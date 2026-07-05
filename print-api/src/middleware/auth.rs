use axum::{
    extract::{Request, State},
    http::header::AUTHORIZATION,
    middleware::Next,
    response::Response,
};
use jsonwebtoken::{DecodingKey, Validation, decode};
use serde::{Deserialize, Serialize};

use axum::extract::FromRequestParts;

use crate::AppState;
use crate::error::AppError;

/// JWT claims — shared with Express (userId, email, role).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    #[serde(alias = "sub", alias = "userId")]
    pub user_id: String,
    #[serde(default)]
    pub email: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
    /// Studio assignment (resolved from active POS shift after auth).
    #[serde(default)]
    pub studio_id: Option<String>,
}

/// Static permission map — mirrors backend/src/config/permissions.ts.
const ADMIN_PERMS: &[&str] = &[
    "inbox:view",
    "inbox:manage",
    "chat:reply",
    "chat:assign",
    "tasks:manage",
    "pos:use",
    "catalog:manage",
    "subscriptions:manage",
    "analytics:view",
    "shifts:manage",
    "reports:view",
    "clients:view",
    "team:chat",
    "bookings:manage",
    "settings:manage",
    "workflows:manage",
    "partners:manage",
    "users:manage",
    "production:manage",
    "pricing:manage",
    "pricing:read",
    "infra:manage",
];

const MANAGER_PERMS: &[&str] = &[
    "inbox:view",
    "inbox:manage",
    "chat:reply",
    "chat:assign",
    "tasks:manage",
    "pos:use",
    "catalog:manage",
    "subscriptions:manage",
    "analytics:view",
    "shifts:manage",
    "reports:view",
    "clients:view",
    "team:chat",
    "bookings:manage",
    "workflows:manage",
    "partners:manage",
    "production:manage",
    "pricing:manage",
    "pricing:read",
];

const EMPLOYEE_PERMS: &[&str] = &[
    "inbox:view",
    "inbox:manage",
    "chat:reply",
    "chat:assign",
    "tasks:manage",
    "pos:use",
    "team:chat",
    "bookings:manage",
    "production:manage",
    "pricing:read",
    "clients:view",
];

const PHOTOGRAPHER_PERMS: &[&str] = &[
    "inbox:view",
    "chat:reply",
    "tasks:manage",
    "team:chat",
    "bookings:manage",
    "clients:view",
];

pub fn has_permission(role: &str, permission: &str) -> bool {
    let perms: &[&str] = match role {
        "admin" => ADMIN_PERMS,
        "manager" => MANAGER_PERMS,
        "employee" => EMPLOYEE_PERMS,
        "photographer" => PHOTOGRAPHER_PERMS,
        _ => &[],
    };
    perms.contains(&permission)
}

/// Require valid JWT. Resolves studio_id from DB.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let token = req
        .headers()
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .ok_or(AppError::Unauthorized)?;

    let key = DecodingKey::from_secret(state.config.jwt_secret.as_bytes());
    let mut validation = Validation::default();
    validation.validate_exp = true;

    let mut claims = decode::<Claims>(token, &key, &validation)
        .map_err(|_| AppError::Unauthorized)?
        .claims;

    // Resolve studio_id: open POS shift → today's employee shift → most recent shift
    if claims.studio_id.is_none()
        && let Ok(user_uuid) = uuid::Uuid::parse_str(&claims.user_id)
    {
        let studio: Option<uuid::Uuid> = sqlx::query_scalar(
            r#"SELECT studio_id FROM (
                     SELECT studio_id, 1 AS priority FROM pos_shifts
                       WHERE employee_id = $1 AND status = 'open'
                       ORDER BY opened_at DESC LIMIT 1
                   UNION ALL
                     SELECT studio_id, 2 AS priority FROM employee_shifts
                       WHERE employee_id = $1
                       ORDER BY shift_date DESC LIMIT 1
                   ) sub ORDER BY priority LIMIT 1"#,
        )
        .bind(user_uuid)
        .fetch_optional(&state.db)
        .await
        .unwrap_or(None);

        if let Some(sid) = studio {
            claims.studio_id = Some(sid.to_string());
        }
    }

    req.extensions_mut().insert(claims);
    Ok(next.run(req).await)
}

/// Middleware factory: require specific permission based on role.
pub async fn require_pos_use(
    State(_state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let claims = req
        .extensions()
        .get::<Claims>()
        .ok_or(AppError::Unauthorized)?;

    if !has_permission(&claims.role, "pos:use") {
        return Err(AppError::forbidden("Недостаточно прав (pos:use)"));
    }

    Ok(next.run(req).await)
}

#[allow(dead_code)]
pub async fn require_catalog_manage(
    State(_state): State<AppState>,
    req: Request,
    next: Next,
) -> Result<Response, AppError> {
    let claims = req
        .extensions()
        .get::<Claims>()
        .ok_or(AppError::Unauthorized)?;

    if !has_permission(&claims.role, "catalog:manage") {
        return Err(AppError::forbidden("Недостаточно прав (catalog:manage)"));
    }

    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn admin_has_infra_manage() {
        assert!(has_permission("admin", "infra:manage"));
    }

    #[test]
    fn manager_does_not_have_infra_manage() {
        assert!(!has_permission("manager", "infra:manage"));
    }

    #[test]
    fn employee_has_pos_use() {
        assert!(has_permission("employee", "pos:use"));
    }

    #[test]
    fn photographer_does_not_have_pos_use() {
        assert!(!has_permission("photographer", "pos:use"));
    }
}

/// Custom extractor: extract Claims from request extensions (set by require_auth middleware).
impl FromRequestParts<AppState> for Claims {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<Claims>()
            .cloned()
            .ok_or(AppError::Unauthorized)
    }
}
