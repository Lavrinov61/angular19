use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct ServiceCatalogRow {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub category: String,
    pub required_device_type: Option<String>,
    pub requires_template: bool,
    pub requires_design_editor: bool,
    pub base_price: f64,
    pub price_per_unit: f64,
    pub price_rules: serde_json::Value,
    pub default_print_profile_id: Option<Uuid>,
    pub is_active: bool,
    pub sort_order: i32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateServiceCatalogDto {
    pub slug: String,
    pub name: String,
    pub category: String,
    pub required_device_type: Option<String>,
    pub requires_template: Option<bool>,
    pub requires_design_editor: Option<bool>,
    pub base_price: Option<f64>,
    pub price_per_unit: Option<f64>,
    pub price_rules: Option<serde_json::Value>,
    pub default_print_profile_id: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateServiceCatalogDto {
    pub name: Option<String>,
    pub category: Option<String>,
    pub required_device_type: Option<Option<String>>,
    pub requires_template: Option<bool>,
    pub requires_design_editor: Option<bool>,
    pub base_price: Option<f64>,
    pub price_per_unit: Option<f64>,
    pub price_rules: Option<serde_json::Value>,
    pub default_print_profile_id: Option<Option<String>>,
    pub is_active: Option<bool>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct ServiceCatalogQuery {
    pub category: Option<String>,
}
