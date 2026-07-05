use std::path::Path;
use std::process::Command;
use tracing::{debug, info, warn};

use crate::proto;

/// CUPS paper size mapping: our IDs → CUPS media names
fn cups_media_name(paper_id: &str, borderless: bool) -> &'static str {
    let base = match paper_id.to_lowercase().as_str() {
        "10x15" => if borderless { "4x6.bl" } else { "4x6" },
        "13x18" => if borderless { "5x7.bl" } else { "5x7" },
        "15x21" => "6x8",
        "20x30" => "8x12",
        "10x10" => "Custom.100x100mm",
        "a4" => "A4",
        "a5" => "A5",
        "a3" => "A3",
        _ => "A4",
    };
    base
}

/// CUPS media type mapping
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

/// CUPS print quality: 3=draft, 4=normal, 5=photo/best
fn cups_quality(quality: &str) -> &'static str {
    match quality.to_lowercase().as_str() {
        "draft" => "3",
        "normal" => "4",
        "photo" | "best" | "high" => "5",
        _ => "4",
    }
}

/// Submit a print job to CUPS via the `lp` command.
///
/// Returns the CUPS job ID on success.
pub fn submit_job(
    cups_printer: &str,
    file_path: &Path,
    cmd: &proto::PrintCommand,
) -> anyhow::Result<i32> {
    if cups_printer.is_empty() {
        anyhow::bail!("No CUPS printer configured");
    }

    if !file_path.exists() {
        anyhow::bail!("File not found: {}", file_path.display());
    }

    let mut args: Vec<String> = vec![
        "-d".into(), cups_printer.to_string(),
        "-n".into(), cmd.copies.max(1).to_string(),
    ];

    // Media size
    if !cmd.paper_size.is_empty() {
        args.push("-o".into());
        args.push(format!("media={}", cups_media_name(&cmd.paper_size, cmd.borderless)));
    }

    // Media type
    if !cmd.media_type.is_empty() {
        args.push("-o".into());
        args.push(format!("media-type={}", cups_media_type(&cmd.media_type)));
    }

    // Quality
    if !cmd.quality.is_empty() {
        args.push("-o".into());
        args.push(format!("print-quality={}", cups_quality(&cmd.quality)));
    }

    // Color mode
    let color = proto::ColorMode::try_from(cmd.color_mode).unwrap_or(proto::ColorMode::Color);
    if color == proto::ColorMode::Bw {
        args.push("-o".into());
        args.push("print-color-mode=monochrome".into());
    }

    // Duplex
    if cmd.duplex {
        args.push("-o".into());
        args.push("sides=two-sided-long-edge".into());
    } else {
        args.push("-o".into());
        args.push("sides=one-sided".into());
    }

    // We handle scaling ourselves — tell CUPS not to scale
    args.push("-o".into());
    args.push("fit-to-page=false".into());

    // Job title
    let title = if cmd.file_name.is_empty() {
        format!("SVF-{}", &cmd.job_id[..8.min(cmd.job_id.len())])
    } else {
        cmd.file_name.clone()
    };
    args.push("-t".into());
    args.push(title);

    // File path (last argument)
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

    // Parse job ID from stdout: "request id is PRINTER-123 (1 file(s))"
    let stdout = String::from_utf8_lossy(&output.stdout);
    let job_id = parse_lp_job_id(&stdout);

    info!(cups_printer, job_id, "Print job submitted to CUPS");
    Ok(job_id)
}

/// Parse CUPS job ID from `lp` output
fn parse_lp_job_id(output: &str) -> i32 {
    // Format: "request id is PRINTER-123 (1 file(s))"
    output
        .split('-')
        .last()
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

/// Get CUPS version string
pub fn get_cups_version() -> String {
    Command::new("cupsd")
        .arg("--version")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

/// Query CUPS printer status via `lpstat`
pub fn get_printer_status(printer_name: &str) -> PrinterStatus {
    let output = Command::new("lpstat")
        .args(["-p", printer_name, "-l"])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return PrinterStatus { is_online: false, state: "unknown".into(), state_reasons: vec![] },
    };

    let is_online = !output.contains("disabled");
    let state = if output.contains("idle") {
        "idle"
    } else if output.contains("printing") {
        "processing"
    } else if output.contains("disabled") || output.contains("stopped") {
        "stopped"
    } else {
        "unknown"
    };

    // Parse state reasons from "Alerts:" line
    let state_reasons = output
        .lines()
        .find(|l| l.contains("Alerts:") || l.contains("Description:"))
        .map(|l| l.split(':').nth(1).unwrap_or("").trim().to_string())
        .filter(|s| !s.is_empty() && s != "none")
        .into_iter()
        .collect();

    PrinterStatus {
        is_online,
        state: state.to_string(),
        state_reasons,
    }
}

/// List all CUPS printers
pub fn list_printers() -> Vec<String> {
    let output = Command::new("lpstat")
        .args(["-p"])
        .output();

    match output {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .filter_map(|line| {
                    // Format: "printer PRINTER_NAME is idle. ..."
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 && parts[0] == "printer" {
                        Some(parts[1].to_string())
                    } else {
                        None
                    }
                })
                .collect()
        }
        _ => {
            warn!("Failed to list CUPS printers via lpstat");
            vec![]
        }
    }
}

pub struct PrinterStatus {
    pub is_online: bool,
    pub state: String,
    pub state_reasons: Vec<String>,
}

/// Parsed supply level from CUPS IPP attributes.
pub struct SupplyLevel {
    pub name: String,
    pub level: i32,       // 0-100 percentage
    pub supply_type: String, // ink, toner, paper, etc.
    pub color: String,    // cyan, magenta, yellow, black, etc.
}

/// Query printer supply levels via `lpstat -l -p` and IPP attributes.
pub fn get_printer_supplies(printer_name: &str) -> Vec<SupplyLevel> {
    // Method 1: Parse from CUPS marker attributes via `ipptool` (most reliable)
    if let Some(supplies) = get_supplies_via_ipptool(printer_name) {
        return supplies;
    }

    // Method 2: Parse from lpstat -l output (fallback)
    get_supplies_via_lpstat(printer_name)
}

/// Use ipptool to query IPP marker-* attributes directly.
fn get_supplies_via_ipptool(printer_name: &str) -> Option<Vec<SupplyLevel>> {
    // Query local CUPS IPP endpoint for the printer
    let ipp_uri = format!("ipp://localhost/printers/{printer_name}");

    // Create a temporary Get-Printer-Attributes request
    let output = Command::new("ipptool")
        .args([
            &ipp_uri,
            "-t",  // test mode (outputs attribute values)
            "/dev/stdin",
        ])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();

    // If ipptool isn't available, fallback
    if output.is_err() {
        return None;
    }

    // Alternative: use lpstat with CUPS attributes file
    // The most portable approach: parse /var/cache/cups/ or CUPS API
    // For now, try the marker attributes from `lpstat -l`
    None
}

/// Parse supply levels from verbose lpstat output.
fn get_supplies_via_lpstat(printer_name: &str) -> Vec<SupplyLevel> {
    let output = Command::new("lpstat")
        .args(["-p", printer_name, "-l"])
        .output();

    let output = match output {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).to_string(),
        _ => return vec![],
    };

    let mut supplies = Vec::new();

    // Parse CUPS marker attributes from lpstat -l output
    // Format varies by driver, but common patterns:
    // "Marker levels: 72,65,89,45,100,0"
    // "Marker names: Cyan,Magenta,Yellow,Black,Photo Black,Maintenance Box"
    // "Marker types: ink,ink,ink,ink,ink,wasteToner"

    let mut marker_levels: Vec<i32> = Vec::new();
    let mut marker_names: Vec<String> = Vec::new();
    let mut marker_types: Vec<String> = Vec::new();

    for line in output.lines() {
        let line = line.trim();
        if let Some(levels_str) = line.strip_prefix("Marker levels:").or_else(|| line.strip_prefix("marker-levels:")) {
            marker_levels = levels_str.trim().split(',')
                .filter_map(|s| s.trim().parse::<i32>().ok())
                .collect();
        }
        if let Some(names_str) = line.strip_prefix("Marker names:").or_else(|| line.strip_prefix("marker-names:")) {
            marker_names = names_str.trim().split(',')
                .map(|s| s.trim().to_string())
                .collect();
        }
        if let Some(types_str) = line.strip_prefix("Marker types:").or_else(|| line.strip_prefix("marker-types:")) {
            marker_types = types_str.trim().split(',')
                .map(|s| s.trim().to_string())
                .collect();
        }
    }

    // Combine into SupplyLevel entries
    let count = marker_levels.len().min(marker_names.len());
    for i in 0..count {
        let name = marker_names[i].clone();
        let color = name_to_color(&name);
        let supply_type = marker_types.get(i)
            .cloned()
            .unwrap_or_else(|| "ink".to_string());

        supplies.push(SupplyLevel {
            name,
            level: marker_levels[i],
            supply_type,
            color,
        });
    }

    supplies
}

/// Map supply name to color identifier.
fn name_to_color(name: &str) -> String {
    let lower = name.to_lowercase();
    if lower.contains("cyan") && lower.contains("light") { "light_cyan".into() }
    else if lower.contains("magenta") && lower.contains("light") { "light_magenta".into() }
    else if lower.contains("cyan") { "cyan".into() }
    else if lower.contains("magenta") { "magenta".into() }
    else if lower.contains("yellow") { "yellow".into() }
    else if lower.contains("black") && lower.contains("photo") { "photo_black".into() }
    else if lower.contains("black") { "black".into() }
    else { lower.replace(' ', "_") }
}

/// Estimate ink usage for a print job based on coverage and paper size.
/// Returns estimated ml per channel (very rough approximation).
pub fn estimate_consumable_usage(
    paper_size: &str,
    color_mode: &str,
    copies: i32,
) -> crate::proto::ConsumableUsage {
    // Average ink coverage ml per cm² (photo quality, 6-color inkjet)
    // These are rough estimates based on Epson L8050 specifications
    let area_cm2 = match paper_size.to_lowercase().as_str() {
        "10x15" => 150.0,
        "13x18" => 234.0,
        "15x21" => 315.0,
        "20x30" => 600.0,
        "a4" => 623.7,
        _ => 150.0,
    };

    let copies_f = copies.max(1) as f32;

    // Photo mode: ~0.00012 ml/cm² per color channel (empirical)
    let ml_per_cm2 = 0.00012;
    let base_ml = area_cm2 as f32 * ml_per_cm2 * copies_f;

    let is_bw = color_mode == "bw" || color_mode == "monochrome";

    crate::proto::ConsumableUsage {
        cyan_ml: if is_bw { 0.0 } else { base_ml },
        magenta_ml: if is_bw { 0.0 } else { base_ml },
        yellow_ml: if is_bw { 0.0 } else { base_ml * 0.8 },
        black_ml: if is_bw { base_ml * 2.0 } else { base_ml * 0.3 },
        light_cyan_ml: if is_bw { 0.0 } else { base_ml * 0.5 },
        light_magenta_ml: if is_bw { 0.0 } else { base_ml * 0.5 },
        sheets_used: copies,
        media_type: String::new(),
        paper_size: paper_size.to_string(),
    }
}
