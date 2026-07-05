//! CUPS printing backend for Linux.
//!
//! Delegates to the `lp` command-line tool for job submission.
//! Ported from rust-agent/cups.rs to use the unified `printing` trait types.

#![cfg(target_os = "linux")]

use std::path::Path;
use std::process::Command;
use tracing::{debug, info, warn};

use crate::print_proto;
use crate::printing::{PrintResult, PrinterState, PrinterStatus, SupplyLevel};

/// CUPS paper size mapping: CRM IDs → CUPS media names
fn cups_media_name(paper_id: &str, borderless: bool) -> &'static str {
    match paper_id.to_lowercase().as_str() {
        "10x15" => {
            if borderless { "4x6.bl" } else { "4x6" }
        }
        "13x18" => {
            if borderless { "5x7.bl" } else { "5x7" }
        }
        "15x21" => {
            if borderless { "6x8.bl" } else { "6x8" }
        }
        "20x30" => {
            if borderless { "8x12.bl" } else { "8x12" }
        }
        "10x10" => {
            if borderless { "4x4.bl" } else { "4x4" }
        }
        "a4" => {
            if borderless { "A4.bl" } else { "A4" }
        }
        "a5" => {
            if borderless { "A5.bl" } else { "A5" }
        }
        "a3" => {
            if borderless { "A3.bl" } else { "A3" }
        }
        _ => "A4",
    }
}

fn cups_media_type(media: &str) -> &'static str {
    match media.to_lowercase().as_str() {
        "glossy" => "photographic-glossy",
        "matte" => "photographic-matte",
        "satin" => "photographic-satin",
        "luster" => "photographic-high-gloss",
        "fine_art" => "stationery-fine",
        "plain" => "stationery",
        "thick" => "stationery-heavyweight",
        "recycled" => "stationery-recycled",
        "envelope" => "envelope",
        _ => "stationery",
    }
}

fn cups_quality(quality: &str) -> &'static str {
    match quality.to_lowercase().as_str() {
        "draft" => "3",
        "normal" => "4",
        "photo" | "best" | "high" => "5",
        _ => "4",
    }
}

/// Submit a print job to CUPS via the `lp` command.
pub fn submit_job(
    cups_printer: &str,
    file_path: &Path,
    cmd: &print_proto::PrintCommand,
) -> anyhow::Result<PrintResult> {
    if cups_printer.is_empty() {
        anyhow::bail!("No CUPS printer configured");
    }
    if !file_path.exists() {
        anyhow::bail!("File not found: {}", file_path.display());
    }

    let mut args: Vec<String> = vec![
        "-d".into(),
        cups_printer.to_string(),
        "-n".into(),
        cmd.copies.max(1).to_string(),
    ];

    if !cmd.paper_size.is_empty() {
        args.push("-o".into());
        args.push(format!(
            "media={}",
            cups_media_name(&cmd.paper_size, cmd.borderless)
        ));
    }

    if !cmd.media_type.is_empty() {
        args.push("-o".into());
        args.push(format!(
            "media-type={}",
            cups_media_type(&cmd.media_type)
        ));
    }

    if !cmd.quality.is_empty() {
        args.push("-o".into());
        args.push(format!("print-quality={}", cups_quality(&cmd.quality)));
    }

    let color = print_proto::ColorMode::try_from(cmd.color_mode).unwrap_or(print_proto::ColorMode::Color);
    if color == print_proto::ColorMode::Bw {
        args.push("-o".into());
        args.push("print-color-mode=monochrome".into());
    }

    if cmd.duplex {
        args.push("-o".into());
        args.push("sides=two-sided-long-edge".into());
    } else {
        args.push("-o".into());
        args.push("sides=one-sided".into());
    }

    args.push("-o".into());
    args.push("fit-to-page=false".into());

    let title = if cmd.file_name.is_empty() {
        format!("SVF-{}", &cmd.job_id[..8.min(cmd.job_id.len())])
    } else {
        cmd.file_name.clone()
    };
    args.push("-t".into());
    args.push(title);

    args.push(file_path.display().to_string());

    debug!(printer = cups_printer, args = ?args, "Submitting to CUPS");

    let output = Command::new("lp")
        .args(&args)
        .output()
        .map_err(|e| anyhow::anyhow!("Failed to execute `lp`: {e}. Is CUPS installed?"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!("lp failed (exit {}): {stderr}", output.status);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let job_id = parse_lp_job_id(&stdout);

    info!(cups_printer, job_id, "Print job submitted to CUPS");
    Ok(PrintResult { job_id })
}

fn parse_lp_job_id(output: &str) -> i32 {
    output
        .split('-')
        .last()
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

pub fn get_cups_version() -> String {
    Command::new("cupsd")
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

pub fn get_printer_status(printer_name: &str) -> PrinterStatus {
    let output = Command::new("lpstat")
        .args(["-p", printer_name, "-l"])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => {
            return PrinterStatus {
                is_online: false,
                state: PrinterState::Unknown,
                state_reasons: vec![],
            }
        }
    };

    let is_online = !output.contains("disabled");
    let state = if output.contains("idle") {
        PrinterState::Idle
    } else if output.contains("printing") {
        PrinterState::Processing
    } else if output.contains("disabled") || output.contains("stopped") {
        PrinterState::Paused
    } else {
        PrinterState::Unknown
    };

    let state_reasons = output
        .lines()
        .find(|l| l.contains("Alerts:") || l.contains("Description:"))
        .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty() && s != "none")
        .into_iter()
        .collect();

    PrinterStatus {
        is_online,
        state,
        state_reasons,
    }
}

pub fn get_printer_supplies(printer_name: &str) -> Vec<SupplyLevel> {
    let output = Command::new("lpstat")
        .args(["-p", printer_name, "-l"])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return vec![],
    };

    let mut marker_levels: Vec<i32> = Vec::new();
    let mut marker_names: Vec<String> = Vec::new();
    let mut marker_types: Vec<String> = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if let Some(levels_str) = line
            .strip_prefix("Marker levels:")
            .or_else(|| line.strip_prefix("marker-levels:"))
        {
            marker_levels = levels_str
                .trim()
                .split(',')
                .filter_map(|s| s.trim().parse::<i32>().ok())
                .collect();
        }
        if let Some(names_str) = line
            .strip_prefix("Marker names:")
            .or_else(|| line.strip_prefix("marker-names:"))
        {
            marker_names = names_str
                .trim()
                .split(',')
                .map(|s| s.trim().to_string())
                .collect();
        }
        if let Some(types_str) = line
            .strip_prefix("Marker types:")
            .or_else(|| line.strip_prefix("marker-types:"))
        {
            marker_types = types_str
                .trim()
                .split(',')
                .map(|s| s.trim().to_string())
                .collect();
        }
    }

    let count = marker_levels.len().min(marker_names.len());
    (0..count)
        .map(|i| {
            let name = marker_names[i].clone();
            let color = name_to_color(&name);
            let supply_type = marker_types
                .get(i)
                .cloned()
                .unwrap_or_else(|| "ink".to_string());
            SupplyLevel {
                name,
                level: marker_levels[i],
                supply_type,
                color,
            }
        })
        .collect()
}

fn name_to_color(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("cyan") && lower.contains("light") {
        "light_cyan".into()
    } else if lower.contains("magenta") && lower.contains("light") {
        "light_magenta".into()
    } else if lower.contains("cyan") {
        "cyan".into()
    } else if lower.contains("magenta") {
        "magenta".into()
    } else if lower.contains("yellow") {
        "yellow".into()
    } else if lower.contains("black") && lower.contains("photo") {
        "photo_black".into()
    } else if lower.contains("black") {
        "black".into()
    } else {
        lower.replace(' ', "_")
    }
}

/// List all CUPS printers.
pub fn list_printers() -> Vec<String> {
    let output = Command::new("lpstat").args(["-p"]).output();

    match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout)
            .lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 && parts[0] == "printer" {
                    Some(parts[1].to_string())
                } else {
                    None
                }
            })
            .collect(),
        _ => {
            warn!("Failed to list CUPS printers via lpstat");
            vec![]
        }
    }
}
