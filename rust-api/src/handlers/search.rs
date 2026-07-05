use axum::{extract::State, Json};

use crate::error::Result;
use crate::models::search::{
    CombinedResult, FuzzyResult, SearchQuery, SearchResult, SemanticQuery, SemanticResult,
};
use crate::AppState;

/// POST /api/kb/search — combined FTS + fuzzy
pub async fn search(
    State(state): State<AppState>,
    Json(body): Json<SearchQuery>,
) -> Result<Json<SearchResponse>> {
    let limit = body.limit.unwrap_or(20).min(100);

    let results = sqlx::query_as::<_, SearchResult>(
        "SELECT * FROM kb_search_text($1, $2, $3, 'active', $4, $5)",
    )
    .bind(&body.q)
    .bind(&body.category)
    .bind(&body.entity_type)
    .bind(limit)
    .bind(body.offset.unwrap_or(0))
    .fetch_all(&state.db)
    .await?;

    // Get total count for pagination
    let total = sqlx::query_scalar::<_, i64>(
        "SELECT count(*) FROM kb_entities e
         JOIN kb_categories c ON c.id = e.category_id
         WHERE e.search_vector @@ websearch_to_tsquery('russian', $1)
           AND e.deleted_at IS NULL AND e.status = 'active'
           AND ($2::text IS NULL OR c.path LIKE $2 || '%')
           AND ($3::text IS NULL OR e.entity_type = $3)",
    )
    .bind(&body.q)
    .bind(&body.category)
    .bind(&body.entity_type)
    .fetch_one(&state.db)
    .await
    .unwrap_or(0);

    Ok(Json(SearchResponse {
        results,
        total,
        query: body.q,
        method: "fts".into(),
    }))
}

/// POST /api/kb/search/suggest — fuzzy autocomplete
pub async fn suggest(
    State(state): State<AppState>,
    Json(body): Json<SearchQuery>,
) -> Result<Json<Vec<FuzzyResult>>> {
    let limit = body.limit.unwrap_or(10).min(20);

    let results = sqlx::query_as::<_, FuzzyResult>(
        "SELECT * FROM kb_search_fuzzy($1, 0.25, $2)",
    )
    .bind(&body.q)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(results))
}

/// POST /api/kb/search/semantic — vector similarity search
///
/// Requires VOYAGE_API_KEY to be configured for query embedding.
/// If not available, falls back to combined FTS+fuzzy search.
pub async fn semantic(
    State(state): State<AppState>,
    Json(body): Json<SemanticQuery>,
) -> Result<Json<SemanticSearchResponse>> {
    let limit = body.limit.unwrap_or(20).min(100);
    let threshold = body.threshold.unwrap_or(0.7);

    // Check if embedding service is available
    let voyage_key = std::env::var("VOYAGE_API_KEY").ok();

    if let Some(api_key) = voyage_key {
        // Generate query embedding
        let embedding_service =
            crate::services::embedding::EmbeddingService::new(api_key);

        let query_embedding = embedding_service
            .embed_query(&body.q)
            .await
            .map_err(|e| crate::error::AppError::Internal(format!("Embedding failed: {e}")))?;

        // Format as pgvector string
        let vector_str = format!(
            "[{}]",
            query_embedding
                .iter()
                .map(|f| f.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );

        let results = sqlx::query_as::<_, SemanticResult>(
            "SELECT * FROM kb_search_semantic($1::vector, $2, $3, $4, $5)",
        )
        .bind(&vector_str)
        .bind(threshold)
        .bind(&body.category)
        .bind(&body.entity_type)
        .bind(limit)
        .fetch_all(&state.db)
        .await?;

        Ok(Json(SemanticSearchResponse {
            results,
            query: body.q,
            method: "semantic".into(),
            model: "voyage-3".into(),
            threshold,
        }))
    } else {
        // Fallback: use combined search
        let results = sqlx::query_as::<_, SemanticResult>(
            "SELECT id, entity_type, slug, name, summary, category_path, similarity
             FROM (
               SELECT id, entity_type, slug, name, summary, category_path,
                      score AS similarity
               FROM kb_search_combined($1, $2, $3, $4)
             ) sub",
        )
        .bind(&body.q)
        .bind(&body.category)
        .bind(&body.entity_type)
        .bind(limit)
        .fetch_all(&state.db)
        .await?;

        Ok(Json(SemanticSearchResponse {
            results,
            query: body.q,
            method: "combined_fallback".into(),
            model: "none".into(),
            threshold,
        }))
    }
}

/// POST /api/kb/search/combined — FTS + fuzzy with deduplication
pub async fn combined(
    State(state): State<AppState>,
    Json(body): Json<SearchQuery>,
) -> Result<Json<CombinedSearchResponse>> {
    let limit = body.limit.unwrap_or(20).min(100);

    let results = sqlx::query_as::<_, CombinedResult>(
        "SELECT * FROM kb_search_combined($1, $2, $3, $4)",
    )
    .bind(&body.q)
    .bind(&body.category)
    .bind(&body.entity_type)
    .bind(limit)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(CombinedSearchResponse {
        results,
        query: body.q,
        method: "combined".into(),
    }))
}

// Response wrappers with metadata

#[derive(Debug, serde::Serialize)]
pub struct SearchResponse {
    pub results: Vec<SearchResult>,
    pub total: i64,
    pub query: String,
    pub method: String,
}

#[derive(Debug, serde::Serialize)]
pub struct SemanticSearchResponse {
    pub results: Vec<SemanticResult>,
    pub query: String,
    pub method: String,
    pub model: String,
    pub threshold: f64,
}

#[derive(Debug, serde::Serialize)]
pub struct CombinedSearchResponse {
    pub results: Vec<CombinedResult>,
    pub query: String,
    pub method: String,
}
