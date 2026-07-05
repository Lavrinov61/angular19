use axum::{
    extract::{Request, State},
    middleware::Next,
    response::Response,
};

use crate::error::AppError;
use crate::middleware::auth::Claims;
use crate::models::access::{AccessRule, Permission, ResolvedPermissions};
use crate::AppState;

/// RBAC middleware — resolves permissions from kb_access_rules for the current user's role.
///
/// Algorithm:
/// 1. Extract user role from JWT Claims (set by auth middleware)
/// 2. Query kb_access_rules for matching rules (role + optional category/entity_type)
/// 3. Merge rules with OR logic (most permissive wins)
/// 4. Store ResolvedPermissions in request extensions
///
/// Rules resolution order (most specific first):
/// - role + category_slug + entity_type (exact match)
/// - role + category_slug + NULL entity_type (category-wide)
/// - role + NULL category_slug + entity_type (type-wide)
/// - role + NULL + NULL (global fallback)
pub async fn resolve_permissions(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let role = req
        .extensions()
        .get::<Claims>()
        .map(|c| c.role.clone())
        .unwrap_or_else(|| "public_api".to_string());

    let rules = sqlx::query_as::<_, AccessRule>(
        "SELECT * FROM kb_access_rules WHERE role = $1 ORDER BY
           CASE WHEN category_slug IS NOT NULL AND entity_type IS NOT NULL THEN 1
                WHEN category_slug IS NOT NULL THEN 2
                WHEN entity_type IS NOT NULL THEN 3
                ELSE 4
           END",
    )
    .bind(&role)
    .fetch_all(&state.db)
    .await?;

    let mut perms = ResolvedPermissions::default();
    for rule in &rules {
        perms.merge(rule);
    }

    // Store both resolved permissions and raw rules for per-entity checks
    req.extensions_mut().insert(perms);
    req.extensions_mut().insert(RoleRules { role, rules });

    Ok(next.run(req).await)
}

/// Stored in request extensions for per-entity permission checks
#[derive(Clone)]
pub struct RoleRules {
    pub role: String,
    pub rules: Vec<AccessRule>,
}

impl RoleRules {
    /// Check permission for a specific category and entity type.
    /// Finds the most specific matching rule.
    pub fn check_permission(
        &self,
        permission: Permission,
        category_slug: Option<&str>,
        entity_type: Option<&str>,
    ) -> bool {
        // Try most specific first
        let candidates: Vec<&AccessRule> = self
            .rules
            .iter()
            .filter(|r| {
                let cat_match = match (&r.category_slug, category_slug) {
                    (None, _) => true, // wildcard rule
                    (Some(rc), Some(c)) => rc == c || c.starts_with(&format!("{rc}/")),
                    (Some(_), None) => false,
                };
                let type_match = match (&r.entity_type, entity_type) {
                    (None, _) => true,
                    (Some(rt), Some(t)) => rt == t,
                    (Some(_), None) => false,
                };
                cat_match && type_match
            })
            .collect();

        // Most specific rule wins — check specificity score
        if let Some(best) = candidates.iter().max_by_key(|r| {
            let mut score = 0;
            if r.category_slug.is_some() {
                score += 2;
            }
            if r.entity_type.is_some() {
                score += 1;
            }
            score
        }) {
            permission.check(&ResolvedPermissions {
                can_read: best.can_read,
                can_create: best.can_create,
                can_update: best.can_update,
                can_delete: best.can_delete,
                can_verify: best.can_verify,
                can_export: best.can_export,
            })
        } else {
            false
        }
    }
}

/// Guard: require a specific permission or return 403
pub fn require_permission(
    req: &Request,
    permission: Permission,
    category_slug: Option<&str>,
    entity_type: Option<&str>,
) -> Result<(), AppError> {
    let rules = req
        .extensions()
        .get::<RoleRules>()
        .ok_or(AppError::Unauthorized)?;

    if rules.check_permission(permission, category_slug, entity_type) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Convenience: extract resolved permissions from request
pub fn get_permissions(req: &Request) -> ResolvedPermissions {
    req.extensions()
        .get::<ResolvedPermissions>()
        .cloned()
        .unwrap_or_default()
}

/// Convenience: extract user role from request
pub fn get_role(req: &Request) -> String {
    req.extensions()
        .get::<Claims>()
        .map(|c| c.role.clone())
        .unwrap_or_else(|| "public_api".to_string())
}
