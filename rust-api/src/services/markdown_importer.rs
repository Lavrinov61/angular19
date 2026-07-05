use regex::Regex;
use sqlx::PgPool;
use std::collections::HashSet;
use std::path::Path;

/// Mapping: markdown filename → competitor entity slug
const FILE_SLUGS: &[(&str, &str)] = &[
    ("О!Фото.md", "competitor-ofoto"),
    ("ТриНаЧетыре.md", "competitor-trinachetyre"),
    ("SkyPrint.md", "competitor-skyprint"),
    ("ЯркийФотомаркет.md", "competitor-yarkiy"),
];

const КОНКУРЕНТЫ_DIR: &str = "/var/www/apimain/angular-app/конкуренты";

/// Import all markdown files into kb_competitor_prices.
/// Marks as `extraction_method = 'markdown_import'` and `verified = true`.
pub async fn import_all(db: &PgPool) -> Result<serde_json::Value, String> {
    let mut total_imported = 0;
    let mut results: Vec<serde_json::Value> = Vec::new();

    for (filename, competitor_slug) in FILE_SLUGS {
        let filepath = Path::new(КОНКУРЕНТЫ_DIR).join(filename);
        if !filepath.exists() {
            tracing::warn!("Markdown file not found: {}", filepath.display());
            continue;
        }

        let content = tokio::fs::read_to_string(&filepath)
            .await
            .map_err(|e| format!("Failed to read {filename}: {e}"))?;

        let competitor_id: Option<uuid::Uuid> = sqlx::query_scalar(
            "SELECT id FROM kb_entities WHERE slug = $1 AND entity_type = 'competitor' AND deleted_at IS NULL",
        )
        .bind(competitor_slug)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("DB error: {e}"))?;

        let Some(competitor_id) = competitor_id else {
            tracing::warn!("Competitor entity '{competitor_slug}' not found");
            continue;
        };

        let prices = parse_markdown_prices(&content);
        let count = prices.len();

        let mut tx = db.begin().await.map_err(|e| format!("TX error: {e}"))?;

        for price in &prices {
            let _ = sqlx::query(
                "INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, scraped_at, verified, extraction_method)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW(), TRUE, 'markdown_import')
                 ON CONFLICT (competitor_id, service_name) DO UPDATE SET
                   price_min = EXCLUDED.price_min,
                   price_text = EXCLUDED.price_text,
                   notes = EXCLUDED.notes,
                   service_category = EXCLUDED.service_category,
                   extraction_method = 'markdown_import',
                   verified = TRUE,
                   scraped_at = NOW()",
            )
            .bind(competitor_id)
            .bind(&price.service)
            .bind(&price.category)
            .bind(price.price)
            .bind(&price.price_text)
            .bind(&price.notes)
            .execute(&mut *tx)
            .await;

            // Record initial history entry
            let _ = sqlx::query(
                "INSERT INTO kb_price_history (competitor_id, service_name, service_category, new_price, change_type)
                 VALUES ($1, $2, $3, $4, 'initial')
                 ON CONFLICT DO NOTHING",
            )
            .bind(competitor_id)
            .bind(&price.service)
            .bind(&price.category)
            .bind(price.price)
            .execute(&mut *tx)
            .await;
        }

        tx.commit().await.map_err(|e| format!("TX commit error: {e}"))?;

        total_imported += count;
        results.push(serde_json::json!({
            "file": filename,
            "competitor": competitor_slug,
            "prices_imported": count,
        }));

        tracing::info!("Imported {count} prices from {filename} for {competitor_slug}");
    }

    Ok(serde_json::json!({
        "total_imported": total_imported,
        "files": results,
    }))
}

struct ParsedPrice {
    service: String,
    category: String,
    price: Option<i32>,
    price_text: String,
    notes: Option<String>,
}

fn parse_markdown_prices(content: &str) -> Vec<ParsedPrice> {
    let mut prices = Vec::new();
    let mut seen = HashSet::new();

    // Pattern 1: Markdown list items "- Service: 1500 ₽" or "- Service — от 500 ₽"
    let re_list = Regex::new(
        r"(?m)^[\s]*[-*•]\s*(.{3,60}?)[:：]\s*((?:от\s+)?\d[\d\s]*)\s*(₽|руб\.?|р\.?)"
    ).unwrap();

    for cap in re_list.captures_iter(content) {
        let service = cap[1].trim().to_string();
        let price_raw = cap[2].replace(' ', "").replace("от", "");
        let price_text = format!("{} {}", &cap[2].trim(), &cap[3]);

        if let Ok(price) = price_raw.trim().parse::<i32>() {
            if price > 0 && price < 100_000 && !is_junk(&service) {
                let key = service.to_lowercase();
                if seen.insert(key) {
                    prices.push(ParsedPrice {
                        category: guess_category(&service),
                        service: clean_name(&service),
                        price: Some(price),
                        price_text,
                        notes: None,
                    });
                }
            }
        }
    }

    // Pattern 2: "Service — 1500₽" or "Service – от 500 руб"
    let re_dash = Regex::new(
        r"(?m)^[\s]*(.{3,60}?)\s*[-–—]\s*((?:от\s+)?\d[\d\s]*)\s*(₽|руб\.?|р\.?)"
    ).unwrap();

    for cap in re_dash.captures_iter(content) {
        let service = cap[1].trim().to_string();
        let price_raw = cap[2].replace(' ', "").replace("от", "");
        let price_text = format!("{} {}", &cap[2].trim(), &cap[3]);

        if let Ok(price) = price_raw.trim().parse::<i32>() {
            if price > 0 && price < 100_000 && !is_junk(&service) {
                let key = service.to_lowercase();
                if seen.insert(key) {
                    prices.push(ParsedPrice {
                        category: guess_category(&service),
                        service: clean_name(&service),
                        price: Some(price),
                        price_text,
                        notes: None,
                    });
                }
            }
        }
    }

    // Pattern 3: Markdown table rows "| Service | 1500 ₽ |"
    let re_table = Regex::new(
        r"(?m)\|\s*(.{3,60}?)\s*\|\s*((?:от\s+)?\d[\d\s]*)\s*(₽|руб\.?|р\.?)"
    ).unwrap();

    for cap in re_table.captures_iter(content) {
        let service = cap[1].trim().to_string();
        let price_raw = cap[2].replace(' ', "").replace("от", "");
        let price_text = format!("{} {}", &cap[2].trim(), &cap[3]);

        if service.contains("---") || service.contains("===") {
            continue; // table separator
        }

        if let Ok(price) = price_raw.trim().parse::<i32>() {
            if price > 0 && price < 100_000 && !is_junk(&service) {
                let key = service.to_lowercase();
                if seen.insert(key) {
                    prices.push(ParsedPrice {
                        category: guess_category(&service),
                        service: clean_name(&service),
                        price: Some(price),
                        price_text,
                        notes: None,
                    });
                }
            }
        }
    }

    // Pattern 4: "1500₽" on its own with context from preceding lines
    let lines: Vec<&str> = content.lines().collect();
    let re_price_line = Regex::new(r"^\s*((?:от\s+)?\d[\d\s]*)\s*(₽|руб\.?|р\.?)\s*$").unwrap();

    for i in 1..lines.len() {
        if let Some(cap) = re_price_line.captures(lines[i]) {
            let price_raw = cap[1].replace(' ', "").replace("от", "");
            let price_text = lines[i].trim().to_string();

            // Look back for a short title
            for back in 1..=3.min(i) {
                let candidate = lines[i - back].trim();
                if candidate.len() >= 3
                    && candidate.len() <= 60
                    && !re_price_line.is_match(candidate)
                    && !is_junk(candidate)
                    && !candidate.starts_with('|')
                    && !candidate.starts_with('#')
                {
                    if let Ok(price) = price_raw.trim().parse::<i32>() {
                        if price > 0 && price < 100_000 {
                            let key = candidate.to_lowercase();
                            if seen.insert(key) {
                                prices.push(ParsedPrice {
                                    category: guess_category(candidate),
                                    service: clean_name(candidate),
                                    price: Some(price),
                                    price_text,
                                    notes: None,
                                });
                            }
                        }
                    }
                    break;
                }
            }
        }
    }

    prices
}

fn clean_name(name: &str) -> String {
    name.trim()
        .trim_start_matches(['•', '·', '-', '–', '—', '✓', '✔', '*', '►', '▸', '→', '#'])
        .trim_start_matches("**")
        .trim_end_matches("**")
        .trim()
        .to_string()
}

fn is_junk(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("http") || lower.contains("@") || lower.contains("copyright")
        || lower.contains("---") || lower.contains("===")
        || lower.contains("источник") || lower.contains("контакт")
        || lower.contains("адрес") || lower.contains("телефон")
        || lower.len() < 3
}

fn guess_category(service: &str) -> String {
    // Reuse the same logic as scraper.rs
    let lower = service.to_lowercase();
    if lower.contains("фото на документ") || lower.contains("паспорт") || lower.contains("виз")
        || lower.contains("3x4") || lower.contains("3х4") || lower.contains("документ") {
        "photo_documents".to_string()
    } else if lower.contains("портрет") || lower.contains("бизнес") || lower.contains("деловой") {
        "portrait".to_string()
    } else if lower.contains("детск") || lower.contains("малыш") {
        "photo_children".to_string()
    } else if lower.contains("фотосесс") || lower.contains("студийн") || lower.contains("предметн") {
        "photosession".to_string()
    } else if lower.contains("ретушь") || lower.contains("обработк") || lower.contains("военн") {
        "retouch".to_string()
    } else if lower.contains("реставрац") || lower.contains("восстановлен") {
        "restoration".to_string()
    } else if lower.contains("печать") || lower.contains("фотопечат") {
        "print".to_string()
    } else if lower.contains("ксерокоп") || lower.contains("сканир") || lower.contains("ламинир") {
        "copy".to_string()
    } else if lower.contains("визитк") || lower.contains("полиграф") || lower.contains("календар") {
        "polygraphy".to_string()
    } else if lower.contains("холст") || lower.contains("широкоформат") || lower.contains("баннер") {
        "print_large".to_string()
    } else if lower.contains("сувенир") || lower.contains("кружк") || lower.contains("магнит") || lower.contains("пазл") {
        "souvenirs".to_string()
    } else {
        "other".to_string()
    }
}
