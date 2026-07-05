//! CUPS job submission via the `lp` CLI command.

use std::path::Path;
use tokio::process::Command;
use tracing::{debug, info};

use super::options::CupsOptions;

fn push_lp_option(args: &mut Vec<String>, option: impl Into<String>) {
    args.push("-o".into());
    args.push(option.into());
}

/// CUPS paper size mapping: CRM paper IDs to CUPS media names.
pub(crate) fn cups_media_name(paper_id: &str, borderless: bool) -> Result<&'static str, String> {
    let media = match paper_id.to_lowercase().as_str() {
        "10x15" => {
            if borderless {
                "4x6.bl"
            } else {
                "4x6"
            }
        }
        "13x18" => {
            if borderless {
                "5x7.bl"
            } else {
                "5x7"
            }
        }
        "15x20" => {
            if borderless {
                "na_index-5x8_5x8in"
            } else {
                "na_index-5x8_5x8in"
            }
        }
        "15x21" => {
            if borderless {
                "6x8.bl"
            } else {
                "6x8"
            }
        }
        "20x30" => {
            if borderless {
                "8x12.bl"
            } else {
                "8x12"
            }
        }
        "10x10" => {
            if borderless {
                "4x4.bl"
            } else {
                "4x4"
            }
        }
        "a4" => {
            if borderless {
                "A4.bl"
            } else {
                "A4"
            }
        }
        "a5" => {
            if borderless {
                "A5.bl"
            } else {
                "A5"
            }
        }
        "a3" => {
            if borderless {
                "A3.bl"
            } else {
                "A3"
            }
        }
        _ => return Err(format!("Unsupported generic CUPS paper size: {paper_id}")),
    };
    Ok(media)
}

pub(crate) fn is_epson_l8050(cups_printer: &str) -> bool {
    cups_printer.to_lowercase().contains("l8050")
}

pub(crate) fn is_canon_c3226i(cups_printer: &str) -> bool {
    let normalized = cups_printer.to_lowercase();
    normalized.contains("c3226") || normalized.contains("ir c3226")
}

fn compact_option_id(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '-' | '_' | '/'))
        .collect()
}

pub(crate) fn canon_c3226i_page_size(paper_id: &str) -> Result<&'static str, String> {
    let normalized = compact_option_id(paper_id);
    let page_size = match normalized.as_str() {
        "a3" => "A3",
        "a4" => "A4",
        "a5" => "A5",
        "a6" => "A6",
        "b4" => "B4",
        "b5" => "B5",
        "c6" | "c6envelope" | "isoc6envelope" | "envelopec6" => "Custom.114x162mm",
        "letter" => "Letter",
        "legal" => "Legal",
        _ => return Err(format!("Unsupported Canon C3226i paper size: {paper_id}")),
    };
    Ok(page_size)
}

fn canon_c3226i_input_slot(paper_source: &str) -> Result<Option<&'static str>, String> {
    let normalized = compact_option_id(paper_source);
    let slot = match normalized.as_str() {
        "" | "auto" => None,
        "manual" | "universal" | "universallot" | "universaltray" | "multipurpose"
        | "multipurposetray" | "bypass" | "mp" | "mptray" => Some("Manual"),
        "cas1" | "cassette1" | "tray1" => Some("Cas1"),
        "cas2" | "cassette2" | "tray2" => Some("Cas2"),
        "cas3" | "cassette3" | "tray3" => Some("Cas3"),
        "cas4" | "cassette4" | "tray4" => Some("Cas4"),
        _ => {
            return Err(format!(
                "Unsupported Canon C3226i paper source: {paper_source}"
            ));
        }
    };
    Ok(slot)
}

fn canon_c3226i_media_type(media_type: &str) -> Result<Option<&'static str>, String> {
    let normalized = compact_option_id(media_type);
    let media = match normalized.as_str() {
        "" | "auto" => None,
        "plain" | "plain1" | "ordinary" => Some("PlainPaper1"),
        "plain2" => Some("PlainPaper2"),
        "plain3" => Some("PlainPaper3"),
        "thick" | "heavy" | "heavy1" => Some("HEAVY1"),
        "heavy2" => Some("HEAVY2"),
        "heavy3" => Some("HEAVY3"),
        "heavy4" => Some("HEAVY4"),
        "heavy5" => Some("HEAVY5"),
        "heavy6" | "heavy221256" | "gsm250" | "250gsm" | "cardstock250" => Some("HEAVY6"),
        "heavy7" | "heavy257300" | "gsm300" | "300gsm" | "cardstock300" => Some("HEAVY7"),
        "labels" | "label" => Some("LABELS"),
        "envelope" | "envelopes" | "kraft" | "kraftenvelope" | "c6kraft" => Some("ENVELOPE"),
        "coated" | "onesidecoated3" => Some("1SIDECOATED3"),
        "recycled" => Some("RECYCLED1"),
        _ => return Err(format!("Unsupported Canon C3226i media type: {media_type}")),
    };
    Ok(media)
}

fn is_rendered_layout_sheet(file_name: &str) -> bool {
    file_name.starts_with("layout-sheet-")
}

fn should_apply_canon_layout_color_defaults(file_name: &str, color_mode: &str) -> bool {
    !color_mode.eq_ignore_ascii_case("bw") && is_rendered_layout_sheet(file_name)
}

fn is_cups_custom_page_size(page_size: &str) -> bool {
    page_size.starts_with("Custom.")
}

fn canon_c3226i_layout_color_options() -> &'static [(&'static str, &'static str)] {
    &[
        ("CNTonerSaving", "False"),
        ("CNObjectPrioritizeProcessing", "Images"),
        ("CNMatchingMethod", "Vividphoto"),
    ]
}

/// Quality options for regular documents on the Canon C3226i.
///
/// The PPD defaults are toner-economical: `CNTonerSaving=Auto` lightens sparse/pale
/// areas and the raster `CNObjectPrioritizeProcessing=Text` binarizes aggressively, so
/// faint content (light pencil, pale scans, stamps) drops to white. We force full toner,
/// bias rendering toward preserving tonal/image content, bump text toner volume, and turn
/// on line-resolution control for crisp thin lines/drawings.
fn canon_c3226i_document_quality_options() -> &'static [(&'static str, &'static str)] {
    &[
        ("CNTonerSaving", "False"),
        ("CNObjectPrioritizeProcessing", "Images"),
        ("CNTonerVolumeAdjustment", "Text"),
        ("CNLineControl", "Resolution"),
    ]
}

/// Epson L8050 ESC/P-R PPD uses vendor PageSize tokens, not generic IPP media names.
pub(crate) fn epson_l8050_page_size(
    paper_id: &str,
    borderless: bool,
) -> Result<&'static str, String> {
    let page_size = match paper_id.to_lowercase().as_str() {
        "10x15" | "4x6" => {
            if borderless {
                "T4X6FULL"
            } else {
                "4X6FULL"
            }
        }
        "13x18" | "5x7" | "2l" => {
            if borderless {
                "T2L"
            } else {
                "2L"
            }
        }
        "9x13" | "l" => {
            if borderless {
                "TL"
            } else {
                "L"
            }
        }
        "20x25" | "8x10" => {
            if borderless {
                "T8x10"
            } else {
                "8x10"
            }
        }
        "16x9" | "4x7" => {
            if borderless {
                "T4X7"
            } else {
                "4X7"
            }
        }
        "postcard" | "100x148" => {
            if borderless {
                "TPostcard"
            } else {
                "Postcard"
            }
        }
        "a4" => {
            if borderless {
                "TA4"
            } else {
                "A4"
            }
        }
        "letter" => {
            if borderless {
                "TLetter"
            } else {
                "Letter"
            }
        }
        "legal" => {
            if borderless {
                "TLegal"
            } else {
                "Legal"
            }
        }
        "a5" => "A5",
        "a6" => "A6",
        "b5" => "B5",
        "b6" => "B6",
        "15x20" | "15x21" | "20x30" | "21x30" => {
            if borderless {
                "TA4"
            } else {
                "A4"
            }
        }
        _ => return Err(format!("Unsupported Epson L8050 paper size: {paper_id}")),
    };
    Ok(page_size)
}

fn cups_media_type(media: &str) -> Result<&'static str, String> {
    let media_type = match media.to_lowercase().as_str() {
        "glossy" => "photographic-glossy",
        "matte" => "photographic-matte",
        "satin" => "photographic-satin",
        "luster" => "photographic-high-gloss",
        "fine_art" => "stationery-fine",
        "plain" => "stationery",
        "thick" => "stationery-heavyweight",
        "recycled" => "stationery-recycled",
        "envelope" => "envelope",
        _ => return Err(format!("Unsupported generic CUPS media type: {media}")),
    };
    Ok(media_type)
}

fn epson_l8050_media_type(media: &str, quality: &str) -> Result<&'static str, String> {
    let high_quality = matches!(quality.to_lowercase().as_str(), "photo" | "best" | "high");

    let media_type = match media.to_lowercase().as_str() {
        "matte" => {
            if high_quality {
                "PMMATT_HIGH"
            } else {
                "PMMATT_NORMAL"
            }
        }
        "semi_glossy" | "semigloss" | "semi-glossy" => {
            if high_quality {
                "PSGLOS_HIGH"
            } else {
                "PSGLOS_NORMAL"
            }
        }
        "luster" | "lustre" => {
            if high_quality {
                "PSGLOS_HIGH"
            } else {
                "PSGLOS_NORMAL"
            }
        }
        "ultra_glossy" | "platinum" | "platina" => {
            if high_quality {
                "PLATINA_HIGH"
            } else {
                "PLATINA_NORMAL"
            }
        }
        "photo_glossy" | "photo-paper-glossy" => {
            if high_quality {
                "LCPP_HIGH"
            } else {
                "LCPP_NORMAL"
            }
        }
        "plain" => {
            if high_quality {
                "PLAIN_HIGH"
            } else {
                "PLAIN_NORMAL"
            }
        }
        "fine" | "sfine" => {
            if high_quality {
                "SFINE_HIGH"
            } else {
                "SFINE_NORMAL"
            }
        }
        "glossy" | "" => {
            if high_quality {
                "PMPHOTO_HIGH"
            } else {
                "PMPHOTO_NORMAL"
            }
        }
        _ => return Err(format!("Unsupported Epson L8050 media type: {media}")),
    };
    Ok(media_type)
}

fn cups_quality(quality: &str) -> Result<&'static str, String> {
    let value = match quality.to_lowercase().as_str() {
        "draft" => "3",
        "normal" | "standard" => "4",
        "photo" | "best" | "high" => "5",
        _ => return Err(format!("Unsupported print quality: {quality}")),
    };
    Ok(value)
}

pub(crate) fn page_size_option(
    cups_printer: &str,
    paper_id: &str,
    borderless: bool,
) -> Result<&'static str, String> {
    if is_epson_l8050(cups_printer) {
        epson_l8050_page_size(paper_id, borderless)
    } else if is_canon_c3226i(cups_printer) {
        canon_c3226i_page_size(paper_id)
    } else {
        cups_media_name(paper_id, borderless)
    }
}

fn require_ppd_choice(
    options: &CupsOptions,
    cups_printer: &str,
    option: &str,
    choice: &str,
) -> Result<(), String> {
    options
        .require_choice(option, choice)
        .map_err(|e| format!("CUPS printer `{cups_printer}` rejected exact option: {e}"))
}

/// Submit a print job to CUPS via the `lp` command (async).
pub async fn submit_job(
    cups_printer: &str,
    file_path: &Path,
    copies: i32,
    paper_size: &str,
    borderless: bool,
    media_type: &str,
    paper_source: &str,
    raster_ppi: u32,
    quality: &str,
    color_mode: &str,
    duplex: bool,
    booklet: bool,
    pages_per_sheet: i32,
    duplex_mode: &str,
    document_print: bool,
    file_name: &str,
    job_id: &str,
) -> Result<i32, String> {
    if cups_printer.is_empty() {
        return Err("No CUPS printer configured".into());
    }
    if !file_path.exists() {
        return Err(format!("File not found: {}", file_path.display()));
    }
    let is_pdf = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"));

    let mut args: Vec<String> = vec![
        "-d".into(),
        cups_printer.to_string(),
        "-n".into(),
        copies.max(1).to_string(),
    ];

    if is_epson_l8050(cups_printer) {
        let ppd = CupsOptions::load(cups_printer).await?;
        let page_size = epson_l8050_page_size(paper_size, borderless)?;
        require_ppd_choice(&ppd, cups_printer, "PageSize", page_size)?;
        push_lp_option(&mut args, format!("PageSize={page_size}"));
        let media = epson_l8050_media_type(media_type, quality)?;
        require_ppd_choice(&ppd, cups_printer, "MediaType", media)?;
        push_lp_option(&mut args, format!("MediaType={media}"));
        let ink = if color_mode == "bw" { "MONO" } else { "COLOR" };
        require_ppd_choice(&ppd, cups_printer, "Ink", ink)?;
        push_lp_option(&mut args, format!("Ink={ink}"));
    } else if is_canon_c3226i(cups_printer) {
        let ppd = CupsOptions::load(cups_printer).await?;
        let page_size = canon_c3226i_page_size(paper_size)?;
        if !is_cups_custom_page_size(page_size) {
            require_ppd_choice(&ppd, cups_printer, "PageSize", page_size)?;
        }
        push_lp_option(&mut args, format!("PageSize={page_size}"));
        if let Some(slot) = canon_c3226i_input_slot(paper_source)? {
            require_ppd_choice(&ppd, cups_printer, "InputSlot", slot)?;
            push_lp_option(&mut args, format!("InputSlot={slot}"));
        }
        if let Some(media) = canon_c3226i_media_type(media_type)? {
            require_ppd_choice(&ppd, cups_printer, "MediaType", media)?;
            push_lp_option(&mut args, format!("MediaType={media}"));
        }
        require_ppd_choice(&ppd, cups_printer, "Resolution", "600")?;
        push_lp_option(&mut args, "Resolution=600");
        let color = if color_mode == "bw" { "mono" } else { "color" };
        require_ppd_choice(&ppd, cups_printer, "CNColorMode", color)?;
        push_lp_option(&mut args, format!("CNColorMode={color}"));
        if should_apply_canon_layout_color_defaults(file_name, color_mode) {
            for (option, choice) in canon_c3226i_layout_color_options() {
                require_ppd_choice(&ppd, cups_printer, option, choice)?;
                push_lp_option(&mut args, format!("{option}={choice}"));
            }
        } else if !is_rendered_layout_sheet(file_name) {
            // Regular documents: disable toner-save and boost density so faint content
            // (light pencil, pale scans, stamps) doesn't get whitened out.
            for (option, choice) in canon_c3226i_document_quality_options() {
                require_ppd_choice(&ppd, cups_printer, option, choice)?;
                push_lp_option(&mut args, format!("{option}={choice}"));
            }
        }
        let canon_duplex_mode = if duplex {
            if booklet || duplex_mode == "short_edge" {
                "DuplexTumble"
            } else {
                "DuplexNoTumble"
            }
        } else {
            "None"
        };
        require_ppd_choice(&ppd, cups_printer, "Duplex", canon_duplex_mode)?;
        push_lp_option(&mut args, format!("Duplex={canon_duplex_mode}"));
    } else {
        if !paper_size.is_empty() {
            push_lp_option(
                &mut args,
                format!("media={}", cups_media_name(paper_size, borderless)?),
            );
        }

        if !media_type.is_empty() {
            push_lp_option(
                &mut args,
                format!("media-type={}", cups_media_type(media_type)?),
            );
        }

        if !quality.is_empty() {
            push_lp_option(
                &mut args,
                format!("print-quality={}", cups_quality(quality)?),
            );
        }

        if color_mode == "bw" {
            push_lp_option(&mut args, "print-color-mode=monochrome");
        }
    }

    push_lp_option(
        &mut args,
        if duplex {
            if booklet || duplex_mode == "short_edge" {
                "sides=two-sided-short-edge"
            } else {
                "sides=two-sided-long-edge"
            }
        } else {
            "sides=one-sided"
        },
    );

    if booklet {
        push_lp_option(&mut args, "booklet=true");
        push_lp_option(&mut args, "number-up=2");
    } else if pages_per_sheet > 1 {
        push_lp_option(
            &mut args,
            format!("number-up={}", pages_per_sheet.clamp(2, 16)),
        );
    }

    let sheet_imposition = booklet || pages_per_sheet > 1;
    // A whole document is scaled to fit the selected paper (like the previous
    // per-page raster path did), so an A4/Letter/A3 source prints correctly on
    // A4 *and* a document sent to a photo format (e.g. 10x15 on Epson) is scaled
    // down instead of being printed at actual size and clipped.
    let scale_to_fit = sheet_imposition || document_print;
    push_lp_option(
        &mut args,
        if scale_to_fit {
            "fit-to-page=true"
        } else {
            "fit-to-page=false"
        },
    );
    if is_pdf {
        push_lp_option(
            &mut args,
            if scale_to_fit {
                "print-scaling=fit"
            } else {
                "print-scaling=none"
            },
        );
    } else {
        push_lp_option(&mut args, format!("ppi={}", raster_ppi.clamp(72, 1200)));
    }

    let title = if file_name.is_empty() {
        format!("SVF-{}", &job_id[..8.min(job_id.len())])
    } else {
        file_name.to_string()
    };
    args.push("-t".into());
    args.push(title);

    args.push(file_path.display().to_string());

    debug!(printer = cups_printer, args = ?args, "Submitting to CUPS");

    let output = Command::new("lp")
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to execute `lp`: {e}. Is CUPS installed?"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("lp failed (exit {}): {stderr}", output.status));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let cups_job_id = parse_lp_job_id(&stdout);

    info!(cups_printer, cups_job_id, "Print job submitted to CUPS");
    Ok(cups_job_id)
}

fn parse_lp_job_id(output: &str) -> i32 {
    output
        .split('-')
        .last()
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_epson_l8050_borderless_10x15_to_vendor_page_size() {
        assert_eq!(epson_l8050_page_size("10x15", true).unwrap(), "T4X6FULL");
        assert_eq!(epson_l8050_page_size("10x15", false).unwrap(), "4X6FULL");
        assert!(epson_l8050_page_size("unknown", false).is_err());
    }

    #[test]
    fn maps_epson_l8050_photo_media_to_vendor_quality_media_type() {
        assert_eq!(
            epson_l8050_media_type("glossy", "photo").unwrap(),
            "PMPHOTO_HIGH"
        );
        assert_eq!(
            epson_l8050_media_type("matte", "normal").unwrap(),
            "PMMATT_NORMAL"
        );
        assert_eq!(
            epson_l8050_media_type("semi_glossy", "best").unwrap(),
            "PSGLOS_HIGH"
        );
        assert!(epson_l8050_media_type("unknown", "photo").is_err());
    }

    #[test]
    fn detects_l8050_cups_queue_names() {
        assert!(is_epson_l8050("Epson-L8050-Left-Soborny"));
        assert!(!is_epson_l8050("Canon-C3226i-Soborny"));
    }

    #[test]
    fn detects_canon_c3226i_cups_queue_names() {
        assert!(is_canon_c3226i("Canon-C3226i-Soborny"));
        assert!(is_canon_c3226i("iR C3226"));
        assert!(!is_canon_c3226i("Epson-L8050-Left-Soborny"));
    }

    #[test]
    fn maps_canon_c3226i_business_card_options_to_ppd_tokens() {
        assert_eq!(canon_c3226i_page_size("A4").unwrap(), "A4");
        assert_eq!(canon_c3226i_input_slot("manual").unwrap(), Some("Manual"));
        assert_eq!(
            canon_c3226i_input_slot("universal").unwrap(),
            Some("Manual")
        );
        assert_eq!(canon_c3226i_media_type("heavy6").unwrap(), Some("HEAVY6"));
        assert_eq!(canon_c3226i_media_type("gsm_250").unwrap(), Some("HEAVY6"));
        assert_eq!(canon_c3226i_media_type("heavy7").unwrap(), Some("HEAVY7"));
        assert_eq!(canon_c3226i_media_type("gsm_300").unwrap(), Some("HEAVY7"));
        assert!(canon_c3226i_page_size("business-card").is_err());
        assert!(canon_c3226i_input_slot("random-tray").is_err());
        assert!(canon_c3226i_media_type("matte").is_err());
    }

    #[test]
    fn maps_canon_c3226i_c6_kraft_envelope_options_to_ppd_tokens() {
        assert_eq!(
            canon_c3226i_page_size("c6_envelope").unwrap(),
            "Custom.114x162mm"
        );
        assert_eq!(
            canon_c3226i_page_size("iso-c6-envelope").unwrap(),
            "Custom.114x162mm"
        );
        assert_eq!(canon_c3226i_media_type("envelope").unwrap(), Some("ENVELOPE"));
        assert_eq!(
            canon_c3226i_media_type("kraft-envelope").unwrap(),
            Some("ENVELOPE")
        );
    }

    #[test]
    fn applies_canon_layout_color_defaults_only_to_color_layout_sheets() {
        assert!(should_apply_canon_layout_color_defaults(
            "layout-sheet-001.jpg",
            "color"
        ));
        assert!(should_apply_canon_layout_color_defaults(
            "layout-sheet-001.jpg",
            "COLOR"
        ));
        assert!(!should_apply_canon_layout_color_defaults(
            "layout-sheet-001.jpg",
            "bw"
        ));
        assert!(!should_apply_canon_layout_color_defaults(
            "photo.jpg",
            "color"
        ));
    }

    #[test]
    fn canon_layout_color_defaults_disable_toner_save_and_prioritize_images() {
        assert!(canon_c3226i_layout_color_options().contains(&("CNTonerSaving", "False")));
        assert!(
            canon_c3226i_layout_color_options()
                .contains(&("CNObjectPrioritizeProcessing", "Images"))
        );
        assert!(canon_c3226i_layout_color_options().contains(&("CNMatchingMethod", "Vividphoto")));
    }

    #[test]
    fn canon_document_quality_options_disable_toner_save_and_boost_density() {
        let opts = canon_c3226i_document_quality_options();
        assert!(opts.contains(&("CNTonerSaving", "False")));
        assert!(opts.contains(&("CNObjectPrioritizeProcessing", "Images")));
        assert!(opts.contains(&("CNTonerVolumeAdjustment", "Text")));
        assert!(opts.contains(&("CNLineControl", "Resolution")));
        // Photo-only color matching must NOT leak into document prints.
        assert!(!opts.iter().any(|(k, _)| *k == "CNMatchingMethod"));
    }
}
