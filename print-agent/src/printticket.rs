//! PrintTicket XML generation + Windows PT* API integration.
//!
//! Flow: generate PrintTicket XML from PrintCommand → PTMergeAndValidatePrintTicket →
//! PTConvertPrintTicketToDevMode → returns DEVMODE bytes for CreateDCW.
//!
//! Falls back to legacy DEVMODE approach if PT* APIs are unavailable.

#![cfg(target_os = "windows")]

use quick_xml::events::{BytesDecl, BytesEnd, BytesStart, BytesText, Event};
use quick_xml::Writer;
use tracing::{debug, info, warn};
use windows::core::PCWSTR;
use windows::Win32::Graphics::Printing::PrintTicket::*;
use windows::Win32::System::Com::IStream;
use windows::Win32::UI::Shell::SHCreateMemStream;

use crate::print_proto;

// ── XML namespace constants ──

const PSF_NS: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemaframework";
const PSK_NS: &str = "http://schemas.microsoft.com/windows/2003/08/printing/printschemakeywords";
const XSI_NS: &str = "http://www.w3.org/2001/XMLSchema-instance";
const XSD_NS: &str = "http://www.w3.org/2001/XMLSchema";

// ── Vendor detection ──

#[derive(Debug, Clone, PartialEq)]
pub enum PrinterVendor {
    Epson,
    Canon,
    Generic,
}

#[derive(Debug, Clone)]
pub struct VendorInfo {
    pub vendor: PrinterVendor,
    pub prefix: Option<String>,
    pub namespace: Option<String>,
}

impl VendorInfo {
    fn generic() -> Self {
        Self {
            vendor: PrinterVendor::Generic,
            prefix: None,
            namespace: None,
        }
    }
}

/// Detect vendor by scanning PrintCapabilities XML for vendor namespace declarations.
pub fn detect_vendor(capabilities_xml: &str) -> VendorInfo {
    // Scan for xmlns:*="...epson.net..." or xmlns:*="...canon.com..."
    for attr_start in capabilities_xml.match_indices("xmlns:") {
        let rest = &capabilities_xml[attr_start.0 + 6..];
        let Some(eq_pos) = rest.find('=') else {
            continue;
        };
        let prefix = &rest[..eq_pos];
        // Skip standard prefixes
        if prefix == "psf" || prefix == "psk" || prefix == "xsi" || prefix == "xsd" {
            continue;
        }
        // Validate prefix is a valid XML NCName (alphanumeric + underscore only)
        if !prefix.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        let after_eq = &rest[eq_pos + 1..];
        let after_eq = after_eq.trim_start_matches('"').trim_start_matches('\'');
        let end = after_eq.find(|c| c == '"' || c == '\'' || c == ' ' || c == '>').unwrap_or(after_eq.len());
        let ns_uri = &after_eq[..end];

        if ns_uri.contains("epson.net") {
            return VendorInfo {
                vendor: PrinterVendor::Epson,
                prefix: Some(prefix.to_string()),
                namespace: Some(ns_uri.to_string()),
            };
        }
        if ns_uri.contains("canon.com") {
            return VendorInfo {
                vendor: PrinterVendor::Canon,
                prefix: Some(prefix.to_string()),
                namespace: Some(ns_uri.to_string()),
            };
        }
    }

    VendorInfo::generic()
}

// ── PrintTicket XML generation ──

/// Generate a complete PrintTicket XML from a PrintCommand and detected vendor info.
pub fn generate_print_ticket(cmd: &print_proto::PrintCommand, vendor: &VendorInfo) -> String {
    let mut buf = Vec::new();
    let mut writer = Writer::new_with_indent(&mut buf, b' ', 2);

    // XML declaration
    writer
        .write_event(Event::Decl(BytesDecl::new("1.0", Some("utf-8"), None)))
        .unwrap();

    // Root element with namespaces
    let mut root = BytesStart::new("psf:PrintTicket");
    root.push_attribute(("xmlns:psf", PSF_NS));
    root.push_attribute(("xmlns:psk", PSK_NS));
    root.push_attribute(("xmlns:xsi", XSI_NS));
    root.push_attribute(("xmlns:xsd", XSD_NS));
    if let (Some(prefix), Some(ns)) = (&vendor.prefix, &vendor.namespace) {
        root.push_attribute((format!("xmlns:{prefix}").as_str(), ns.as_str()));
    }
    writer.write_event(Event::Start(root)).unwrap();

    let vp = vendor.prefix.as_deref();
    let v = &vendor.vendor;

    // 1. Paper size
    if !cmd.paper_size.is_empty() {
        let (size_name, width, height) = map_paper_size(&cmd.paper_size, vp);
        write_feature_with_scored_props(
            &mut writer,
            "psk:PageMediaSize",
            &size_name,
            &[
                ("psk:MediaSizeWidth", &width.to_string()),
                ("psk:MediaSizeHeight", &height.to_string()),
            ],
        );
        debug!(name = size_name, width, height, "PrintTicket: PageMediaSize");
    }

    // 2. Media type
    if !cmd.media_type.is_empty() {
        let media_name = map_media_type(&cmd.media_type, vp, v);
        write_feature(&mut writer, "psk:PageMediaType", &media_name);
        debug!(name = media_name, "PrintTicket: PageMediaType");
    }

    // 3. Borderless
    {
        let opt = if cmd.borderless {
            "psk:Borderless"
        } else {
            "psk:None"
        };
        write_feature(&mut writer, "psk:PageBorderless", opt);
    }

    // 4. Color mode
    {
        let color_mode = print_proto::ColorMode::try_from(cmd.color_mode)
            .unwrap_or(print_proto::ColorMode::Color);
        let opt = match color_mode {
            print_proto::ColorMode::Bw => {
                // Check gray_mode: if "true_gray" use Grayscale, otherwise Monochrome
                if cmd.gray_mode == "true_gray" { "psk:Grayscale" } else { "psk:Monochrome" }
            }
            _ => "psk:Color",
        };
        write_feature(&mut writer, "psk:PageOutputColor", opt);
    }

    // 5. Quality
    if !cmd.quality.is_empty() {
        let quality_name = map_quality(&cmd.quality, vp);
        write_feature(&mut writer, "psk:PageOutputQuality", &quality_name);
        debug!(name = quality_name, "PrintTicket: PageOutputQuality");
    }

    // 6. Orientation
    {
        let orientation = print_proto::Orientation::try_from(cmd.orientation)
            .unwrap_or(print_proto::Orientation::Auto);
        match orientation {
            print_proto::Orientation::Landscape => {
                write_feature(&mut writer, "psk:PageOrientation", "psk:Landscape");
            }
            print_proto::Orientation::Portrait => {
                write_feature(&mut writer, "psk:PageOrientation", "psk:Portrait");
            }
            _ => {
                // Auto — don't set, let driver decide
            }
        }
    }

    // 7. Duplex (vendor-specific feature name)
    {
        let duplex_feature = match v {
            PrinterVendor::Canon => "psk:DocumentDuplex",
            _ => "psk:JobDuplexAllDocumentsContiguously",
        };
        let opt = if cmd.duplex {
            match cmd.duplex_mode.as_str() {
                "short_edge" => "psk:TwoSidedShortEdge",
                _ => "psk:TwoSidedLongEdge",
            }
        } else {
            "psk:OneSided"
        };
        write_feature(&mut writer, duplex_feature, opt);
    }

    // 8. Paper source (PageInputBin)
    if !cmd.paper_source.is_empty() {
        let source_name = map_paper_source(&cmd.paper_source, vp, v);
        write_feature(&mut writer, "psk:PageInputBin", &source_name);
        debug!(name = source_name, "PrintTicket: PageInputBin");
    }

    // 9. Resolution (PageResolution)
    if !cmd.resolution.is_empty() {
        if let Some((res_name, res_x, res_y)) = map_resolution(&cmd.resolution, vp, v) {
            write_feature_with_scored_props(
                &mut writer,
                "psk:PageResolution",
                &res_name,
                &[
                    ("psk:ResolutionX", &res_x.to_string()),
                    ("psk:ResolutionY", &res_y.to_string()),
                ],
            );
            debug!(name = res_name, x = res_x, y = res_y, "PrintTicket: PageResolution");
        }
    }

    // 10. Color management (PageColorManagement)
    if !cmd.color_management.is_empty() {
        if let Some(cm_opt) = map_color_management(&cmd.color_management) {
            write_feature(&mut writer, "psk:PageColorManagement", cm_opt);
            debug!(opt = cm_opt, "PrintTicket: PageColorManagement");
        }
    }

    // 11. Rendering intent (PageICMRenderingIntent) — now enum in proto
    {
        let ri = print_proto::RenderingIntent::try_from(cmd.rendering_intent)
            .unwrap_or(print_proto::RenderingIntent::default());
        let ri_opt = match ri {
            print_proto::RenderingIntent::Perceptual => Some("psk:Perceptual"),
            print_proto::RenderingIntent::RelativeColorimetric => Some("psk:RelativeColorimetric"),
            print_proto::RenderingIntent::Saturation => Some("psk:Saturation"),
            print_proto::RenderingIntent::AbsoluteColorimetric => Some("psk:AbsoluteColorimetric"),
            _ => None,
        };
        if let Some(opt) = ri_opt {
            write_feature(&mut writer, "psk:PageICMRenderingIntent", opt);
            debug!(opt, "PrintTicket: PageICMRenderingIntent");
        }
    }

    // 12. ICC profile (PageDestinationColorProfile)
    if !cmd.icc_profile_key.is_empty() {
        if let Some(icc_path) = resolve_icc_path(&cmd.icc_profile_key) {
            write_feature_with_string_scored_props(
                &mut writer,
                "psk:PageDestinationColorProfile",
                "psk:Application",
                &[("psk:DestinationColorProfileURI", "xsd:string", &icc_path)],
            );
            debug!(path = icc_path, "PrintTicket: PageDestinationColorProfile");
        } else {
            warn!(profile = cmd.icc_profile_key, "ICC profile not found, skipping");
        }
    }

    // 13. Pages per sheet (NUp)
    if cmd.pages_per_sheet > 1 {
        let nup_feature = match v {
            PrinterVendor::Epson => "psk:JobNUpAllDocumentsContiguously",
            _ => "psk:DocumentNUp",
        };
        write_feature_with_scored_props(
            &mut writer,
            nup_feature,
            &format!("{nup_feature}:NUp"),
            &[("psk:PagesPerSheet", &cmd.pages_per_sheet.to_string())],
        );
        debug!(n = cmd.pages_per_sheet, "PrintTicket: NUp");
    }

    // 14. Collate (dynamic: proto3 bool default=false, but collate default should be true)
    {
        let copies = cmd.copies.clamp(1, 999);
        let collate_opt = if cmd.pages_per_sheet > 1 || copies > 1 {
            if cmd.collate { "psk:Collated" } else { "psk:Uncollated" }
        } else {
            "psk:Collated"
        };
        write_feature(&mut writer, "psk:DocumentCollate", collate_opt);
    }

    // 15. Copies
    {
        let copies = cmd.copies.clamp(1, 999);
        write_parameter_init(&mut writer, "psk:JobCopiesAllDocuments", &copies.to_string());
    }

    // 16. Staple (Canon only)
    if *v == PrinterVendor::Canon && !cmd.staple.is_empty() {
        if let Some(staple_opt) = map_staple(&cmd.staple) {
            write_feature(&mut writer, "psk:JobStapleAllDocuments", staple_opt);
            debug!(opt = staple_opt, "PrintTicket: JobStapleAllDocuments");
        }
    }

    // 17. Hole punch (Canon only)
    if *v == PrinterVendor::Canon && !cmd.hole_punch.is_empty() {
        if let Some(punch_opt) = map_hole_punch(&cmd.hole_punch) {
            write_feature(&mut writer, "psk:JobHolePunch", punch_opt);
            debug!(opt = punch_opt, "PrintTicket: JobHolePunch");
        }
    }

    // 18. Booklet (Canon only)
    if *v == PrinterVendor::Canon && cmd.booklet {
        write_feature(&mut writer, "psk:DocumentBinding", "psk:Booklet");
        debug!("PrintTicket: DocumentBinding=Booklet");
    }

    // 19. Stapleless stitch (Canon only)
    if *v == PrinterVendor::Canon && !cmd.stapleless_position.is_empty() {
        if let Some(vp) = vp {
            let opt = match cmd.stapleless_position.as_str() {
                "top_left" => Some(format!("{vp}:StapleTopLeft")),
                "top_right" => Some(format!("{vp}:StapleTopRight")),
                "bottom_left" => Some(format!("{vp}:StapleBottomLeft")),
                "bottom_right" => Some(format!("{vp}:StapleBottomRight")),
                _ => None,
            };
            if let Some(opt_name) = opt {
                write_feature(&mut writer, &format!("{vp}:DocumentStaplelessStitch"), &opt_name);
                debug!(opt = opt_name, "PrintTicket: DocumentStaplelessStitch");
            }
        }
    }

    // 20. Hole punch type (Canon only — ISO2, NA2, NA3, French4, Multiple)
    if *v == PrinterVendor::Canon && !cmd.hole_punch_type.is_empty() {
        if let Some(vp) = vp {
            let opt = match cmd.hole_punch_type.as_str() {
                "2_hole" | "iso2" => Some(format!("{vp}:ISO2Holes")),
                "na2" | "north_america_2" => Some(format!("{vp}:NorthAmerica2Holes")),
                "3_hole" | "na3" | "north_america_3" => Some(format!("{vp}:NorthAmerica3Holes")),
                "4_hole" | "french4" => Some(format!("{vp}:French4Holes")),
                "multiple" => Some(format!("{vp}:MultipleHoles")),
                _ => None,
            };
            if let Some(opt_name) = opt {
                write_feature(&mut writer, &format!("{vp}:DocumentHolePunchType"), &opt_name);
                debug!(opt = opt_name, "PrintTicket: DocumentHolePunchType");
            }
        }
    }

    // 21. Color auto detection (Canon only)
    if *v == PrinterVendor::Canon && cmd.color_auto_detect {
        if let Some(vp) = vp {
            write_feature(&mut writer, &format!("{vp}:PageOutputColorAutoDetection"), &format!("{vp}:OutputColorAutoDetection"));
            debug!("PrintTicket: PageOutputColorAutoDetection=On");
        }
    }

    // 22. Red eye fix (Epson only)
    if *v == PrinterVendor::Epson {
        if let Some(ep) = vp {
            let redeye_opt = if cmd.red_eye_fix { "psk:On" } else { "psk:Off" };
            write_feature(&mut writer, &format!("{ep}:PageFixRedEye"), redeye_opt);
        }
    }

    // 23. Quiet mode (vendor-specific)
    if cmd.quiet_mode {
        if let Some(vp) = vp {
            write_feature(&mut writer, &format!("{vp}:PageQuietMode"), &format!("{vp}:On"));
            debug!("PrintTicket: QuietMode On");
        }
    }

    // 24. Bidirectional printing (Epson — faster but lower quality)
    if *v == PrinterVendor::Epson && cmd.bidirectional {
        if let Some(ep) = vp {
            write_feature(&mut writer, &format!("{ep}:PageBidirectional"), &format!("{ep}:On"));
            debug!("PrintTicket: Bidirectional On");
        }
    }

    // 25. Scaling percent (copy center: A3→A4, A4→A3, etc.)
    if cmd.scaling_percent > 0 && cmd.scaling_percent != 100 {
        let percent = cmd.scaling_percent.clamp(25, 400);
        write_feature_with_scored_props(
            &mut writer,
            "psk:PageScaling",
            "psk:CustomSquare",
            &[
                ("psk:Scale", &percent.to_string()),
                ("psk:ScaleWidth", &percent.to_string()),
            ],
        );
        debug!(percent, "PrintTicket: PageScaling");
    }

    // 24. Output bin (Canon finisher trays)
    if !cmd.output_bin.is_empty() {
        let bin_name = map_output_bin(&cmd.output_bin, vp, v);
        if let Some(bin) = bin_name {
            write_feature(&mut writer, "psk:JobOutputOptimization", &bin);
            debug!(bin = ?bin, "PrintTicket: OutputBin");
        }
    }

    // 25. Toner save / economy mode (Canon only)
    if *v == PrinterVendor::Canon && cmd.toner_save == "on" {
        if let Some(vp) = vp {
            write_feature(&mut writer, &format!("{vp}:PageTonerSaveMode"), &format!("{vp}:TonerSaveOn"));
            debug!("PrintTicket: TonerSaveMode=On");
        }
    }

    // 26. Department ID (Canon Account Track)
    if *v == PrinterVendor::Canon && !cmd.department_id.is_empty() {
        if let Some(vp) = vp {
            write_feature_with_string_scored_props(
                &mut writer,
                &format!("{vp}:JobDepartmentID"),
                &format!("{vp}:DepartmentIDValue"),
                &[(&format!("{vp}:DepartmentID"), "xsd:string", &cmd.department_id)],
            );
            debug!(dept = %cmd.department_id, "PrintTicket: DepartmentID");
        }
    }

    // 27. Secure Print PIN (Canon Secure Print)
    if *v == PrinterVendor::Canon && !cmd.secure_pin.is_empty() {
        if let Some(vp) = vp {
            write_feature_with_string_scored_props(
                &mut writer,
                &format!("{vp}:JobSecurePrint"),
                &format!("{vp}:SecurePrintEnabled"),
                &[(&format!("{vp}:SecurePrintPIN"), "xsd:string", &cmd.secure_pin)],
            );
            debug!("PrintTicket: SecurePrint with PIN");
        }
    }

    // 28. Gray rendering mode (Canon only — true_gray or black_only)
    if *v == PrinterVendor::Canon && !cmd.gray_mode.is_empty() {
        if let Some(vp) = vp {
            let mode = match cmd.gray_mode.as_str() {
                "true_gray" | "composite" => format!("{vp}:TrueGray"),
                "black_only" | "black" => format!("{vp}:BlackOnly"),
                _ => format!("{vp}:TrueGray"),
            };
            write_feature(&mut writer, &format!("{vp}:PageGrayRendering"), &mode);
            debug!(mode = %cmd.gray_mode, "PrintTicket: GrayRendering");
        }
    }

    // Close root
    writer
        .write_event(Event::End(BytesEnd::new("psf:PrintTicket")))
        .unwrap();

    String::from_utf8(buf).unwrap_or_default()
}

// ── XML safety helpers ──

/// Sanitize a string for use in XML attribute values.
/// Prevents XML injection via special characters.
fn escape_xml_attr(s: &str) -> String {
    s.replace('&', "&amp;")
     .replace('<', "&lt;")
     .replace('>', "&gt;")
     .replace('"', "&quot;")
     .replace('\'', "&apos;")
}

/// Safe wrapper around BytesStart::push_attribute that escapes values.
fn safe_push_attr(elem: &mut BytesStart, key: &str, value: &str) {
    let escaped = escape_xml_attr(value);
    elem.push_attribute((key, escaped.as_str()));
}

// ── XML helper writers ──

fn write_feature<W: std::io::Write>(writer: &mut Writer<W>, feature_name: &str, option_name: &str) {
    let mut feat = BytesStart::new("psf:Feature");
    safe_push_attr(&mut feat, "name", feature_name);
    writer.write_event(Event::Start(feat)).unwrap();

    let mut opt = BytesStart::new("psf:Option");
    safe_push_attr(&mut opt, "name", option_name);
    writer.write_event(Event::Empty(opt)).unwrap();

    writer
        .write_event(Event::End(BytesEnd::new("psf:Feature")))
        .unwrap();
}

fn write_feature_with_scored_props<W: std::io::Write>(
    writer: &mut Writer<W>,
    feature_name: &str,
    option_name: &str,
    props: &[(&str, &str)],
) {
    let mut feat = BytesStart::new("psf:Feature");
    safe_push_attr(&mut feat, "name", feature_name);
    writer.write_event(Event::Start(feat)).unwrap();

    let mut opt = BytesStart::new("psf:Option");
    safe_push_attr(&mut opt, "name", option_name);
    writer.write_event(Event::Start(opt)).unwrap();

    for &(prop_name, value) in props {
        let mut sp = BytesStart::new("psf:ScoredProperty");
        safe_push_attr(&mut sp, "name", prop_name);
        writer.write_event(Event::Start(sp)).unwrap();

        let mut val = BytesStart::new("psf:Value");
        val.push_attribute(("xsi:type", "xsd:integer"));
        writer.write_event(Event::Start(val)).unwrap();
        writer
            .write_event(Event::Text(BytesText::new(value)))
            .unwrap();
        writer
            .write_event(Event::End(BytesEnd::new("psf:Value")))
            .unwrap();

        writer
            .write_event(Event::End(BytesEnd::new("psf:ScoredProperty")))
            .unwrap();
    }

    writer
        .write_event(Event::End(BytesEnd::new("psf:Option")))
        .unwrap();
    writer
        .write_event(Event::End(BytesEnd::new("psf:Feature")))
        .unwrap();
}

fn write_feature_with_string_scored_props<W: std::io::Write>(
    writer: &mut Writer<W>,
    feature_name: &str,
    option_name: &str,
    props: &[(&str, &str, &str)], // (name, xsi:type, value)
) {
    let mut feat = BytesStart::new("psf:Feature");
    safe_push_attr(&mut feat, "name", feature_name);
    writer.write_event(Event::Start(feat)).unwrap();

    let mut opt = BytesStart::new("psf:Option");
    safe_push_attr(&mut opt, "name", option_name);
    writer.write_event(Event::Start(opt)).unwrap();

    for &(prop_name, xsi_type, value) in props {
        let mut sp = BytesStart::new("psf:ScoredProperty");
        safe_push_attr(&mut sp, "name", prop_name);
        writer.write_event(Event::Start(sp)).unwrap();

        let mut val = BytesStart::new("psf:Value");
        safe_push_attr(&mut val, "xsi:type", xsi_type);
        writer.write_event(Event::Start(val)).unwrap();
        writer
            .write_event(Event::Text(BytesText::new(value)))
            .unwrap();
        writer
            .write_event(Event::End(BytesEnd::new("psf:Value")))
            .unwrap();

        writer
            .write_event(Event::End(BytesEnd::new("psf:ScoredProperty")))
            .unwrap();
    }

    writer
        .write_event(Event::End(BytesEnd::new("psf:Option")))
        .unwrap();
    writer
        .write_event(Event::End(BytesEnd::new("psf:Feature")))
        .unwrap();
}

fn write_parameter_init<W: std::io::Write>(writer: &mut Writer<W>, param_name: &str, value: &str) {
    let mut pi = BytesStart::new("psf:ParameterInit");
    safe_push_attr(&mut pi, "name", param_name);
    writer.write_event(Event::Start(pi)).unwrap();

    let mut val = BytesStart::new("psf:Value");
    val.push_attribute(("xsi:type", "xsd:integer"));
    writer.write_event(Event::Start(val)).unwrap();
    writer
        .write_event(Event::Text(BytesText::new(value)))
        .unwrap();
    writer
        .write_event(Event::End(BytesEnd::new("psf:Value")))
        .unwrap();

    writer
        .write_event(Event::End(BytesEnd::new("psf:ParameterInit")))
        .unwrap();
}

// ── Mapping functions ──

fn map_paper_size(size: &str, vendor_prefix: Option<&str>) -> (String, i32, i32) {
    match size.to_lowercase().as_str() {
        "10x15" => (
            vendor_prefix
                .map(|vp| format!("{vp}:Fullsize4x6"))
                .unwrap_or_else(|| "psk:NorthAmerica4x6".into()),
            101600,
            152400,
        ),
        "13x18" => ("psk:NorthAmerica5x7".into(), 127000, 178000),
        "9x13" => (
            vendor_prefix
                .map(|vp| format!("{vp}:JapanLPhoto"))
                .unwrap_or_else(|| "psk:ISOA6".into()),
            89000,
            127000,
        ),
        "a4" => ("psk:ISOA4".into(), 210000, 297000),
        "a5" => ("psk:ISOA5".into(), 148000, 210000),
        "a6" => ("psk:ISOA6".into(), 105000, 148000),
        "a3" => ("psk:ISOA3".into(), 297000, 420000),
        "a2" => ("psk:ISOA2".into(), 420000, 594000),
        "a1" => ("psk:ISOA1".into(), 594000, 841000),
        "a0" => ("psk:ISOA0".into(), 841000, 1189000),
        "b5" | "jis_b5" => ("psk:JISB5".into(), 182000, 257000),
        "b4" | "jis_b4" => ("psk:JISB4".into(), 257000, 364000),
        "b3" | "jis_b3" => ("psk:JISB3".into(), 364000, 515000),
        "b2" | "jis_b2" => ("psk:JISB2".into(), 515000, 728000),
        "b1" | "jis_b1" => ("psk:JISB1".into(), 728000, 1030000),
        "sra3" => ("psk:ISOSRA3".into(), 320000, 450000),
        "tabloid" | "11x17" => ("psk:NorthAmericaTabloid".into(), 279400, 431800),
        "executive" => ("psk:NorthAmericaExecutive".into(), 184200, 266700),
        "statement" => ("psk:NorthAmericaStatement".into(), 139700, 215900),
        "arch_b" => ("psk:NorthAmericaArchitectureBSheet".into(), 304800, 457200),
        "postcard" | "hagaki" => ("psk:JapanHagakiPostcard".into(), 100000, 148500),
        "double_postcard" => ("psk:JapanDoubleHagakiPostcardRotated".into(), 148500, 200000),
        "dl_envelope" | "envelope_dl" => ("psk:ISODLEnvelope".into(), 110000, 220000),
        "c5_envelope" | "envelope_c5" => ("psk:ISOC5Envelope".into(), 162000, 229000),
        "monarch_envelope" => ("psk:NorthAmericaMonarchEnvelope".into(), 98400, 190500),
        "no10_envelope" | "com10" => ("psk:NorthAmericaNumber10Envelope".into(), 104700, 241300),
        "kaku2" => ("psk:JapanKaku2Envelope".into(), 240000, 332000),
        "chou3" => ("psk:JapanChou3Envelope".into(), 120000, 235000),
        "chou4" => ("psk:JapanChou4Envelope".into(), 90000, 205000),
        "oficio" => (vendor_prefix.map(|vp| format!("{vp}:Oficio")).unwrap_or("psk:NorthAmericaLegal".into()), 215900, 317500),
        "foolscap" => (vendor_prefix.map(|vp| format!("{vp}:Foolscap")).unwrap_or("psk:NorthAmericaLegal".into()), 215900, 330200),
        "indian_legal" => (vendor_prefix.map(|vp| format!("{vp}:IndianLegal")).unwrap_or("psk:NorthAmericaLegal".into()), 215000, 345000),
        "c16k" | "16k" => (vendor_prefix.map(|vp| format!("{vp}:C16K")).unwrap_or("psk:ISOA5".into()), 195000, 270000),
        "c8k" | "8k" => (vendor_prefix.map(|vp| format!("{vp}:C8K")).unwrap_or("psk:ISOA4".into()), 270000, 390000),
        "government_letter" => (vendor_prefix.map(|vp| format!("{vp}:GovernmentLetter")).unwrap_or("psk:NorthAmericaLetter".into()), 203200, 266700),
        "government_legal" => (vendor_prefix.map(|vp| format!("{vp}:GovernmentLegal")).unwrap_or("psk:NorthAmericaLegal".into()), 203200, 330200),
        "20x25" | "8x10" => (
            vendor_prefix
                .map(|vp| format!("{vp}:IndexCard8x10"))
                .unwrap_or_else(|| "psk:NorthAmerica8x10".into()),
            203200,
            254000,
        ),
        "letter" => ("psk:NorthAmericaLetter".into(), 215900, 279400),
        "legal" => ("psk:NorthAmericaLegal".into(), 215900, 355600),
        _ => ("psk:ISOA4".into(), 210000, 297000),
    }
}

fn map_media_type(media: &str, vendor_prefix: Option<&str>, vendor: &PrinterVendor) -> String {
    let mt = media.to_lowercase();

    if *vendor == PrinterVendor::Canon {
        if let Some(vp) = vendor_prefix {
            return match mt.as_str() {
                "plain" | "plain1" => "psk:Plain".into(),
                "plain2" => format!("{vp}:Plain2"),
                "plain3" => format!("{vp}:Plain3"),
                "plain4" => format!("{vp}:Plain4"),
                "thin" => format!("{vp}:Thin"),
                "recycled" | "recycled1" => format!("{vp}:Recycled"),
                "recycled2" => format!("{vp}:Recycled2"),
                "color" => format!("{vp}:Color"),
                "thick" | "thick1" | "heavy1" => format!("{vp}:PasteBoard"),
                "thick2" | "heavy2" => format!("{vp}:PasteBoard2"),
                "coated" | "coated1" => format!("{vp}:OneSideCoated"),
                "coated2" => format!("{vp}:OneSideCoated2"),
                "coated3" => format!("{vp}:OneSideCoated3"),
                "pre_punched" | "prepunched" => format!("{vp}:PrePunched"),
                "pre_punched2" => format!("{vp}:PrePunched2"),
                "letterhead" | "letterhead1" => format!("{vp}:LetterHead1"),
                "letterhead2" => format!("{vp}:LetterHead2"),
                "letterhead3" => format!("{vp}:LetterHead3"),
                "letterhead4" => format!("{vp}:LetterHead4"),
                "letterhead5" => format!("{vp}:LetterHead5"),
                "letterhead6" => format!("{vp}:LetterHead6"),
                "letterhead7" => format!("{vp}:LetterHead7"),
                "bond" => "psk:Bond".into(),
                "pasteboard" | "pasteboard1" | "heavy" => format!("{vp}:PasteBoard"),
                "pasteboard2" => format!("{vp}:PasteBoard2"),
                "pasteboard3" | "heavy3" => format!("{vp}:PasteBoard3"),
                "pasteboard4" => format!("{vp}:PasteBoard4"),
                "pasteboard5" => format!("{vp}:PasteBoard5"),
                "pasteboard6" => format!("{vp}:PasteBoard6"),
                "pasteboard7" => format!("{vp}:PasteBoard7"),
                "transparency" | "transparency_film" => format!("{vp}:TransparencyFilm"),
                "tracing" | "tracing_paper" => format!("{vp}:TracingPaper"),
                "postcard" => format!("{vp}:Postcard"),
                "one_side_coated2" | "coated_glossy" => format!("{vp}:OneSideCoated2"),
                "one_side_coated3" | "coated_matte" => format!("{vp}:OneSideCoated3"),
                "one_side_coated4" => format!("{vp}:OneSideCoated4"),
                "one_side_coated5" => format!("{vp}:OneSideCoated5"),
                "two_side_coated" | "two_side_coated1" => format!("{vp}:TwoSideCoated"),
                "two_side_coated2" => format!("{vp}:TwoSideCoated2"),
                "two_side_coated3" => format!("{vp}:TwoSideCoated3"),
                "two_side_coated4" => format!("{vp}:TwoSideCoated4"),
                "two_side_coated5" => format!("{vp}:TwoSideCoated5"),
                "label" | "sticker" => "psk:Label".into(),
                "envelope" => "psk:EnvelopePlain".into(),
                _ => "psk:AutoSelect".into(),
            };
        }
    }

    // Epson / Generic
    match mt.as_str() {
        "plain" => "psk:Plain".into(),
        "matte" => "psk:PhotographicMatte".into(),
        "ultra_glossy" => "psk:HighResolution".into(),
        "premium_glossy" | "glossy" => "psk:PhotographicHighGloss".into(),
        "premium_semigloss" | "satin" | "luster" => "psk:PhotographicSemiGloss".into(),
        "photo_glossy" => vendor_prefix
            .map(|vp| format!("{vp}:EpsonPhotoPaperGlossy"))
            .unwrap_or_else(|| "psk:PhotographicHighGloss".into()),
        "photo_quality_inkjet" => "psk:Bond".into(),
        "letterhead" => vendor_prefix
            .map(|vp| format!("{vp}:Letterhead"))
            .unwrap_or_else(|| "psk:Plain".into()),
        "sticker" | "label" => "psk:Label".into(),
        "envelope" => "psk:EnvelopePlain".into(),
        "thick" => "psk:Stationery".into(),
        _ => "psk:AutoSelect".into(),
    }
}

fn map_quality(quality: &str, vendor_prefix: Option<&str>) -> String {
    match quality.to_lowercase().as_str() {
        "draft" | "standard" => vendor_prefix
            .map(|vp| format!("{vp}:Standard"))
            .unwrap_or_else(|| "psk:Draft".into()),
        "high" => vendor_prefix
            .map(|vp| format!("{vp}:HighQuality"))
            .unwrap_or_else(|| "psk:High".into()),
        "photo" | "best" | "best_photo" => vendor_prefix
            .map(|vp| format!("{vp}:BestQuality"))
            .unwrap_or_else(|| "psk:High".into()),
        "custom" => vendor_prefix
            .map(|vp| format!("{vp}:AdvancedSetting"))
            .unwrap_or_else(|| "psk:High".into()),
        _ => vendor_prefix
            .map(|vp| format!("{vp}:Standard"))
            .unwrap_or_else(|| "psk:Normal".into()),
    }
}

fn map_paper_source(source: &str, vendor_prefix: Option<&str>, vendor: &PrinterVendor) -> String {
    let s = source.to_lowercase();

    if *vendor == PrinterVendor::Canon {
        if let Some(vp) = vendor_prefix {
            return match s.as_str() {
                "auto" | "auto_select" => "psk:AutoSelect".into(),
                "manual" | "universal" | "bypass" => "psk:Manual".into(),
                "cassette1" | "tray1" => format!("{vp}:Cassette1"),
                "cassette2" | "tray2" => format!("{vp}:Cassette2"),
                "cassette3" | "tray3" => format!("{vp}:Cassette3"),
                "cassette4" | "tray4" => format!("{vp}:Cassette4"),
                "by_type" => format!("{vp}:None"),
                _ => "psk:AutoSelect".into(),
            };
        }
    }

    if *vendor == PrinterVendor::Epson {
        return match s.as_str() {
            "auto" | "auto_select" => "psk:AutoSelect".into(),
            "rear" | "sheet_feeder" => "psk:AutoSheetFeeder".into(),
            "disc_tray" | "manual" => "psk:Manual".into(),
            _ => "psk:AutoSelect".into(),
        };
    }

    // Generic
    match s.as_str() {
        "auto" | "auto_select" => "psk:AutoSelect".into(),
        "manual" => "psk:Manual".into(),
        _ => "psk:AutoSelect".into(),
    }
}

fn map_resolution(res: &str, vendor_prefix: Option<&str>, vendor: &PrinterVendor) -> Option<(String, i32, i32)> {
    let r = res.to_lowercase();

    if *vendor == PrinterVendor::Canon {
        if let Some(vp) = vendor_prefix {
            return match r.as_str() {
                "600" | "600x600" | "normal" | "standard" => Some((format!("{vp}:DPI600"), 600, 600)),
                "1200" | "1200x1200" | "high" | "best" => Some((format!("{vp}:DPI1200"), 1200, 1200)),
                _ => None,
            };
        }
    }

    if *vendor == PrinterVendor::Epson {
        if let Some(vp) = vendor_prefix {
            return match r.as_str() {
                "normal" | "standard" => Some((format!("{vp}:Standard"), 360, 360)),
                "high" | "720x720" => Some((format!("{vp}:HighQuality"), 720, 720)),
                "best" | "1440x720" => Some((format!("{vp}:BestQuality"), 1440, 720)),
                _ => None,
            };
        }
    }

    // Generic
    match r.as_str() {
        "600" | "600x600" | "normal" | "standard" => Some(("psk:Normal".into(), 600, 600)),
        "1200" | "1200x1200" | "high" | "best" => Some(("psk:High".into(), 1200, 1200)),
        _ => None,
    }
}

fn map_color_management(cm: &str) -> Option<&'static str> {
    match cm.to_lowercase().as_str() {
        "none" | "off" | "application" => Some("psk:None"),
        "driver" | "icm_driver" => Some("psk:Driver"),
        "system" | "icm_host" | "icm" => Some("psk:System"),
        _ => None,
    }
}

fn resolve_icc_path(profile: &str) -> Option<String> {
    let path = std::path::Path::new(profile);

    // 1. Check as full path
    if path.is_absolute() && path.exists() {
        return Some(profile.to_string());
    }

    let color_dir = std::path::Path::new(r"C:\Windows\System32\spool\drivers\color");

    // 2. Check in system color directory
    let in_color = color_dir.join(profile);
    if in_color.exists() {
        return Some(in_color.to_string_lossy().into_owned());
    }

    // 3. Try adding .icc extension
    let with_icc = color_dir.join(format!("{profile}.icc"));
    if with_icc.exists() {
        return Some(with_icc.to_string_lossy().into_owned());
    }

    // 4. Try adding .icm extension
    let with_icm = color_dir.join(format!("{profile}.icm"));
    if with_icm.exists() {
        return Some(with_icm.to_string_lossy().into_owned());
    }

    None
}

fn map_staple(staple: &str) -> Option<&'static str> {
    match staple.to_lowercase().as_str() {
        "none" | "off" | "" => None,
        "top_left" => Some("psk:StapleTopLeft"),
        "top_right" => Some("psk:StapleTopRight"),
        "bottom_left" => Some("psk:StapleBottomLeft"),
        "bottom_right" => Some("psk:StapleBottomRight"),
        "dual_left" => Some("psk:StapleDualLeft"),
        "dual_right" => Some("psk:StapleDualRight"),
        "dual_top" => Some("psk:StapleDualTop"),
        "dual_bottom" => Some("psk:StapleDualBottom"),
        "saddle_stitch" => Some("psk:SaddleStitch"),
        _ => None,
    }
}

fn map_hole_punch(punch: &str) -> Option<&'static str> {
    match punch.to_lowercase().as_str() {
        "none" | "off" | "" => None,
        "left" => Some("psk:Left"),
        "right" => Some("psk:Right"),
        "top" => Some("psk:Top"),
        "bottom" => Some("psk:Bottom"),
        _ => None,
    }
}

fn map_output_bin(bin: &str, vendor_prefix: Option<&str>, vendor: &PrinterVendor) -> Option<String> {
    let b = bin.to_lowercase();

    if *vendor == PrinterVendor::Canon {
        if let Some(vp) = vendor_prefix {
            return match b.as_str() {
                "auto" | "auto_select" => Some("psk:AutoSelect".into()),
                "standard" | "main" | "default" => Some(format!("{vp}:StandardBin")),
                "face_up" => Some(format!("{vp}:FaceUp")),
                "finisher" | "finisher_bin1" => Some(format!("{vp}:FinisherBin1")),
                "finisher_bin2" => Some(format!("{vp}:FinisherBin2")),
                "stacker" => Some(format!("{vp}:StackerBin")),
                _ => None,
            };
        }
    }

    match b.as_str() {
        "auto" | "auto_select" => Some("psk:AutoSelect".into()),
        _ => None,
    }
}

// ── Windows PT* API wrappers ──

/// Safe wrapper around HPTPROVIDER — auto-closes on drop.
struct PtProvider {
    handle: HPTPROVIDER,
}

impl PtProvider {
    fn open(printer_name: &str) -> anyhow::Result<Self> {
        let wide: Vec<u16> = printer_name
            .encode_utf16()
            .chain(std::iter::once(0))
            .collect();
        let handle = unsafe {
            PTOpenProvider(PCWSTR(wide.as_ptr()), PRINTTICKET_ISTREAM_APIS)?
        };
        if handle.is_invalid() {
            anyhow::bail!("PTOpenProvider returned invalid handle for: {printer_name}");
        }
        Ok(Self { handle })
    }
}

impl Drop for PtProvider {
    fn drop(&mut self) {
        if !self.handle.is_invalid() {
            let _ = unsafe { PTCloseProvider(self.handle) };
        }
    }
}

/// Create an IStream from bytes using SHCreateMemStream.
fn create_stream_from_bytes(data: &[u8]) -> anyhow::Result<IStream> {
    let stream = unsafe { SHCreateMemStream(Some(data)) };
    stream.ok_or_else(|| anyhow::anyhow!("SHCreateMemStream failed"))
}

/// Create an empty writable IStream.
fn create_empty_stream() -> anyhow::Result<IStream> {
    let stream = unsafe { SHCreateMemStream(None) };
    stream.ok_or_else(|| anyhow::anyhow!("SHCreateMemStream(empty) failed"))
}

/// Read all bytes from an IStream (seeks to beginning first).
fn read_stream_bytes(stream: &IStream) -> anyhow::Result<Vec<u8>> {
    use windows::Win32::System::Com::STREAM_SEEK_SET;
    unsafe {
        // Seek to beginning
        stream.Seek(0, STREAM_SEEK_SET, None)?;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        let mut read = 0u32;
        unsafe {
            let hr = stream.Read(
                chunk.as_mut_ptr() as *mut _,
                chunk.len() as u32,
                Some(&mut read),
            );
            hr.ok()?;
        }
        if read == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..read as usize]);
    }
    Ok(buf)
}

/// Get PrintCapabilities XML from the printer via PTGetPrintCapabilities.
pub fn get_print_capabilities(printer_name: &str) -> anyhow::Result<String> {
    let provider = PtProvider::open(printer_name)?;

    // Empty ticket as input
    let empty_ticket = create_stream_from_bytes(b"")?;
    let caps_stream = create_empty_stream()?;

    unsafe {
        PTGetPrintCapabilities(
            provider.handle,
            &empty_ticket,
            &caps_stream,
            None,
        )?;
    }

    let bytes = read_stream_bytes(&caps_stream)?;
    String::from_utf8(bytes).map_err(|e| anyhow::anyhow!("PrintCapabilities not UTF-8: {e}"))
}

/// Merge and validate a PrintTicket XML, then convert to DEVMODE bytes.
///
/// Returns (devmode_bytes, was_conflict_resolved).
pub fn validate_and_convert(
    ticket_xml: &str,
    printer_name: &str,
) -> anyhow::Result<(Vec<u8>, bool)> {
    let provider = PtProvider::open(printer_name)?;

    // Create streams
    let base_stream = create_stream_from_bytes(ticket_xml.as_bytes())?;
    let delta_stream = create_stream_from_bytes(ticket_xml.as_bytes())?;
    let result_stream = create_empty_stream()?;
    let mut error_msg = windows::core::BSTR::default();

    // Merge and validate
    let merge_result = unsafe {
        PTMergeAndValidatePrintTicket(
            provider.handle,
            &base_stream,
            &delta_stream,
            kPTJobScope,
            &result_stream,
            Some(&mut error_msg),
        )
    };

    if let Err(e) = &merge_result {
        warn!(
            error = %e,
            error_msg = %error_msg,
            "PTMergeAndValidatePrintTicket failed"
        );
        anyhow::bail!("PTMergeAndValidatePrintTicket: {e}");
    }

    // Read validated ticket
    let validated_bytes = read_stream_bytes(&result_stream)?;
    let validated_stream = create_stream_from_bytes(&validated_bytes)?;

    // Convert to DEVMODE
    let mut devmode_size: u32 = 0;
    let mut devmode_ptr: *mut windows::Win32::Graphics::Gdi::DEVMODEA = std::ptr::null_mut();
    let mut convert_error = windows::core::BSTR::default();

    unsafe {
        PTConvertPrintTicketToDevMode(
            provider.handle,
            &validated_stream,
            kUserDefaultDevmode,
            kPTJobScope,
            &mut devmode_size,
            &mut devmode_ptr,
            Some(&mut convert_error),
        )?;
    }

    if devmode_ptr.is_null() || devmode_size == 0 {
        anyhow::bail!("PTConvertPrintTicketToDevMode returned null DEVMODE");
    }

    // Copy DEVMODE bytes
    let devmode_bytes = unsafe {
        std::slice::from_raw_parts(devmode_ptr as *const u8, devmode_size as usize).to_vec()
    };

    // Free the PT-allocated memory
    unsafe {
        PTReleaseMemory(devmode_ptr as *const _)?;
    }

    info!(
        devmode_size,
        "PrintTicket validated and converted to DEVMODE"
    );

    Ok((devmode_bytes, false))
}

/// Full PrintTicket flow: detect vendor → generate XML → validate → convert to DEVMODE.
///
/// Returns DEVMODE bytes on success, or error if PrintTicket API is unavailable.
pub fn generate_and_convert_devmode(
    cmd: &print_proto::PrintCommand,
    printer_name: &str,
) -> anyhow::Result<Vec<u8>> {
    // Step 1: Get print capabilities to detect vendor
    let vendor = match get_print_capabilities(printer_name) {
        Ok(caps_xml) => {
            let v = detect_vendor(&caps_xml);
            debug!(
                vendor = ?v.vendor,
                prefix = ?v.prefix,
                "Detected printer vendor from capabilities"
            );
            v
        }
        Err(e) => {
            debug!("PTGetPrintCapabilities failed ({}), using generic vendor", e);
            VendorInfo::generic()
        }
    };

    // Step 2: Generate PrintTicket XML
    let ticket_xml = generate_print_ticket(cmd, &vendor);
    debug!(xml_len = ticket_xml.len(), "Generated PrintTicket XML");

    // Step 3: Validate and convert to DEVMODE
    let (devmode_bytes, conflict) = validate_and_convert(&ticket_xml, printer_name)?;
    if conflict {
        warn!("PrintTicket had conflicts, using validated version");
    }

    Ok(devmode_bytes)
}
