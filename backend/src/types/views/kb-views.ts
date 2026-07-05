import type {
  KbAccessRuleMetadataJsonb,
  KbConfigValueJsonb,
  KbDataSourceConfigJsonb,
  KbEntityMetadataJsonb,
  KbMetricDashboardConfigJsonb,
  KbMetricDimensionsJsonb,
  KbMetricThresholdJsonb,
  KbTaskPayloadJsonb,
  KbTaskResultJsonb,
} from '../jsonb/kb-jsonb.js';

export interface KbCountRow {
  count: string | number;
}

export interface KbCategoryRow {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  metadata: KbEntityMetadataJsonb;
  is_active: boolean;
  entity_count: number;
  depth: number;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface KbEntityRow {
  id: string;
  category_id: string;
  entity_type: string;
  slug: string;
  status: string;
  visibility: string;
  name: string;
  summary: string | null;
  content: string | null;
  metadata: KbEntityMetadataJsonb;
  tags: string[];
  source_type: string;
  source_ref: string | null;
  confidence: string | number;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbEntitySummaryRow {
  id: string;
  entity_type: string;
  slug: string;
  status: string;
  name: string;
  summary: string | null;
  tags: string[];
  confidence: string | number;
  is_verified: boolean;
  category_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface KbSearchTextRow {
  id: string;
  entity_type: string;
  slug: string;
  name: string;
  summary: string | null;
  category_path: string;
  tags: string[];
  confidence: string | number;
  is_verified: boolean;
  rank: number;
  headline: string;
}

export interface KbSearchCombinedRow {
  id: string;
  entity_type: string;
  slug: string;
  name: string;
  summary: string | null;
  category_path: string;
  search_method: string;
  score: number;
}

export interface KbFuzzySearchRow {
  id: string;
  entity_type: string;
  slug: string;
  name: string;
  summary: string | null;
  similarity: string | number;
}

export interface KbRelationExpandedRow {
  id: string;
  relation_type: string;
  label: string | null;
  weight: string | number;
  bidirectional: boolean;
  from_id: string;
  from_name: string;
  from_type: string;
  to_id: string;
  to_name: string;
  to_type: string;
}

export interface KbEntityVersionRow {
  id: string;
  entity_id: string;
  version: number;
  name: string;
  change_type: string;
  change_reason: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface KbEnrichmentTaskRow {
  id: string;
  entity_id: string | null;
  task_type: string;
  status: string;
  priority: number;
  payload: KbTaskPayloadJsonb;
  result: KbTaskResultJsonb | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  entity_name: string | null;
  entity_type: string | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface KbDataSourceRow {
  id: string;
  slug: string;
  name: string;
  source_type: string;
  config: KbDataSourceConfigJsonb;
  sync_schedule: string | null;
  last_synced_at: string | null;
  sync_status: string | null;
  sync_error: string | null;
  entity_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KbAccessRuleRow {
  id: string;
  role: string;
  category_slug: string | null;
  entity_type: string | null;
  can_read: boolean;
  can_create: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_verify: boolean;
  can_export: boolean;
  metadata: KbAccessRuleMetadataJsonb;
  created_at: string;
}

export interface KbConfigRow {
  key: string;
  value: KbConfigValueJsonb;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface KbMetricDefinitionRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  unit: string;
  aggregation: string;
  category: string;
  is_cumulative: boolean;
  alert_threshold: KbMetricThresholdJsonb | null;
  dashboard_config: KbMetricDashboardConfigJsonb | null;
  is_active: boolean;
  created_at: string;
}

export interface KbMetricPointRow {
  period_start: string;
  period_end: string;
  metric_value: string | number;
  dimensions: KbMetricDimensionsJsonb;
}

export interface KbPriceComparisonRow {
  service_name: string;
  our_price: string | number | null;
  competitor_name: string;
  competitor_price: string | number | null;
  price_diff_percent: string | number | null;
}

export interface KbGraphNodeRow {
  id: string;
  name: string;
  entity_type: string;
  slug: string;
  category_path: string;
  relation_count: string | number;
}

export interface KbGraphEdgeRow {
  id: string;
  source: string;
  target: string;
  relation_type: string;
  label: string | null;
  weight: string | number;
  bidirectional: boolean;
}

export interface KbTypeCountRow {
  type_name: string;
  count: string | number;
}

export interface KbDashboardCategoryRow {
  slug: string;
  name: string;
  entity_count: number;
  path: string;
}

export interface KbRecentChangeRow {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  change_type: string;
  changed_at: string;
  changed_by_name: string | null;
}

export interface KbNeighborRow {
  id: string;
  name: string;
  entity_type: string;
  slug: string;
  depth: number;
  path: string[];
  relation_type: string;
}
