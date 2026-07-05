import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

// ── Types ──────────────────────────────────────────────────────

export interface KBCategory {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
  is_active: boolean;
  entity_count: number;
  depth: number;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface KBEntity {
  id: string;
  category_id: string;
  entity_type: KBEntityType;
  slug: string;
  status: KBStatus;
  visibility: KBVisibility;
  name: string;
  summary: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  tags: string[];
  source_type: string;
  source_ref: string | null;
  confidence: number;
  is_verified: boolean;
  verified_by: string | null;
  verified_at: string | null;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface KBEntitySummary {
  id: string;
  entity_type: KBEntityType;
  slug: string;
  status: KBStatus;
  name: string;
  summary: string | null;
  tags: string[];
  confidence: number;
  is_verified: boolean;
  category_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface KBRelationExpanded {
  id: string;
  relation_type: string;
  label: string | null;
  weight: number;
  bidirectional: boolean;
  from_id: string;
  from_name: string;
  from_type: string;
  to_id: string;
  to_name: string;
  to_type: string;
}

export interface KBEntityVersion {
  id: string;
  entity_id: string;
  version: number;
  name: string;
  change_type: string;
  change_reason: string | null;
  changed_by: string | null;
  created_at: string;
}

export interface KBSearchResult {
  id: string;
  entity_type: string;
  slug: string;
  name: string;
  summary: string | null;
  category_path: string;
  tags: string[];
  confidence: number;
  is_verified: boolean;
  rank: number;
  headline: string;
}

export interface KBSearchResponse {
  results: KBSearchResult[];
  total: number;
  query: string;
  method: string;
}

export interface KBFuzzyResult {
  id: string;
  entity_type: string;
  slug: string;
  name: string;
  summary: string | null;
  similarity: number;
}

export interface KBGraphNode {
  id: string;
  name: string;
  entity_type: string;
  slug: string;
  category_path: string;
  relation_count: number;
}

export interface KBGraphEdge {
  id: string;
  source: string;
  target: string;
  relation_type: string;
  label: string | null;
  weight: number;
  bidirectional: boolean;
}

export interface KBFullGraph {
  nodes: KBGraphNode[];
  edges: KBGraphEdge[];
  stats: {
    node_count: number;
    edge_count: number;
    entity_types: { type_name: string; count: number }[];
    relation_types: { type_name: string; count: number }[];
  };
}

export interface KBNeighborNode {
  id: string;
  name: string;
  entity_type: string;
  slug: string;
  depth: number;
  path: string[];
  relation_type: string;
}

export interface KBMetricDefinition {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  unit: string;
  aggregation: string;
  category: string;
  is_cumulative: boolean;
  alert_threshold: Record<string, unknown> | null;
  dashboard_config: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
}

export interface KBMetricPoint {
  period_start: string;
  period_end: string;
  metric_value: number;
  dimensions: Record<string, unknown>;
}

export interface KBPriceComparison {
  service_name: string;
  our_price: number | null;
  competitor_name: string;
  competitor_price: number | null;
  price_diff_percent: number | null;
}

export interface KBDashboard {
  total_entities: number;
  entities_by_type: { type_name: string; count: number }[];
  entities_by_status: { type_name: string; count: number }[];
  unverified_count: number;
  enrichment_pending: number;
  enrichment_failed: number;
  relation_count: number;
  category_coverage: { slug: string; name: string; entity_count: number; path: string }[];
  recent_changes: {
    entity_id: string;
    entity_name: string;
    entity_type: string;
    change_type: string;
    changed_at: string;
    changed_by_name: string | null;
  }[];
}

export interface KBEnrichmentTask {
  id: string;
  entity_id: string | null;
  task_type: string;
  status: string;
  priority: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  entity_name?: string | null;
  entity_type?: string | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface KBDataSource {
  id: string;
  slug: string;
  name: string;
  source_type: string;
  config: Record<string, unknown>;
  sync_schedule: string | null;
  last_synced_at: string | null;
  sync_status: string | null;
  sync_error: string | null;
  entity_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KBAccessRule {
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
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface KBConfigEntry {
  key: string;
  value: unknown;
  description: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface KBBulkResult {
  total: number;
  created: number;
  skipped: number;
  errors: { index: number; slug: string; error: string }[];
}

export type KBEntityType =
  | 'service' | 'equipment' | 'location' | 'person'
  | 'competitor' | 'process' | 'faq' | 'usp'
  | 'content' | 'market_insight' | 'product' | 'brand_asset';

export type KBStatus = 'draft' | 'active' | 'archived' | 'deprecated' | 'review';
export type KBVisibility = 'public' | 'internal' | 'confidential';

// ── Params ──────────────────────────────────────────────────────

export interface ListEntitiesParams {
  entity_type?: KBEntityType;
  category?: string;
  status?: KBStatus;
  verified?: boolean;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface SearchParams {
  q: string;
  category?: string;
  entity_type?: string;
  limit?: number;
  offset?: number;
}

export interface SemanticSearchParams {
  q: string;
  category?: string;
  entity_type?: string;
  limit?: number;
  threshold?: number;
}

export interface GraphTraversalParams {
  max_depth?: number;
  relation_type?: string;
  entity_type?: string;
  include_bidirectional?: boolean;
}

export interface MetricSeriesParams {
  period_type?: string;
  from?: string;
  to?: string;
  dimensions?: Record<string, unknown>;
}

// ── Service ──────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class KnowledgeBaseService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/kb';

  // ── Health ──

  health(): Observable<{ status: string; service: string; version: string; entities_count: number }> {
    return this.http.get<{ status: string; service: string; version: string; entities_count: number }>(`${this.base}/health`);
  }

  // ── Categories ──

  listCategories(): Observable<KBCategory[]> {
    return this.http.get<KBCategory[]>(`${this.base}/categories`);
  }

  getCategory(key: string): Observable<KBCategory> {
    return this.http.get<KBCategory>(`${this.base}/categories/${key}`);
  }

  createCategory(data: Partial<KBCategory> & { slug: string; name: string; parent_slug?: string }): Observable<KBCategory> {
    return this.http.post<KBCategory>(`${this.base}/categories`, data);
  }

  updateCategory(key: string, data: Partial<Pick<KBCategory, 'name' | 'description' | 'icon' | 'sort_order' | 'is_active'>>): Observable<KBCategory> {
    return this.http.patch<KBCategory>(`${this.base}/categories/${key}`, data);
  }

  // ── Entities ──

  listEntities(params?: ListEntitiesParams): Observable<KBEntitySummary[]> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) httpParams = httpParams.set(k, String(v));
      });
    }
    return this.http.get<KBEntitySummary[]>(`${this.base}/entities`, { params: httpParams });
  }

  getEntity(key: string): Observable<KBEntity> {
    return this.http.get<KBEntity>(`${this.base}/entities/${key}`);
  }

  createEntity(data: {
    category_slug: string;
    entity_type: KBEntityType;
    slug: string;
    name: string;
    summary?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
    status?: KBStatus;
    visibility?: KBVisibility;
    source_type?: string;
    source_ref?: string;
    confidence?: number;
  }): Observable<KBEntity> {
    return this.http.post<KBEntity>(`${this.base}/entities`, data);
  }

  updateEntity(key: string, data: Partial<Pick<KBEntity, 'name' | 'summary' | 'content' | 'metadata' | 'tags' | 'status' | 'visibility'> & { confidence?: number }>): Observable<KBEntity> {
    return this.http.patch<KBEntity>(`${this.base}/entities/${key}`, data);
  }

  deleteEntity(key: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.base}/entities/${key}`);
  }

  verifyEntity(id: string): Observable<KBEntity> {
    return this.http.post<KBEntity>(`${this.base}/entities/${id}/verify`, {});
  }

  getEntityVersions(id: string): Observable<KBEntityVersion[]> {
    return this.http.get<KBEntityVersion[]>(`${this.base}/entities/${id}/versions`);
  }

  getEntityRelations(id: string): Observable<KBRelationExpanded[]> {
    return this.http.get<KBRelationExpanded[]>(`${this.base}/entities/${id}/relations`);
  }

  // ── Relations ──

  createRelation(data: {
    from_slug: string;
    to_slug: string;
    relation_type: string;
    label?: string;
    weight?: number;
    bidirectional?: boolean;
  }): Observable<{ created: boolean }> {
    return this.http.post<{ created: boolean }>(`${this.base}/relations`, data);
  }

  deleteRelation(id: string): Observable<{ deleted: boolean }> {
    return this.http.delete<{ deleted: boolean }>(`${this.base}/relations/${id}`);
  }

  // ── Search ──

  search(params: SearchParams): Observable<KBSearchResponse> {
    return this.http.post<KBSearchResponse>(`${this.base}/search`, params);
  }

  suggest(params: SearchParams): Observable<KBFuzzyResult[]> {
    return this.http.post<KBFuzzyResult[]>(`${this.base}/search/suggest`, params);
  }

  semanticSearch(params: SemanticSearchParams): Observable<unknown> {
    return this.http.post(`${this.base}/search/semantic`, params);
  }

  combinedSearch(params: SearchParams): Observable<unknown> {
    return this.http.post(`${this.base}/search/combined`, params);
  }

  // ── Graph ──

  getFullGraph(): Observable<KBFullGraph> {
    return this.http.get<KBFullGraph>(`${this.base}/graph`);
  }

  getNeighbors(id: string, params?: GraphTraversalParams): Observable<KBNeighborNode[]> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) httpParams = httpParams.set(k, String(v));
      });
    }
    return this.http.get<KBNeighborNode[]>(`${this.base}/graph/neighbors/${id}`, { params: httpParams });
  }

  getPriceComparison(serviceSlug?: string): Observable<KBPriceComparison[]> {
    let httpParams = new HttpParams();
    if (serviceSlug) httpParams = httpParams.set('service_slug', serviceSlug);
    return this.http.get<KBPriceComparison[]>(`${this.base}/price-comparison`, { params: httpParams });
  }

  // ── Dashboard ──

  getDashboard(): Observable<KBDashboard> {
    return this.http.get<KBDashboard>(`${this.base}/dashboard`);
  }

  // ── Metrics ──

  listMetricDefinitions(): Observable<KBMetricDefinition[]> {
    return this.http.get<KBMetricDefinition[]>(`${this.base}/metrics/definitions`);
  }

  recordMetric(data: {
    metric_slug: string;
    value: number;
    dimensions?: Record<string, unknown>;
    period_type?: string;
    period_start: string;
    period_end: string;
    source_type?: string;
    notes?: string;
  }): Observable<{ recorded: boolean }> {
    return this.http.post<{ recorded: boolean }>(`${this.base}/metrics`, data);
  }

  getMetricSeries(slug: string, params?: MetricSeriesParams): Observable<KBMetricPoint[]> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) httpParams = httpParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      });
    }
    return this.http.get<KBMetricPoint[]>(`${this.base}/metrics/series/${slug}`, { params: httpParams });
  }

  // ── Enrichment ──

  listEnrichmentTasks(params?: { status?: string; task_type?: string; entity_id?: string; limit?: number; offset?: number }): Observable<KBEnrichmentTask[]> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) httpParams = httpParams.set(k, String(v));
      });
    }
    return this.http.get<KBEnrichmentTask[]>(`${this.base}/enrichment`, { params: httpParams });
  }

  getEnrichmentQueue(): Observable<KBEnrichmentTask[]> {
    return this.http.get<KBEnrichmentTask[]>(`${this.base}/enrichment/queue`);
  }

  getEnrichmentStats(): Observable<unknown> {
    return this.http.get(`${this.base}/enrichment/stats`);
  }

  createEnrichmentTask(data: {
    entity_slug?: string;
    task_type: string;
    priority?: number;
    payload?: Record<string, unknown>;
  }): Observable<KBEnrichmentTask> {
    return this.http.post<KBEnrichmentTask>(`${this.base}/enrichment`, data);
  }

  batchEnqueueEnrichment(data: {
    task_type: string;
    entity_type?: string;
    category_slug?: string;
    priority?: number;
  }): Observable<{ enqueued: number; task_type: string }> {
    return this.http.post<{ enqueued: number; task_type: string }>(`${this.base}/enrichment/batch`, data);
  }

  updateEnrichmentTask(id: string, data: Partial<Pick<KBEnrichmentTask, 'status' | 'priority' | 'result' | 'error'>>): Observable<KBEnrichmentTask> {
    return this.http.patch<KBEnrichmentTask>(`${this.base}/enrichment/${id}`, data);
  }

  cancelEnrichmentTask(id: string): Observable<{ cancelled: boolean }> {
    return this.http.delete<{ cancelled: boolean }>(`${this.base}/enrichment/${id}`);
  }

  retryEnrichmentTask(id: string): Observable<KBEnrichmentTask> {
    return this.http.post<KBEnrichmentTask>(`${this.base}/enrichment/${id}/retry`, {});
  }

  // ── Sources ──

  listSources(): Observable<KBDataSource[]> {
    return this.http.get<KBDataSource[]>(`${this.base}/sources`);
  }

  getSource(key: string): Observable<KBDataSource> {
    return this.http.get<KBDataSource>(`${this.base}/sources/${key}`);
  }

  triggerSync(key: string): Observable<{ sync_triggered: boolean; source: string; task_type: string }> {
    return this.http.post<{ sync_triggered: boolean; source: string; task_type: string }>(`${this.base}/sources/${key}/sync`, {});
  }

  // ── Access Rules ──

  listAccessRules(): Observable<KBAccessRule[]> {
    return this.http.get<KBAccessRule[]>(`${this.base}/access`);
  }

  getAccessRulesByRole(role: string): Observable<KBAccessRule[]> {
    return this.http.get<KBAccessRule[]>(`${this.base}/access/role/${role}`);
  }

  checkPermissions(params: { role: string; category_slug?: string; entity_type?: string }): Observable<unknown> {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) httpParams = httpParams.set(k, String(v));
    });
    return this.http.get(`${this.base}/access/check`, { params: httpParams });
  }

  // ── Config ──

  listConfig(): Observable<KBConfigEntry[]> {
    return this.http.get<KBConfigEntry[]>(`${this.base}/config`);
  }

  getConfig(key: string): Observable<KBConfigEntry> {
    return this.http.get<KBConfigEntry>(`${this.base}/config/${key}`);
  }

  setConfig(key: string, value: unknown, description?: string): Observable<KBConfigEntry> {
    return this.http.put<KBConfigEntry>(`${this.base}/config/${key}`, { value, description });
  }

  // ── Bulk ──

  bulkCreateEntities(entities: {
    category_slug: string;
    entity_type: KBEntityType;
    slug: string;
    name: string;
    summary?: string;
    content?: string;
    metadata?: Record<string, unknown>;
    tags?: string[];
  }[]): Observable<KBBulkResult> {
    return this.http.post<KBBulkResult>(`${this.base}/bulk/entities`, { entities });
  }

  bulkCreateRelations(relations: {
    from_slug: string;
    to_slug: string;
    relation_type: string;
    label?: string;
    weight?: number;
    bidirectional?: boolean;
  }[]): Observable<KBBulkResult> {
    return this.http.post<KBBulkResult>(`${this.base}/bulk/relations`, { relations });
  }

  // ── Export ──

  exportEntities(params?: { entity_type?: string; category?: string; status?: string }): Observable<Blob> {
    let httpParams = new HttpParams();
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) httpParams = httpParams.set(k, String(v));
      });
    }
    return this.http.get(`${this.base}/export/entities`, { params: httpParams, responseType: 'blob' });
  }

  exportRelations(): Observable<Blob> {
    return this.http.get(`${this.base}/export/relations`, { responseType: 'blob' });
  }
}
