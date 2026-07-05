use regex::{Captures, Regex};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;

const MIN_FONT_HALF_POINTS: i32 = 8;
const MAX_FONT_HALF_POINTS: i32 = 400;

#[derive(Debug, Clone)]
pub(crate) struct DocxFontStats {
    pub sizes_pt: Vec<f32>,
    pub min_pt: f32,
    pub max_pt: f32,
    pub primary_pt: f32,
    pub explicit_size_count: usize,
}

/// Apply a point-size delta to explicit DOCX font declarations.
///
/// DOCX stores font sizes as half-points in `w:sz` / `w:szCs`. A `delta_pt`
/// of `-2` subtracts 4 from those values, preserving heading/body hierarchy.
pub fn apply_font_size_delta(
    input_path: &Path,
    output_path: &Path,
    delta_pt: i16,
) -> Result<(), String> {
    if delta_pt == 0 {
        std::fs::copy(input_path, output_path)
            .map_err(|e| format!("Cannot copy DOCX without font changes: {e}"))?;
        return Ok(());
    }

    let input_file = File::open(input_path)
        .map_err(|e| format!("Cannot open DOCX {}: {e}", input_path.display()))?;
    let mut archive = zip::ZipArchive::new(input_file)
        .map_err(|e| format!("Cannot read DOCX zip {}: {e}", input_path.display()))?;

    let output_file = File::create(output_path)
        .map_err(|e| format!("Cannot create adjusted DOCX {}: {e}", output_path.display()))?;
    let mut writer = zip::ZipWriter::new(output_file);

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("Cannot read DOCX zip entry #{index}: {e}"))?;
        let name = file.name().to_string();
        let options = SimpleFileOptions::default()
            .compression_method(file.compression())
            .unix_permissions(file.unix_mode().unwrap_or(0o644));

        if file.is_dir() {
            writer
                .add_directory(&name, options)
                .map_err(|e| format!("Cannot write DOCX directory {name}: {e}"))?;
            continue;
        }

        writer
            .start_file(&name, options)
            .map_err(|e| format!("Cannot write DOCX entry {name}: {e}"))?;

        if is_word_xml_part(&name) {
            let mut xml = String::new();
            file.read_to_string(&mut xml)
                .map_err(|e| format!("Cannot read XML DOCX entry {name}: {e}"))?;
            let adjusted = adjust_font_xml(&xml, delta_pt)?;
            writer
                .write_all(adjusted.as_bytes())
                .map_err(|e| format!("Cannot write adjusted XML DOCX entry {name}: {e}"))?;
        } else {
            std::io::copy(&mut file, &mut writer)
                .map_err(|e| format!("Cannot copy DOCX entry {name}: {e}"))?;
        }
    }

    writer
        .finish()
        .map_err(|e| format!("Cannot finish adjusted DOCX {}: {e}", output_path.display()))?;

    Ok(())
}

pub(crate) fn inspect_font_sizes(input_path: &Path) -> Result<Option<DocxFontStats>, String> {
    let input_file = File::open(input_path)
        .map_err(|e| format!("Cannot open DOCX {}: {e}", input_path.display()))?;
    let mut archive = zip::ZipArchive::new(input_file)
        .map_err(|e| format!("Cannot read DOCX zip {}: {e}", input_path.display()))?;

    let double_quote_pattern = Regex::new(r#"<w:(?:sz|szCs)\b[^>]*\bw:val="(\d+)""#)
        .map_err(|e| format!("Invalid DOCX font inspect regex: {e}"))?;
    let single_quote_pattern = Regex::new(r#"<w:(?:sz|szCs)\b[^>]*\bw:val='(\d+)'"#)
        .map_err(|e| format!("Invalid DOCX font inspect regex: {e}"))?;

    let mut counts: BTreeMap<i32, usize> = BTreeMap::new();
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| format!("Cannot read DOCX zip entry #{index}: {e}"))?;
        let name = file.name().to_string();
        if file.is_dir() || !is_word_xml_part(&name) {
            continue;
        }

        let mut xml = String::new();
        file.read_to_string(&mut xml)
            .map_err(|e| format!("Cannot read XML DOCX entry {name}: {e}"))?;
        collect_font_sizes(&xml, &double_quote_pattern, &mut counts);
        collect_font_sizes(&xml, &single_quote_pattern, &mut counts);
    }

    let explicit_size_count = counts.values().sum();
    if explicit_size_count == 0 {
        return Ok(None);
    }

    let sizes_pt: Vec<f32> = counts
        .keys()
        .map(|half_points| *half_points as f32 / 2.0)
        .collect();
    let min_pt = sizes_pt.first().copied().unwrap_or(0.0);
    let max_pt = sizes_pt.last().copied().unwrap_or(0.0);
    let primary_half_points = counts
        .iter()
        .max_by_key(|(_, count)| *count)
        .map(|(half_points, _)| *half_points)
        .unwrap_or(0);

    Ok(Some(DocxFontStats {
        sizes_pt,
        min_pt,
        max_pt,
        primary_pt: primary_half_points as f32 / 2.0,
        explicit_size_count,
    }))
}

fn is_word_xml_part(name: &str) -> bool {
    name.starts_with("word/") && name.ends_with(".xml")
}

fn collect_font_sizes(xml: &str, pattern: &Regex, counts: &mut BTreeMap<i32, usize>) {
    for captures in pattern.captures_iter(xml) {
        let Some(size) = captures.get(1).and_then(|m| m.as_str().parse::<i32>().ok()) else {
            continue;
        };
        if (MIN_FONT_HALF_POINTS..=MAX_FONT_HALF_POINTS).contains(&size) {
            *counts.entry(size).or_insert(0) += 1;
        }
    }
}

fn adjust_font_xml(xml: &str, delta_pt: i16) -> Result<String, String> {
    let delta_half_points = i32::from(delta_pt) * 2;
    let double_quote_pattern = Regex::new(r#"(<w:(?:sz|szCs)\b[^>]*\bw:val=")(\d+)(")"#)
        .map_err(|e| format!("Invalid DOCX font regex: {e}"))?;
    let single_quote_pattern = Regex::new(r#"(<w:(?:sz|szCs)\b[^>]*\bw:val=')(\d+)(')"#)
        .map_err(|e| format!("Invalid DOCX font regex: {e}"))?;

    let adjusted = double_quote_pattern
        .replace_all(xml, |captures: &Captures<'_>| {
            replace_font_size(captures, delta_half_points)
        })
        .into_owned();
    let adjusted = single_quote_pattern
        .replace_all(&adjusted, |captures: &Captures<'_>| {
            replace_font_size(captures, delta_half_points)
        })
        .into_owned();

    Ok(adjusted)
}

fn replace_font_size(captures: &Captures<'_>, delta_half_points: i32) -> String {
    let original = captures.get(2).and_then(|m| m.as_str().parse::<i32>().ok());

    let Some(original) = original else {
        return captures[0].to_string();
    };

    let adjusted = (original + delta_half_points).clamp(MIN_FONT_HALF_POINTS, MAX_FONT_HALF_POINTS);

    format!("{}{}{}", &captures[1], adjusted, &captures[3])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reduces_word_font_sizes_by_point_delta() {
        let xml = r#"<w:rPr><w:sz w:val="24"/><w:szCs w:val="20"/></w:rPr>"#;

        let adjusted = adjust_font_xml(xml, -2).expect("font XML adjusts");

        assert!(adjusted.contains(r#"<w:sz w:val="20"/>"#));
        assert!(adjusted.contains(r#"<w:szCs w:val="16"/>"#));
    }

    #[test]
    fn clamps_tiny_fonts() {
        let xml = r#"<w:rPr><w:sz w:val="10"/></w:rPr>"#;

        let adjusted = adjust_font_xml(xml, -4).expect("font XML adjusts");

        assert!(adjusted.contains(r#"<w:sz w:val="8"/>"#));
    }

    #[test]
    fn leaves_non_font_xml_unchanged() {
        let xml = r#"<w:t>12</w:t><w:spacing w:val="240"/>"#;

        let adjusted = adjust_font_xml(xml, -2).expect("font XML adjusts");

        assert_eq!(adjusted, xml);
    }

    #[test]
    fn inspects_explicit_font_sizes() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let input_path = temp_dir.path().join("input.docx");

        {
            let input_file = File::create(&input_path).expect("input DOCX file");
            let mut writer = zip::ZipWriter::new(input_file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            writer
                .start_file("word/document.xml", options)
                .expect("document entry");
            writer
                .write_all(
                    r#"<w:rPr><w:sz w:val="24"/></w:rPr><w:rPr><w:szCs w:val='28'/></w:rPr>"#
                        .as_bytes(),
                )
                .expect("document XML");
            writer.finish().expect("finish input DOCX");
        }

        let stats = inspect_font_sizes(&input_path)
            .expect("font inspect succeeds")
            .expect("font stats exist");

        assert_eq!(stats.sizes_pt, vec![12.0, 14.0]);
        assert_eq!(stats.min_pt, 12.0);
        assert_eq!(stats.max_pt, 14.0);
        assert_eq!(stats.explicit_size_count, 2);
    }

    #[test]
    fn rewrites_docx_zip_entries() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let input_path = temp_dir.path().join("input.docx");
        let output_path = temp_dir.path().join("output.docx");

        {
            let input_file = File::create(&input_path).expect("input DOCX file");
            let mut writer = zip::ZipWriter::new(input_file);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

            writer
                .start_file("word/document.xml", options)
                .expect("document entry");
            writer
                .write_all(r#"<w:rPr><w:sz w:val="24"/></w:rPr>"#.as_bytes())
                .expect("document XML");

            writer
                .start_file("word/media/image.png", options)
                .expect("media entry");
            writer.write_all(b"png").expect("media bytes");

            writer.finish().expect("finish input DOCX");
        }

        apply_font_size_delta(&input_path, &output_path, -2).expect("DOCX font delta");

        let output_file = File::open(&output_path).expect("output DOCX file");
        let mut archive = zip::ZipArchive::new(output_file).expect("output zip");

        let mut xml = String::new();
        archive
            .by_name("word/document.xml")
            .expect("document entry exists")
            .read_to_string(&mut xml)
            .expect("read document XML");
        assert!(xml.contains(r#"<w:sz w:val="20"/>"#));

        let mut image_bytes = Vec::new();
        archive
            .by_name("word/media/image.png")
            .expect("media entry exists")
            .read_to_end(&mut image_bytes)
            .expect("read media bytes");
        assert_eq!(image_bytes, b"png");
    }
}
