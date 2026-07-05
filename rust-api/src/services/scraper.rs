use regex::Regex;
use reqwest::Client;
use scraper::Selector;
use sqlx::PgPool;
use std::collections::{HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use super::chrome::{Chrome, dump_dom};

/// Global flag: prevents concurrent scrape-all runs
static SCRAPE_ALL_RUNNING: AtomicBool = AtomicBool::new(false);

const MAX_CRAWL_DEPTH: u32 = 3;
const MAX_PAGES_PER_SITE: usize = 10;

/// Minimum absolute price delta (₽) per category to trigger alerts.
/// Prevents false positives on cheap items (10₽→12₽ = 20% but insignificant).
fn min_delta_for_category(category: &str) -> i32 {
    match category {
        "photo_documents" | "portrait" => 50,
        "photosession" | "photo_children" => 100,
        "retouch" | "restoration" => 30,
        "print" | "copy" => 5,
        "polygraphy" | "print_large" => 20,
        "souvenirs" => 30,
        _ => 20,
    }
}

/// RAII guard that releases SCRAPE_ALL_RUNNING on drop (even on panic).
pub struct ScrapeAllGuard;

impl Drop for ScrapeAllGuard {
    fn drop(&mut self) {
        SCRAPE_ALL_RUNNING.store(false, Ordering::SeqCst);
        tracing::info!("Scrape-all lock released (guard dropped)");
    }
}

#[derive(Clone)]
pub struct ScraperService {
    client: Client,
    db: PgPool,
}

impl ScraperService {
    /// Acquire scrape-all lock. Returns None if already running.
    pub fn try_start_scrape_all() -> Option<ScrapeAllGuard> {
        if SCRAPE_ALL_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            Some(ScrapeAllGuard)
        } else {
            None
        }
    }

    pub fn new(db: PgPool) -> Self {
        Self {
            client: Client::builder()
                .user_agent("Mozilla/5.0 (compatible; SvoeFotoBot/1.0)")
                .timeout(std::time::Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::limited(5))
                .build()
                .unwrap(),
            db,
        }
    }

    // ───────────────────────────────────────────────────
    //  MAIN ENTRY POINT
    // ───────────────────────────────────────────────────

    /// Full crawl pipeline: discover → scrape → extract prices
    pub async fn scrape_source(&self, source_slug: &str) -> Result<ScrapeResult, String> {
        let started = Instant::now();

        let source: Option<SourceConfig> = sqlx::query_as(
            "SELECT slug, config FROM kb_data_sources WHERE slug = $1 AND is_active = TRUE",
        )
        .bind(source_slug)
        .fetch_optional(&self.db)
        .await
        .map_err(|e| format!("DB error: {e}"))?;

        let source = source.ok_or_else(|| format!("Source '{source_slug}' not found or inactive"))?;
        let config = &source.config;

        let base_url = config
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Source config missing 'url'".to_string())?
            .trim_end_matches('/')
            .to_string();

        let max_depth = config
            .get("max_depth")
            .and_then(|v| v.as_u64())
            .unwrap_or(MAX_CRAWL_DEPTH as u64) as u32;

        let needs_js = config
            .get("needs_js")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);

        let scrape_config = SourceScrapeConfig::from_json(config);

        let extraction_type = config
            .get("extraction_type")
            .and_then(|v| v.as_str())
            .unwrap_or("standard");

        // Step 1: Resolve URLs to scrape
        // If price_urls is set — use only those (no crawl). Otherwise fall back to discovery.
        let price_urls: Option<Vec<String>> = config
            .get("price_urls")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect());

        let urls = if let Some(ref pu) = price_urls {
            if !pu.is_empty() {
                tracing::info!("Using {} explicit price_urls for {source_slug}", pu.len());
                pu.clone()
            } else {
                self.discover_pages(&base_url, max_depth).await?
            }
        } else {
            self.discover_pages(&base_url, max_depth).await?
        };

        tracing::info!("{source_slug}: {} pages, extraction_type={extraction_type}", urls.len());

        // Route by extraction_type: vision/calculator bypass standard pipeline
        let competitor_slug = config
            .get("competitor_slug")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if extraction_type == "vision" {
            let result = self.scrape_with_vision(&urls, competitor_slug).await?;
            // Save structured prices directly from Vision pairs
            if !competitor_slug.is_empty() {
                let _ = self.save_structured_prices(competitor_slug, &result.data).await;
            }
            return Ok(result);
        }

        if extraction_type == "calculator" {
            let result = self.scrape_with_calculator(&urls, config).await?;
            if !competitor_slug.is_empty() {
                let _ = self.save_structured_prices(competitor_slug, &result.data).await;
            }
            return Ok(result);
        }

        // Standard extraction: save discovered pages to DB
        for url in &urls {
            let _ = sqlx::query(
                "INSERT INTO kb_crawled_pages (source_slug, url, status)
                 VALUES ($1, $2, 'pending')
                 ON CONFLICT (source_slug, url) DO NOTHING",
            )
            .bind(source_slug)
            .bind(url)
            .execute(&self.db)
            .await;
        }

        // Step 2: Three-tier scraping: reqwest → Chrome CDP → dump-dom
        let mut all_data = Vec::new();
        let mut chrome_used = false;
        let mut reqwest_used = false;
        let mut errors: Vec<String> = Vec::new();

        if needs_js {
            // JS-heavy site: try Chrome CDP first, fallback to dump-dom
            match self.scrape_with_browser(&urls, &scrape_config).await {
                Ok(data) => {
                    chrome_used = true;
                    all_data = data;
                }
                Err(e) => {
                    errors.push(format!("Chrome CDP: {e}"));
                    tracing::warn!("Chrome CDP failed, trying dump-dom: {e}");
                    match self.scrape_with_dump_dom(&urls, &scrape_config).await {
                        Ok(data) => {
                            chrome_used = true; // still used Chrome binary
                            all_data = data;
                        }
                        Err(e2) => {
                            errors.push(format!("dump-dom: {e2}"));
                            tracing::warn!("dump-dom also failed, falling back to reqwest: {e2}");
                            match self.scrape_with_reqwest(&urls, &scrape_config).await {
                                Ok(data) => {
                                    reqwest_used = true;
                                    all_data = data;
                                }
                                Err(e3) => errors.push(format!("reqwest: {e3}")),
                            }
                        }
                    }
                }
            }
        } else {
            // Static site: reqwest first, Chrome CDP as fallback
            match self.scrape_with_reqwest(&urls, &scrape_config).await {
                Ok(data) if !data.is_empty() => {
                    reqwest_used = true;
                    all_data = data;
                }
                Ok(_) | Err(_) => {
                    tracing::info!("reqwest returned no data, trying Chrome CDP");
                    match self.scrape_with_browser(&urls, &scrape_config).await {
                        Ok(data) => {
                            chrome_used = true;
                            all_data = data;
                        }
                        Err(e) => {
                            errors.push(format!("Chrome CDP: {e}"));
                            match self.scrape_with_dump_dom(&urls, &scrape_config).await {
                                Ok(data) => all_data = data,
                                Err(e2) => errors.push(format!("dump-dom: {e2}")),
                            }
                        }
                    }
                }
            }
        }

        // Pre-filter garbage items before price extraction
        let pre_filter_count = all_data.len();
        filter_scraped_items(&mut all_data);
        if pre_filter_count != all_data.len() {
            tracing::info!("Filtered {} → {} items", pre_filter_count, all_data.len());
        }

        // Step 3: Mark pages as crawled
        for url in &urls {
            let has_prices = all_data.iter().any(|item| {
                item.source_url.as_deref() == Some(url.as_str())
                    && item.selector != "content"
                    && item.selector != "chrome_content"
                    && item.selector != "reqwest_content"
            });

            let _ = sqlx::query(
                "UPDATE kb_crawled_pages SET
                   status = 'crawled',
                   last_crawled_at = NOW(),
                   has_prices = $3
                 WHERE source_slug = $1 AND url = $2",
            )
            .bind(source_slug)
            .bind(url)
            .bind(has_prices)
            .execute(&self.db)
            .await;
        }

        // Update source sync status
        let _ = sqlx::query(
            "UPDATE kb_data_sources SET
               sync_status = 'idle',
               last_synced_at = NOW(),
               sync_error = NULL
             WHERE slug = $1",
        )
        .bind(source_slug)
        .execute(&self.db)
        .await;

        let duration_ms = started.elapsed().as_millis() as i32;

        // Log scrape run
        let log_status = if all_data.is_empty() && !errors.is_empty() {
            "failed"
        } else if !errors.is_empty() {
            "partial"
        } else {
            "success"
        };

        let competitor_slug = source_slug
            .strip_prefix("web-")
            .map(|s| format!("competitor-{s}"));

        let _ = sqlx::query(
            "INSERT INTO kb_scrape_logs (source_slug, competitor_slug, status, pages_discovered, pages_scraped, items_found, chrome_used, reqwest_used, errors, duration_ms)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        )
        .bind(source_slug)
        .bind(&competitor_slug)
        .bind(log_status)
        .bind(urls.len() as i32)
        .bind(urls.len() as i32)
        .bind(all_data.len() as i32)
        .bind(chrome_used)
        .bind(reqwest_used)
        .bind(serde_json::json!(errors))
        .bind(duration_ms)
        .execute(&self.db)
        .await;

        Ok(ScrapeResult {
            source: source_slug.to_string(),
            pages_scraped: urls.len(),
            items_found: all_data.len(),
            data: all_data,
        })
    }

    // ───────────────────────────────────────────────────
    //  PAGE DISCOVERY (sitemap + BFS link crawl)
    // ───────────────────────────────────────────────────

    async fn discover_pages(
        &self,
        base_url: &str,
        max_depth: u32,
    ) -> Result<Vec<String>, String> {
        let origin = extract_origin(base_url);
        let mut discovered: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();

        // 1. Try sitemap.xml (via robots.txt or direct)
        let sitemap_urls = self.discover_from_sitemap(&origin).await;
        for url in &sitemap_urls {
            if seen.insert(url.clone()) {
                discovered.push(url.clone());
            }
        }
        if !sitemap_urls.is_empty() {
            tracing::info!("Sitemap: found {} URLs for {origin}", sitemap_urls.len());
        }

        // 2. BFS link crawl via reqwest (lightweight, no Chrome)
        let crawled = self.bfs_crawl_reqwest(base_url, &origin, max_depth).await;
        for url in crawled {
            if seen.insert(url.clone()) {
                discovered.push(url);
            }
        }

        // 3. Always include base URL
        if seen.insert(base_url.to_string()) {
            discovered.insert(0, base_url.to_string());
        }

        discovered.truncate(MAX_PAGES_PER_SITE);
        Ok(discovered)
    }

    async fn discover_from_sitemap(&self, origin: &str) -> Vec<String> {
        let mut sitemap_urls: Vec<String> = Vec::new();

        let robots_url = format!("{origin}/robots.txt");
        if let Ok(resp) = self.client.get(&robots_url).send().await {
            if let Ok(text) = resp.text().await {
                for line in text.lines() {
                    let lower = line.to_lowercase();
                    if lower.starts_with("sitemap:") {
                        if let Some(url) = line.split_once(':').map(|(_, v)| v.trim()) {
                            let sitemap_url = if url.starts_with("http") {
                                url.to_string()
                            } else {
                                format!("{origin}{url}")
                            };
                            let mut urls = self.parse_sitemap(&sitemap_url).await;
                            sitemap_urls.append(&mut urls);
                        }
                    }
                }
            }
        }

        if sitemap_urls.is_empty() {
            for path in ["/sitemap.xml", "/sitemap_index.xml"] {
                let url = format!("{origin}{path}");
                let mut urls = self.parse_sitemap(&url).await;
                if !urls.is_empty() {
                    sitemap_urls.append(&mut urls);
                    break;
                }
            }
        }

        sitemap_urls
    }

    async fn parse_sitemap(&self, sitemap_url: &str) -> Vec<String> {
        self.parse_sitemap_inner(sitemap_url, 0).await
    }

    fn parse_sitemap_inner<'a>(
        &'a self,
        sitemap_url: &'a str,
        depth: u32,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Vec<String>> + Send + 'a>> {
        Box::pin(async move {
            if depth > 2 {
                return Vec::new();
            }

            let Ok(resp) = self.client.get(sitemap_url).send().await else {
                return Vec::new();
            };
            if !resp.status().is_success() {
                return Vec::new();
            }
            let Ok(xml) = resp.text().await else {
                return Vec::new();
            };

            let mut urls = Vec::new();
            let loc_re = Regex::new(r"<loc>\s*(.*?)\s*</loc>").unwrap();
            let is_index = xml.contains("<sitemapindex");

            for cap in loc_re.captures_iter(&xml) {
                let url = cap[1].trim().to_string();

                if is_index && url.contains("sitemap") {
                    let nested = self.parse_sitemap_inner(&url, depth + 1).await;
                    urls.extend(nested);
                } else {
                    urls.push(url);
                }

                if urls.len() >= MAX_PAGES_PER_SITE {
                    break;
                }
            }

            urls
        })
    }

    /// BFS crawl using reqwest (lightweight, no Chrome needed for discovery)
    async fn bfs_crawl_reqwest(
        &self,
        start_url: &str,
        origin: &str,
        max_depth: u32,
    ) -> Vec<String> {
        let mut queue: VecDeque<(String, u32)> = VecDeque::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut result: Vec<String> = Vec::new();

        queue.push_back((start_url.to_string(), 0));
        seen.insert(normalize_url(start_url));

        while let Some((url, depth)) = queue.pop_front() {
            if result.len() >= MAX_PAGES_PER_SITE {
                break;
            }

            let Ok(resp) = self.client.get(&url).send().await else {
                continue;
            };
            if !resp.status().is_success() {
                continue;
            }
            let Ok(html) = resp.text().await else {
                continue;
            };

            result.push(url.clone());

            if depth < max_depth {
                let links = extract_internal_links(&html, origin);
                for link in links {
                    let normalized = normalize_url(&link);
                    if seen.insert(normalized) && is_useful_page(&link) {
                        queue.push_back((link, depth + 1));
                    }
                }
            }
        }

        result
    }

    // ───────────────────────────────────────────────────
    //  THREE-TIER SCRAPING
    // ───────────────────────────────────────────────────

    /// Tier 1: Scrape with reqwest (fast, no Chrome overhead)
    async fn scrape_with_reqwest(&self, urls: &[String], config: &SourceScrapeConfig) -> Result<Vec<ScrapedItem>, String> {
        let mut all_items = Vec::new();

        for url in urls {
            let Ok(resp) = self.client.get(url).send().await else {
                continue;
            };
            if !resp.status().is_success() {
                continue;
            }
            let Ok(html) = resp.text().await else {
                continue;
            };

            let document = scraper::Html::parse_document(&html);
            all_items.extend(self.extract_price_blocks(&document, url, config));
            all_items.extend(self.extract_table_prices(&document, url));

            // Full text content for LLM
            if let Some(text) = self.extract_clean_text(&document) {
                all_items.push(ScrapedItem {
                    selector: "reqwest_content".to_string(),
                    text: if text.len() > 8000 { truncate_utf8(&text, 8000) } else { text },
                    context: None,
                    source_url: Some(url.to_string()),
                });
            }
        }

        Ok(all_items)
    }

    /// Tier 2: Scrape with Chrome CDP (JS rendering)
    async fn scrape_with_browser(&self, urls: &[String], config: &SourceScrapeConfig) -> Result<Vec<ScrapedItem>, String> {
        let mut chrome = Chrome::launch().await?;
        let mut all_items = Vec::new();

        for url in urls {
            if !chrome.is_alive() {
                tracing::warn!("Chrome died mid-session, stopping CDP scraping");
                break;
            }

            tracing::info!("Chrome CDP scraping: {url}");
            match self.fetch_page_cdp(&mut chrome, url, config).await {
                Ok(items) => all_items.extend(items),
                Err(e) => tracing::warn!("Chrome scrape failed for {url}: {e}"),
            }
        }

        chrome.close().await;
        Ok(all_items)
    }

    /// Tier 3: Scrape with Chrome --dump-dom (no CDP, just stdout)
    async fn scrape_with_dump_dom(&self, urls: &[String], config: &SourceScrapeConfig) -> Result<Vec<ScrapedItem>, String> {
        let mut all_items = Vec::new();

        for url in urls {
            match dump_dom(url).await {
                Ok(result) => {
                    let document = scraper::Html::parse_document(&result.html);
                    all_items.extend(self.extract_price_blocks(&document, url, config));
                    all_items.extend(self.extract_table_prices(&document, url));

                    let normalized: String = result.text.split_whitespace().collect::<Vec<_>>().join(" ");
                    if normalized.len() > 100 {
                        all_items.push(ScrapedItem {
                            selector: "chrome_content".to_string(),
                            text: if normalized.len() > 8000 { truncate_utf8(&normalized, 8000) } else { normalized },
                            context: Some(result.title),
                            source_url: Some(url.to_string()),
                        });
                    }
                }
                Err(e) => tracing::warn!("dump-dom failed for {url}: {e}"),
            }
        }

        Ok(all_items)
    }

    async fn fetch_page_cdp(&self, chrome: &mut Chrome, url: &str, config: &SourceScrapeConfig) -> Result<Vec<ScrapedItem>, String> {
        let page = chrome.get_page(url).await?;
        let document = scraper::Html::parse_fragment(&page.html);

        let mut items = Vec::new();
        items.extend(self.extract_price_blocks(&document, url, config));
        items.extend(self.extract_table_prices(&document, url));

        let normalized: String = page.text.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.len() > 100 {
            items.push(ScrapedItem {
                selector: "chrome_content".to_string(),
                text: if normalized.len() > 8000 {
                    truncate_utf8(&normalized, 8000)
                } else {
                    normalized
                },
                context: Some(page.title),
                source_url: Some(url.to_string()),
            });
        }

        tracing::info!("CDP: {} items from {url}", items.len());
        Ok(items)
    }

    // ───────────────────────────────────────────────────
    //  CONTENT EXTRACTION
    // ───────────────────────────────────────────────────

    fn extract_price_blocks(&self, document: &scraper::Html, url: &str, config: &SourceScrapeConfig) -> Vec<ScrapedItem> {
        let mut items = Vec::new();
        let price_re = Regex::new(r"(\d[\d\s]*\d|\d+)\s*(₽|руб\.?|р\.?|rub)").unwrap();
        let digits_re = Regex::new(r"\d").unwrap();

        for sel_str in &config.price_selectors {
            let Ok(selector) = Selector::parse(sel_str) else {
                continue;
            };

            for element in document.select(&selector) {
                let text = clean_element_text(&element);
                if text.len() < 3 || text.len() > 300 || !digits_re.is_match(&text) {
                    continue;
                }
                if price_re.is_match(&text) || looks_like_price(&text) {
                    items.push(ScrapedItem {
                        selector: sel_str.to_string(),
                        text,
                        context: None,
                        source_url: Some(url.to_string()),
                    });
                }
            }
        }

        items.sort_by(|a, b| a.text.cmp(&b.text));
        items.dedup_by(|a, b| a.text == b.text);
        items
    }

    fn extract_table_prices(&self, document: &scraper::Html, url: &str) -> Vec<ScrapedItem> {
        let mut items = Vec::new();
        let Ok(table_sel) = Selector::parse("table") else { return items };
        let Ok(row_sel) = Selector::parse("tr") else { return items };
        let Ok(cell_sel) = Selector::parse("td, th") else { return items };

        for table in document.select(&table_sel) {
            let mut rows: Vec<Vec<String>> = Vec::new();
            for row in table.select(&row_sel) {
                let cells: Vec<String> = row
                    .select(&cell_sel)
                    .map(|c| clean_element_text(&c))
                    .filter(|t| !t.is_empty())
                    .collect();
                if cells.len() >= 2 {
                    rows.push(cells);
                }
            }

            let has_prices = rows.iter().any(|row| row.iter().any(|cell| looks_like_price(cell)));
            if has_prices && !rows.is_empty() {
                for row in rows.iter().take(50) {
                    items.push(ScrapedItem {
                        selector: "table".to_string(),
                        text: row.join(" | "),
                        context: None,
                        source_url: Some(url.to_string()),
                    });
                }
            }
        }
        items
    }

    fn extract_clean_text(&self, document: &scraper::Html) -> Option<String> {
        let Ok(body_sel) = Selector::parse("body") else { return None };
        let body = document.select(&body_sel).next()?;

        let mut text_parts: Vec<String> = Vec::new();
        collect_clean_text(&body, &mut text_parts);

        let normalized: String = text_parts.join(" ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");

        if normalized.len() > 100 {
            Some(if normalized.len() > 5000 {
                truncate_utf8(&normalized, 5000)
            } else {
                normalized
            })
        } else {
            None
        }
    }

    // ───────────────────────────────────────────────────
    //  PRICE PERSISTENCE WITH HISTORY
    // ───────────────────────────────────────────────────

    pub async fn update_competitor_prices(
        &self,
        competitor_slug: &str,
        prices: &serde_json::Value,
    ) -> Result<(), String> {
        sqlx::query(
            "UPDATE kb_entities SET
               metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('pricing', $2, 'last_checked_at', to_char(NOW(), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')),
               updated_at = NOW()
             WHERE slug = $1 AND entity_type = 'competitor' AND deleted_at IS NULL",
        )
        .bind(competitor_slug)
        .bind(prices)
        .execute(&self.db)
        .await
        .map_err(|e| format!("Failed to update competitor prices: {e}"))?;

        tracing::info!("Updated prices for competitor '{competitor_slug}'");
        Ok(())
    }

    /// Vision-based scraping: screenshot pages → Claude Vision API → structured prices.
    /// Used for sites where prices are in images (e.g., SkyPrint).
    async fn scrape_with_vision(
        &self,
        urls: &[String],
        competitor_slug: &str,
    ) -> Result<ScrapeResult, String> {
        use sha2::{Sha256, Digest};

        let mut chrome = Chrome::launch().await?;
        let mut all_pairs: Vec<PricePair> = Vec::new();
        let mut pages_scraped = 0;

        for url in urls {
            tracing::info!("Vision scrape: taking screenshot of {url}");
            let png_data = match chrome.screenshot(url).await {
                Ok(data) => data,
                Err(e) => {
                    tracing::warn!("Screenshot failed for {url}: {e}");
                    continue;
                }
            };
            pages_scraped += 1;

            // Hash check: skip Vision API if screenshot hasn't changed
            let hash = format!("{:x}", Sha256::digest(&png_data));
            let prev_hash: Option<String> = sqlx::query_scalar(
                "SELECT config->>'last_screenshot_hash' FROM kb_data_sources \
                 WHERE config->>'competitor_slug' = $1 AND is_active = TRUE",
            )
            .bind(competitor_slug)
            .fetch_optional(&self.db)
            .await
            .ok()
            .flatten();

            if prev_hash.as_deref() == Some(hash.as_str()) {
                tracing::info!("Vision scrape: screenshot unchanged for {url}, skipping API call");
                continue;
            }

            // Call Claude Vision API
            match extract_prices_with_vision(&self.client, &png_data).await {
                Ok(pairs) => {
                    tracing::info!("Vision API extracted {} prices from {url}", pairs.len());
                    all_pairs.extend(pairs);
                }
                Err(e) => {
                    tracing::error!("Vision API failed for {url}: {e}");
                    continue;
                }
            }

            // Save new hash
            let _ = sqlx::query(
                "UPDATE kb_data_sources SET config = config || jsonb_build_object('last_screenshot_hash', $1::text) \
                 WHERE config->>'competitor_slug' = $2 AND is_active = TRUE",
            )
            .bind(&hash)
            .bind(competitor_slug)
            .execute(&self.db)
            .await;
        }

        chrome.close().await;

        // Convert PricePairs to ScrapedItems for save_structured_prices compatibility
        let data: Vec<ScrapedItem> = all_pairs
            .iter()
            .map(|p| ScrapedItem {
                selector: "vision".to_string(),
                text: format!("{} - {}", p.service, p.price_text),
                context: Some(format!("category:{}", p.category)),
                source_url: urls.first().map(|u| u.to_string()),
            })
            .collect();

        Ok(ScrapeResult {
            source: competitor_slug.to_string(),
            pages_scraped,
            items_found: data.len(),
            data,
        })
    }

    /// Calculator-based scraping: Chrome CDP clicks options → reads prices.
    /// Used for sites with dynamic pricing calculators (e.g., Яркий).
    async fn scrape_with_calculator(
        &self,
        urls: &[String],
        config: &serde_json::Value,
    ) -> Result<ScrapeResult, String> {
        use super::chrome::CalculatorConfig;

        let calc_config = config
            .get("calculator")
            .and_then(|v| serde_json::from_value::<CalculatorConfig>(v.clone()).ok())
            .unwrap_or_else(|| CalculatorConfig {
                option_selectors: vec![
                    "button[class*=format]".to_string(),
                    "button[class*=size]".to_string(),
                    "[class*=option] button".to_string(),
                ],
                price_selector: "[class*=total], [class*=price], [class*=itogo]".to_string(),
            });

        let mut chrome = Chrome::launch().await?;
        let mut all_items: Vec<ScrapedItem> = Vec::new();
        let max_pages = 10.min(urls.len());

        for url in urls.iter().take(max_pages) {
            tracing::info!("Calculator scrape: {url}");
            match chrome.scrape_calculator(url, &calc_config).await {
                Ok(results) => {
                    for r in results {
                        all_items.push(ScrapedItem {
                            selector: "calculator".to_string(),
                            text: format!("{} - {}", r.option, r.price_text),
                            context: None,
                            source_url: Some(url.to_string()),
                        });
                    }
                    tracing::info!("Calculator: {} prices from {url}", all_items.len());
                }
                Err(e) => {
                    tracing::warn!("Calculator scrape failed for {url}: {e}");
                    // Fallback: try Vision API on this page
                    if let Ok(png) = chrome.screenshot(url).await {
                        if let Ok(pairs) = extract_prices_with_vision(&self.client, &png).await {
                            for p in pairs {
                                all_items.push(ScrapedItem {
                                    selector: "vision_fallback".to_string(),
                                    text: format!("{} - {}", p.service, p.price_text),
                                    context: Some(format!("category:{}", p.category)),
                                    source_url: Some(url.to_string()),
                                });
                            }
                        }
                    }
                }
            }
        }

        chrome.close().await;

        Ok(ScrapeResult {
            source: "calculator".to_string(),
            pages_scraped: max_pages,
            items_found: all_items.len(),
            data: all_items,
        })
    }

    /// Save structured prices with change detection, history tracking, and alert generation.
    pub async fn save_structured_prices(
        &self,
        competitor_slug: &str,
        scraped_items: &[ScrapedItem],
    ) -> Result<usize, String> {
        let competitor_id: Option<uuid::Uuid> = sqlx::query_scalar(
            "SELECT id FROM kb_entities WHERE slug = $1 AND entity_type = 'competitor' AND deleted_at IS NULL",
        )
        .bind(competitor_slug)
        .fetch_optional(&self.db)
        .await
        .map_err(|e| format!("DB error: {e}"))?;

        let Some(competitor_id) = competitor_id else {
            return Err(format!("Competitor '{competitor_slug}' not found"));
        };

        // Build combined text for LLM: full-text content + structured CSS-extracted price snippets
        let content_text: String = scraped_items
            .iter()
            .filter(|item| matches!(item.selector.as_str(), "content" | "chrome_content" | "reqwest_content" | "table"))
            .map(|item| item.text.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");

        // CSS-extracted items as plain text (no selector prefixes — they pollute service names)
        let css_price_snippets: Vec<String> = scraped_items
            .iter()
            .filter(|item| !matches!(item.selector.as_str(), "content" | "chrome_content" | "reqwest_content"))
            .map(|item| item.text.clone())
            .collect();

        let combined_text = if css_price_snippets.is_empty() {
            content_text.clone()
        } else {
            format!(
                "{}\n\n{}", content_text, css_price_snippets.join("\n")
            )
        };

        if combined_text.len() < 50 {
            tracing::info!("Not enough text for LLM extraction for '{competitor_slug}' ({}b)", combined_text.len());
            return Ok(0);
        }

        // Extract prices using regex (LLM extraction disabled — enable after Chrome CDP is stable)
        let pairs = parse_price_pairs(&combined_text);

        if pairs.is_empty() {
            tracing::info!("No prices found for '{competitor_slug}'");
            return Ok(0);
        }

        // Read existing prices for change detection
        let existing: Vec<ExistingPrice> = sqlx::query_as(
            "SELECT service_name, service_category, price_min FROM kb_competitor_prices WHERE competitor_id = $1",
        )
        .bind(competitor_id)
        .fetch_all(&self.db)
        .await
        .map_err(|e| format!("DB error reading existing prices: {e}"))?;

        let existing_map: std::collections::HashMap<String, ExistingPrice> = existing
            .into_iter()
            .map(|p| (p.service_name.clone(), p))
            .collect();

        // Begin transaction for atomicity
        let mut tx = self.db.begin().await.map_err(|e| format!("TX begin error: {e}"))?;

        let mut count = 0usize;
        for pair in &pairs {
            // Detect changes
            let old_price = existing_map
                .get(&pair.service)
                .and_then(|p| p.price_min);

            let change_type = if existing_map.contains_key(&pair.service) {
                if pair.price != old_price { "update" } else { "unchanged" }
            } else {
                "new_service"
            };

            // Upsert price
            let result = sqlx::query(
                "INSERT INTO kb_competitor_prices (competitor_id, service_name, service_category, price_min, price_text, notes, scraped_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (competitor_id, service_name) DO UPDATE SET
                   price_min = EXCLUDED.price_min,
                   price_text = EXCLUDED.price_text,
                   notes = EXCLUDED.notes,
                   service_category = EXCLUDED.service_category,
                   scraped_at = NOW()",
            )
            .bind(competitor_id)
            .bind(&pair.service)
            .bind(&pair.category)
            .bind(pair.price)
            .bind(&pair.price_text)
            .bind(&pair.notes)
            .execute(&mut *tx)
            .await;

            if result.is_ok() {
                count += 1;
            }

            // Record history if changed
            if change_type != "unchanged" {
                let change_pct = match (old_price, pair.price) {
                    (Some(old), Some(new)) if old > 0 => {
                        Some(((new as f64 - old as f64) / old as f64 * 100.0) as f64)
                    }
                    _ => None,
                };

                let _ = sqlx::query(
                    "INSERT INTO kb_price_history (competitor_id, service_name, service_category, old_price, new_price, change_pct, change_type)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)",
                )
                .bind(competitor_id)
                .bind(&pair.service)
                .bind(&pair.category)
                .bind(old_price)
                .bind(pair.price)
                .bind(change_pct)
                .bind(change_type)
                .execute(&mut *tx)
                .await;

                // Generate alert if significant change
                if let (Some(pct), Some(old), Some(new)) = (change_pct, old_price, pair.price) {
                    let abs_delta = (new - old).unsigned_abs() as i32;
                    let min_delta = min_delta_for_category(&pair.category);
                    let abs_pct = pct.abs();

                    let severity = if abs_pct > 20.0 && abs_delta > min_delta {
                        Some("critical")
                    } else if abs_pct > 10.0 && abs_delta > min_delta {
                        Some("warning")
                    } else if abs_pct > 5.0 && abs_delta > min_delta {
                        Some("info")
                    } else {
                        None
                    };

                    if let Some(severity) = severity {
                        let alert_type = if pct > 0.0 { "price_increase" } else { "price_decrease" };
                        let direction = if pct > 0.0 { "повысил" } else { "снизил" };

                        let _ = sqlx::query(
                            "INSERT INTO kb_price_alerts (competitor_id, alert_type, severity, title, description, metadata)
                             VALUES ($1, $2, $3, $4, $5, $6)",
                        )
                        .bind(competitor_id)
                        .bind(alert_type)
                        .bind(severity)
                        .bind(format!("{}: {} {} цену на «{}»", competitor_slug, direction, format!("{:+.0}%", pct), pair.service))
                        .bind(format!("{} ₽ → {} ₽ ({:+.1}%)", old, new, pct))
                        .bind(serde_json::json!({
                            "service_name": pair.service,
                            "category": pair.category,
                            "old_price": old,
                            "new_price": new,
                            "change_pct": pct,
                        }))
                        .execute(&mut *tx)
                        .await;
                    }
                }

                // Alert for new services
                if change_type == "new_service" {
                    let _ = sqlx::query(
                        "INSERT INTO kb_price_alerts (competitor_id, alert_type, severity, title, description, metadata)
                         VALUES ($1, 'new_service', 'info', $2, $3, $4)",
                    )
                    .bind(competitor_id)
                    .bind(format!("{}: новая услуга «{}»", competitor_slug, pair.service))
                    .bind(format!("Цена: {}", pair.price_text))
                    .bind(serde_json::json!({
                        "service_name": pair.service,
                        "category": pair.category,
                        "price": pair.price,
                    }))
                    .execute(&mut *tx)
                    .await;
                }
            }
        }

        tx.commit().await.map_err(|e| format!("TX commit error: {e}"))?;

        tracing::info!("Saved {count} structured prices for '{competitor_slug}'");
        Ok(count)
    }
}

// ═══════════════════════════════════════════════════════
//  HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════

/// Extract structured prices from text using Claude API
async fn extract_prices_with_llm(client: &Client, text: &str) -> Result<Vec<PricePair>, String> {
    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .map_err(|_| "ANTHROPIC_API_KEY not set".to_string())?;

    let truncated = if text.len() > 12000 {
        truncate_utf8(text, 12000)
    } else {
        text.to_string()
    };

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 2048,
        "messages": [{
            "role": "user",
            "content": format!(
                "Извлеки ВСЕ услуги и цены из текста сайта фотостудии/копицентра. \
                 Верни ТОЛЬКО JSON массив, без markdown, без пояснений.\n\n\
                 Формат: [{{\"service\": \"название услуги\", \"price\": число_в_рублях_или_null, \
                 \"price_text\": \"как написано на сайте\", \"category\": \"одна из: \
                 photo_documents, portrait, photo_children, photosession, retouch, restoration, \
                 print, copy, polygraphy, print_large, souvenirs, other\"}}]\n\n\
                 Правила:\n\
                 - service: короткое понятное название (2-6 слов)\n\
                 - price: минимальная цена числом, null если не указана\n\
                 - Включай ВСЕ услуги, даже без цены\n\
                 - Не выдумывай цены, бери только из текста\n\
                 - Элементы с CSS-селекторами (в квадратных скобках) — приоритетные данные о ценах\n\n\
                 Текст сайта:\n{truncated}")
        }]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude API error: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Claude API {status}: {body}"));
    }

    let resp_json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Claude response parse error: {e}"))?;

    let text_content = resp_json["content"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|block| block["text"].as_str())
        .ok_or_else(|| "No text in Claude response".to_string())?;

    let json_str = text_content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let items: Vec<LlmPriceItem> = serde_json::from_str(json_str)
        .map_err(|e| format!("JSON parse error: {e} — raw: {}", &json_str[..200.min(json_str.len())]))?;

    let pairs = items
        .into_iter()
        .filter(|item| !item.service.is_empty() && item.service.len() <= 80)
        .map(|item| PricePair {
            service: item.service,
            category: item.category,
            price: item.price,
            price_text: item.price_text,
            notes: None,
        })
        .collect();

    Ok(pairs)
}

#[derive(Debug, serde::Deserialize)]
struct LlmPriceItem {
    service: String,
    #[serde(default)]
    price: Option<i32>,
    #[serde(default)]
    price_text: String,
    #[serde(default)]
    category: String,
}

/// Extract prices from a screenshot image using Claude Vision API.
/// Returns structured price pairs from the image.
async fn extract_prices_with_vision(client: &Client, png_data: &[u8]) -> Result<Vec<PricePair>, String> {
    use base64::Engine;

    let api_key = std::env::var("ANTHROPIC_API_KEY")
        .map_err(|_| "ANTHROPIC_API_KEY not set".to_string())?;

    let b64 = base64::engine::general_purpose::STANDARD.encode(png_data);

    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 4096,
        "messages": [{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": b64
                    }
                },
                {
                    "type": "text",
                    "text": "Извлеки ВСЕ услуги и цены из этого прайс-листа фотостудии/копицентра. \
                     Верни ТОЛЬКО JSON массив, без markdown, без пояснений.\n\n\
                     Формат: [{\"service\": \"название услуги\", \"price\": число_в_рублях_или_null, \
                     \"price_text\": \"как написано на сайте\", \"category\": \"одна из: \
                     photo_documents, portrait, photo_children, photosession, retouch, restoration, \
                     print, copy, polygraphy, print_large, souvenirs, other\"}]\n\n\
                     Правила:\n\
                     - service: короткое понятное название (2-6 слов)\n\
                     - price: минимальная цена числом, null если не указана\n\
                     - Не выдумывай цены, бери только из изображения\n\
                     - Включай ВСЕ видимые услуги с ценами"
                }
            ]
        }]
    });

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Claude Vision API error: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Claude Vision API {status}: {body}"));
    }

    let resp_json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Claude Vision response parse error: {e}"))?;

    let text_content = resp_json["content"]
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|block| block["text"].as_str())
        .ok_or_else(|| "No text in Claude Vision response".to_string())?;

    let json_str = text_content
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    let items: Vec<LlmPriceItem> = serde_json::from_str(json_str)
        .map_err(|e| format!("Vision JSON parse error: {e} — raw: {}", &json_str[..200.min(json_str.len())]))?;

    let pairs = items
        .into_iter()
        .filter(|item| !item.service.is_empty() && item.service.len() <= 80)
        .map(|item| PricePair {
            service: item.service,
            category: item.category,
            price: item.price,
            price_text: item.price_text,
            notes: None,
        })
        .collect();

    Ok(pairs)
}

#[derive(Debug, sqlx::FromRow)]
struct ExistingPrice {
    service_name: String,
    #[allow(dead_code)]
    service_category: String,
    price_min: Option<i32>,
}

fn extract_origin(url: &str) -> String {
    if let Some(pos) = url.find("://") {
        let after = &url[pos + 3..];
        if let Some(slash) = after.find('/') {
            url[..pos + 3 + slash].to_string()
        } else {
            url.to_string()
        }
    } else {
        url.to_string()
    }
}

fn extract_internal_links(html: &str, origin: &str) -> Vec<String> {
    let document = scraper::Html::parse_fragment(html);
    let Ok(a_sel) = Selector::parse("a[href]") else {
        return Vec::new();
    };

    let mut links = Vec::new();
    let origin_lower = origin.to_lowercase();

    for element in document.select(&a_sel) {
        let Some(href) = element.value().attr("href") else {
            continue;
        };

        let href = href.trim();
        if href.is_empty() || href.starts_with('#') || href.starts_with("javascript:") || href.starts_with("mailto:") || href.starts_with("tel:") {
            continue;
        }

        let full_url = if href.starts_with("http") {
            if href.to_lowercase().starts_with(&origin_lower) {
                href.to_string()
            } else {
                continue;
            }
        } else if href.starts_with("//") {
            let scheme = if origin.starts_with("https") { "https:" } else { "http:" };
            format!("{scheme}{href}")
        } else if href.starts_with('/') {
            format!("{origin}{href}")
        } else {
            format!("{origin}/{href}")
        };

        let clean = full_url.split('#').next().unwrap_or(&full_url).to_string();
        if is_useful_page(&clean) {
            links.push(clean);
        }
    }

    links.sort();
    links.dedup();
    links
}

fn is_useful_page(url: &str) -> bool {
    let lower = url.to_lowercase();
    let skip_ext = [
        ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx",
        ".zip", ".rar", ".tar", ".gz",
        ".mp3", ".mp4", ".avi", ".mov",
        ".css", ".js", ".json", ".xml",
        ".woff", ".woff2", ".ttf", ".eot",
    ];
    !skip_ext.iter().any(|ext| lower.ends_with(ext))
        && !lower.contains("/wp-admin")
        && !lower.contains("/wp-json")
        && !lower.contains("/feed")
        && !lower.contains("/rss")
        && !lower.contains("?replytocom")
        && !lower.contains("/tag/")
        && !lower.contains("/author/")
}

fn normalize_url(url: &str) -> String {
    let url = url.split('#').next().unwrap_or(url);
    let url = url.split('?').next().unwrap_or(url);
    url.trim_end_matches('/').to_lowercase()
}

fn collect_clean_text(element: &scraper::ElementRef, parts: &mut Vec<String>) {
    for child in element.children() {
        if let Some(el) = scraper::ElementRef::wrap(child) {
            let tag = el.value().name();
            if matches!(tag, "script" | "style" | "noscript" | "svg" | "iframe") {
                continue;
            }
            collect_clean_text(&el, parts);
        } else if let Some(text_node) = child.value().as_text() {
            let trimmed = text_node.trim();
            if !trimmed.is_empty() {
                parts.push(trimmed.to_string());
            }
        }
    }
}

fn clean_element_text(element: &scraper::ElementRef) -> String {
    let mut parts = Vec::new();
    collect_clean_text(element, &mut parts);
    parts.join(" ").trim().to_string()
}

fn looks_like_price(text: &str) -> bool {
    let price_patterns = ["₽", "руб", "р.", "rub", "цена", "стоимость", "от "];
    let has_currency = price_patterns.iter().any(|p| text.to_lowercase().contains(p));
    let has_digits = text.chars().any(|c| c.is_ascii_digit());
    has_currency && has_digits
}

/// Pre-filter scraped items to remove garbage before regex extraction.
fn filter_scraped_items(items: &mut Vec<ScrapedItem>) {
    let currency_re = Regex::new(r"\d[\d\s]*(₽|руб\.?|р\.)").unwrap();
    items.retain(|item| {
        // Always keep full-text content items (for future LLM)
        if matches!(item.selector.as_str(), "content" | "chrome_content" | "reqwest_content") {
            return true;
        }
        // Always keep table items (they have pipe-separated service|price)
        if item.selector == "table" {
            return true;
        }
        let text = item.text.trim();
        // Length bounds: 10-200 chars
        if text.len() < 10 || text.len() > 200 {
            return false;
        }
        // Must contain digit + currency marker
        if !currency_re.is_match(text) && !looks_like_price(text) {
            return false;
        }
        // Marketing/investment junk
        let lower = text.to_lowercase();
        if lower.contains("проинвестировал")
            || lower.contains("000 000")
            || lower.contains("млн")
            || lower.contains("млрд")
        {
            return false;
        }
        true
    });
}

// ═══════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════

#[derive(Debug, serde::Serialize)]
pub struct ScrapeResult {
    pub source: String,
    pub pages_scraped: usize,
    pub items_found: usize,
    pub data: Vec<ScrapedItem>,
}

#[derive(Debug, serde::Serialize)]
pub struct ScrapedItem {
    pub selector: String,
    pub text: String,
    pub context: Option<String>,
    pub source_url: Option<String>,
}

#[derive(Debug, sqlx::FromRow)]
struct SourceConfig {
    slug: String,
    config: serde_json::Value,
}

/// Per-source scrape configuration parsed from kb_data_sources.config JSON.
struct SourceScrapeConfig {
    price_selectors: Vec<String>,
    exclude_zones: Vec<String>,
}

impl SourceScrapeConfig {
    fn from_json(config: &serde_json::Value) -> Self {
        let css = config.get("css_selectors");
        Self {
            price_selectors: css
                .and_then(|c| c.get("price_blocks"))
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_else(Self::defaults),
            exclude_zones: css
                .and_then(|c| c.get("exclude_zones"))
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        }
    }

    fn defaults() -> Vec<String> {
        [".price", ".cost", ".amount",
         "[class*=price]", "[class*=cost]",
         ".service-item", ".price-item", ".price-row",
         ".catalog-item", ".product-item",
         ".t-card__title", ".t-card__descr",
         ".t396__elem", ".t-text"]
            .iter().map(|s| s.to_string()).collect()
    }
}

// ═══════════════════════════════════════════════════════
//  PRICE PARSING (regex fallback)
// ═══════════════════════════════════════════════════════

#[derive(Debug)]
struct PricePair {
    service: String,
    category: String,
    price: Option<i32>,
    price_text: String,
    notes: Option<String>,
}

/// Strip CSS selector prefixes like "[.t-card__descr] " from text lines
fn strip_css_selectors(text: &str) -> String {
    let re = Regex::new(r"(?m)^\[[\.\#\w\-\*\[\]=\s]+\]\s*").unwrap();
    re.replace_all(text, "").to_string()
}

fn parse_price_pairs(text: &str) -> Vec<PricePair> {
    let text = &strip_css_selectors(text);
    let mut pairs = Vec::new();

    // Pattern 1: "Service name - 1500₽"
    let re_dash = Regex::new(r"(?m)^(.{3,60}?)\s*[-–—]\s*((?:от\s+)?\d[\d\s]*)\s*(₽|руб\.?|р\.)").unwrap();
    for cap in re_dash.captures_iter(text) {
        let service = cap[1].trim().to_string();
        let price_raw = cap[2].replace(' ', "");
        let price_text = format!("{} ₽", &cap[2].trim());
        if let Ok(price) = price_raw.replace("от", "").trim().parse::<i32>() {
            if price > 0 && price < 100_000 && !is_junk_service(&service) {
                pairs.push(PricePair {
                    category: guess_category(&service),
                    service: normalize_service_name(&service),
                    price: Some(price),
                    price_text,
                    notes: None,
                });
            }
        }
    }

    // Pattern 2: Price on its own line
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    let re_price_line = Regex::new(r"^((?:от\s+)?[\+]?\d[\d\s]*)\s*(₽|руб\.?|р\.?)$").unwrap();

    for i in 1..lines.len() {
        if let Some(cap) = re_price_line.captures(lines[i]) {
            let price_raw = cap[1].replace(' ', "");
            let price_text = lines[i].to_string();

            let mut service_name: Option<&str> = None;
            for back in 1..=5.min(i) {
                let candidate = lines[i - back];
                if candidate.len() >= 3
                    && candidate.len() <= 60
                    && !re_price_line.is_match(candidate)
                    && !is_junk_service(candidate)
                    && !candidate.contains(". ")
                    && candidate.split_whitespace().count() <= 8
                {
                    service_name = Some(candidate);
                    break;
                }
            }

            if let Some(service) = service_name {
                let price_num = price_raw.replace("от", "").replace('+', "").trim().parse::<i32>().ok();
                if price_num.map_or(true, |p| p > 0 && p < 100_000) {
                    let normalized = normalize_service_name(service);
                    if !pairs.iter().any(|p| p.service == normalized) {
                        pairs.push(PricePair {
                            category: guess_category(service),
                            service: normalized,
                            price: price_num,
                            price_text,
                            notes: None,
                        });
                    }
                }
            }
        }
    }

    // Pattern 3: "Печать 10x15 см 36 ₽"
    let re_inline = Regex::new(r"(\d+[xх×]\d+\s*(?:см|mm)?)\s*(\d+)\s*(₽|руб\.?|р\.)").unwrap();
    for cap in re_inline.captures_iter(text) {
        let service = format!("Печать {}", &cap[1]);
        let price: i32 = cap[2].parse().unwrap_or(0);
        let price_text = format!("{} ₽", price);
        if price > 0 && price < 100_000 {
            let normalized = normalize_service_name(&service);
            if !pairs.iter().any(|p| p.service == normalized) {
                pairs.push(PricePair {
                    category: "print".to_string(),
                    service: normalized,
                    price: Some(price),
                    price_text,
                    notes: None,
                });
            }
        }
    }

    // Pattern 4: "Service | 1500 ₽" (table pipes)
    let re_pipe = Regex::new(r"(.{3,60}?)\s*\|\s*((?:от\s+)?\d[\d\s]*)\s*(₽|руб\.?|р\.)").unwrap();
    for cap in re_pipe.captures_iter(text) {
        let service = cap[1].trim().to_string();
        let price_raw = cap[2].replace(' ', "");
        let price_text = format!("{} ₽", &cap[2].trim());
        if let Ok(price) = price_raw.replace("от", "").trim().parse::<i32>() {
            if price > 0 && price < 100_000 && !is_junk_service(&service) {
                let normalized = normalize_service_name(&service);
                if !pairs.iter().any(|p| p.service == normalized) {
                    pairs.push(PricePair {
                        category: guess_category(&service),
                        service: normalized,
                        price: Some(price),
                        price_text,
                        notes: None,
                    });
                }
            }
        }
    }

    // Deduplicate
    let mut unique = Vec::new();
    let mut seen = HashSet::new();
    for pair in pairs {
        if seen.insert(pair.service.clone()) {
            unique.push(pair);
        }
    }

    unique
}

fn normalize_service_name(name: &str) -> String {
    name.trim()
        .trim_start_matches(['•', '·', '-', '–', '—', '✓', '✔', '*', '►', '▸', '→'])
        .trim()
        .to_string()
}

fn is_junk_service(name: &str) -> bool {
    let lower = name.to_lowercase();
    let trimmed = name.trim();

    // Too short or too long
    if trimmed.len() < 3 || trimmed.len() > 80 {
        return true;
    }

    // Table fragments from markdown import
    if trimmed.starts_with('|') {
        return true;
    }
    // CSS selector prefixes from scraper
    if trimmed.starts_with("[.") {
        return true;
    }
    // Markdown bold fragments
    if trimmed.starts_with("**") {
        return true;
    }

    // Purely numeric or just "от NNNN"
    let no_spaces: String = trimmed.chars().filter(|c| !c.is_whitespace()).collect();
    if no_spaces.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    if Regex::new(r"^от\s*\d+$").unwrap().is_match(trimmed) {
        return true;
    }

    // Contains price markers — it's a price, not a service name
    if Regex::new(r"\d+\s*(₽|руб|р\.)\s*(₽|руб|р\.|\d)").unwrap().is_match(trimmed) {
        return true;
    }
    // Starts with price: "1400 ₽ ₽", "79 ₽ 200 ₽"
    if Regex::new(r"^\d[\d\s]*(₽|руб|р\.)").unwrap().is_match(trimmed) {
        return true;
    }

    // Marketing/investment text
    if lower.contains("проинвестировал")
        || lower.contains("инвестиц")
        || lower.contains("000 000")
        || lower.contains("млн")
        || lower.contains("млрд")
    {
        return true;
    }

    // Navigation, UI, legal junk
    lower.contains("cookie")
        || lower.contains("все услуги")
        || lower.contains("подробнее")
        || lower.contains("записаться")
        || lower.contains("узнать больше")
        || lower.contains("написать")
        || lower.contains("заказать")
        || lower.contains("купить")
        || lower.contains("whatsapp")
        || lower.contains("telegram")
        || lower.contains("instagram")
        || lower.contains("vkontakte")
        || lower.contains("facebook")
        || lower.contains("http")
        || lower.contains("www.")
        || lower.contains("@")
        || lower.contains("политик")
        || lower.contains("согласи")
        || lower.contains("copyright")
        || lower.contains("©")
        || lower.contains("все права")
        || lower.contains("реквизит")
        || lower.contains("оферт")
        || lower.contains("конфиденциальн")
        || lower.contains("пн-")
        || lower.contains("пн–")
        || lower.contains("вс ")
        || lower.contains("ежедневно")
        || lower.contains("режим работы")
        || lower.contains("карта сайта")
        || lower.contains("перезвон")
        || lower.contains("обратный звонок")
}

fn guess_category(service: &str) -> String {
    let lower = service.to_lowercase();
    if lower.contains("фото на документ") || lower.contains("паспорт") || lower.contains("виз")
        || lower.contains("3x4") || lower.contains("3х4") || lower.contains("документ") {
        "photo_documents".to_string()
    } else if lower.contains("портрет") || lower.contains("бизнес") || lower.contains("деловой") {
        "portrait".to_string()
    } else if lower.contains("детск") || lower.contains("малыш") || lower.contains("ребён") {
        "photo_children".to_string()
    } else if lower.contains("фотосесс") || lower.contains("студийн") || lower.contains("предметн") {
        "photosession".to_string()
    } else if lower.contains("ретушь") || lower.contains("замена одежд") || lower.contains("обработк")
        || lower.contains("коррекц") || lower.contains("военн") {
        "retouch".to_string()
    } else if lower.contains("реставрац") || lower.contains("восстановлен") {
        "restoration".to_string()
    } else if lower.contains("печать") || lower.contains("x1") || lower.contains("х1")
        || lower.contains("полароид") || lower.contains("фотопечат") {
        "print".to_string()
    } else if lower.contains("ксерокоп") || lower.contains("сканир") || lower.contains("ламинир") {
        "copy".to_string()
    } else if lower.contains("визитк") || lower.contains("полиграф") || lower.contains("календар")
        || lower.contains("плоттер") || lower.contains("листовк") {
        "polygraphy".to_string()
    } else if lower.contains("холст") || lower.contains("широкоформат") || lower.contains("пенокартон")
        || lower.contains("баннер") || lower.contains("постер") {
        "print_large".to_string()
    } else if lower.contains("сувенир") || lower.contains("кружк") || lower.contains("магнит")
        || lower.contains("футболк") || lower.contains("подушк") {
        "souvenirs".to_string()
    } else {
        "other".to_string()
    }
}

fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s[..end].to_string()
}
