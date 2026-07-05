use chromiumoxide::browser::Browser;
use futures::StreamExt;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncBufReadExt;
use tokio::process::Command;
use tokio::sync::Semaphore;

const CHROME_BIN: &str = "/usr/bin/google-chrome-stable";
const SESSION_TIMEOUT: Duration = Duration::from_secs(120);
const PAGE_TIMEOUT: Duration = Duration::from_secs(30);
const PAGE_SETTLE_SECS: u64 = 3;

/// Global semaphore: limit concurrent Chrome sessions to prevent OOM.
/// Chrome headless eats ~200-300MB per tab on heavy pages.
static CHROME_SEMAPHORE: std::sync::OnceLock<Arc<Semaphore>> = std::sync::OnceLock::new();

fn chrome_semaphore() -> Arc<Semaphore> {
    CHROME_SEMAPHORE
        .get_or_init(|| Arc::new(Semaphore::new(2)))
        .clone()
}

/// Managed Chrome instance — launches Chrome with fresh temp dir, connects via CDP WebSocket.
pub struct Chrome {
    pub browser: Browser,
    _event_handle: tokio::task::JoinHandle<()>,
    _chrome_process: tokio::process::Child,
    temp_dir: PathBuf,
    _permit: tokio::sync::OwnedSemaphorePermit,
}

impl Chrome {
    /// Launch Chrome and connect via CDP.
    /// Acquires global semaphore permit (max 2 concurrent sessions).
    pub async fn launch() -> Result<Self, String> {
        let permit = chrome_semaphore()
            .acquire_owned()
            .await
            .map_err(|e| format!("Chrome semaphore error: {e}"))?;

        // Fresh temp dir each time to avoid stale locks
        let temp_dir = std::env::temp_dir().join(format!("chrome-cdp-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let user_data_dir = format!("--user-data-dir={}", temp_dir.display());

        // Kill any zombie Chrome processes using old temp dirs
        let _ = Command::new("pkill")
            .args(["-f", &format!("chrome.*--user-data-dir={}", temp_dir.display())])
            .output()
            .await;

        let mut child = Command::new(CHROME_BIN)
            .args([
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-extensions",
                "--disable-crash-reporter",
                "--disable-background-networking",
                "--no-first-run",
                "--no-default-browser-check",
                &user_data_dir,
                "--remote-debugging-port=0", // random port
            ])
            .stderr(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Chrome spawn error: {e}"))?;

        // Read stderr to find the WebSocket URL
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "No stderr from Chrome".to_string())?;

        let mut reader = tokio::io::BufReader::new(stderr);

        // Chrome prints "DevTools listening on ws://..." to stderr
        let ws_url = tokio::time::timeout(Duration::from_secs(10), async {
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) => break None, // EOF
                    Ok(_) => {
                        if let Some(pos) = line.find("ws://") {
                            return Some(line[pos..].trim().to_string());
                        }
                    }
                    Err(_) => break None,
                }
            }
        })
        .await
        .map_err(|_| "Timeout waiting for Chrome WebSocket URL".to_string())?
        .ok_or_else(|| "Chrome exited without providing WebSocket URL".to_string())?;

        tracing::info!("Chrome CDP connected: {ws_url}");

        // Connect chromiumoxide to the existing Chrome instance
        let (browser, mut handler) = Browser::connect(&ws_url)
            .await
            .map_err(|e| format!("CDP connect error: {e}"))?;

        // Drive CDP events in background (ignore parse errors from newer Chrome versions)
        let event_handle = tokio::spawn(async move {
            loop {
                match handler.next().await {
                    Some(Ok(_)) => {}  // OK, continue
                    Some(Err(_)) => {} // Parse error from unknown CDP event — ignore
                    None => break,     // Stream ended — Chrome closed
                }
            }
        });

        Ok(Self {
            browser,
            _event_handle: event_handle,
            _chrome_process: child,
            temp_dir,
            _permit: permit,
        })
    }

    /// Check if Chrome process is still alive.
    pub fn is_alive(&mut self) -> bool {
        match self._chrome_process.try_wait() {
            Ok(None) => true,    // still running
            Ok(Some(_)) => false, // exited
            Err(_) => false,
        }
    }

    /// Navigate to URL, wait for JS, return rendered text + HTML.
    /// Returns Err if Chrome process is dead or page times out.
    pub async fn get_page(&mut self, url: &str) -> Result<PageContent, String> {
        if !self.is_alive() {
            return Err("Chrome process is dead".to_string());
        }

        tokio::time::timeout(PAGE_TIMEOUT, self.get_page_inner(url))
            .await
            .map_err(|_| format!("Page timeout after {}s: {url}", PAGE_TIMEOUT.as_secs()))?
    }

    async fn get_page_inner(&self, url: &str) -> Result<PageContent, String> {
        let page = self
            .browser
            .new_page(url)
            .await
            .map_err(|e| format!("New page error: {e}"))?;

        // Wait for network idle
        let _ = page.wait_for_navigation().await;
        tokio::time::sleep(Duration::from_secs(PAGE_SETTLE_SECS)).await;

        let text: String = page
            .evaluate("document.body.innerText")
            .await
            .map_err(|e| format!("JS error: {e}"))?
            .into_value()
            .map_err(|e| format!("Value error: {e}"))?;

        let html: String = page
            .evaluate("document.body.innerHTML")
            .await
            .map_err(|e| format!("HTML error: {e}"))?
            .into_value()
            .map_err(|e| format!("Value error: {e}"))?;

        let title: String = page
            .evaluate("document.title")
            .await
            .ok()
            .and_then(|v| v.into_value().ok())
            .unwrap_or_default();

        let _ = page.close().await;

        Ok(PageContent { text, html, title })
    }

    /// Take a full-page screenshot (PNG bytes). Used for Vision API extraction.
    pub async fn screenshot(&mut self, url: &str) -> Result<Vec<u8>, String> {
        if !self.is_alive() {
            return Err("Chrome process is dead".to_string());
        }

        tokio::time::timeout(PAGE_TIMEOUT, self.screenshot_inner(url))
            .await
            .map_err(|_| format!("Screenshot timeout after {}s: {url}", PAGE_TIMEOUT.as_secs()))?
    }

    async fn screenshot_inner(&self, url: &str) -> Result<Vec<u8>, String> {
        use chromiumoxide::page::ScreenshotParams;
        use chromiumoxide::cdp::browser_protocol::page::CaptureScreenshotFormat;

        let page = self
            .browser
            .new_page(url)
            .await
            .map_err(|e| format!("New page error: {e}"))?;

        let _ = page.wait_for_navigation().await;
        tokio::time::sleep(Duration::from_secs(PAGE_SETTLE_SECS)).await;

        let params = ScreenshotParams::builder()
            .format(CaptureScreenshotFormat::Png)
            .full_page(true)
            .build();

        let png_data = page
            .screenshot(params)
            .await
            .map_err(|e| format!("Screenshot error: {e}"))?;

        let _ = page.close().await;
        tracing::info!("Screenshot taken: {url} ({}KB)", png_data.len() / 1024);
        Ok(png_data)
    }

    /// Interact with a calculator: click options, read prices.
    pub async fn scrape_calculator(
        &mut self,
        url: &str,
        config: &CalculatorConfig,
    ) -> Result<Vec<CalculatorResult>, String> {
        if !self.is_alive() {
            return Err("Chrome process is dead".to_string());
        }

        tokio::time::timeout(SESSION_TIMEOUT, self.scrape_calculator_inner(url, config))
            .await
            .map_err(|_| format!("Calculator scrape timeout: {url}"))?
    }

    async fn scrape_calculator_inner(
        &self,
        url: &str,
        config: &CalculatorConfig,
    ) -> Result<Vec<CalculatorResult>, String> {
        let page = self
            .browser
            .new_page(url)
            .await
            .map_err(|e| format!("New page error: {e}"))?;

        let _ = page.wait_for_navigation().await;
        tokio::time::sleep(Duration::from_secs(PAGE_SETTLE_SECS)).await;

        let mut results = Vec::new();

        for selector_group in &config.option_selectors {
            let options_js = format!(
                "Array.from(document.querySelectorAll('{}')).map(el => ({{ \
                    text: el.innerText.trim(), \
                    tag: el.tagName \
                }}))",
                selector_group
            );

            let options: Vec<serde_json::Value> = page
                .evaluate(options_js.as_str())
                .await
                .map_err(|e| format!("Options eval error: {e}"))?
                .into_value()
                .unwrap_or_default();

            let count = options.len();
            tracing::info!("Calculator: found {count} options for selector '{selector_group}'");

            for i in 0..count {
                let click_js = format!(
                    "document.querySelectorAll('{}')[{}].click()",
                    selector_group, i
                );
                let _ = page.evaluate(click_js.as_str()).await;
                tokio::time::sleep(Duration::from_millis(500)).await;

                let price_js = format!(
                    "document.querySelector('{}')?.innerText?.trim() || ''",
                    config.price_selector
                );
                let price_text: String = page
                    .evaluate(price_js.as_str())
                    .await
                    .ok()
                    .and_then(|v| v.into_value().ok())
                    .unwrap_or_default();

                let option_text = options
                    .get(i)
                    .and_then(|v| v["text"].as_str())
                    .unwrap_or("")
                    .to_string();

                if !price_text.is_empty() && !option_text.is_empty() {
                    results.push(CalculatorResult {
                        option: option_text,
                        price_text,
                    });
                }
            }
        }

        let _ = page.close().await;
        Ok(results)
    }

    /// Shutdown Chrome and cleanup temp directory.
    pub async fn close(mut self) {
        let _ = self._chrome_process.kill().await;
        self._event_handle.abort();
        // Cleanup temp user-data-dir
        let _ = tokio::fs::remove_dir_all(&self.temp_dir).await;
    }
}

/// Fallback: fetch page via Chrome --dump-dom (no CDP, just stdout).
/// Works when CDP connection fails but Chrome binary is fine.
pub async fn dump_dom(url: &str) -> Result<DumpDomResult, String> {
    let temp_dir = std::env::temp_dir().join(format!("chrome-dump-{}", std::process::id()));
    let _ = std::fs::create_dir_all(&temp_dir);
    let user_data_dir = format!("--user-data-dir={}", temp_dir.display());

    let output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new(CHROME_BIN)
            .args([
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--dump-dom",
                &user_data_dir,
                url,
            ])
            .output(),
    )
    .await
    .map_err(|_| format!("dump-dom timeout for {url}"))?
    .map_err(|e| format!("dump-dom exec error: {e}"))?;

    let _ = tokio::fs::remove_dir_all(&temp_dir).await;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("dump-dom failed ({}): {stderr}", output.status));
    }

    let html = String::from_utf8_lossy(&output.stdout).to_string();

    // Extract text from HTML using scraper crate
    let document = scraper::Html::parse_document(&html);
    let text = if let Ok(body_sel) = scraper::Selector::parse("body") {
        document
            .select(&body_sel)
            .next()
            .map(|body| body.text().collect::<Vec<_>>().join(" "))
            .unwrap_or_default()
    } else {
        String::new()
    };

    let title = if let Ok(title_sel) = scraper::Selector::parse("title") {
        document
            .select(&title_sel)
            .next()
            .map(|t| t.text().collect::<String>())
            .unwrap_or_default()
    } else {
        String::new()
    };

    Ok(DumpDomResult { html, text, title })
}

pub struct PageContent {
    pub text: String,
    pub html: String,
    pub title: String,
}

pub struct DumpDomResult {
    pub html: String,
    pub text: String,
    pub title: String,
}

/// Configuration for scraping a calculator on a page
#[derive(Debug, Clone, serde::Deserialize)]
pub struct CalculatorConfig {
    /// CSS selectors for clickable options (e.g., ".size-tab", ".paper-option")
    pub option_selectors: Vec<String>,
    /// CSS selector for the price display element
    pub price_selector: String,
}

pub struct CalculatorResult {
    pub option: String,
    pub price_text: String,
}
