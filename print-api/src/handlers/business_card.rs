use sqlx::PgPool;
use uuid::Uuid;

use crate::cups::options::CupsOptions;
use crate::error::{AppError, Result};
use crate::models::printer::PrinterRow;

const CANON_C3226I_NEEDLE: &str = "c3226";
const PAPER_SIZE: &str = "A4";
const PAPER_W_MM: f64 = 210.0;
const PAPER_H_MM: f64 = 297.0;
const ROWS: i32 = 5;
const COLS: i32 = 2;
const CUT_MARGIN_MM: f64 = 3.0;
const CUT_MARK_LENGTH_MM: f64 = 5.0;
const CUT_MARK_OFFSET_MM: f64 = 1.0;
const EPS_MM: f64 = 0.05;

const PRICE_SLUGS_90X50: &[&str] = &[
    "business-card-90x50-a4-canon-c3226i",
    "business-card-a4-canon-c3226i",
];
const PRICE_SLUGS_85X55: &[&str] = &[
    "business-card-85x55-a4-canon-c3226i",
    "business-card-a4-canon-c3226i",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BusinessCardMediaClass {
    Heavy6,
    Heavy7,
}

impl BusinessCardMediaClass {
    fn cups_choice(self) -> &'static str {
        match self {
            Self::Heavy6 => "HEAVY6",
            Self::Heavy7 => "HEAVY7",
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct BusinessCardSpec {
    pub width_mm: f64,
    pub height_mm: f64,
    pub price_slugs: &'static [&'static str],
}

impl BusinessCardSpec {
    fn price_slugs_vec(self) -> Vec<String> {
        self.price_slugs
            .iter()
            .map(|slug| (*slug).to_string())
            .collect()
    }
}

#[derive(Debug, Clone, Copy)]
pub struct BusinessCardPrintJobRequest<'a> {
    pub paper_size: Option<&'a str>,
    pub color_mode: &'a str,
    pub borderless: bool,
    pub duplex: bool,
    pub media_type: Option<&'a str>,
    pub paper_source: Option<&'a str>,
    pub layout_rows: Option<i32>,
    pub layout_cols: Option<i32>,
    pub photo_width_mm: Option<f64>,
    pub photo_height_mm: Option<f64>,
    pub cut_marks: bool,
    pub cut_margin_mm: Option<f64>,
    pub cut_mark_length_mm: Option<f64>,
    pub cut_mark_offset_mm: Option<f64>,
    pub finishing_ops: Option<&'a [String]>,
}

#[derive(Debug, Clone, Copy)]
pub struct BusinessCardLayoutBatchRequest<'a> {
    pub paper_size: Option<&'a str>,
    pub paper_width_mm: f64,
    pub paper_height_mm: f64,
    pub photo_width_mm: f64,
    pub photo_height_mm: f64,
    pub photo_preset_id: Option<&'a str>,
    pub color_mode: &'a str,
    pub borderless: bool,
    pub media_type: Option<&'a str>,
    pub paper_source: Option<&'a str>,
    pub cut_marks: bool,
    pub cut_margin_mm: Option<f64>,
}

pub fn is_business_card_document_template(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.trim().eq_ignore_ascii_case("business-card-a4"))
}

pub fn is_business_card_template_mode(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.trim().eq_ignore_ascii_case("business-card"))
}

pub fn validate_business_card_print_job_request(
    req: BusinessCardPrintJobRequest<'_>,
) -> Result<BusinessCardSpec> {
    require_paper_size(req.paper_size)?;
    require_color(req.color_mode)?;
    require_false(
        req.borderless,
        "Визитки печатаются с полями, borderless=false обязателен",
    )?;
    require_false(
        req.duplex,
        "Визитки печатаются только односторонне, duplex=false обязателен",
    )?;
    require_business_card_media_type(req.media_type)?;
    require_manual_source(req.paper_source)?;
    require_eq_i32(req.layout_rows, ROWS, "layout_rows")?;
    require_eq_i32(req.layout_cols, COLS, "layout_cols")?;
    require_true(req.cut_marks, "cut_marks=true обязателен для визиток")?;
    require_eq_mm(req.cut_margin_mm, CUT_MARGIN_MM, "cut_margin_mm")?;
    require_eq_mm(
        req.cut_mark_length_mm,
        CUT_MARK_LENGTH_MM,
        "cut_mark_length_mm",
    )?;
    require_eq_mm(
        req.cut_mark_offset_mm,
        CUT_MARK_OFFSET_MM,
        "cut_mark_offset_mm",
    )?;

    if req.finishing_ops.is_some_and(|ops| !ops.is_empty()) {
        return Err(AppError::bad_request(
            "Визитки не принимают finishing_ops в этом серверном шаблоне",
        ));
    }

    spec_from_dimensions(req.photo_width_mm, req.photo_height_mm)
}

pub fn validate_business_card_layout_batch_request(
    req: BusinessCardLayoutBatchRequest<'_>,
) -> Result<BusinessCardSpec> {
    require_paper_size(req.paper_size)?;
    require_eq_mm_value(req.paper_width_mm, PAPER_W_MM, "paper_width_mm")?;
    require_eq_mm_value(req.paper_height_mm, PAPER_H_MM, "paper_height_mm")?;
    require_color(req.color_mode)?;
    require_false(
        req.borderless,
        "Визитки печатаются с полями, borderless=false обязателен",
    )?;
    require_business_card_media_type(req.media_type)?;
    require_manual_source(req.paper_source)?;
    require_true(req.cut_marks, "cut_marks=true обязателен для визиток")?;
    require_eq_mm(req.cut_margin_mm, CUT_MARGIN_MM, "cut_margin_mm")?;
    spec_from_preset_or_dimensions(req.photo_preset_id, req.photo_width_mm, req.photo_height_mm)
}

pub async fn validate_business_card_printer_driver(
    printer: &PrinterRow,
    media_type: Option<&str>,
) -> Result<()> {
    if !is_canon_c3226i_printer(printer) {
        return Err(AppError::bad_request(
            "Визитки A4 печатаются только на Canon C3226i через серверный CUPS-драйвер",
        ));
    }

    let cups_printer = printer
        .cups_printer_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::bad_request(
                "У Canon C3226i не задан cups_printer_name, серверная печать невозможна",
            )
        })?;

    let options = CupsOptions::load(cups_printer).await.map_err(|e| {
        AppError::service_unavailable(format!(
            "Не удалось прочитать CUPS-драйвер `{cups_printer}`: {e}"
        ))
    })?;
    let media_choice = require_business_card_media_type(media_type)?.cups_choice();

    for (option, choice) in [
        ("PageSize", "A4"),
        ("MediaType", media_choice),
        ("InputSlot", "Manual"),
        ("Duplex", "None"),
        ("CNColorMode", "color"),
        ("Resolution", "600"),
    ] {
        options.require_choice(option, choice).map_err(|e| {
            AppError::service_unavailable(format!(
                "CUPS-драйвер `{cups_printer}` не подтверждает точную печать визиток: {e}"
            ))
        })?;
    }

    Ok(())
}

pub async fn fetch_business_card_sheet_price(
    db: &PgPool,
    printer: &PrinterRow,
    studio_id: Option<Uuid>,
    spec: BusinessCardSpec,
) -> Result<f64> {
    let slugs = spec.price_slugs_vec();
    let price = sqlx::query_scalar::<_, f64>(
        r#"
        SELECT pp.price::float8
        FROM print_presets pp
        WHERE pp.is_active = TRUE
          AND pp.slug = ANY($1::text[])
          AND pp.printer_type = $2
          AND pp.paper_size = 'A4'
          AND lower(COALESCE(pp.media_type, '')) IN (
              'heavy6', 'heavy221256', 'gsm250', '250gsm', 'cardstock250',
              'heavy7', 'heavy257300', 'gsm300', '300gsm', 'cardstock300'
          )
          AND pp.borderless = FALSE
          AND pp.duplex = FALSE
          AND ($3::uuid IS NULL OR pp.studio_id = $3 OR pp.studio_id IS NULL)
        ORDER BY
          CASE WHEN $3::uuid IS NOT NULL AND pp.studio_id = $3 THEN 0 ELSE 1 END,
          array_position($1::text[], pp.slug::text),
          pp.sort_order,
          pp.name
        LIMIT 1
        "#,
    )
    .bind(slugs.clone())
    .bind(&printer.printer_type)
    .bind(studio_id)
    .fetch_optional(db)
    .await?;

    let Some(price) = price else {
        return Err(AppError::bad_request(format!(
            "Нет активной цены print_presets для визиток Canon C3226i. Нужен один из slug: {}",
            slugs.join(", ")
        )));
    };

    if !price.is_finite() || price <= 0.0 {
        return Err(AppError::bad_request(format!(
            "Цена print_presets для визиток должна быть больше нуля. Проверьте slug: {}",
            slugs.join(", ")
        )));
    }

    Ok(price)
}

fn is_canon_c3226i_printer(printer: &PrinterRow) -> bool {
    let name = compact_id(&printer.name);
    let cups = printer
        .cups_printer_name
        .as_deref()
        .map(compact_id)
        .unwrap_or_default();
    name.contains(CANON_C3226I_NEEDLE) || cups.contains(CANON_C3226I_NEEDLE)
}

fn compact_id(value: &str) -> String {
    value
        .to_lowercase()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '-' | '_' | '/' | '.'))
        .collect()
}

fn require_paper_size(value: Option<&str>) -> Result<()> {
    match value.map(str::trim) {
        Some(paper) if paper.eq_ignore_ascii_case(PAPER_SIZE) => Ok(()),
        _ => Err(AppError::bad_request(
            "Для визиток paper_size=A4 обязателен, без серверного fallback",
        )),
    }
}

fn require_color(value: &str) -> Result<()> {
    if value == "color" {
        Ok(())
    } else {
        Err(AppError::bad_request(
            "Визитки Canon C3226i печатаются только в color",
        ))
    }
}

fn require_false(value: bool, message: &str) -> Result<()> {
    if value {
        Err(AppError::bad_request(message))
    } else {
        Ok(())
    }
}

fn require_true(value: bool, message: &str) -> Result<()> {
    if value {
        Ok(())
    } else {
        Err(AppError::bad_request(message))
    }
}

fn require_business_card_media_type(value: Option<&str>) -> Result<BusinessCardMediaClass> {
    let Some(media) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err(AppError::bad_request(
            "Для визиток нужна плотная бумага HEAVY6/HEAVY7, без подстановки обычной бумаги",
        ));
    };
    let normalized = compact_id(media);
    if matches!(
        normalized.as_str(),
        "heavy6" | "heavy221256" | "gsm250" | "250gsm" | "cardstock250"
    ) || normalized.contains("heavy6")
        || normalized.contains("221256")
        || normalized.contains("250")
        || normalized.contains("плотная6")
    {
        Ok(BusinessCardMediaClass::Heavy6)
    } else if matches!(
        normalized.as_str(),
        "heavy7" | "heavy257300" | "gsm300" | "300gsm" | "cardstock300"
    ) || normalized.contains("heavy7")
        || normalized.contains("257300")
        || normalized.contains("300")
        || normalized.contains("плотная7")
    {
        Ok(BusinessCardMediaClass::Heavy7)
    } else {
        Err(AppError::bad_request(
            "Для визиток нужна плотная бумага HEAVY6/HEAVY7",
        ))
    }
}

fn require_manual_source(value: Option<&str>) -> Result<()> {
    let Some(source) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err(AppError::bad_request(
            "Для визиток paper_source=manual обязателен, без auto-лотка",
        ));
    };
    let normalized = compact_id(source);
    if matches!(
        normalized.as_str(),
        "manual"
            | "universal"
            | "universallot"
            | "universaltray"
            | "multipurpose"
            | "multipurposetray"
            | "bypass"
            | "mp"
            | "mptray"
    ) {
        Ok(())
    } else {
        Err(AppError::bad_request(
            "Визитки должны печататься из универсального/ручного лотка",
        ))
    }
}

fn require_eq_i32(value: Option<i32>, expected: i32, field: &str) -> Result<()> {
    match value {
        Some(actual) if actual == expected => Ok(()),
        _ => Err(AppError::bad_request(format!(
            "Для визиток {field} должен быть {expected}",
        ))),
    }
}

fn require_eq_mm(value: Option<f64>, expected: f64, field: &str) -> Result<()> {
    let Some(actual) = value else {
        return Err(AppError::bad_request(format!(
            "Для визиток {field} обязателен",
        )));
    };
    require_eq_mm_value(actual, expected, field)
}

fn require_eq_mm_value(actual: f64, expected: f64, field: &str) -> Result<()> {
    if actual.is_finite() && (actual - expected).abs() <= EPS_MM {
        Ok(())
    } else {
        Err(AppError::bad_request(format!(
            "Для визиток {field} должен быть {expected} мм",
        )))
    }
}

fn spec_from_dimensions(width: Option<f64>, height: Option<f64>) -> Result<BusinessCardSpec> {
    let Some(width) = width else {
        return Err(AppError::bad_request(
            "Для визиток custom_photo_width_mm обязателен",
        ));
    };
    let Some(height) = height else {
        return Err(AppError::bad_request(
            "Для визиток custom_photo_height_mm обязателен",
        ));
    };
    spec_from_preset_or_dimensions(None, width, height)
}

fn spec_from_preset_or_dimensions(
    preset_id: Option<&str>,
    width_mm: f64,
    height_mm: f64,
) -> Result<BusinessCardSpec> {
    if let Some(preset_id) = preset_id {
        let spec = spec_by_preset(preset_id).ok_or_else(|| {
            AppError::bad_request("Для template_mode=business-card нужен business-card preset")
        })?;
        require_eq_mm_value(width_mm, spec.width_mm, "photo_width_mm")?;
        require_eq_mm_value(height_mm, spec.height_mm, "photo_height_mm")?;
        return Ok(spec);
    }

    if is_mm(width_mm, 90.0) && is_mm(height_mm, 50.0) {
        return Ok(BusinessCardSpec {
            width_mm: 90.0,
            height_mm: 50.0,
            price_slugs: PRICE_SLUGS_90X50,
        });
    }

    if is_mm(width_mm, 85.0) && is_mm(height_mm, 55.0) {
        return Ok(BusinessCardSpec {
            width_mm: 85.0,
            height_mm: 55.0,
            price_slugs: PRICE_SLUGS_85X55,
        });
    }

    Err(AppError::bad_request(
        "Поддерживаются только визитки 90x50 или 85x55 мм на A4",
    ))
}

fn spec_by_preset(preset_id: &str) -> Option<BusinessCardSpec> {
    match preset_id {
        "business-card" => Some(BusinessCardSpec {
            width_mm: 90.0,
            height_mm: 50.0,
            price_slugs: PRICE_SLUGS_90X50,
        }),
        "business-card-eu" => Some(BusinessCardSpec {
            width_mm: 85.0,
            height_mm: 55.0,
            price_slugs: PRICE_SLUGS_85X55,
        }),
        _ => None,
    }
}

fn is_mm(actual: f64, expected: f64) -> bool {
    actual.is_finite() && (actual - expected).abs() <= EPS_MM
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_exact_business_card_print_job_contract() {
        let spec = validate_business_card_print_job_request(BusinessCardPrintJobRequest {
            paper_size: Some("A4"),
            color_mode: "color",
            borderless: false,
            duplex: false,
            media_type: Some("heavy6"),
            paper_source: Some("manual"),
            layout_rows: Some(5),
            layout_cols: Some(2),
            photo_width_mm: Some(90.0),
            photo_height_mm: Some(50.0),
            cut_marks: true,
            cut_margin_mm: Some(3.0),
            cut_mark_length_mm: Some(5.0),
            cut_mark_offset_mm: Some(1.0),
            finishing_ops: None,
        })
        .unwrap();

        assert_eq!(spec.width_mm, 90.0);
        assert_eq!(spec.height_mm, 50.0);
    }

    #[test]
    fn rejects_business_card_auto_paper_source() {
        let err = validate_business_card_print_job_request(BusinessCardPrintJobRequest {
            paper_size: Some("A4"),
            color_mode: "color",
            borderless: false,
            duplex: false,
            media_type: Some("heavy6"),
            paper_source: Some("auto"),
            layout_rows: Some(5),
            layout_cols: Some(2),
            photo_width_mm: Some(90.0),
            photo_height_mm: Some(50.0),
            cut_marks: true,
            cut_margin_mm: Some(3.0),
            cut_mark_length_mm: Some(5.0),
            cut_mark_offset_mm: Some(1.0),
            finishing_ops: None,
        });

        assert!(err.is_err());
    }

    #[test]
    fn validates_business_card_layout_batch_contract() {
        let spec = validate_business_card_layout_batch_request(BusinessCardLayoutBatchRequest {
            paper_size: Some("A4"),
            paper_width_mm: 210.0,
            paper_height_mm: 297.0,
            photo_width_mm: 85.0,
            photo_height_mm: 55.0,
            photo_preset_id: Some("business-card-eu"),
            color_mode: "color",
            borderless: false,
            media_type: Some("gsm_250"),
            paper_source: Some("universal"),
            cut_marks: true,
            cut_margin_mm: Some(3.0),
        })
        .unwrap();

        assert_eq!(spec.width_mm, 85.0);
        assert_eq!(spec.height_mm, 55.0);
    }

    #[test]
    fn validates_business_card_heavy7_contract() {
        let spec = validate_business_card_layout_batch_request(BusinessCardLayoutBatchRequest {
            paper_size: Some("A4"),
            paper_width_mm: 210.0,
            paper_height_mm: 297.0,
            photo_width_mm: 85.0,
            photo_height_mm: 55.0,
            photo_preset_id: Some("business-card-eu"),
            color_mode: "color",
            borderless: false,
            media_type: Some("heavy7"),
            paper_source: Some("universal"),
            cut_marks: true,
            cut_margin_mm: Some(3.0),
        })
        .unwrap();

        assert_eq!(spec.width_mm, 85.0);
        assert_eq!(spec.height_mm, 55.0);
    }

    #[test]
    fn rejects_business_card_plain_media_contract() {
        let err = validate_business_card_layout_batch_request(BusinessCardLayoutBatchRequest {
            paper_size: Some("A4"),
            paper_width_mm: 210.0,
            paper_height_mm: 297.0,
            photo_width_mm: 85.0,
            photo_height_mm: 55.0,
            photo_preset_id: Some("business-card-eu"),
            color_mode: "color",
            borderless: false,
            media_type: Some("plain"),
            paper_source: Some("universal"),
            cut_marks: true,
            cut_margin_mm: Some(3.0),
        });

        assert!(err.is_err());
    }

    #[test]
    fn maps_business_card_media_to_cups_choice() {
        assert_eq!(
            require_business_card_media_type(Some("heavy6"))
                .unwrap()
                .cups_choice(),
            "HEAVY6"
        );
        assert_eq!(
            require_business_card_media_type(Some("Плотная 7 / 257-300 г/м2"))
                .unwrap()
                .cups_choice(),
            "HEAVY7"
        );
    }
}
