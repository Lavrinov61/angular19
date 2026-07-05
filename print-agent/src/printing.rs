//! Cross-platform printing abstraction.
//!
//! On Linux: delegates to CUPS (`lp` command).
//! On Windows: delegates to Windows Spooler API (winspool.drv + GDI).

use std::path::Path;

use crate::print_proto;

/// Result of submitting a print job to the OS print spooler.
pub struct PrintResult {
    /// OS-level job ID (CUPS job ID or Windows Spooler job ID)
    pub job_id: i32,
}

/// Discovered printer capabilities (reported to CRM for UI filtering).
#[derive(Debug, Clone, serde::Serialize)]
pub struct PrinterCapabilities {
    pub name: String,
    pub driver: String,
    pub is_default: bool,
    pub printer_type: PrinterType,
    pub supported_paper_sizes: Vec<String>,
    pub supported_media_types: Vec<String>,
    pub max_dpi: u32,
    pub supports_duplex: bool,
    pub supports_color: bool,
    pub supports_borderless: bool,
    pub tray_count: u32,
    pub trays: Vec<String>,
    pub supports_staple: bool,
    pub supports_collate: bool,
    pub firmware_version: Option<String>,
}

/// Printer type — determines which CRM settings are relevant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrinterType {
    InkjetPhoto,
    LaserMfp,
    LaserColor,
    LaserMono,
    Unknown,
}

impl std::fmt::Display for PrinterType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InkjetPhoto => f.write_str("inkjet_photo"),
            Self::LaserMfp => f.write_str("laser_mfp"),
            Self::LaserColor => f.write_str("laser_color"),
            Self::LaserMono => f.write_str("laser_mono"),
            Self::Unknown => f.write_str("unknown"),
        }
    }
}

/// Printer state enum — typed replacement for raw strings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PrinterState {
    Idle,
    Processing,
    Paused,
    Error,
    Offline,
    Unknown,
}

impl Default for PrinterState {
    fn default() -> Self { Self::Unknown }
}

impl std::fmt::Display for PrinterState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Idle => write!(f, "idle"),
            Self::Processing => write!(f, "processing"),
            Self::Paused => write!(f, "paused"),
            Self::Error => write!(f, "error"),
            Self::Offline => write!(f, "offline"),
            Self::Unknown => write!(f, "unknown"),
        }
    }
}

/// Printer status information.
#[derive(Debug, Clone)]
pub struct PrinterStatus {
    pub is_online: bool,
    pub state: PrinterState,
    pub state_reasons: Vec<String>,
}

/// Supply level for a consumable (ink, toner, paper, etc.)
#[derive(Debug, Clone, serde::Serialize)]
pub struct SupplyLevel {
    pub name: String,
    pub level: i32,
    pub supply_type: String,
    pub color: String,
}

/// Submit a print job to the platform-specific spooler.
pub fn submit_job(
    printer_name: &str,
    file_path: &Path,
    cmd: &print_proto::PrintCommand,
) -> anyhow::Result<PrintResult> {
    #[cfg(target_os = "windows")]
    {
        crate::win_print::submit_job(printer_name, file_path, cmd)
    }
    #[cfg(target_os = "linux")]
    {
        crate::cups_print::submit_job(printer_name, file_path, cmd)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        anyhow::bail!("Printing not supported on this platform")
    }
}

/// Query printer status.
pub fn get_printer_status(printer_name: &str) -> PrinterStatus {
    #[cfg(target_os = "windows")]
    {
        crate::win_print::get_printer_status(printer_name)
    }
    #[cfg(target_os = "linux")]
    {
        crate::cups_print::get_printer_status(printer_name)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        PrinterStatus {
            is_online: false,
            state: PrinterState::Unknown,
            state_reasons: vec![],
        }
    }
}

/// Query printer supply levels.
pub fn get_printer_supplies(printer_name: &str) -> Vec<SupplyLevel> {
    #[cfg(target_os = "windows")]
    {
        crate::win_print::get_printer_supplies(printer_name)
    }
    #[cfg(target_os = "linux")]
    {
        crate::cups_print::get_printer_supplies(printer_name)
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        vec![]
    }
}

/// Estimate ink/toner usage for a print job.
#[allow(dead_code)]
pub fn estimate_consumable_usage(
    paper_size: &str,
    color_mode: &str,
    copies: i32,
) -> print_proto::ConsumableUsage {
    estimate_consumable_usage_with_service(paper_size, color_mode, copies, "")
}

/// Estimate ink usage with service-aware coverage factor.
///
/// `service_slug` adjusts ink coverage estimates:
/// - "photo" services → 50% coverage (high ink density photos)
/// - "document" services → 5% coverage (text-heavy documents)
/// - default → standard Epson L8050 empirical model
pub fn estimate_consumable_usage_with_service(
    paper_size: &str,
    color_mode: &str,
    copies: i32,
    service_slug: &str,
) -> print_proto::ConsumableUsage {
    // Average ink coverage ml per cm² (photo quality, 6-color inkjet)
    // Empirical estimates based on Epson L8050 specifications.
    let area_cm2 = match paper_size.to_lowercase().as_str() {
        "10x15" => 150.0,
        "13x18" => 234.0,
        "15x21" => 315.0,
        "20x30" => 600.0,
        "a4" => 623.7,
        "a5" => 311.85,
        "a3" => 1247.4,
        _ => 150.0,
    };

    let copies_f = copies.max(1) as f32;
    let is_bw = color_mode == "bw" || color_mode == "monochrome";
    let slug = service_slug.to_lowercase();

    // Service-aware coverage multiplier for ml_per_cm2 base rate (0.00012)
    let ml_per_cm2: f32 = if slug.contains("photo") {
        // Photo prints: ~50% coverage → 4.2x base rate
        0.0005
    } else if slug.contains("document") {
        // Documents: ~5% coverage → 0.42x base rate
        0.00005
    } else {
        // Default: standard Epson L8050 empirical model
        0.00012
    };

    let base_ml = area_cm2 as f32 * ml_per_cm2 * copies_f;

    print_proto::ConsumableUsage {
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

/// Estimate toner usage for laser printers (Canon C3226i).
/// Coverage model: 5% per page (ISO/IEC 19798 standard).
#[allow(dead_code)]
pub fn estimate_toner_usage(
    paper_size: &str,
    color_mode: &str,
    copies: i32,
) -> print_proto::ConsumableUsage {
    estimate_toner_usage_with_service(paper_size, color_mode, copies, "")
}

/// Estimate toner usage with service-aware coverage model.
///
/// `service_slug` adjusts coverage percentage:
/// - "photo" services on A4 color → 50% coverage (high-density photo)
/// - "document" services → 5% coverage (ISO/IEC 19798 standard text)
/// - default → 5% (ISO standard)
#[allow(dead_code)]
pub fn estimate_toner_usage_with_service(
    paper_size: &str,
    color_mode: &str,
    copies: i32,
    service_slug: &str,
) -> print_proto::ConsumableUsage {
    let pages = copies.max(1) as f32;
    let paper_factor = match paper_size.to_lowercase().as_str() {
        "a3" => 2.0,
        "a4" => 1.0,
        "a5" => 0.5,
        "b4" => 1.5,
        "b5" => 0.7,
        _ => 1.0,
    };
    let is_bw = color_mode == "bw" || color_mode == "monochrome";
    let slug = service_slug.to_lowercase();

    // Service-aware coverage: photo ~50%, document ~5%, default ~5%
    let coverage_pct: f32 = if slug.contains("photo") && !is_bw {
        0.50
    } else if slug.contains("document") {
        0.05
    } else {
        0.05
    };

    let base = coverage_pct * paper_factor * pages;

    print_proto::ConsumableUsage {
        cyan_ml: if is_bw { 0.0 } else { base },
        magenta_ml: if is_bw { 0.0 } else { base },
        yellow_ml: if is_bw { 0.0 } else { base * 0.8 },
        black_ml: if is_bw { base * 1.5 } else { base * 0.3 },
        light_cyan_ml: 0.0,
        light_magenta_ml: 0.0,
        sheets_used: copies,
        media_type: String::new(),
        paper_size: paper_size.to_string(),
    }
}
