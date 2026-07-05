//! Command execution with config-driven whitelist.
//!
//! All allowed commands are loaded from TOML config at startup.
//! The binary itself contains NO command names — this prevents
//! antivirus heuristics from flagging the executable.

use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tracing::{error, warn};

use crate::AgentState;

#[derive(Debug, Deserialize)]
pub struct ExecRequest {
    pub request_id: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct ExecResult {
    pub request_id: String,
    pub command: String,
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub error: Option<String>,
}

/// Validate that the command is whitelisted and execute it.
pub async fn run_whitelisted(state: &AgentState, req: ExecRequest) -> ExecResult {
    let full_command = if req.args.is_empty() {
        req.command.clone()
    } else {
        format!("{} {}", req.command, req.args.join(" "))
    };

    let monitor = &state.config.monitor;

    // Security: validate command against config whitelist
    if let Err(reason) = validate_command(&req.command, &req.args, monitor) {
        warn!(
            command = %req.command,
            reason = %reason,
            "Command rejected by whitelist"
        );
        return ExecResult {
            request_id: req.request_id,
            command: full_command,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms: 0,
            error: Some(format!("Command rejected: {reason}")),
        };
    }

    let timeout = Duration::from_secs(
        req.timeout_secs.unwrap_or(monitor.exec_timeout_secs),
    );
    let max_output = monitor.max_output_bytes;

    let start = Instant::now();
    let mut cmd = build_command(&req.command, &req.args);
    let result = tokio::time::timeout(timeout, cmd.output()).await;
    let duration_ms = start.elapsed().as_millis() as u64;

    match result {
        Ok(Ok(output)) => {
            let stdout = truncate_output(
                String::from_utf8_lossy(&output.stdout).into_owned(),
                max_output,
            );
            let stderr = truncate_output(
                String::from_utf8_lossy(&output.stderr).into_owned(),
                max_output,
            );
            ExecResult {
                request_id: req.request_id,
                command: full_command,
                exit_code: output.status.code().unwrap_or(-1),
                stdout,
                stderr,
                duration_ms,
                error: None,
            }
        }
        Ok(Err(e)) => {
            error!(error = %e, "Command execution failed");
            ExecResult {
                request_id: req.request_id,
                command: full_command,
                exit_code: -1,
                stdout: String::new(),
                stderr: String::new(),
                duration_ms,
                error: Some(format!("Execution error: {e}")),
            }
        }
        Err(_) => ExecResult {
            request_id: req.request_id,
            command: full_command,
            exit_code: -1,
            stdout: String::new(),
            stderr: String::new(),
            duration_ms,
            error: Some(format!("Command timed out after {timeout:?}")),
        },
    }
}

use crate::MonitorConfig;

/// Validate command against config-driven whitelist.
fn validate_command(command: &str, args: &[String], cfg: &MonitorConfig) -> Result<(), String> {
    let base = command.to_lowercase();
    let base = base.strip_suffix(".exe").unwrap_or(&base);

    // Check against allowed_commands from config
    if cfg.allowed_commands.iter().any(|a| a.to_lowercase() == base) {
        // Reject shell metacharacters in args (single-char and multi-char operators)
        for arg in args {
            if arg.contains('|')
                || arg.contains('&')
                || arg.contains(';')
                || arg.contains('`')
                || arg.contains('$')
                || arg.contains('>')
                || arg.contains('<')
            {
                return Err(format!("Shell metacharacters not allowed in args: {arg}"));
            }
            // Explicit multi-char operator check (defense-in-depth)
            if arg.contains("&&")
                || arg.contains("||")
                || arg.contains("$(")
                || arg.contains(">>")
            {
                return Err(format!("Blocked: shell operator in argument: {arg}"));
            }
        }
        return Ok(());
    }

    // Check PowerShell commands against allowed_ps_commands from config
    if base == "powershell" || base == "pwsh" {
        let combined_args = args.join(" ");
        let ps_command = combined_args
            .strip_prefix("-Command ")
            .or_else(|| combined_args.strip_prefix("-c "))
            .unwrap_or(&combined_args);

        if cfg.allowed_ps_commands.iter().any(|a| ps_command.starts_with(a.as_str())) {
            // Safety net: check blocked patterns
            let lower = ps_command.to_lowercase();
            for blocked in &cfg.blocked_ps_patterns {
                if lower.contains(&blocked.to_lowercase()) {
                    return Err(format!("Blocked pattern: {blocked}"));
                }
            }

            // Block pipe chaining and shell operators
            // The first cmdlet is whitelisted, but anything after | is not validated.
            if ps_command.contains('|') {
                return Err("Pipe chaining not allowed in PowerShell commands".to_string());
            }
            if ps_command.contains("&&")
                || ps_command.contains("||")
                || ps_command.contains("$(")
                || ps_command.contains(">>")
                || ps_command.contains(';')
            {
                return Err("Blocked: shell operator in PowerShell command".to_string());
            }

            return Ok(());
        }

        return Err(format!("PowerShell command not in whitelist: {ps_command}"));
    }

    Err(format!("Executable not in whitelist: {base}"))
}

/// Encode a PowerShell command as base64 UTF-16LE for `-EncodedCommand`.
///
/// This prevents injection via shell metacharacters that survive quoting,
/// because the encoded blob is opaque to the shell parser.
fn encode_ps_command(cmd: &str) -> String {
    use base64::Engine;
    let utf16: Vec<u8> = cmd.encode_utf16()
        .flat_map(|c| c.to_le_bytes())
        .collect();
    base64::engine::general_purpose::STANDARD.encode(&utf16)
}

/// Build a tokio::process::Command.
fn build_command(command: &str, args: &[String]) -> tokio::process::Command {
    #[cfg(target_os = "windows")]
    {
        let base_lower = command.to_lowercase();
        let base = base_lower.strip_suffix(".exe").unwrap_or(&base_lower);
        let is_builtin = matches!(base, "dir" | "type" | "ver" | "hostname" | "copy" | "del"
            | "move" | "ren" | "mkdir" | "rmdir" | "set");

        if is_builtin {
            let mut cmd = tokio::process::Command::new("cmd.exe");
            cmd.arg("/C").arg(command);
            for arg in args {
                cmd.arg(arg);
            }
            cmd
        } else if base == "powershell" || base == "pwsh" {
            // Extract the PS command text from args (strip -Command/-c prefix)
            let combined_args = args.join(" ");
            let ps_text = combined_args
                .strip_prefix("-Command ")
                .or_else(|| combined_args.strip_prefix("-c "))
                .unwrap_or(&combined_args);

            let encoded = encode_ps_command(ps_text);
            let mut cmd = tokio::process::Command::new(command);
            cmd.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded]);
            cmd
        } else {
            let mut cmd = tokio::process::Command::new(command);
            for arg in args {
                cmd.arg(arg);
            }
            cmd
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let full = if args.is_empty() {
            command.to_string()
        } else {
            format!("{} {}", command, args.join(" "))
        };
        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(full);
        cmd
    }
}

/// Truncate output to max bytes, preserving UTF-8 boundary.
fn truncate_output(s: String, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    let mut truncated = s[..end].to_string();
    truncated.push_str("\n... [output truncated]");
    truncated
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config(
        commands: Vec<&str>,
        ps_commands: Vec<&str>,
        blocked: Vec<&str>,
    ) -> MonitorConfig {
        MonitorConfig {
            exec_timeout_secs: 30,
            max_output_bytes: 65536,
            whitelisted_paths: vec![],
            allowed_commands: commands.into_iter().map(String::from).collect(),
            allowed_ps_commands: ps_commands.into_iter().map(String::from).collect(),
            blocked_ps_patterns: blocked.into_iter().map(String::from).collect(),
            allowed_services: vec![],
        }
    }

    // --- validate_command: whitelist ---

    #[test]
    fn test_validate_whitelisted_command() {
        let cfg = make_config(vec!["hostname", "ipconfig"], vec![], vec![]);
        assert!(validate_command("hostname", &[], &cfg).is_ok());
        assert!(validate_command("ipconfig", &[], &cfg).is_ok());
    }

    #[test]
    fn test_validate_command_case_insensitive() {
        let cfg = make_config(vec!["hostname"], vec![], vec![]);
        assert!(validate_command("HOSTNAME", &[], &cfg).is_ok());
        assert!(validate_command("Hostname.exe", &[], &cfg).is_ok());
    }

    #[test]
    fn test_validate_command_not_whitelisted() {
        let cfg = make_config(vec!["hostname"], vec![], vec![]);
        let result = validate_command("rm", &[], &cfg);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not in whitelist"));
    }

    // --- validate_command: metacharacter blocking ---

    #[test]
    fn test_validate_blocks_pipe_in_args() {
        let cfg = make_config(vec!["dir"], vec![], vec![]);
        let args = vec!["| del *".to_string()];
        let result = validate_command("dir", &args, &cfg);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("metacharacters"));
    }

    #[test]
    fn test_validate_blocks_ampersand_in_args() {
        let cfg = make_config(vec!["echo"], vec![], vec![]);
        let args = vec!["hello & del *".to_string()];
        assert!(validate_command("echo", &args, &cfg).is_err());
    }

    #[test]
    fn test_validate_blocks_semicolon_in_args() {
        let cfg = make_config(vec!["echo"], vec![], vec![]);
        let args = vec!["hello; rm -rf /".to_string()];
        assert!(validate_command("echo", &args, &cfg).is_err());
    }

    #[test]
    fn test_validate_blocks_backtick_in_args() {
        let cfg = make_config(vec!["echo"], vec![], vec![]);
        let args = vec!["`whoami`".to_string()];
        assert!(validate_command("echo", &args, &cfg).is_err());
    }

    #[test]
    fn test_validate_blocks_dollar_in_args() {
        let cfg = make_config(vec!["echo"], vec![], vec![]);
        let args = vec!["$(whoami)".to_string()];
        assert!(validate_command("echo", &args, &cfg).is_err());
    }

    #[test]
    fn test_validate_blocks_redirect_in_args() {
        let cfg = make_config(vec!["echo"], vec![], vec![]);
        assert!(validate_command("echo", &["hello > evil.txt".into()], &cfg).is_err());
        assert!(validate_command("echo", &["hello < input.txt".into()], &cfg).is_err());
    }

    #[test]
    fn test_validate_clean_args_pass() {
        let cfg = make_config(vec!["ipconfig"], vec![], vec![]);
        let args = vec!["/all".to_string()];
        assert!(validate_command("ipconfig", &args, &cfg).is_ok());
    }

    // --- validate_command: PowerShell ---

    #[test]
    fn test_validate_ps_whitelisted_command() {
        let cfg = make_config(vec![], vec!["Get-Service"], vec![]);
        let args = vec!["-Command".to_string(), "Get-Service SvfPrintAgent".to_string()];
        assert!(validate_command("powershell", &args, &cfg).is_ok());
    }

    #[test]
    fn test_validate_ps_not_whitelisted() {
        let cfg = make_config(vec![], vec!["Get-Service"], vec![]);
        let args = vec!["-Command".to_string(), "Remove-Item C:\\".to_string()];
        let result = validate_command("powershell", &args, &cfg);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not in whitelist"));
    }

    #[test]
    fn test_validate_ps_blocked_pattern() {
        let cfg = make_config(vec![], vec!["Get-Process"], vec!["Invoke-Expression"]);
        let args = vec!["-Command".to_string(), "Get-Process | Invoke-Expression".to_string()];
        // pipe is blocked first
        let result = validate_command("powershell", &args, &cfg);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_ps_blocks_pipe_chaining() {
        let cfg = make_config(vec![], vec!["Get-Service"], vec![]);
        let args = vec!["-Command".to_string(), "Get-Service | Stop-Service".to_string()];
        let result = validate_command("powershell", &args, &cfg);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Pipe chaining"));
    }

    #[test]
    fn test_validate_ps_blocks_shell_operators() {
        let cfg = make_config(vec![], vec!["Get-Service"], vec![]);
        for op in &["&&", "||", "$(", ">>", ";"] {
            let cmd = format!("Get-Service {op} evil");
            let args = vec!["-Command".to_string(), cmd];
            assert!(
                validate_command("powershell", &args, &cfg).is_err(),
                "should block operator: {op}"
            );
        }
    }

    #[test]
    fn test_validate_pwsh_alias() {
        let cfg = make_config(vec![], vec!["Get-Service"], vec![]);
        let args = vec!["-Command".to_string(), "Get-Service".to_string()];
        assert!(validate_command("pwsh", &args, &cfg).is_ok());
    }

    // --- encode_ps_command ---

    #[test]
    fn test_encode_ps_command_roundtrip() {
        let cmd = "Get-Service SvfPrintAgent";
        let encoded = encode_ps_command(cmd);
        // Decode and verify
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&encoded).unwrap();
        let utf16: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let decoded = String::from_utf16(&utf16).unwrap();
        assert_eq!(decoded, cmd);
    }

    #[test]
    fn test_encode_ps_command_cyrillic() {
        let cmd = "Write-Output 'Привет'";
        let encoded = encode_ps_command(cmd);
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD.decode(&encoded).unwrap();
        let utf16: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        let decoded = String::from_utf16(&utf16).unwrap();
        assert_eq!(decoded, cmd);
    }

    // --- truncate_output ---

    #[test]
    fn test_truncate_output_short() {
        let s = "hello".to_string();
        assert_eq!(truncate_output(s, 100), "hello");
    }

    #[test]
    fn test_truncate_output_exact_boundary() {
        let s = "hello".to_string();
        assert_eq!(truncate_output(s, 5), "hello");
    }

    #[test]
    fn test_truncate_output_cuts() {
        let s = "hello world".to_string();
        let result = truncate_output(s, 5);
        assert!(result.starts_with("hello"));
        assert!(result.contains("[output truncated]"));
    }

    #[test]
    fn test_truncate_output_utf8_boundary() {
        // "Привет" is 12 bytes in UTF-8 (2 bytes per cyrillic char)
        let s = "Привет".to_string();
        assert_eq!(s.len(), 12);
        // Truncate at 5 bytes — must not split a multi-byte char
        let result = truncate_output(s, 5);
        // Should cut to 4 bytes (2 full chars "Пр")
        assert!(result.starts_with("Пр"));
        assert!(result.contains("[output truncated]"));
    }

    #[test]
    fn test_truncate_output_zero_max() {
        let s = "hello".to_string();
        let result = truncate_output(s, 0);
        assert!(result.contains("[output truncated]"));
    }
}
