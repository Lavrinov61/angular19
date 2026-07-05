use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct AccessRule {
    pub id: Uuid,
    pub role: String,
    pub category_slug: Option<String>,
    pub entity_type: Option<String>,
    pub can_read: bool,
    pub can_create: bool,
    pub can_update: bool,
    pub can_delete: bool,
    pub can_verify: bool,
    pub can_export: bool,
    pub metadata: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAccessRule {
    pub role: String,
    pub category_slug: Option<String>,
    pub entity_type: Option<String>,
    pub can_read: Option<bool>,
    pub can_create: Option<bool>,
    pub can_update: Option<bool>,
    pub can_delete: Option<bool>,
    pub can_verify: Option<bool>,
    pub can_export: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateAccessRule {
    pub can_read: Option<bool>,
    pub can_create: Option<bool>,
    pub can_update: Option<bool>,
    pub can_delete: Option<bool>,
    pub can_verify: Option<bool>,
    pub can_export: Option<bool>,
}

/// Permission check result — resolved from kb_access_rules
#[derive(Debug, Clone, Default)]
pub struct ResolvedPermissions {
    pub can_read: bool,
    pub can_create: bool,
    pub can_update: bool,
    pub can_delete: bool,
    pub can_verify: bool,
    pub can_export: bool,
}

impl ResolvedPermissions {
    /// Merge multiple rules: most permissive wins (OR logic)
    pub fn merge(&mut self, rule: &AccessRule) {
        self.can_read = self.can_read || rule.can_read;
        self.can_create = self.can_create || rule.can_create;
        self.can_update = self.can_update || rule.can_update;
        self.can_delete = self.can_delete || rule.can_delete;
        self.can_verify = self.can_verify || rule.can_verify;
        self.can_export = self.can_export || rule.can_export;
    }
}

/// KB permission types for RBAC checks
#[derive(Debug, Clone, Copy)]
pub enum Permission {
    Read,
    Create,
    Update,
    Delete,
    Verify,
    Export,
}

impl Permission {
    pub fn check(&self, perms: &ResolvedPermissions) -> bool {
        match self {
            Self::Read => perms.can_read,
            Self::Create => perms.can_create,
            Self::Update => perms.can_update,
            Self::Delete => perms.can_delete,
            Self::Verify => perms.can_verify,
            Self::Export => perms.can_export,
        }
    }
}
