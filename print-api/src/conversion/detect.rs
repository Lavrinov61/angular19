/// Supported document types for conversion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentType {
    Pdf,
    Docx,
    Docm,
    Xlsx,
    Xlsm,
    Xlsb,
    Doc,
    Xls,
    Dot,
    Dotx,
    Dotm,
    Xlt,
    Xltx,
    Xltm,
    Rtf,
    Odt,
    Ott,
    Ods,
    Ots,
    Ppt,
    Pptx,
    Pptm,
    Pps,
    Ppsx,
    Ppsm,
    Pot,
    Potx,
    Potm,
    Odp,
    Otp,
    Txt,
    Csv,
    Tsv,
    /// Not a document — raster image, pass through directly.
    Raster,
}

impl DocumentType {
    /// Whether this type requires LibreOffice conversion to PDF first.
    pub fn needs_libreoffice(self) -> bool {
        self.is_document() && !matches!(self, Self::Pdf)
    }

    /// Whether this is an actual document (not a raster passthrough).
    pub fn is_document(self) -> bool {
        !matches!(self, Self::Raster)
    }

    pub fn source_extension(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Docm => "docm",
            Self::Xlsx => "xlsx",
            Self::Xlsm => "xlsm",
            Self::Xlsb => "xlsb",
            Self::Doc => "doc",
            Self::Xls => "xls",
            Self::Dot => "dot",
            Self::Dotx => "dotx",
            Self::Dotm => "dotm",
            Self::Xlt => "xlt",
            Self::Xltx => "xltx",
            Self::Xltm => "xltm",
            Self::Rtf => "rtf",
            Self::Odt => "odt",
            Self::Ott => "ott",
            Self::Ods => "ods",
            Self::Ots => "ots",
            Self::Ppt => "ppt",
            Self::Pptx => "pptx",
            Self::Pptm => "pptm",
            Self::Pps => "pps",
            Self::Ppsx => "ppsx",
            Self::Ppsm => "ppsm",
            Self::Pot => "pot",
            Self::Potx => "potx",
            Self::Potm => "potm",
            Self::Odp => "odp",
            Self::Otp => "otp",
            Self::Txt => "txt",
            Self::Csv => "csv",
            Self::Tsv => "tsv",
            Self::Raster => "bin",
        }
    }

    pub fn api_label(self) -> &'static str {
        match self {
            Self::Raster => "raster",
            document => document.source_extension(),
        }
    }

    pub fn is_word_font_adjustable(self) -> bool {
        matches!(self, Self::Doc | Self::Docx)
    }
}

impl std::fmt::Display for DocumentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if matches!(self, Self::Raster) {
            write!(f, "Raster")
        } else {
            write!(f, "{}", self.source_extension().to_ascii_uppercase())
        }
    }
}

/// Detect document type from URL by examining the file extension.
///
/// Strips query parameters and fragments before matching. Returns `Raster`
/// for any unrecognised extension (images, unknown files).
pub fn detect_file_type(url: &str) -> DocumentType {
    // Strip query string and fragment
    let path = url.split('?').next().unwrap_or(url);
    let path = path.split('#').next().unwrap_or(path);

    // URL-decode to handle encoded dots (%2E) in S3 presigned URLs
    let decoded = path.replace("%2E", ".").replace("%2e", ".");

    // Extract extension (case-insensitive)
    let ext = match decoded.rsplit('.').next() {
        Some(e) => e.to_ascii_lowercase(),
        None => return DocumentType::Raster,
    };

    match ext.as_str() {
        "pdf" => DocumentType::Pdf,
        "docx" => DocumentType::Docx,
        "docm" => DocumentType::Docm,
        "xlsx" => DocumentType::Xlsx,
        "xlsm" => DocumentType::Xlsm,
        "xlsb" => DocumentType::Xlsb,
        "doc" => DocumentType::Doc,
        "xls" => DocumentType::Xls,
        "dot" => DocumentType::Dot,
        "dotx" => DocumentType::Dotx,
        "dotm" => DocumentType::Dotm,
        "xlt" => DocumentType::Xlt,
        "xltx" => DocumentType::Xltx,
        "xltm" => DocumentType::Xltm,
        "rtf" => DocumentType::Rtf,
        "odt" => DocumentType::Odt,
        "ott" => DocumentType::Ott,
        "ods" => DocumentType::Ods,
        "ots" => DocumentType::Ots,
        "ppt" => DocumentType::Ppt,
        "pptx" => DocumentType::Pptx,
        "pptm" => DocumentType::Pptm,
        "pps" => DocumentType::Pps,
        "ppsx" => DocumentType::Ppsx,
        "ppsm" => DocumentType::Ppsm,
        "pot" => DocumentType::Pot,
        "potx" => DocumentType::Potx,
        "potm" => DocumentType::Potm,
        "odp" => DocumentType::Odp,
        "otp" => DocumentType::Otp,
        "txt" | "log" => DocumentType::Txt,
        "csv" => DocumentType::Csv,
        "tsv" => DocumentType::Tsv,
        _ => DocumentType::Raster,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pdf() {
        assert_eq!(
            detect_file_type("https://svoefoto.ru/media/uploads/file.pdf"),
            DocumentType::Pdf,
        );
    }

    #[test]
    fn test_docx_with_query() {
        assert_eq!(
            detect_file_type("https://example.com/docs/report.DOCX?token=abc123"),
            DocumentType::Docx,
        );
    }

    #[test]
    fn test_xlsx() {
        assert_eq!(
            detect_file_type("https://example.com/sheet.xlsx#page1"),
            DocumentType::Xlsx,
        );
    }

    #[test]
    fn test_legacy_doc_xls() {
        assert_eq!(detect_file_type("/tmp/old.doc"), DocumentType::Doc);
        assert_eq!(detect_file_type("/tmp/old.xls"), DocumentType::Xls);
    }

    #[test]
    fn test_libreoffice_document_formats() {
        assert_eq!(detect_file_type("/tmp/rich.rtf"), DocumentType::Rtf);
        assert_eq!(detect_file_type("/tmp/text.odt"), DocumentType::Odt);
        assert_eq!(detect_file_type("/tmp/template.ott"), DocumentType::Ott);
        assert_eq!(detect_file_type("/tmp/sheet.ods"), DocumentType::Ods);
        assert_eq!(detect_file_type("/tmp/template.ots"), DocumentType::Ots);
        assert_eq!(detect_file_type("/tmp/slides.ppt"), DocumentType::Ppt);
        assert_eq!(detect_file_type("/tmp/slides.pptx"), DocumentType::Pptx);
        assert_eq!(detect_file_type("/tmp/slides.odp"), DocumentType::Odp);
        assert_eq!(detect_file_type("/tmp/note.txt"), DocumentType::Txt);
        assert_eq!(detect_file_type("/tmp/data.csv"), DocumentType::Csv);
        assert_eq!(detect_file_type("/tmp/data.tsv"), DocumentType::Tsv);
        assert_eq!(detect_file_type("/tmp/print.log"), DocumentType::Txt);
    }

    #[test]
    fn test_office_template_and_macro_formats() {
        assert_eq!(detect_file_type("/tmp/report.docm"), DocumentType::Docm);
        assert_eq!(detect_file_type("/tmp/template.dot"), DocumentType::Dot);
        assert_eq!(detect_file_type("/tmp/template.dotx"), DocumentType::Dotx);
        assert_eq!(detect_file_type("/tmp/template.dotm"), DocumentType::Dotm);
        assert_eq!(detect_file_type("/tmp/sheet.xlsm"), DocumentType::Xlsm);
        assert_eq!(detect_file_type("/tmp/sheet.xlsb"), DocumentType::Xlsb);
        assert_eq!(detect_file_type("/tmp/template.xlt"), DocumentType::Xlt);
        assert_eq!(detect_file_type("/tmp/template.xltx"), DocumentType::Xltx);
        assert_eq!(detect_file_type("/tmp/template.xltm"), DocumentType::Xltm);
        assert_eq!(detect_file_type("/tmp/slides.pptm"), DocumentType::Pptm);
        assert_eq!(detect_file_type("/tmp/show.pps"), DocumentType::Pps);
        assert_eq!(detect_file_type("/tmp/show.ppsx"), DocumentType::Ppsx);
        assert_eq!(detect_file_type("/tmp/show.ppsm"), DocumentType::Ppsm);
        assert_eq!(detect_file_type("/tmp/template.pot"), DocumentType::Pot);
        assert_eq!(detect_file_type("/tmp/template.potx"), DocumentType::Potx);
        assert_eq!(detect_file_type("/tmp/template.potm"), DocumentType::Potm);
        assert_eq!(detect_file_type("/tmp/template.otp"), DocumentType::Otp);
    }

    #[test]
    fn test_all_documents_except_pdf_need_libreoffice() {
        assert!(!DocumentType::Pdf.needs_libreoffice());
        assert!(!DocumentType::Raster.needs_libreoffice());
        assert!(DocumentType::Docx.needs_libreoffice());
        assert!(DocumentType::Rtf.needs_libreoffice());
        assert!(DocumentType::Pptx.needs_libreoffice());
        assert!(DocumentType::Csv.needs_libreoffice());
    }

    #[test]
    fn test_raster_fallback() {
        assert_eq!(
            detect_file_type("https://cdn.example.com/photo.jpg"),
            DocumentType::Raster,
        );
        assert_eq!(
            detect_file_type("https://cdn.example.com/photo.png"),
            DocumentType::Raster,
        );
    }

    #[test]
    fn test_no_extension() {
        assert_eq!(
            detect_file_type("https://example.com/download/12345"),
            DocumentType::Raster,
        );
    }

    #[test]
    fn test_url_encoded_extension() {
        // S3 presigned URLs may encode the dot as %2E
        assert_eq!(
            detect_file_type("https://s3.example.com/bucket/report%2Epdf?X-Amz-Signature=abc"),
            DocumentType::Pdf,
        );
        assert_eq!(
            detect_file_type("https://s3.example.com/bucket/sheet%2exlsx?token=123"),
            DocumentType::Xlsx,
        );
    }

    #[test]
    fn test_case_insensitive() {
        assert_eq!(
            detect_file_type("https://example.com/FILE.PDF"),
            DocumentType::Pdf
        );
        assert_eq!(
            detect_file_type("https://example.com/Report.Docx"),
            DocumentType::Docx
        );
        assert_eq!(
            detect_file_type("https://example.com/data.XLS"),
            DocumentType::Xls
        );
        assert_eq!(detect_file_type("/tmp/SHEET.XLSX"), DocumentType::Xlsx);
        assert_eq!(detect_file_type("/tmp/old.DOC"), DocumentType::Doc);
    }
}
