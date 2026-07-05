use axum::{
    extract::{Path, State},
    Json,
};
use uuid::Uuid;

use crate::error::{AppError, Result};
use crate::models::access::{AccessRule, CreateAccessRule, UpdateAccessRule};
use crate::AppState;

/// GET /api/kb/access — list all access rules
pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<AccessRule>>> {
    let rules = sqlx::query_as::<_, AccessRule>(
        "SELECT * FROM kb_access_rules
         ORDER BY role, category_slug NULLS FIRST, entity_type NULLS FIRST",
    )
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rules))
}

/// GET /api/kb/access/role/:role — rules for a specific role
pub async fn by_role(
    State(state): State<AppState>,
    Path(role): Path<String>,
) -> Result<Json<Vec<AccessRule>>> {
    let rules = sqlx::query_as::<_, AccessRule>(
        "SELECT * FROM kb_access_rules WHERE role = $1
         ORDER BY category_slug NULLS FIRST, entity_type NULLS FIRST",
    )
    .bind(&role)
    .fetch_all(&state.db)
    .await?;

    Ok(Json(rules))
}

/// POST /api/kb/access — create an access rule
pub async fn create(
    State(state): State<AppState>,
    Json(body): Json<CreateAccessRule>,
) -> Result<Json<AccessRule>> {
    // Validate role
    let valid_roles = [
        "admin",
        "manager",
        "photographer",
        "employee",
        "ai_agent",
        "public_api",
    ];
    if !valid_roles.contains(&body.role.as_str()) {
        return Err(AppError::bad_request(format!(
            "Invalid role '{}'. Valid: {:?}",
            body.role, valid_roles
        )));
    }

    // Validate category slug exists if provided
    if let Some(ref cat_slug) = body.category_slug {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM kb_categories WHERE slug = $1)",
        )
        .bind(cat_slug)
        .fetch_one(&state.db)
        .await?;

        if !exists {
            return Err(AppError::bad_request(format!(
                "Category '{cat_slug}' not found"
            )));
        }
    }

    let rule = sqlx::query_as::<_, AccessRule>(
        "INSERT INTO kb_access_rules (
           role, category_slug, entity_type,
           can_read, can_create, can_update, can_delete, can_verify, can_export
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (role, category_slug, entity_type) DO UPDATE SET
           can_read = EXCLUDED.can_read,
           can_create = EXCLUDED.can_create,
           can_update = EXCLUDED.can_update,
           can_delete = EXCLUDED.can_delete,
           can_verify = EXCLUDED.can_verify,
           can_export = EXCLUDED.can_export
         RETURNING *",
    )
    .bind(&body.role)
    .bind(&body.category_slug)
    .bind(&body.entity_type)
    .bind(body.can_read.unwrap_or(true))
    .bind(body.can_create.unwrap_or(false))
    .bind(body.can_update.unwrap_or(false))
    .bind(body.can_delete.unwrap_or(false))
    .bind(body.can_verify.unwrap_or(false))
    .bind(body.can_export.unwrap_or(false))
    .fetch_one(&state.db)
    .await?;

    Ok(Json(rule))
}

/// PATCH /api/kb/access/:id — update an access rule
pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<UpdateAccessRule>,
) -> Result<Json<AccessRule>> {
    let rule = sqlx::query_as::<_, AccessRule>(
        "UPDATE kb_access_rules SET
           can_read = COALESCE($2, can_read),
           can_create = COALESCE($3, can_create),
           can_update = COALESCE($4, can_update),
           can_delete = COALESCE($5, can_delete),
           can_verify = COALESCE($6, can_verify),
           can_export = COALESCE($7, can_export)
         WHERE id = $1
         RETURNING *",
    )
    .bind(id)
    .bind(body.can_read)
    .bind(body.can_create)
    .bind(body.can_update)
    .bind(body.can_delete)
    .bind(body.can_verify)
    .bind(body.can_export)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::not_found("Access rule not found"))?;

    Ok(Json(rule))
}

/// DELETE /api/kb/access/:id — delete an access rule
pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>> {
    let rows = sqlx::query("DELETE FROM kb_access_rules WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?
        .rows_affected();

    if rows == 0 {
        return Err(AppError::not_found("Access rule not found"));
    }

    Ok(Json(serde_json::json!({ "deleted": true })))
}

/// GET /api/kb/access/check — check effective permissions for a role on a resource
pub async fn check_permissions(
    State(state): State<AppState>,
    axum::extract::Query(q): axum::extract::Query<CheckPermissionsQuery>,
) -> Result<Json<serde_json::Value>> {
    let rules = sqlx::query_as::<_, AccessRule>(
        "SELECT * FROM kb_access_rules
         WHERE role = $1
           AND (category_slug IS NULL OR category_slug = $2)
           AND (entity_type IS NULL OR entity_type = $3)
         ORDER BY
           CASE WHEN category_slug IS NOT NULL AND entity_type IS NOT NULL THEN 1
                WHEN category_slug IS NOT NULL THEN 2
                WHEN entity_type IS NOT NULL THEN 3
                ELSE 4
           END
         LIMIT 1",
    )
    .bind(&q.role)
    .bind(&q.category_slug)
    .bind(&q.entity_type)
    .fetch_all(&state.db)
    .await?;

    let effective = if let Some(rule) = rules.first() {
        let scope = if rule.category_slug.is_some() && rule.entity_type.is_some() {
            "specific"
        } else if rule.category_slug.is_some() || rule.entity_type.is_some() {
            "partial"
        } else {
            "global"
        };

        serde_json::json!({
            "role": q.role,
            "category_slug": q.category_slug,
            "entity_type": q.entity_type,
            "can_read": rule.can_read,
            "can_create": rule.can_create,
            "can_update": rule.can_update,
            "can_delete": rule.can_delete,
            "can_verify": rule.can_verify,
            "can_export": rule.can_export,
            "rule_id": rule.id,
            "rule_scope": scope
        })
    } else {
        serde_json::json!({
            "role": q.role,
            "category_slug": q.category_slug,
            "entity_type": q.entity_type,
            "can_read": false,
            "can_create": false,
            "can_update": false,
            "can_delete": false,
            "can_verify": false,
            "can_export": false,
            "rule_id": null,
            "rule_scope": "no_match"
        })
    };

    Ok(Json(effective))
}

#[derive(Debug, serde::Deserialize)]
pub struct CheckPermissionsQuery {
    pub role: String,
    pub category_slug: Option<String>,
    pub entity_type: Option<String>,
}
