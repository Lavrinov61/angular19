use axum::{extract::State, Json};

use crate::error::Result;
use crate::models::graph::{
    CategoryCoverage, DashboardData, RecentChange, TypeCount,
};
use crate::AppState;

/// GET /api/kb/dashboard — aggregated KB overview for CRM dashboard widget
pub async fn dashboard(State(state): State<AppState>) -> Result<Json<DashboardData>> {
    // Run all aggregation queries in parallel using tokio::join!
    let (
        total_entities,
        entities_by_type,
        entities_by_status,
        unverified_count,
        enrichment_pending,
        enrichment_failed,
        relation_count,
        category_coverage,
        recent_changes,
    ) = tokio::join!(
        // Total active entities
        async {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM kb_entities WHERE deleted_at IS NULL",
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
        },
        // By entity type
        async {
            sqlx::query_as::<_, TypeCount>(
                "SELECT entity_type AS type_name, count(*) AS count
                 FROM kb_entities WHERE deleted_at IS NULL
                 GROUP BY entity_type ORDER BY count DESC",
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
        },
        // By status
        async {
            sqlx::query_as::<_, TypeCount>(
                "SELECT status AS type_name, count(*) AS count
                 FROM kb_entities WHERE deleted_at IS NULL
                 GROUP BY status ORDER BY count DESC",
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
        },
        // Unverified count
        async {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM kb_entities
                 WHERE is_verified = FALSE AND status IN ('active', 'review') AND deleted_at IS NULL",
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
        },
        // Enrichment pending
        async {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM kb_enrichment_tasks WHERE status = 'pending'",
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
        },
        // Enrichment failed
        async {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM kb_enrichment_tasks WHERE status = 'failed'",
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
        },
        // Total relations
        async {
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM kb_relations r
                 JOIN kb_entities f ON f.id = r.from_entity_id AND f.deleted_at IS NULL",
            )
            .fetch_one(&state.db)
            .await
            .unwrap_or(0)
        },
        // Category coverage (root categories with aggregated child entity counts)
        async {
            sqlx::query_as::<_, CategoryCoverage>(
                "SELECT p.slug, p.name, p.path,
                        COALESCE(SUM(c.entity_count), 0)::INT AS entity_count
                 FROM kb_categories p
                 LEFT JOIN kb_categories c ON c.parent_id = p.id AND c.is_active = TRUE
                 WHERE p.is_active = TRUE AND p.depth = 0
                 GROUP BY p.id, p.slug, p.name, p.path, p.sort_order
                 ORDER BY p.sort_order",
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
        },
        // Recent changes (last 20)
        async {
            sqlx::query_as::<_, RecentChange>(
                "SELECT v.entity_id, e.name AS entity_name, e.entity_type,
                        v.change_type, v.created_at AS changed_at,
                        COALESCE(u.first_name || ' ' || u.last_name, 'System') AS changed_by_name
                 FROM kb_entity_versions v
                 JOIN kb_entities e ON e.id = v.entity_id
                 LEFT JOIN users u ON u.id = v.changed_by
                 ORDER BY v.created_at DESC
                 LIMIT 20",
            )
            .fetch_all(&state.db)
            .await
            .unwrap_or_default()
        },
    );

    Ok(Json(DashboardData {
        total_entities,
        entities_by_type,
        entities_by_status,
        unverified_count,
        enrichment_pending,
        enrichment_failed,
        relation_count,
        category_coverage,
        recent_changes,
    }))
}
