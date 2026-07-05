use axum::{
    extract::{Path, Query, State},
    Json,
};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::models::graph::{
    FullGraph, FullGraphEdge, FullGraphNode, GraphStats, GraphTraversalQuery,
    NeighborNode, PriceComparison, TypeCount,
};
use crate::AppState;

/// GET /api/kb/graph — full knowledge graph for visualization
pub async fn full_graph(State(state): State<AppState>) -> Result<Json<FullGraph>> {
    // Nodes: all active entities with category and relation count
    let nodes = sqlx::query_as::<_, FullGraphNode>(
        "SELECT e.id, e.name, e.entity_type, e.slug, c.path AS category_path,
                (SELECT count(*) FROM kb_relations r
                 WHERE r.from_entity_id = e.id OR r.to_entity_id = e.id) AS relation_count
         FROM kb_entities e
         JOIN kb_categories c ON c.id = e.category_id
         WHERE e.deleted_at IS NULL AND e.status = 'active'
         ORDER BY e.entity_type, e.name",
    )
    .fetch_all(&state.db)
    .await?;

    // Edges: all relations
    let edge_rows = sqlx::query_as::<_, EdgeRow>(
        "SELECT r.id, r.from_entity_id AS source, r.to_entity_id AS target,
                r.relation_type, r.label, r.weight, r.bidirectional
         FROM kb_relations r
         JOIN kb_entities f ON f.id = r.from_entity_id AND f.deleted_at IS NULL
         JOIN kb_entities t ON t.id = r.to_entity_id AND t.deleted_at IS NULL
         ORDER BY r.relation_type",
    )
    .fetch_all(&state.db)
    .await?;

    let edges: Vec<FullGraphEdge> = edge_rows
        .into_iter()
        .map(|r| FullGraphEdge {
            id: r.id,
            source: r.source,
            target: r.target,
            relation_type: r.relation_type,
            label: r.label,
            weight: bigdecimal_to_f64(&r.weight),
            bidirectional: r.bidirectional,
        })
        .collect();

    // Stats
    let entity_types = sqlx::query_as::<_, TypeCount>(
        "SELECT entity_type AS type_name, count(*) AS count
         FROM kb_entities WHERE deleted_at IS NULL AND status = 'active'
         GROUP BY entity_type ORDER BY count DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let relation_types = sqlx::query_as::<_, TypeCount>(
        "SELECT relation_type AS type_name, count(*) AS count
         FROM kb_relations r
         JOIN kb_entities f ON f.id = r.from_entity_id AND f.deleted_at IS NULL
         GROUP BY relation_type ORDER BY count DESC",
    )
    .fetch_all(&state.db)
    .await?;

    let stats = GraphStats {
        node_count: nodes.len() as i64,
        edge_count: edges.len() as i64,
        entity_types,
        relation_types,
    };

    Ok(Json(FullGraph {
        nodes,
        edges,
        stats,
    }))
}

/// GET /api/kb/graph/neighbors/:id — N-hop neighborhood traversal
pub async fn neighbors(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Query(q): Query<GraphTraversalQuery>,
) -> Result<Json<Vec<NeighborNode>>> {
    let max_depth = q.max_depth.unwrap_or(2).min(5).max(1);
    let include_bidi = q.include_bidirectional.unwrap_or(true);

    // Recursive CTE for N-hop traversal
    let neighbors = sqlx::query_as::<_, NeighborRow>(
        "WITH RECURSIVE graph_walk AS (
           -- Base: direct neighbors of the starting node
           SELECT
             r.to_entity_id AS id,
             e.name, e.entity_type, e.slug,
             1 AS depth,
             ARRAY[r.relation_type] AS path,
             r.relation_type
           FROM kb_relations r
           JOIN kb_entities e ON e.id = r.to_entity_id AND e.deleted_at IS NULL
           WHERE r.from_entity_id = $1
             AND ($3::text IS NULL OR r.relation_type = $3)
             AND ($4::text IS NULL OR e.entity_type = $4)

           UNION ALL

           -- Also include bidirectional reverse edges if requested
           SELECT
             r.from_entity_id AS id,
             e.name, e.entity_type, e.slug,
             1 AS depth,
             ARRAY[r.relation_type] AS path,
             r.relation_type
           FROM kb_relations r
           JOIN kb_entities e ON e.id = r.from_entity_id AND e.deleted_at IS NULL
           WHERE r.to_entity_id = $1
             AND ($5::bool IS TRUE OR r.bidirectional = TRUE)
             AND ($3::text IS NULL OR r.relation_type = $3)
             AND ($4::text IS NULL OR e.entity_type = $4)

           UNION ALL

           -- Recursive step
           SELECT
             r.to_entity_id AS id,
             e.name, e.entity_type, e.slug,
             gw.depth + 1,
             gw.path || r.relation_type,
             r.relation_type
           FROM graph_walk gw
           JOIN kb_relations r ON r.from_entity_id = gw.id
           JOIN kb_entities e ON e.id = r.to_entity_id AND e.deleted_at IS NULL
           WHERE gw.depth < $2
             AND r.to_entity_id != $1  -- avoid cycles back to start
             AND ($3::text IS NULL OR r.relation_type = $3)
             AND ($4::text IS NULL OR e.entity_type = $4)
         )
         SELECT DISTINCT ON (id) id, name, entity_type, slug, depth, path, relation_type
         FROM graph_walk
         ORDER BY id, depth ASC
         LIMIT 200",
    )
    .bind(id)
    .bind(max_depth)
    .bind(&q.relation_type)
    .bind(&q.entity_type)
    .bind(include_bidi)
    .fetch_all(&state.db)
    .await?;

    let result: Vec<NeighborNode> = neighbors
        .into_iter()
        .map(|n| NeighborNode {
            id: n.id,
            name: n.name,
            entity_type: n.entity_type,
            slug: n.slug,
            depth: n.depth,
            path: n.path,
            relation_type: n.relation_type,
        })
        .collect();

    Ok(Json(result))
}

/// GET /api/kb/price-comparison — compare prices with competitors
pub async fn price_comparison(
    State(state): State<AppState>,
    Query(q): Query<PriceComparisonQuery>,
) -> Result<Json<Vec<PriceComparison>>> {
    let results = sqlx::query_as::<_, PriceComparison>(
        "SELECT * FROM kb_price_comparison($1)",
    )
    .bind(&q.service_slug)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(results))
}

#[derive(Debug, serde::Deserialize)]
pub struct PriceComparisonQuery {
    pub service_slug: Option<String>,
}

// Internal row types for sqlx mapping
#[derive(Debug, sqlx::FromRow)]
struct EdgeRow {
    id: Uuid,
    source: Uuid,
    target: Uuid,
    relation_type: String,
    label: Option<String>,
    weight: sqlx::types::BigDecimal,
    bidirectional: bool,
}

#[derive(Debug, sqlx::FromRow)]
struct NeighborRow {
    id: Uuid,
    name: String,
    entity_type: String,
    slug: String,
    depth: i32,
    path: Vec<String>,
    relation_type: String,
}

fn bigdecimal_to_f64(bd: &sqlx::types::BigDecimal) -> f64 {
    use std::str::FromStr;
    f64::from_str(&bd.to_string()).unwrap_or(0.0)
}
