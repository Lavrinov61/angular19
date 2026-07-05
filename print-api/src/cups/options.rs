//! CUPS/PPD option discovery via `lpoptions`.

use std::collections::{HashMap, HashSet};

use tokio::process::Command;

#[derive(Debug, Clone, Default)]
pub struct CupsOptions {
    choices: HashMap<String, HashSet<String>>,
}

impl CupsOptions {
    pub async fn load(printer: &str) -> Result<Self, String> {
        if printer.trim().is_empty() {
            return Err("CUPS printer name is empty".to_string());
        }

        let output = Command::new("lpoptions")
            .arg("-p")
            .arg(printer)
            .arg("-l")
            .output()
            .await
            .map_err(|e| format!("Failed to execute `lpoptions`: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                format!("lpoptions failed with status {}", output.status)
            } else {
                format!("lpoptions failed with status {}: {stderr}", output.status)
            });
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        Ok(Self::parse(&stdout))
    }

    pub fn parse(output: &str) -> Self {
        let mut choices: HashMap<String, HashSet<String>> = HashMap::new();

        for line in output
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
        {
            let Some((option_label, raw_choices)) = line.split_once(':') else {
                continue;
            };
            let option = option_label
                .split('/')
                .next()
                .unwrap_or(option_label)
                .trim();
            if option.is_empty() {
                continue;
            }

            let option_choices = choices.entry(option.to_string()).or_default();
            for raw_choice in raw_choices.split_whitespace() {
                let choice = raw_choice.trim_start_matches('*').trim();
                if !choice.is_empty() {
                    option_choices.insert(choice.to_string());
                }
            }
        }

        Self { choices }
    }

    pub fn supports_choice(&self, option: &str, choice: &str) -> bool {
        self.choices
            .get(option)
            .is_some_and(|choices| choices.contains(choice))
    }

    pub fn require_choice(&self, option: &str, choice: &str) -> Result<(), String> {
        if self.supports_choice(option, choice) {
            return Ok(());
        }

        let available = self
            .choices
            .get(option)
            .map(|choices| {
                let mut values = choices.iter().cloned().collect::<Vec<_>>();
                values.sort();
                values.join(", ")
            })
            .filter(|values| !values.is_empty())
            .unwrap_or_else(|| "option not present in PPD".to_string());

        Err(format!(
            "CUPS option `{option}` does not support `{choice}`; available: {available}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_lpoptions_choices_and_defaults() {
        let options = CupsOptions::parse(
            r#"
Resolution/Resolution : *600
MediaType/Media Type : *Auto PlainPaper1 HEAVY6 HEAVY7
InputSlot/Paper Source: *Auto Manual Cas1 Cas2
Duplex/Duplex: *None DuplexNoTumble DuplexTumble
CNColorMode/Color Mode: Auto *color mono
PageSize/Page Size: Letter *A4 A3
"#,
        );

        assert!(options.supports_choice("Resolution", "600"));
        assert!(options.supports_choice("MediaType", "HEAVY6"));
        assert!(options.supports_choice("MediaType", "HEAVY7"));
        assert!(options.supports_choice("InputSlot", "Manual"));
        assert!(options.supports_choice("Duplex", "None"));
        assert!(options.supports_choice("CNColorMode", "color"));
        assert!(options.supports_choice("PageSize", "A4"));
        assert!(!options.supports_choice("PageRegion", "A4"));
        assert!(options.require_choice("MediaType", "PlainPaper1").is_ok());
        assert!(options.require_choice("MediaType", "Glossy").is_err());
    }
}
