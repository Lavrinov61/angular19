//! Minimal PPD parser for exact printable areas.
//!
//! CUPS drivers expose physical paper dimensions and imageable areas in
//! PostScript points. The Rust print pipeline uses this as the server-side
//! source of truth for non-borderless previews and rendered sheets.

use std::{collections::HashMap, path::PathBuf};

use serde::Serialize;

use super::submit;

const POINT_TO_MM: f64 = 25.4 / 72.0;

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PrintableAreaMm {
    pub page_width_mm: f64,
    pub page_height_mm: f64,
    pub left_mm: f64,
    pub top_mm: f64,
    pub right_mm: f64,
    pub bottom_mm: f64,
    pub printable_width_mm: f64,
    pub printable_height_mm: f64,
}

#[derive(Clone, Debug, PartialEq)]
struct PpdRect {
    llx: f64,
    lly: f64,
    urx: f64,
    ury: f64,
}

#[derive(Clone, Debug, PartialEq)]
struct PpdSize {
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, Default)]
pub struct PpdFile {
    imageable_areas: HashMap<String, PpdRect>,
    paper_dimensions: HashMap<String, PpdSize>,
}

impl PpdFile {
    pub fn load(cups_printer: &str) -> Result<Self, String> {
        let path = ppd_path(cups_printer)?;
        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Cannot read PPD `{}`: {e}", path.display()))?;
        Self::parse(&content)
    }

    pub fn parse(content: &str) -> Result<Self, String> {
        let mut ppd = Self::default();

        for line in content.lines() {
            let line = line.trim();
            if line.starts_with("*ImageableArea ") {
                if let Some((token, values)) = parse_ppd_line(line, "*ImageableArea ") {
                    ppd.imageable_areas.insert(
                        token.to_string(),
                        parse_rect(values)
                            .map_err(|e| format!("Invalid ImageableArea `{token}`: {e}"))?,
                    );
                }
            } else if line.starts_with("*PaperDimension ") {
                if let Some((token, values)) = parse_ppd_line(line, "*PaperDimension ") {
                    ppd.paper_dimensions.insert(
                        token.to_string(),
                        parse_size(values)
                            .map_err(|e| format!("Invalid PaperDimension `{token}`: {e}"))?,
                    );
                }
            }
        }

        if ppd.imageable_areas.is_empty() || ppd.paper_dimensions.is_empty() {
            return Err("PPD does not define ImageableArea/PaperDimension".to_string());
        }

        Ok(ppd)
    }

    pub fn printable_area_mm(&self, page_size: &str) -> Result<PrintableAreaMm, String> {
        let area = self
            .imageable_areas
            .get(page_size)
            .ok_or_else(|| format!("PPD does not define ImageableArea for `{page_size}`"))?;
        let paper = self
            .paper_dimensions
            .get(page_size)
            .ok_or_else(|| format!("PPD does not define PaperDimension for `{page_size}`"))?;

        if area.urx <= area.llx || area.ury <= area.lly {
            return Err(format!(
                "PPD ImageableArea for `{page_size}` is not positive"
            ));
        }
        if paper.width <= 0.0 || paper.height <= 0.0 {
            return Err(format!(
                "PPD PaperDimension for `{page_size}` is not positive"
            ));
        }
        if area.urx > paper.width + 0.01 || area.ury > paper.height + 0.01 {
            return Err(format!(
                "PPD ImageableArea for `{page_size}` exceeds PaperDimension"
            ));
        }

        Ok(PrintableAreaMm {
            page_width_mm: paper.width * POINT_TO_MM,
            page_height_mm: paper.height * POINT_TO_MM,
            left_mm: area.llx * POINT_TO_MM,
            top_mm: (paper.height - area.ury) * POINT_TO_MM,
            right_mm: (paper.width - area.urx) * POINT_TO_MM,
            bottom_mm: area.lly * POINT_TO_MM,
            printable_width_mm: (area.urx - area.llx) * POINT_TO_MM,
            printable_height_mm: (area.ury - area.lly) * POINT_TO_MM,
        })
    }
}

pub fn printable_area_for_printer(
    cups_printer: &str,
    paper_size: &str,
    borderless: bool,
) -> Result<PrintableAreaMm, String> {
    let page_size = submit::page_size_option(cups_printer, paper_size, borderless)?;
    PpdFile::load(cups_printer)?.printable_area_mm(page_size)
}

fn ppd_path(cups_printer: &str) -> Result<PathBuf, String> {
    if cups_printer.is_empty()
        || cups_printer.contains('/')
        || cups_printer.contains('\\')
        || cups_printer.contains("..")
    {
        return Err(format!("Invalid CUPS printer name: `{cups_printer}`"));
    }
    Ok(PathBuf::from("/etc/cups/ppd").join(format!("{cups_printer}.ppd")))
}

fn parse_ppd_line<'a>(line: &'a str, prefix: &str) -> Option<(&'a str, &'a str)> {
    let rest = line.strip_prefix(prefix)?;
    let (raw_token, raw_values) = rest.split_once(':')?;
    let token = raw_token
        .trim()
        .split_once('/')
        .map(|(token, _)| token)
        .unwrap_or_else(|| raw_token.trim())
        .trim();
    let values = raw_values.trim().trim_matches('"');
    if token.is_empty() || values.is_empty() {
        return None;
    }
    Some((token, values))
}

fn parse_rect(values: &str) -> Result<PpdRect, String> {
    let parts = parse_numbers(values)?;
    if parts.len() != 4 {
        return Err(format!("expected 4 numbers, got {}", parts.len()));
    }
    Ok(PpdRect {
        llx: parts[0],
        lly: parts[1],
        urx: parts[2],
        ury: parts[3],
    })
}

fn parse_size(values: &str) -> Result<PpdSize, String> {
    let parts = parse_numbers(values)?;
    if parts.len() != 2 {
        return Err(format!("expected 2 numbers, got {}", parts.len()));
    }
    Ok(PpdSize {
        width: parts[0],
        height: parts[1],
    })
}

fn parse_numbers(values: &str) -> Result<Vec<f64>, String> {
    values
        .split_whitespace()
        .map(|part| {
            part.parse::<f64>()
                .map_err(|_| format!("not a number: `{part}`"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_canon_a4_printable_area_from_ppd_lines() {
        let ppd = PpdFile::parse(
            r#"
*ImageableArea A4/A4: "14.173 14.173 581.127 827.727"
*PaperDimension A4/A4: "595.3 841.9"
"#,
        )
        .unwrap();

        let area = ppd.printable_area_mm("A4").unwrap();
        assert!((area.page_width_mm - 210.0).abs() < 0.1);
        assert!((area.page_height_mm - 297.0).abs() < 0.1);
        assert!((area.left_mm - 5.0).abs() < 0.1);
        assert!((area.top_mm - 5.0).abs() < 0.1);
        assert!((area.printable_width_mm - 200.0).abs() < 0.2);
        assert!((area.printable_height_mm - 287.0).abs() < 0.2);
    }

    #[test]
    fn parses_epson_borderless_and_non_borderless_tokens() {
        let ppd = PpdFile::parse(
            r#"
*ImageableArea A4/A4: "8.40 8.40 586.80 833.40"
*PaperDimension A4/A4: "595.20 841.80"
*ImageableArea TA4/A4 (Borderless): "0 0 595.20 841.80"
*PaperDimension TA4/A4 (Borderless): "595.20 841.80"
"#,
        )
        .unwrap();

        let area = ppd.printable_area_mm("A4").unwrap();
        assert!(area.left_mm > 2.0);
        assert!(area.printable_width_mm < area.page_width_mm);

        let borderless = ppd.printable_area_mm("TA4").unwrap();
        assert!(borderless.left_mm.abs() < 0.01);
        assert!((borderless.printable_width_mm - borderless.page_width_mm).abs() < 0.01);
    }

    #[test]
    fn rejects_unsafe_printer_names() {
        assert!(ppd_path("../secret").is_err());
        assert!(ppd_path("bad/name").is_err());
        assert!(ppd_path("Canon-C3226i-Soborny").is_ok());
    }
}
