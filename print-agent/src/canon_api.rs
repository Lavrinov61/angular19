//! Canon Remote UI HTTP API client.
//!
//! Handles RSA PKCS1v15 login, address book CRUD, session management.
//! Target: Canon iR C3226i at http://192.168.1.146:8000.
//!
//! Login flow:
//! 1. GET /login → parse RSA modulus, exponent, challenge from HTML/JS
//! 2. plaintext = challenge + ":" + password
//! 3. RSA PKCS1v15 encrypt → base64
//! 4. POST /login with encrypted_password + username
//! 5. Session maintained via cookie jar

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{bail, Context, Result};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rumqttc::QoS;
use tracing::{debug, info, warn};

use svf_agent_core::circuit_breaker::CircuitBreaker;
use svf_agent_core::mqtt;

// ── Config ──

/// Canon Remote UI configuration (deserialized from config.toml `[canon]` section).
///
/// Note: `Debug` is manually implemented to mask the `password` field.
#[derive(Clone, serde::Deserialize)]
pub struct CanonConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_remote_ui_url")]
    pub remote_ui_url: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_canon_poll_interval")]
    pub poll_interval_secs: u64,
}

impl std::fmt::Debug for CanonConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CanonConfig")
            .field("enabled", &self.enabled)
            .field("remote_ui_url", &self.remote_ui_url)
            .field("username", &self.username)
            .field("password", &"********")
            .field("poll_interval_secs", &self.poll_interval_secs)
            .finish()
    }
}

impl Default for CanonConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            remote_ui_url: default_remote_ui_url(),
            username: String::new(),
            password: String::new(),
            poll_interval_secs: default_canon_poll_interval(),
        }
    }
}

fn default_remote_ui_url() -> String {
    "http://192.168.1.146:8000".into()
}

fn default_canon_poll_interval() -> u64 {
    300
}

// ── Data types ──

/// A single entry in the Canon address book.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AddressBookEntry {
    pub index: u32,
    pub name: String,
    /// SMB path or email address.
    pub address: String,
    /// Credentials for SMB shares.
    pub username: String,
    /// Protocol code (7 = SMB, 1 = email).
    pub protocol: u8,
}

// ── Session ──

/// Persistent session to Canon Remote UI with auto-relogin.
pub struct CanonSession {
    client: reqwest::Client,
    base_url: String,
    username: String,
    password: String,
    authenticated: AtomicBool,
}

impl CanonSession {
    /// Create a new session. Does NOT authenticate yet — call `login()` first.
    pub fn new(base_url: &str, username: &str, password: &str) -> Self {
        let client = reqwest::Client::builder()
            .cookie_store(true)
            .timeout(Duration::from_secs(15))
            .connect_timeout(Duration::from_secs(5))
            .build()
            .expect("Failed to build reqwest client with cookie store");

        Self {
            client,
            base_url: base_url.trim_end_matches('/').to_string(),
            username: username.to_string(),
            password: password.to_string(),
            authenticated: AtomicBool::new(false),
        }
    }

    /// Login via RSA PKCS1v15 encrypted password.
    ///
    /// 1. GET /login → parse modulus, exponent, challenge from JS vars
    /// 2. Encrypt `challenge:password` with RSA public key
    /// 3. POST /login with encrypted payload
    /// 4. Verify we got a valid session cookie
    pub async fn login(&self) -> Result<()> {
        let login_url = format!("{}/login", self.base_url);

        // Step 1: fetch login page
        let resp = self
            .client
            .get(&login_url)
            .send()
            .await
            .context("GET /login failed")?;

        if !resp.status().is_success() {
            bail!("Login page returned status {}", resp.status());
        }

        let html = resp.text().await.context("Failed to read login page body")?;

        // Step 2: parse RSA parameters from JavaScript
        let (modulus_hex, exponent_hex, challenge) =
            parse_login_page(&html).context("Failed to parse RSA parameters from login page")?;

        debug!(
            modulus_len = modulus_hex.len(),
            challenge_len = challenge.len(),
            "Parsed Canon login page RSA parameters"
        );

        // Step 3: encrypt
        let plaintext = format!("{}:{}", challenge, self.password);
        let encrypted =
            rsa_encrypt(&modulus_hex, &exponent_hex, &plaintext).context("RSA encryption failed")?;

        // Step 4: POST login
        let resp = self
            .client
            .post(&login_url)
            .form(&[
                ("DWP_SYS_ENCODED_PASSWORD", encrypted.as_str()),
                ("DWP_SYS_USERNAME", &self.username),
                ("DWP_SYS_AUTHTYPE", "1"),
            ])
            .send()
            .await
            .context("POST /login failed")?;

        // Canon returns 200 with a redirect on success, or 200 with the login form again on failure.
        // Check if we got session cookies as the reliable indicator.
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();

        if status.is_success() && !body.contains("DWP_SYS_ENCODED_PASSWORD") {
            self.authenticated.store(true, Ordering::Relaxed);
            info!("Canon Remote UI login successful");
            Ok(())
        } else {
            self.authenticated.store(false, Ordering::Relaxed);
            bail!("Canon login failed — still on login page (status={status})");
        }
    }

    /// Fetch the address book from Canon Remote UI.
    ///
    /// GET /rps/asublist.cgi?CorePGTAG=24&AMOD=0 → parse HTML table rows.
    pub async fn list_addresses(&self) -> Result<Vec<AddressBookEntry>> {
        let url = format!(
            "{}/rps/asublist.cgi?CorePGTAG=24&AMOD=0",
            self.base_url
        );

        let resp = self
            .request_with_auth(self.client.get(&url))
            .await
            .context("list_addresses request failed")?;

        let html = resp.text().await.context("Failed to read address list body")?;
        parse_address_list(&html)
    }

    /// Add a new entry to the Canon address book.
    ///
    /// POST /rps/albody.cgi with Go_NextPage("Add_adrs") action.
    #[allow(dead_code)]
    pub async fn add_address(
        &self,
        name: &str,
        smb_path: &str,
        username: &str,
        password: &str,
    ) -> Result<()> {
        let url = format!("{}/rps/albody.cgi", self.base_url);

        let resp = self
            .request_with_auth(
                self.client.post(&url).form(&[
                    ("AMOD", "0"),
                    ("ANAME", name),
                    ("AAD1", smb_path),
                    ("AUSER", username),
                    ("APWORD", password),
                    ("APRTCL", "7"), // SMB
                    ("Go_NextPage", "Add_adrs"),
                ]),
            )
            .await
            .context("add_address request failed")?;

        let status = resp.status();
        if status.is_success() {
            // NB: never log password or form data containing APWORD
            info!(name, smb_path, user = username, "Address added to Canon address book");
            Ok(())
        } else {
            bail!("add_address failed with status {status}");
        }
    }

    /// Delete an entry from the Canon address book by index.
    ///
    /// POST /rps/albody.cgi with Go_NextPage("Del_adrs").
    #[allow(dead_code)]
    pub async fn delete_address(&self, index: u32) -> Result<()> {
        let url = format!("{}/rps/albody.cgi", self.base_url);

        let resp = self
            .request_with_auth(
                self.client.post(&url).form(&[
                    ("AIDX", index.to_string()),
                    ("Go_NextPage", "Del_adrs".to_string()),
                ]),
            )
            .await
            .context("delete_address request failed")?;

        let status = resp.status();
        if status.is_success() {
            info!(index, "Address deleted from Canon address book");
            Ok(())
        } else {
            bail!("delete_address failed with status {status}");
        }
    }

    /// Execute a request with automatic re-authentication on 401.
    async fn request_with_auth(
        &self,
        req: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response> {
        // Ensure we're authenticated
        if !self.authenticated.load(Ordering::Relaxed) {
            self.login().await?;
        }

        let resp = req
            .try_clone()
            .context("Cannot clone request for retry")?
            .send()
            .await
            .context("HTTP request failed")?;

        // If 401/403 or redirected to login page, re-authenticate and retry
        if resp.status() == reqwest::StatusCode::UNAUTHORIZED
            || resp.status() == reqwest::StatusCode::FORBIDDEN
        {
            warn!("Canon session expired, re-authenticating");
            self.authenticated.store(false, Ordering::Relaxed);
            self.login().await?;

            // Retry the original request (clone was already taken above, rebuild from caller)
            // Since we can't retry from here after consuming resp, the caller should handle this.
            // For simplicity, we bail and let the run loop retry on next cycle.
            bail!("Session expired and re-authenticated — retry on next poll cycle");
        }

        Ok(resp)
    }
}

// ── RSA helpers ──

/// Parse RSA modulus, exponent, and challenge from Canon login page HTML/JS.
///
/// Canon embeds these as JS variables, e.g.:
/// ```js
/// var Modulus = "ABCDEF123...";
/// var Exponent = "010001";
/// var DWP_SYS_CHALLENGE = "random_string";
/// ```
fn parse_login_page(html: &str) -> Result<(String, String, String)> {
    let extract = |patterns: &[&str]| -> Option<String> {
        for pattern in patterns {
            // Match: var <name> = "<value>" or var <name> = '<value>'
            let search = format!("{pattern}");
            if let Some(pos) = html.find(&search) {
                let after = &html[pos + search.len()..];
                // Skip whitespace and = sign
                let after = after.trim_start();
                let after = after.strip_prefix('=').unwrap_or(after).trim_start();
                // Extract quoted value
                let quote = after.chars().next()?;
                if quote == '"' || quote == '\'' {
                    let rest = &after[1..];
                    if let Some(end) = rest.find(quote) {
                        return Some(rest[..end].to_string());
                    }
                }
            }
        }
        None
    };

    let modulus = extract(&["var Modulus", "var modulus", "\"Modulus\""])
        .context("RSA modulus not found in login page")?;

    let exponent = extract(&["var Exponent", "var exponent", "\"Exponent\""])
        .context("RSA exponent not found in login page")?;

    let challenge = extract(&[
        "var DWP_SYS_CHALLENGE",
        "var Challenge",
        "var challenge",
        "\"DWP_SYS_CHALLENGE\"",
    ])
    .context("Challenge not found in login page")?;

    if modulus.is_empty() || exponent.is_empty() || challenge.is_empty() {
        bail!("One or more RSA parameters are empty");
    }

    Ok((modulus, exponent, challenge))
}

/// RSA PKCS1v15 encrypt plaintext using modulus and exponent (hex-encoded).
fn rsa_encrypt(modulus_hex: &str, exponent_hex: &str, plaintext: &str) -> Result<String> {
    use rsa::{BigUint, Pkcs1v15Encrypt, RsaPublicKey};

    let n = BigUint::parse_bytes(modulus_hex.as_bytes(), 16)
        .context("Invalid RSA modulus hex")?;
    let e = BigUint::parse_bytes(exponent_hex.as_bytes(), 16)
        .context("Invalid RSA exponent hex")?;

    let key = RsaPublicKey::new(n, e).context("Invalid RSA public key")?;
    let encrypted = key.encrypt(&mut rand::rngs::OsRng, Pkcs1v15Encrypt, plaintext.as_bytes())
        .context("RSA encryption failed")?;

    Ok(BASE64.encode(&encrypted))
}

// ── Address book parser ──

/// Parse HTML table from Canon address list page into structured entries.
///
/// The Canon Remote UI renders an HTML table with columns:
/// Index | Name | Address | Protocol | Username
fn parse_address_list(html: &str) -> Result<Vec<AddressBookEntry>> {
    let mut entries = Vec::new();

    // Canon uses <tr> rows with specific field patterns.
    // We look for table rows containing address data.
    // Each entry has AIDX (index), ANAME (name), AAD1 (address), APRTCL (protocol).

    // Strategy: find all <input> hidden fields in forms, or parse table <td> cells.
    // The actual HTML structure varies by firmware, so we try multiple approaches.

    // Approach 1: Parse input hidden fields (common in Canon Remote UI forms)
    let mut i = 0;
    while let Some(found) = html[i..].find("AIDX") {
        let aidx_pos = i + found;
        // Back up to include the name=" prefix so extract_field_value can match
        let block_start = aidx_pos.saturating_sub(6);
        // Find the next reasonable block boundary (next AIDX or end)
        let block_end = html[aidx_pos + 4..]
            .find("AIDX")
            .map(|p| aidx_pos + 4 + p)
            .unwrap_or(html.len());
        let block = &html[block_start..block_end];

        let index = extract_field_value(block, "AIDX")
            .and_then(|v| v.parse::<u32>().ok());
        let name = extract_field_value(block, "ANAME");
        let address = extract_field_value(block, "AAD1");
        let protocol = extract_field_value(block, "APRTCL")
            .and_then(|v| v.parse::<u8>().ok())
            .unwrap_or(7);
        let username = extract_field_value(block, "AUSER").unwrap_or_default();

        if let (Some(index), Some(name), Some(address)) = (index, name, address) {
            if !name.is_empty() {
                entries.push(AddressBookEntry {
                    index,
                    name,
                    address,
                    username,
                    protocol,
                });
            }
        }

        i = block_end;
    }

    // Approach 2: If no hidden fields found, try parsing <td> cells
    if entries.is_empty() {
        debug!("No hidden fields found, trying <td> cell parsing");
        entries = parse_address_table_cells(html);
    }

    debug!(count = entries.len(), "Parsed Canon address book entries");
    Ok(entries)
}

/// Extract value from a form field like: name="FIELD" value="VALUE"
fn extract_field_value(html: &str, field_name: &str) -> Option<String> {
    // Look for: name="<field_name>" ... value="<value>"
    // or: <field_name>=<value> in URL params
    let patterns = [
        format!("name=\"{field_name}\" value=\""),
        format!("name='{field_name}' value='"),
        format!("name=\"{field_name}\"  value=\""),
    ];

    for pattern in &patterns {
        if let Some(pos) = html.find(pattern.as_str()) {
            let after = &html[pos + pattern.len()..];
            let quote = if pattern.contains('"') { '"' } else { '\'' };
            if let Some(end) = after.find(quote) {
                return Some(after[..end].to_string());
            }
        }
    }

    None
}

/// Fallback: parse <td> cells from an HTML table.
fn parse_address_table_cells(html: &str) -> Vec<AddressBookEntry> {
    let mut entries = Vec::new();
    let mut idx = 0u32;

    // Simple approach: find <tr> blocks, extract <td> content
    let rows: Vec<&str> = html.split("<tr").collect();
    for row in rows.iter().skip(1) {
        // Skip header rows
        if row.contains("<th") {
            continue;
        }

        let cells: Vec<String> = row
            .split("<td")
            .skip(1)
            .filter_map(|cell| {
                // Extract text between > and </td>
                let content_start = cell.find('>')?;
                let content = &cell[content_start + 1..];
                let content_end = content.find("</td")?;
                let text = content[..content_end].trim();
                // Strip inner HTML tags
                let text = strip_html_tags(text);
                if text.is_empty() {
                    None
                } else {
                    Some(text)
                }
            })
            .collect();

        // Expect at least name and address columns
        if cells.len() >= 2 {
            idx += 1;
            entries.push(AddressBookEntry {
                index: idx,
                name: cells[0].clone(),
                address: cells.get(1).cloned().unwrap_or_default(),
                username: cells.get(2).cloned().unwrap_or_default(),
                protocol: 7,
            });
        }
    }

    entries
}

/// Minimal HTML tag stripping for cell content.
fn strip_html_tags(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => result.push(ch),
            _ => {}
        }
    }
    result.trim().to_string()
}

// ── Background task ──

/// Background task: periodically poll Canon address book and publish via MQTT.
///
/// This task:
/// 1. Logs in to Canon Remote UI
/// 2. Fetches address book entries
/// 3. Publishes JSON payload to MQTT topic
/// 4. Sleeps for `poll_interval_secs`
pub async fn run(state: Arc<crate::AgentState>) {
    let config = &state.config.canon;
    if !config.enabled {
        debug!("Canon Remote UI integration disabled");
        return;
    }

    if config.username.is_empty() || config.password.is_empty() {
        warn!("Canon credentials not configured, skipping Canon Remote UI integration");
        return;
    }

    info!(
        url = %config.remote_ui_url,
        user = %config.username,
        poll_secs = config.poll_interval_secs,
        "Starting Canon Remote UI integration"
    );

    let session = CanonSession::new(&config.remote_ui_url, &config.username, &config.password);
    let poll_interval = Duration::from_secs(config.poll_interval_secs);

    // Circuit breaker: 5 consecutive failures → open for 5 minutes
    let mut cb = CircuitBreaker::new("canon-remote-ui", 5, Duration::from_secs(300));

    // Initial delay to let MQTT connect
    tokio::time::sleep(Duration::from_secs(10)).await;

    let prefix = mqtt::topic_prefix(
        &state.config.base.agent.studio_id,
        &state.config.base.agent.agent_type,
    );
    let topic = format!("{prefix}/canon/addresses");

    loop {
        if let Err(wait) = cb.check() {
            debug!(wait_secs = wait.as_secs(), "Canon API circuit open, skipping");
            tokio::time::sleep(poll_interval).await;
            continue;
        }

        match session.login().await {
            Ok(()) => match session.list_addresses().await {
                Ok(entries) => {
                    cb.record_success();
                    debug!(count = entries.len(), "Fetched Canon address book");
                    match serde_json::to_vec(&entries) {
                        Ok(payload) => {
                            if let Err(e) = state
                                .mqtt_handle
                                .publish(&topic, QoS::AtLeastOnce, false, payload)
                                .await
                            {
                                warn!("Failed to publish Canon addresses: {e}");
                            }
                        }
                        Err(e) => warn!("Failed to serialize Canon addresses: {e}"),
                    }
                }
                Err(e) => {
                    cb.record_failure();
                    warn!("Failed to fetch Canon addresses: {e}");
                }
            },
            Err(e) => {
                cb.record_failure();
                warn!("Canon Remote UI login failed: {e}");
            }
        }

        tokio::time::sleep(poll_interval).await;
    }
}

// ── Tests ──

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_login_page_js_vars() {
        let html = r#"
            <html><head><script>
            var Modulus = "ABCDEF0123456789";
            var Exponent = "010001";
            var DWP_SYS_CHALLENGE = "test_challenge_123";
            </script></head></html>
        "#;

        let (modulus, exponent, challenge) = parse_login_page(html).unwrap();
        assert_eq!(modulus, "ABCDEF0123456789");
        assert_eq!(exponent, "010001");
        assert_eq!(challenge, "test_challenge_123");
    }

    #[test]
    fn test_parse_login_page_missing_fields() {
        let html = "<html><body>No JS here</body></html>";
        assert!(parse_login_page(html).is_err());
    }

    #[test]
    fn test_extract_field_value() {
        let html = r#"<input type="hidden" name="ANAME" value="Test Scan Folder">"#;
        assert_eq!(
            extract_field_value(html, "ANAME"),
            Some("Test Scan Folder".to_string())
        );
    }

    #[test]
    fn test_extract_field_value_missing() {
        let html = r#"<input type="hidden" name="OTHER" value="foo">"#;
        assert_eq!(extract_field_value(html, "ANAME"), None);
    }

    #[test]
    fn test_strip_html_tags() {
        assert_eq!(strip_html_tags("<b>hello</b>"), "hello");
        assert_eq!(strip_html_tags("plain text"), "plain text");
        assert_eq!(strip_html_tags("<a href=\"#\">link</a>"), "link");
    }

    #[test]
    fn test_parse_address_list_hidden_fields() {
        let html = r#"
            <form>
            <input name="AIDX" value="1">
            <input name="ANAME" value="Scan Folder">
            <input name="AAD1" value="\\server\scans">
            <input name="APRTCL" value="7">
            <input name="AUSER" value="admin">
            </form>
        "#;

        let entries = parse_address_list(html).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].index, 1);
        assert_eq!(entries[0].name, "Scan Folder");
        assert_eq!(entries[0].address, "\\\\server\\scans");
        assert_eq!(entries[0].protocol, 7);
    }

    #[test]
    fn test_parse_empty_address_list() {
        let html = "<html><body>No addresses</body></html>";
        let entries = parse_address_list(html).unwrap();
        assert!(entries.is_empty());
    }
}
