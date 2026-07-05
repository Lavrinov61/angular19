use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Full graph node for visualization
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct GraphNode {
    pub id: Uuid,
    pub name: String,
    pub entity_type: String,
    pub slug: String,
    pub status: String,
    pub outgoing_relations: Option<serde_json::Value>,
    pub incoming_relations: Option<serde_json::Value>,
}

/// Edge in the knowledge graph
#[derive(Debug, Clone, Serialize)]
pub struct GraphEdge {
    pub id: Uuid,
    pub source: Uuid,
    pub target: Uuid,
    pub relation_type: String,
    pub label: Option<String>,
    pub weight: f64,
    pub bidirectional: bool,
}

/// N-hop neighbor traversal result
#[derive(Debug, Clone, Serialize)]
pub struct NeighborNode {
    pub id: Uuid,
    pub name: String,
    pub entity_type: String,
    pub slug: String,
    pub depth: i32,
    pub path: Vec<String>,
    pub relation_type: String,
}

/// Graph traversal query parameters
#[derive(Debug, Deserialize)]
pub struct GraphTraversalQuery {
    /// Max depth for traversal (default: 2, max: 5)
    pub max_depth: Option<i32>,
    /// Filter by relation type
    pub relation_type: Option<String>,
    /// Filter by entity type
    pub entity_type: Option<String>,
    /// Include bidirectional edges as incoming
    pub include_bidirectional: Option<bool>,
}

/// Full graph response for visualization
#[derive(Debug, Serialize)]
pub struct FullGraph {
    pub nodes: Vec<FullGraphNode>,
    pub edges: Vec<FullGraphEdge>,
    pub stats: GraphStats,
}

#[derive(Debug, Serialize, FromRow)]
pub struct FullGraphNode {
    pub id: Uuid,
    pub name: String,
    pub entity_type: String,
    pub slug: String,
    pub category_path: String,
    pub relation_count: i64,
}

#[derive(Debug, Serialize)]
pub struct FullGraphEdge {
    pub id: Uuid,
    pub source: Uuid,
    pub target: Uuid,
    pub relation_type: String,
    pub label: Option<String>,
    pub weight: f64,
    pub bidirectional: bool,
}

#[derive(Debug, Serialize)]
pub struct GraphStats {
    pub node_count: i64,
    pub edge_count: i64,
    pub entity_types: Vec<TypeCount>,
    pub relation_types: Vec<TypeCount>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct TypeCount {
    pub type_name: String,
    pub count: i64,
}

/// Price comparison result from kb_price_comparison()
#[derive(Debug, Clone, Serialize, FromRow)]
pub struct PriceComparison {
    pub service_name: String,
    pub our_price: Option<sqlx::types::BigDecimal>,
    pub competitor_name: String,
    pub competitor_price: Option<sqlx::types::BigDecimal>,
    pub price_diff_percent: Option<sqlx::types::BigDecimal>,
}

/// Dashboard aggregation
#[derive(Debug, Serialize)]
pub struct DashboardData {
    pub total_entities: i64,
    pub entities_by_type: Vec<TypeCount>,
    pub entities_by_status: Vec<TypeCount>,
    pub unverified_count: i64,
    pub enrichment_pending: i64,
    pub enrichment_failed: i64,
    pub relation_count: i64,
    pub category_coverage: Vec<CategoryCoverage>,
    pub recent_changes: Vec<RecentChange>,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct CategoryCoverage {
    pub slug: String,
    pub name: String,
    pub entity_count: i32,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct RecentChange {
    pub entity_id: Uuid,
    pub entity_name: String,
    pub entity_type: String,
    pub change_type: String,
    pub changed_at: chrono::DateTime<chrono::Utc>,
    pub changed_by_name: Option<String>,
}
