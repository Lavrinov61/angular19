//! Windows Spooler API printing via `winspool.drv` + GDI rendering.
//!
//! Uses `windows-rs` crate for safe FFI to:
//! - `OpenPrinterW` / `ClosePrinter` — printer handle lifecycle
//! - `DocumentPropertiesW` — get/set DEVMODE (paper size, quality, color, duplex)
//! - `CreateDCW` / `DeleteDC` — create device context for rendering
//! - `StartDocW` / `EndDoc`, `StartPage` / `EndPage` — job lifecycle
//! - `StretchDIBits` — GDI bitmap rendering onto the DC
//! - `EnumPrintersW` — printer discovery
//! - `DeviceCapabilitiesW` — query printer capabilities (paper sizes, DPI, trays, duplex)

#![cfg(target_os = "windows")]

use std::mem;
use std::path::Path;

use tracing::{debug, error, info, warn};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HWND};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::Graphics::Printing::*;
use windows::Win32::Storage::Xps::*;
use windows::Win32::UI::WindowsAndMessaging::IDOK;

use crate::print_proto;
use crate::printing::{PrintResult, PrinterState, PrinterStatus, SupplyLevel};

// ── DEVMODE mapping ──

/// Map CRM paper size ID to Windows DEVMODE `dmPaperSize` constant.
fn map_paper_size(paper_id: &str) -> i16 {
    match paper_id.to_lowercase().as_str() {
        "10x15" => 75,     // DMPAPER_PHOTO_4x6 (4x6 inches ≈ 10x15 cm)
        "13x18" => 76,     // DMPAPER_PHOTO_5x7
        "15x21" => 77,     // DMPAPER_PHOTO_6x8 (closest standard)
        "20x30" => 78,     // DMPAPER_PHOTO_8x10 (closest)
        "10x10" => 0,      // Custom — set dmPaperWidth/dmPaperLength
        "a4" => 9,         // DMPAPER_A4
        "a5" => 11,        // DMPAPER_A5
        "a3" => 8,         // DMPAPER_A3
        "letter" => 1,     // DMPAPER_LETTER
        "legal" => 5,      // DMPAPER_LEGAL
        _ => 9,            // Default A4
    }
}

/// Map CRM quality to Windows DEVMODE `dmPrintQuality`.
fn map_print_quality(quality: &str) -> i16 {
    match quality.to_lowercase().as_str() {
        "draft" => -1,     // DMRES_DRAFT
        "low" => -2,       // DMRES_LOW
        "normal" | "medium" => -3, // DMRES_MEDIUM
        "high" | "photo" | "best" => -4, // DMRES_HIGH
        _ => -3,
    }
}

/// Map CRM media type to DEVMODE `dmMediaType`.
fn map_media_type(media: &str) -> i32 {
    match media.to_lowercase().as_str() {
        "plain" => 1,           // DMMEDIA_STANDARD
        "glossy" => 3,          // DMMEDIA_GLOSSY
        "matte" => 1,           // DMMEDIA_STANDARD (not TRANSPARENCY)
        "satin" => 3,           // Treat as glossy for generic DEVMODE
        "luster" => 3,
        "fine_art" => 1,        // DMMEDIA_STANDARD
        "thick" => 1,           // DMMEDIA_STANDARD
        "envelope" => 1,
        _ => 1,
    }
}

/// Apply PrintCommand settings to a DEVMODE structure.
///
/// Handles standard DEVMODE fields. Vendor-specific extensions (Epson borderless,
/// Canon stapler, etc.) are applied via `ExtDeviceMode` or by directly writing
/// to the vendor's private DEVMODE extension area (future work).
fn apply_settings_to_devmode(devmode: &mut DEVMODEW, cmd: &print_proto::PrintCommand) {
    // Access print-related fields through the Anonymous1.Anonymous1 union member
    let print_fields = unsafe { &mut devmode.Anonymous1.Anonymous1 };

    // Paper size
    if !cmd.paper_size.is_empty() {
        let paper = map_paper_size(&cmd.paper_size);
        if paper > 0 {
            print_fields.dmPaperSize = paper;
            devmode.dmFields |= DM_PAPERSIZE;
        } else {
            // Custom size: 10x10 cm → tenths of mm
            print_fields.dmPaperWidth = 1000;  // 100.0 mm in tenths
            print_fields.dmPaperLength = 1000;
            devmode.dmFields |= DM_PAPERWIDTH | DM_PAPERLENGTH;
        }
    }

    // Quality
    if !cmd.quality.is_empty() {
        print_fields.dmPrintQuality = map_print_quality(&cmd.quality);
        devmode.dmFields |= DM_PRINTQUALITY;
    }

    // Color mode
    let color_mode = print_proto::ColorMode::try_from(cmd.color_mode)
        .unwrap_or(print_proto::ColorMode::Color);
    match color_mode {
        print_proto::ColorMode::Bw => {
            devmode.dmColor = DMCOLOR_MONOCHROME;
            // gray_mode "true_gray" distinction handled in PrintTicket path
            if cmd.gray_mode == "true_gray" {
                warn!("Grayscale via DEVMODE fallback — TrueGray/BlackOnly distinction lost");
            }
        }
        _ => {
            devmode.dmColor = DMCOLOR_COLOR;
        }
    }
    devmode.dmFields |= DM_COLOR;

    // Orientation
    let orientation = print_proto::Orientation::try_from(cmd.orientation)
        .unwrap_or(print_proto::Orientation::Auto);
    match orientation {
        print_proto::Orientation::Landscape => {
            print_fields.dmOrientation = DMORIENT_LANDSCAPE as i16;
            devmode.dmFields |= DM_ORIENTATION;
        }
        print_proto::Orientation::Portrait => {
            print_fields.dmOrientation = DMORIENT_PORTRAIT as i16;
            devmode.dmFields |= DM_ORIENTATION;
        }
        _ => {
            // Auto — don't set, keep driver default
        }
    }

    // Duplex
    if cmd.duplex {
        devmode.dmDuplex = match cmd.duplex_mode.as_str() {
            "short_edge" => DMDUP_HORIZONTAL,
            _ => DMDUP_VERTICAL,
        };
        devmode.dmFields |= DM_DUPLEX;
    } else {
        devmode.dmDuplex = DMDUP_SIMPLEX;
        devmode.dmFields |= DM_DUPLEX;
    }

    // Copies
    if cmd.copies > 0 {
        print_fields.dmCopies = cmd.copies as i16;
        devmode.dmFields |= DM_COPIES;
    }

    // Media type
    if !cmd.media_type.is_empty() {
        devmode.dmMediaType = map_media_type(&cmd.media_type) as u32;
        devmode.dmFields |= DM_MEDIATYPE;
    }

    // Scaling (if not 100%)
    if cmd.scaling_percent > 0 && cmd.scaling_percent != 100 {
        let scale = cmd.scaling_percent.clamp(25, 400);
        print_fields.dmScale = scale as i16;
        devmode.dmFields |= DM_SCALE;
    }
}

// ── Print job submission ──

/// Submit a print job via Windows Spooler API.
///
/// Flow: OpenPrinterW → DocumentPropertiesW (get DEVMODE) → apply settings →
///       CreateDCW → StartDocW → StartPage → StretchDIBits (GDI render) → EndPage → EndDoc
pub fn submit_job(
    printer_name: &str,
    file_path: &Path,
    cmd: &print_proto::PrintCommand,
) -> anyhow::Result<PrintResult> {
    if printer_name.is_empty() {
        anyhow::bail!("Empty printer name");
    }
    if printer_name.len() > 220 {
        anyhow::bail!("Printer name too long: {} chars", printer_name.len());
    }

    if !file_path.exists() {
        anyhow::bail!("File not found: {}", file_path.display());
    }

    // Load image
    let img = image::open(file_path)?;
    let rgb = img.to_rgb8();
    let (img_w, img_h) = (rgb.width(), rgb.height());

    // Convert printer name to wide string
    let printer_wide: Vec<u16> = printer_name.encode_utf16().chain(std::iter::once(0)).collect();
    let printer_pcwstr = PCWSTR(printer_wide.as_ptr());

    // Open printer
    let mut printer_handle = HANDLE::default();
    unsafe {
        OpenPrinterW(printer_pcwstr, &mut printer_handle, None)?;
    }

    // Get default DEVMODE size
    let devmode_size = unsafe {
        DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            printer_pcwstr,
            None,
            None,
            0u32, // DM_OUT_BUFFER size query
        )
    };

    if devmode_size <= 0 {
        unsafe { ClosePrinter(printer_handle)?; }
        anyhow::bail!("Failed to get DEVMODE size for printer: {printer_name}");
    }

    // Allocate and fill DEVMODE
    let mut devmode_buf = vec![0u8; devmode_size as usize];
    let devmode_ptr = devmode_buf.as_mut_ptr() as *mut DEVMODEW;

    unsafe {
        let result = DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            printer_pcwstr,
            Some(devmode_ptr),
            None,
            DM_OUT_BUFFER.0,
        );
        if result != IDOK.0 {
            ClosePrinter(printer_handle)?;
            anyhow::bail!("DocumentPropertiesW failed for: {printer_name}");
        }
    }

    // Try PrintTicket path first, fall back to legacy DEVMODE
    let use_printticket_devmode = match crate::printticket::generate_and_convert_devmode(cmd, printer_name) {
        Ok(pt_devmode_bytes) => {
            if pt_devmode_bytes.len() >= std::mem::size_of::<DEVMODEW>() {
                // Copy PrintTicket-derived DEVMODE over our buffer
                let copy_len = pt_devmode_bytes.len().min(devmode_buf.len());
                devmode_buf[..copy_len].copy_from_slice(&pt_devmode_bytes[..copy_len]);
                info!("Using PrintTicket-derived DEVMODE ({} bytes)", copy_len);
                true
            } else {
                warn!(
                    "PrintTicket DEVMODE too small ({} bytes), falling back to legacy",
                    pt_devmode_bytes.len()
                );
                false
            }
        }
        Err(e) => {
            debug!("PrintTicket unavailable ({}), using legacy DEVMODE path", e);
            false
        }
    };

    if !use_printticket_devmode {
        // Legacy path: apply settings directly to DEVMODE fields
        let devmode = unsafe { &mut *devmode_ptr };
        apply_settings_to_devmode(devmode, cmd);

        // Validate DEVMODE with the driver
        unsafe {
            let result = DocumentPropertiesW(
                HWND::default(),
                printer_handle,
                printer_pcwstr,
                Some(devmode_ptr),
                Some(devmode_ptr),
                (DM_IN_BUFFER | DM_OUT_BUFFER).0,
            );
            if result != IDOK.0 {
                warn!(
                    paper_size = %cmd.paper_size,
                    media_type = %cmd.media_type,
                    quality = %cmd.quality,
                    copies = cmd.copies,
                    duplex = cmd.duplex,
                    "Driver rejected DEVMODE, using driver defaults"
                );
            }
        }
    }

    // Create Device Context (devmode_ptr points at final DEVMODE regardless of path)
    let devmode_ref = unsafe { &*devmode_ptr };
    let winspool_wide: Vec<u16> = "WINSPOOL".encode_utf16().chain(std::iter::once(0)).collect();
    let dc = unsafe {
        CreateDCW(
            PCWSTR(winspool_wide.as_ptr()),
            printer_pcwstr,
            PCWSTR::null(),
            Some(devmode_ref),
        )
    };

    if dc.is_invalid() {
        unsafe { ClosePrinter(printer_handle)?; }
        anyhow::bail!("CreateDCW failed for: {printer_name}");
    }

    // Job title
    let title = if cmd.file_name.is_empty() {
        format!("SVF-{}", &cmd.job_id[..8.min(cmd.job_id.len())])
    } else {
        cmd.file_name.clone()
    };
    let title_wide: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();

    let doc_info = DOCINFOW {
        cbSize: mem::size_of::<DOCINFOW>() as i32,
        lpszDocName: PCWSTR(title_wide.as_ptr()),
        lpszOutput: PCWSTR::null(),
        lpszDatatype: PCWSTR::null(),
        fwType: 0,
    };

    // Start document
    let job_id = unsafe { StartDocW(dc, &doc_info) };
    if job_id <= 0 {
        unsafe {
            let _ = DeleteDC(dc);
            ClosePrinter(printer_handle)?;
        }
        anyhow::bail!("StartDocW failed");
    }

    // Start page
    if unsafe { StartPage(dc) } <= 0 {
        unsafe {
            EndDoc(dc);
            let _ = DeleteDC(dc);
            ClosePrinter(printer_handle)?;
        }
        anyhow::bail!("StartPage failed");
    }

    // Get printable area
    let page_w = unsafe { GetDeviceCaps(dc, HORZRES) };
    let page_h = unsafe { GetDeviceCaps(dc, VERTRES) };

    // Prepare BITMAPINFO for StretchDIBits
    // Image data must be bottom-up BGR for Windows GDI
    let row_stride = ((img_w * 3 + 3) & !3) as usize; // DWORD-aligned
    let mut bgr_data = vec![0u8; row_stride * img_h as usize];

    for y in 0..img_h {
        // Flip vertically: bottom-up
        let dst_row = (img_h - 1 - y) as usize;
        for x in 0..img_w {
            let pixel = rgb.get_pixel(x, y);
            let offset = dst_row * row_stride + (x as usize) * 3;
            bgr_data[offset] = pixel[2];     // B
            bgr_data[offset + 1] = pixel[1]; // G
            bgr_data[offset + 2] = pixel[0]; // R
        }
    }

    let bmi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: img_w as i32,
            biHeight: img_h as i32, // positive = bottom-up
            biPlanes: 1,
            biBitCount: 24,
            biCompression: BI_RGB.0,
            biSizeImage: 0,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD::default()],
    };

    // Render image to page using StretchDIBits
    let result = unsafe {
        StretchDIBits(
            dc,
            0,              // dst X
            0,              // dst Y
            page_w,         // dst width (full page)
            page_h,         // dst height (full page)
            0,              // src X
            0,              // src Y
            img_w as i32,   // src width
            img_h as i32,   // src height
            Some(bgr_data.as_ptr() as *const _),
            &bmi,
            DIB_RGB_COLORS,
            SRCCOPY,
        )
    };

    if result == 0 {
        error!("StretchDIBits returned 0 — GDI rendering failed");
        unsafe {
            EndPage(dc);
            EndDoc(dc);
            let _ = DeleteDC(dc);
            ClosePrinter(printer_handle)?;
        }
        anyhow::bail!("GDI rendering failed: StretchDIBits returned 0");
    }

    // End page + document
    unsafe {
        EndPage(dc);
        EndDoc(dc);
        let _ = DeleteDC(dc);
        ClosePrinter(printer_handle)?;
    }

    info!(
        printer = printer_name,
        job_id,
        img = format!("{img_w}x{img_h}"),
        page = format!("{page_w}x{page_h}"),
        "Print job submitted via Windows Spooler"
    );

    Ok(PrintResult { job_id })
}

// ── Printer status ──

/// Query printer status via Windows Spooler API.
pub fn get_printer_status(printer_name: &str) -> PrinterStatus {
    let printer_wide: Vec<u16> = printer_name.encode_utf16().chain(std::iter::once(0)).collect();
    let mut printer_handle = HANDLE::default();

    let opened = unsafe {
        OpenPrinterW(PCWSTR(printer_wide.as_ptr()), &mut printer_handle, None)
    };

    if opened.is_err() {
        return PrinterStatus {
            is_online: false,
            state: PrinterState::Error,
            state_reasons: vec!["Cannot open printer".into()],
        };
    }

    // Get PRINTER_INFO_2 for status
    let mut needed = 0u32;
    unsafe {
        let _ = GetPrinterW(printer_handle, 2, None, &mut needed);
    }

    if needed == 0 {
        unsafe { let _ = ClosePrinter(printer_handle); }
        return PrinterStatus {
            is_online: false,
            state: PrinterState::Unknown,
            state_reasons: vec![],
        };
    }

    let mut buffer = vec![0u8; needed as usize];
    let success = unsafe {
        GetPrinterW(
            printer_handle,
            2,
            Some(&mut buffer),
            &mut needed,
        )
    };

    unsafe { let _ = ClosePrinter(printer_handle); }

    if success.is_err() {
        return PrinterStatus {
            is_online: false,
            state: PrinterState::Error,
            state_reasons: vec!["GetPrinterW failed".into()],
        };
    }

    let info = unsafe { &*(buffer.as_ptr() as *const PRINTER_INFO_2W) };
    let status = info.Status;

    let state = if status == 0 {
        PrinterState::Idle
    } else if status & (PRINTER_STATUS_PRINTING | PRINTER_STATUS_PROCESSING) != 0 {
        PrinterState::Processing
    } else if status & PRINTER_STATUS_PAUSED != 0 {
        PrinterState::Paused
    } else if status & PRINTER_STATUS_ERROR != 0 {
        PrinterState::Error
    } else if status & PRINTER_STATUS_OFFLINE != 0 {
        PrinterState::Offline
    } else {
        PrinterState::Unknown
    };

    let mut reasons = Vec::new();
    if status & PRINTER_STATUS_PAPER_JAM != 0 { reasons.push("paper_jam".into()); }
    if status & PRINTER_STATUS_PAPER_OUT != 0 { reasons.push("paper_out".into()); }
    if status & PRINTER_STATUS_TONER_LOW != 0 { reasons.push("toner_low".into()); }
    if status & PRINTER_STATUS_NO_TONER != 0 { reasons.push("no_toner".into()); }
    if status & PRINTER_STATUS_DOOR_OPEN != 0 { reasons.push("door_open".into()); }
    if status & PRINTER_STATUS_USER_INTERVENTION != 0 { reasons.push("user_intervention".into()); }
    if status & PRINTER_STATUS_OUT_OF_MEMORY != 0 { reasons.push("out_of_memory".into()); }

    PrinterStatus {
        is_online: status & PRINTER_STATUS_OFFLINE == 0 && status & PRINTER_STATUS_ERROR == 0,
        state,
        state_reasons: reasons,
    }
}

/// Query supply levels (Windows lacks a universal API — returns empty for most printers).
/// Vendor-specific SDKs (Epson Status Monitor, Canon Status Window) are required for ink levels.
pub fn get_printer_supplies(_printer_name: &str) -> Vec<SupplyLevel> {
    // Windows doesn't have a standard API for supply levels like CUPS marker-*.
    // In practice, this is queried via vendor SNMP OIDs or WMI. For now, return empty
    // and rely on the Telemetry Agent (Device Monitor) for hardware-level supply info.
    vec![]
}
