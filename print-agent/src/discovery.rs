//! Printer discovery — enumerate printers and query capabilities.
//!
//! On Windows: `EnumPrintersW` + `DeviceCapabilitiesW` → capabilities JSONB.
//! On Linux: `lpstat -p` + `lpoptions -l` → capabilities.

use crate::printing::{PrinterCapabilities, PrinterType};

/// Discover all available printers with their capabilities.
pub fn discover_printers() -> Vec<PrinterCapabilities> {
    #[cfg(target_os = "windows")]
    {
        discover_windows()
    }
    #[cfg(target_os = "linux")]
    {
        discover_linux()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        vec![]
    }
}

// ── Windows discovery via EnumPrintersW + DeviceCapabilitiesW ──

#[cfg(target_os = "windows")]
fn discover_windows() -> Vec<PrinterCapabilities> {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Printing::*;

    let mut printers = Vec::new();

    // EnumPrintersW: PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS
    let flags = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
    let mut needed = 0u32;
    let mut returned = 0u32;

    // First call: get required buffer size
    unsafe {
        let _ = EnumPrintersW(flags, PCWSTR::null(), 2, None, &mut needed, &mut returned);
    }

    if needed == 0 {
        return printers;
    }

    let mut buffer = vec![0u8; needed as usize];
    let success = unsafe {
        EnumPrintersW(
            flags,
            PCWSTR::null(),
            2,
            Some(&mut buffer),
            &mut needed,
            &mut returned,
        )
    };

    if success.is_err() {
        tracing::warn!("EnumPrintersW failed");
        return printers;
    }

    let info_ptr = buffer.as_ptr() as *const PRINTER_INFO_2W;

    for i in 0..returned as usize {
        let info = unsafe { &*info_ptr.add(i) };

        let name = unsafe { info.pPrinterName.to_string().unwrap_or_default() };
        let driver = unsafe { info.pDriverName.to_string().unwrap_or_default() };

        // Skip virtual/software printers
        if is_virtual_printer(&name, &driver) {
            tracing::debug!(name = %name, driver = %driver, "Skipping virtual printer");
            continue;
        }

        let is_default = info.Attributes & PRINTER_ATTRIBUTE_DEFAULT != 0;

        // Determine printer type from driver name heuristics
        let printer_type = classify_printer_type(&driver, &name);

        // Query detailed capabilities via DeviceCapabilitiesW
        let caps = query_device_capabilities(&name, printer_type);

        printers.push(caps.unwrap_or_else(|| PrinterCapabilities {
            name: name.clone(),
            driver: driver.clone(),
            is_default,
            printer_type,
            supported_paper_sizes: vec![],
            supported_media_types: vec![],
            max_dpi: 300,
            supports_duplex: false,
            supports_color: true,
            supports_borderless: false,
            tray_count: 1,
            trays: vec![],
            supports_staple: false,
            supports_collate: false,
            firmware_version: None,
        }));
    }

    printers
}

/// Query printer capabilities via DeviceCapabilitiesW.
#[cfg(target_os = "windows")]
fn query_device_capabilities(printer_name: &str, printer_type: PrinterType) -> Option<PrinterCapabilities> {
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::Storage::Xps::*;

    let name_wide: Vec<u16> = printer_name.encode_utf16().chain(std::iter::once(0)).collect();
    let name_pcwstr = PCWSTR(name_wide.as_ptr());

    // Query paper sizes
    let paper_count = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_PAPERS, PWSTR::null(), None)
    };

    let supported_paper_sizes = if paper_count > 0 {
        let mut papers = vec![0u16; paper_count as usize];
        unsafe {
            DeviceCapabilitiesW(
                name_pcwstr,
                PCWSTR::null(),
                DC_PAPERS,
                PWSTR(papers.as_mut_ptr()),
                None,
            );
        }
        papers.iter().filter_map(|&p| windows_paper_to_crm(p)).collect()
    } else {
        vec!["a4".into()]
    };

    // Query DPI (max resolution)
    let resolution_count = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_ENUMRESOLUTIONS, PWSTR::null(), None)
    };

    let max_dpi = if resolution_count > 0 {
        let mut resolutions = vec![0i32; resolution_count as usize * 2]; // pairs: (x, y)
        unsafe {
            DeviceCapabilitiesW(
                name_pcwstr,
                PCWSTR::null(),
                DC_ENUMRESOLUTIONS,
                PWSTR(resolutions.as_mut_ptr() as *mut u16),
                None,
            );
        }
        resolutions.iter().copied().filter(|&v| v > 0).max().unwrap_or(300) as u32
    } else {
        300
    };

    // Query duplex
    let duplex = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_DUPLEX, PWSTR::null(), None)
    };

    // Query color
    let color = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_COLORDEVICE, PWSTR::null(), None)
    };

    // Query staple support (DC_STAPLE = 35)
    let staple_count = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_STAPLE, PWSTR::null(), None)
    };

    // Query collate support (DC_COLLATE = 22)
    let collate_support = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_COLLATE, PWSTR::null(), None)
    };

    // Query trays (bins)
    let bin_count = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_BINS, PWSTR::null(), None)
    };

    let trays = if bin_count > 0 {
        // DC_BINNAMES returns 24-char wide strings per bin
        let mut bin_names = vec![0u16; bin_count as usize * 24];
        unsafe {
            DeviceCapabilitiesW(
                name_pcwstr,
                PCWSTR::null(),
                DC_BINNAMES,
                PWSTR(bin_names.as_mut_ptr()),
                None,
            );
        }
        (0..bin_count as usize)
            .filter_map(|i| {
                let start = i * 24;
                let end = bin_names[start..start + 24]
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(24);
                let name = String::from_utf16_lossy(&bin_names[start..start + end]);
                if name.is_empty() { None } else { Some(name) }
            })
            .collect()
    } else {
        vec![]
    };

    // Query media types via DC_MEDIATYPENAMES (index 34), 64 wchar per entry
    let media_count = unsafe {
        DeviceCapabilitiesW(name_pcwstr, PCWSTR::null(), DC_MEDIATYPENAMES, PWSTR::null(), None)
    };

    let supported_media_types = if media_count > 0 {
        let mut media_names = vec![0u16; media_count as usize * 64];
        unsafe {
            DeviceCapabilitiesW(
                name_pcwstr,
                PCWSTR::null(),
                DC_MEDIATYPENAMES,
                PWSTR(media_names.as_mut_ptr()),
                None,
            );
        }
        let mut types: Vec<String> = (0..media_count as usize)
            .filter_map(|i| {
                let start = i * 64;
                let end = media_names[start..start + 64]
                    .iter()
                    .position(|&c| c == 0)
                    .unwrap_or(64);
                let raw = String::from_utf16_lossy(&media_names[start..start + end]);
                if raw.is_empty() { return None; }
                let crm_id = normalize_media_name(&raw);
                Some(crm_id)
            })
            .collect();
        types.sort();
        types.dedup();
        if types.is_empty() { fallback_media_types(printer_type) } else { types }
    } else {
        fallback_media_types(printer_type)
    };

    // Borderless: typically only inkjet photo printers
    let supports_borderless = printer_type == PrinterType::InkjetPhoto;

    Some(PrinterCapabilities {
        name: printer_name.to_string(),
        driver: String::new(), // filled by caller
        is_default: false,     // filled by caller
        printer_type,
        supported_paper_sizes,
        supported_media_types,
        max_dpi,
        supports_duplex: duplex > 0,
        supports_color: color > 0,
        supports_borderless,
        tray_count: bin_count.max(1) as u32,
        trays,
        supports_staple: staple_count > 0,
        supports_collate: collate_support > 0,
        firmware_version: None,
    })
}

/// Map Windows DMPAPER_* constants to our CRM paper size IDs.
#[cfg(target_os = "windows")]
fn windows_paper_to_crm(paper: u16) -> Option<String> {
    match paper {
        75 => Some("10x15".into()),   // DMPAPER_PHOTO_4x6
        76 => Some("13x18".into()),   // DMPAPER_PHOTO_5x7
        77 => Some("15x21".into()),   // DMPAPER_PHOTO_6x8
        78 => Some("20x30".into()),   // DMPAPER_PHOTO_8x10
        8 => Some("a3".into()),       // DMPAPER_A3
        9 => Some("a4".into()),       // DMPAPER_A4
        11 => Some("a5".into()),      // DMPAPER_A5
        1 => Some("letter".into()),   // DMPAPER_LETTER
        5 => Some("legal".into()),    // DMPAPER_LEGAL
        _ => None, // Skip uncommon sizes
    }
}

/// Normalize Windows media type name to CRM media type ID.
#[cfg(target_os = "windows")]
fn normalize_media_name(raw: &str) -> String {
    let lower = raw.to_lowercase();
    if lower.contains("glossy") || lower.contains("photo") {
        "glossy".into()
    } else if lower.contains("matte") {
        "matte".into()
    } else if lower.contains("satin") || lower.contains("semi-gloss") || lower.contains("luster") {
        "satin".into()
    } else if lower.contains("fine art") || lower.contains("fine_art") {
        "fine_art".into()
    } else if lower.contains("heavy") || lower.contains("thick") || lower.contains("cardstock")
        || lower.contains("pasteboard")
    {
        "thick".into()
    } else if lower.contains("recycled") {
        "recycled".into()
    } else if lower.contains("envelope") {
        "envelope".into()
    } else if lower.contains("thin") || lower.contains("lightweight") {
        "thin".into()
    } else if lower.contains("coated") {
        "coated".into()
    } else if lower.contains("transparen") || lower.contains("ohp") {
        "transparency".into()
    } else if lower.contains("label") {
        "label".into()
    } else {
        "plain".into()
    }
}

/// Fallback media types based on printer type (used when DC_MEDIATYPENAMES is unavailable).
fn fallback_media_types(printer_type: PrinterType) -> Vec<String> {
    match printer_type {
        PrinterType::InkjetPhoto => vec![
            "glossy".into(),
            "matte".into(),
            "satin".into(),
            "luster".into(),
            "fine_art".into(),
            "plain".into(),
        ],
        PrinterType::LaserMfp | PrinterType::LaserColor => vec![
            "plain".into(),
            "thick".into(),
            "recycled".into(),
            "envelope".into(),
        ],
        PrinterType::LaserMono => vec!["plain".into(), "thick".into(), "envelope".into()],
        PrinterType::Unknown => vec!["plain".into()],
    }
}

/// Check if a printer is a virtual/software printer that should be filtered out.
fn is_virtual_printer(name: &str, driver: &str) -> bool {
    let lower = format!("{} {}", name, driver).to_lowercase();
    lower.contains("pdf")
        || lower.contains("onenote")
        || lower.contains("xps")
        || lower.contains("fax")
        || lower.contains("print to file")
        || lower.contains("microsoft print")
        || lower.contains("send to")
}

/// Classify printer type from driver name heuristics.
fn classify_printer_type(driver: &str, name: &str) -> PrinterType {
    let combined = format!("{} {}", driver, name).to_lowercase();

    // Inkjet photo printers
    if combined.contains("epson") && (combined.contains("l8") || combined.contains("et-")) {
        return PrinterType::InkjetPhoto;
    }
    if combined.contains("epson") && combined.contains("photo") {
        return PrinterType::InkjetPhoto;
    }
    if combined.contains("canon") && combined.contains("pixma") {
        return PrinterType::InkjetPhoto;
    }
    if combined.contains("inkjet") || combined.contains("ink jet") {
        return PrinterType::InkjetPhoto;
    }

    // Laser MFP
    if combined.contains("canon") && (combined.contains("mf") || combined.contains("c3") || combined.contains("ir-adv")) {
        return PrinterType::LaserMfp;
    }
    if combined.contains("mfp") || combined.contains("multifunction") {
        if combined.contains("color") || combined.contains("colour") {
            return PrinterType::LaserMfp;
        }
        return PrinterType::LaserMfp;
    }

    // Laser color
    if combined.contains("color") && combined.contains("laser") {
        return PrinterType::LaserColor;
    }

    // Laser mono
    if combined.contains("laser") {
        return PrinterType::LaserMono;
    }

    PrinterType::Unknown
}

// ── Linux discovery via lpstat + lpoptions ──

#[cfg(target_os = "linux")]
fn discover_linux() -> Vec<PrinterCapabilities> {
    use std::process::Command;

    let printers = crate::cups_print::list_printers();

    // Detect default printer
    let default_printer = Command::new("lpstat")
        .arg("-d")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                let out = String::from_utf8_lossy(&o.stdout).to_string();
                // Output: "system default destination: PrinterName"
                out.split(':').nth(1).map(|s| s.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_default();

    printers
        .into_iter()
        .map(|name| {
            let is_default = name == default_printer;
            let printer_type = classify_printer_type("", &name);

            // Try to parse real capabilities from lpoptions
            match query_cups_capabilities(&name) {
                Some((paper_sizes, media_types, max_dpi, supports_duplex, supports_borderless)) => {
                    PrinterCapabilities {
                        name: name.clone(),
                        driver: String::new(),
                        is_default,
                        printer_type,
                        supported_paper_sizes: paper_sizes,
                        supported_media_types: media_types,
                        max_dpi,
                        supports_duplex,
                        supports_color: true,
                        supports_borderless,
                        tray_count: 1,
                        trays: vec![],
                        supports_staple: false,
                        supports_collate: false,
                        firmware_version: None,
                    }
                }
                None => {
                    // Fallback to hardcoded defaults
                    PrinterCapabilities {
                        name: name.clone(),
                        driver: String::new(),
                        is_default,
                        printer_type,
                        supported_paper_sizes: vec![
                            "10x15".into(), "13x18".into(), "15x21".into(),
                            "20x30".into(), "a4".into(), "a5".into(), "a3".into(),
                        ],
                        supported_media_types: vec![
                            "glossy".into(), "matte".into(), "satin".into(), "plain".into(),
                        ],
                        max_dpi: 300,
                        supports_duplex: false,
                        supports_color: true,
                        supports_borderless: false,
                        tray_count: 1,
                        trays: vec![],
                        supports_staple: false,
                        supports_collate: false,
                        firmware_version: None,
                    }
                }
            }
        })
        .collect()
}

/// Query real CUPS capabilities via `lpoptions -p <name> -l`.
/// Returns (paper_sizes, media_types, max_dpi, supports_duplex, supports_borderless).
#[cfg(target_os = "linux")]
fn query_cups_capabilities(
    printer_name: &str,
) -> Option<(Vec<String>, Vec<String>, u32, bool, bool)> {
    use std::process::Command;

    let output = Command::new("lpoptions")
        .args(["-p", printer_name, "-l"])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    if text.trim().is_empty() {
        return None;
    }

    let mut paper_sizes = Vec::new();
    let mut media_types = Vec::new();
    let mut max_dpi: u32 = 300;
    let mut supports_duplex = false;
    let mut supports_borderless = false;

    for line in text.lines() {
        // Format: "OptionName/Description: value1 *value2 value3"
        let Some((key_part, values_part)) = line.split_once(':') else {
            continue;
        };
        let option_name = key_part.split('/').next().unwrap_or("").trim();
        let values: Vec<&str> = values_part.split_whitespace().collect();

        match option_name {
            "PageSize" => {
                for v in &values {
                    let v = v.trim_start_matches('*'); // active value marked with *
                    if let Some(crm_id) = cups_pagesize_to_crm(v) {
                        if !paper_sizes.contains(&crm_id) {
                            paper_sizes.push(crm_id);
                        }
                    }
                    // Check for borderless variants
                    if v.ends_with(".Borderless") || v.ends_with(".bl") {
                        supports_borderless = true;
                    }
                }
            }
            "MediaType" => {
                for v in &values {
                    let v = v.trim_start_matches('*');
                    if let Some(crm_media) = cups_mediatype_to_crm(v) {
                        if !media_types.contains(&crm_media) {
                            media_types.push(crm_media);
                        }
                    }
                }
            }
            "Resolution" => {
                for v in &values {
                    let v = v.trim_start_matches('*');
                    // Format: "600dpi", "1200x600dpi", etc.
                    let dpi_str = v.to_lowercase().replace("dpi", "");
                    let parsed_dpi = if let Some((x, _y)) = dpi_str.split_once('x') {
                        x.parse::<u32>().unwrap_or(0)
                    } else {
                        dpi_str.parse::<u32>().unwrap_or(0)
                    };
                    if parsed_dpi > max_dpi {
                        max_dpi = parsed_dpi;
                    }
                }
            }
            "Duplex" => {
                // If Duplex option exists with more than just "None", duplex is supported
                let has_duplex_mode = values.iter().any(|v| {
                    let v = v.trim_start_matches('*');
                    v != "None" && v != "none"
                });
                if has_duplex_mode {
                    supports_duplex = true;
                }
            }
            _ => {}
        }
    }

    // Only return Some if we parsed at least paper sizes
    if paper_sizes.is_empty() && media_types.is_empty() {
        return None;
    }

    // Ensure we have at least some defaults if partial data
    if paper_sizes.is_empty() {
        paper_sizes = vec!["a4".into()];
    }
    if media_types.is_empty() {
        media_types = vec!["plain".into()];
    }

    Some((paper_sizes, media_types, max_dpi, supports_duplex, supports_borderless))
}

/// Map CUPS PageSize option values to CRM paper size IDs.
#[cfg(target_os = "linux")]
fn cups_pagesize_to_crm(cups_name: &str) -> Option<String> {
    let lower = cups_name.to_lowercase();
    let base = lower
        .trim_end_matches(".borderless")
        .trim_end_matches(".bl");

    match base {
        "4x6" | "photo_4x6" | "postcard" => Some("10x15".into()),
        "5x7" | "photo_5x7" => Some("13x18".into()),
        "6x8" | "photo_6x8" => Some("15x21".into()),
        "8x12" | "photo_8x12" | "8x10" => Some("20x30".into()),
        "4x4" | "photo_4x4" => Some("10x10".into()),
        "a4" => Some("a4".into()),
        "a5" => Some("a5".into()),
        "a3" => Some("a3".into()),
        _ => None,
    }
}

/// Map CUPS MediaType option values to CRM media type IDs.
#[cfg(target_os = "linux")]
fn cups_mediatype_to_crm(cups_media: &str) -> Option<String> {
    let lower = cups_media.to_lowercase();
    if lower.contains("glossy") {
        Some("glossy".into())
    } else if lower.contains("matte") {
        Some("matte".into())
    } else if lower.contains("satin") {
        Some("satin".into())
    } else if lower.contains("luster") || lower.contains("high-gloss") {
        Some("luster".into())
    } else if lower.contains("fine") || lower.contains("art") {
        Some("fine_art".into())
    } else if lower.contains("heavy") || lower.contains("thick") || lower.contains("cardstock") {
        Some("thick".into())
    } else if lower.contains("plain") || lower.contains("stationery") {
        Some("plain".into())
    } else if lower.contains("recycled") {
        Some("recycled".into())
    } else if lower.contains("envelope") {
        Some("envelope".into())
    } else {
        None
    }
}
