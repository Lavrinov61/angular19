use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub category: Option<String>,
    pub entity_type: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct SemanticQuery {
    pub q: String,
    pub category: Option<String>,
    pub entity_type: Option<String>,
    pub limit: Option<i32>,
    /// Similarity threshold (0-1, default: 0.7)
    pub threshold: Option<f64>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SearchResult {
    pub id: Uuid,
    pub entity_type: String,
    pub slug: String,
    pub name: String,
    pub summary: Option<String>,
    pub category_path: String,
    pub tags: Vec<String>,
    pub confidence: sqlx::types::BigDecimal,
    pub is_verified: bool,
    pub rank: f32,
    pub headline: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct FuzzyResult {
    pub id: Uuid,
    pub entity_type: String,
    pub slug: String,
    pub name: String,
    pub summary: Option<String>,
    pub similarity: f64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct SemanticResult {
    pub id: Uuid,
    pub entity_type: String,
    pub slug: String,
    pub name: String,
    pub summary: Option<String>,
    pub category_path: String,
    pub similarity: f32,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CombinedResult {
    pub id: Uuid,
    pub entity_type: String,
    pub slug: String,
    pub name: String,
    pub summary: Option<String>,
    pub category_path: String,
    pub search_method: String,
    pub score: f32,
}
