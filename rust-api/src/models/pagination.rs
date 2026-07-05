use serde::{Deserialize, Serialize};

/// Cursor-based pagination parameters
#[derive(Debug, Deserialize)]
pub struct PaginationParams {
    /// Cursor for next page (base64-encoded UUID or timestamp)
    pub cursor: Option<String>,
    /// Page size (default: 50, max: 200)
    pub limit: Option<i64>,
    /// Sort field
    pub sort_by: Option<String>,
    /// Sort direction
    pub sort_dir: Option<SortDirection>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    #[default]
    Desc,
}

impl SortDirection {
    pub fn as_sql(&self) -> &str {
        match self {
            Self::Asc => "ASC",
            Self::Desc => "DESC",
        }
    }
}

impl PaginationParams {
    pub fn effective_limit(&self) -> i64 {
        self.limit.unwrap_or(50).min(200).max(1)
    }

    pub fn decode_cursor(&self) -> Option<CursorValue> {
        self.cursor.as_ref().and_then(|c| {
            use base64::Engine;
            let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .decode(c)
                .ok()?;
            let s = String::from_utf8(bytes).ok()?;
            serde_json::from_str(&s).ok()
        })
    }
}

/// Decoded cursor value — supports UUID or timestamp-based cursors
#[derive(Debug, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CursorValue {
    Timestamp { ts: String, id: String },
    Id { id: String },
}

/// Paginated response wrapper
#[derive(Debug, Serialize)]
pub struct PaginatedResponse<T: Serialize> {
    pub data: Vec<T>,
    pub pagination: PaginationMeta,
}

#[derive(Debug, Serialize)]
pub struct PaginationMeta {
    pub total: i64,
    pub limit: i64,
    pub has_more: bool,
    pub next_cursor: Option<String>,
}

impl PaginationMeta {
    pub fn new(total: i64, limit: i64, items_returned: usize) -> Self {
        Self {
            total,
            limit,
            has_more: items_returned as i64 >= limit,
            next_cursor: None,
        }
    }

    pub fn with_cursor(mut self, cursor: Option<String>) -> Self {
        self.next_cursor = cursor;
        self
    }

    pub fn encode_cursor(ts: &str, id: &str) -> String {
        use base64::Engine;
        let json = serde_json::json!({ "ts": ts, "id": id });
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json.to_string().as_bytes())
    }
}
