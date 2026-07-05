use crate::error::{AppError, Result};
use sqlx::PgPool;
use uuid::Uuid;

/// Voyage AI embedding service.
///
/// Uses Voyage AI's `voyage-3` model (recommended by Anthropic) to generate
/// 1024-dimensional embeddings for semantic search.
///
/// API: POST https://api.voyageai.com/v1/embeddings
/// Docs: https://docs.voyageai.com/reference/embeddings-api
///
/// Rate limit: 300 RPM, 1M tokens/min (voyage-3)
/// Max input: 32K tokens per text
#[derive(Clone)]
pub struct EmbeddingService {
    client: reqwest::Client,
    api_key: String,
    model: String,
    dimensions: usize,
}

impl EmbeddingService {
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            model: "voyage-3".to_string(),
            dimensions: 1024,
        }
    }

    pub fn with_model(mut self, model: String, dimensions: usize) -> Self {
        self.model = model;
        self.dimensions = dimensions;
        self
    }

    /// Generate embedding for a single text
    pub async fn embed_text(&self, text: &str) -> Result<Vec<f32>> {
        let response = self
            .client
            .post("https://api.voyageai.com/v1/embeddings")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&serde_json::json!({
                "model": self.model,
                "input": [text],
                "input_type": "document",
                "output_dimension": self.dimensions,
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Voyage AI request failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "Voyage AI returned {status}: {body}"
            )));
        }

        let body: VoyageResponse = response
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to parse Voyage AI response: {e}")))?;

        body.data
            .into_iter()
            .next()
            .map(|d| d.embedding)
            .ok_or_else(|| AppError::Internal("Voyage AI returned empty response".into()))
    }

    /// Generate embeddings for multiple texts (batch)
    /// Voyage AI supports up to 128 texts per batch
    pub async fn embed_batch(&self, texts: &[&str]) -> Result<Vec<Vec<f32>>> {
        if texts.is_empty() {
            return Ok(Vec::new());
        }

        // Voyage AI limit: 128 texts per batch
        let mut all_embeddings = Vec::new();

        for chunk in texts.chunks(128) {
            let response = self
                .client
                .post("https://api.voyageai.com/v1/embeddings")
                .header("Authorization", format!("Bearer {}", self.api_key))
                .json(&serde_json::json!({
                    "model": self.model,
                    "input": chunk,
                    "input_type": "document",
                    "output_dimension": self.dimensions,
                }))
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Voyage AI batch failed: {e}")))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Internal(format!(
                    "Voyage AI batch returned {status}: {body}"
                )));
            }

            let body: VoyageResponse = response.json().await.map_err(|e| {
                AppError::Internal(format!("Failed to parse batch response: {e}"))
            })?;

            for item in body.data {
                all_embeddings.push(item.embedding);
            }
        }

        Ok(all_embeddings)
    }

    /// Generate embedding for a query (uses query input_type for better retrieval)
    pub async fn embed_query(&self, query: &str) -> Result<Vec<f32>> {
        let response = self
            .client
            .post("https://api.voyageai.com/v1/embeddings")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .json(&serde_json::json!({
                "model": self.model,
                "input": [query],
                "input_type": "query",
                "output_dimension": self.dimensions,
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Voyage AI query embed failed: {e}")))?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AppError::Internal(format!(
                "Voyage AI returned {status}: {body}"
            )));
        }

        let body: VoyageResponse = response.json().await.map_err(|e| {
            AppError::Internal(format!("Failed to parse query embed response: {e}"))
        })?;

        body.data
            .into_iter()
            .next()
            .map(|d| d.embedding)
            .ok_or_else(|| AppError::Internal("Empty response".into()))
    }

    /// Embed an entity and store the vector in the database
    pub async fn embed_entity(&self, db: &PgPool, entity_id: Uuid) -> Result<()> {
        // Fetch entity text
        let row: Option<(String, Option<String>, Option<String>, Vec<String>)> =
            sqlx::query_as(
                "SELECT name, summary, content, tags FROM kb_entities WHERE id = $1 AND deleted_at IS NULL",
            )
            .bind(entity_id)
            .fetch_optional(db)
            .await?;

        let Some((name, summary, content, tags)) = row else {
            return Err(AppError::not_found("Entity not found"));
        };

        // Compose text for embedding: name + summary + tags + content (truncated)
        let text = compose_embedding_text(&name, summary.as_deref(), content.as_deref(), &tags);

        let embedding = self.embed_text(&text).await?;

        // Store as pgvector
        let vector_str = format!(
            "[{}]",
            embedding
                .iter()
                .map(|f| f.to_string())
                .collect::<Vec<_>>()
                .join(",")
        );

        sqlx::query("UPDATE kb_entities SET embedding = $2::vector WHERE id = $1")
            .bind(entity_id)
            .bind(&vector_str)
            .execute(db)
            .await?;

        tracing::info!("Embedded entity {entity_id} ({} dimensions)", embedding.len());
        Ok(())
    }

    /// Batch embed all entities that don't have embeddings yet
    pub async fn embed_all_missing(&self, db: &PgPool, batch_size: i64) -> Result<usize> {
        let rows: Vec<(Uuid, String, Option<String>, Option<String>, Vec<String>)> =
            sqlx::query_as(
                "SELECT id, name, summary, content, tags FROM kb_entities
                 WHERE embedding IS NULL AND deleted_at IS NULL AND status = 'active'
                 LIMIT $1",
            )
            .bind(batch_size)
            .fetch_all(db)
            .await?;

        if rows.is_empty() {
            return Ok(0);
        }

        let texts: Vec<String> = rows
            .iter()
            .map(|(_, name, summary, content, tags)| {
                compose_embedding_text(name, summary.as_deref(), content.as_deref(), tags)
            })
            .collect();

        let text_refs: Vec<&str> = texts.iter().map(String::as_str).collect();
        let embeddings = self.embed_batch(&text_refs).await?;

        for (i, (id, _, _, _, _)) in rows.iter().enumerate() {
            if let Some(embedding) = embeddings.get(i) {
                let vector_str = format!(
                    "[{}]",
                    embedding
                        .iter()
                        .map(|f| f.to_string())
                        .collect::<Vec<_>>()
                        .join(",")
                );

                sqlx::query("UPDATE kb_entities SET embedding = $2::vector WHERE id = $1")
                    .bind(id)
                    .bind(&vector_str)
                    .execute(db)
                    .await?;
            }
        }

        let count = rows.len();
        tracing::info!("Batch embedded {count} entities");
        Ok(count)
    }
}

/// Compose text for embedding from entity fields
fn compose_embedding_text(
    name: &str,
    summary: Option<&str>,
    content: Option<&str>,
    tags: &[String],
) -> String {
    let mut parts = vec![name.to_string()];

    if let Some(s) = summary {
        parts.push(s.to_string());
    }

    if !tags.is_empty() {
        parts.push(tags.join(", "));
    }

    if let Some(c) = content {
        // Truncate content to ~4000 chars to stay within token limits
        let truncated = if c.len() > 4000 {
            &c[..4000]
        } else {
            c
        };
        parts.push(truncated.to_string());
    }

    parts.join("\n\n")
}

// Voyage AI response types
#[derive(Debug, serde::Deserialize)]
struct VoyageResponse {
    data: Vec<VoyageEmbedding>,
}

#[derive(Debug, serde::Deserialize)]
struct VoyageEmbedding {
    embedding: Vec<f32>,
}
