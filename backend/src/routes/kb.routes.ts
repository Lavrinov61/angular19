import { Router, type Request, type Response } from 'express';
import db from '../database/db.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticateToken, requirePermission, requireUser, type AuthRequest } from '../middleware/auth.js';
import type {
  KbAccessRuleRow,
  KbCategoryRow,
  KbConfigRow,
  KbCountRow,
  KbDashboardCategoryRow,
  KbDataSourceRow,
  KbEnrichmentTaskRow,
  KbEntityRow,
  KbEntitySummaryRow,
  KbEntityVersionRow,
  KbFuzzySearchRow,
  KbGraphEdgeRow,
  KbGraphNodeRow,
  KbMetricDefinitionRow,
  KbMetricPointRow,
  KbNeighborRow,
  KbPriceComparisonRow,
  KbRecentChangeRow,
  KbRelationExpandedRow,
  KbSearchCombinedRow,
  KbSearchTextRow,
  KbTypeCountRow,
} from '../types/views/kb-views.js';
import type {
  KbConfigValueJsonb,
  KbEntityMetadataJsonb,
  KbJsonObject,
  KbJsonValue,
  KbMetricDimensionsJsonb,
  KbTaskPayloadJsonb,
} from '../types/jsonb/kb-jsonb.js';

const router = Router();

router.use(authenticateToken);
router.use(requirePermission('inbox:view'));

const ENTITY_SELECT = `
  e.id, e.category_id, e.entity_type, e.slug, e.status, e.visibility,
  e.name, e.summary, e.content, e.metadata, e.tags, e.source_type,
  e.source_ref, e.confidence, e.is_verified, e.verified_by, e.verified_at,
  e.version, e.created_by, e.updated_by, e.created_at, e.updated_at
`;

const ENTITY_RETURNING = `
  id, category_id, entity_type, slug, status, visibility, name, summary,
  content, metadata, tags, source_type, source_ref, confidence, is_verified,
  verified_by, verified_at, version, created_by, updated_by, created_at, updated_at
`;

interface KbSearchResponse {
  results: ReturnType<typeof mapSearchResult>[];
  total: number;
  query: string;
  method: string;
}

interface UnknownObject {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKbJsonValue(value: unknown): value is KbJsonValue {
  if (value === null) return true;
  const valueType = typeof value;
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') return true;
  if (Array.isArray(value)) return value.every(isKbJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(item => item === undefined || isKbJsonValue(item));
}

function isKbJsonObject(value: unknown): value is KbJsonObject {
  return isRecord(value) && Object.values(value).every(item => item === undefined || isKbJsonValue(item));
}

function readBody(req: Request): KbJsonObject {
  return isKbJsonObject(req.body) ? req.body : {};
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function requireString(body: KbJsonObject, key: string): string {
  const value = readString(body[key]);
  if (!value) throw new AppError(400, `${key} is required`);
  return value;
}

function readBoolean(value: unknown): boolean | undefined {
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function readInt(value: unknown, fallback: number, max: number): number {
  const raw = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, Math.min(Math.trunc(raw), max));
}

function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function requiredParam(req: Request, key: string): string {
  const value = req.params[key];
  if (!value) throw new AppError(400, `${key} is required`);
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function highlightHeadline(value: string): string {
  const parts = value.split('**');
  return parts.map((part, index) => {
    const escaped = escapeHtml(part);
    return index % 2 === 1 ? `<mark>${escaped}</mark>` : escaped;
  }).join('');
}

function mapEntity(row: KbEntityRow) {
  return {
    ...row,
    confidence: toNumber(row.confidence, 1),
  };
}

function mapEntitySummary(row: KbEntitySummaryRow) {
  return {
    ...row,
    confidence: toNumber(row.confidence, 1),
  };
}

function mapSearchResult(row: KbSearchTextRow) {
  return {
    ...row,
    confidence: toNumber(row.confidence, 1),
    headline: highlightHeadline(row.headline || row.summary || row.name),
  };
}

function mapFuzzyResult(row: KbFuzzySearchRow) {
  return {
    ...row,
    similarity: toNumber(row.similarity),
  };
}

function mapRelation(row: KbRelationExpandedRow) {
  return {
    ...row,
    weight: toNumber(row.weight, 1),
  };
}

function mapGraphNode(row: KbGraphNodeRow) {
  return {
    ...row,
    relation_count: toNumber(row.relation_count),
  };
}

function mapGraphEdge(row: KbGraphEdgeRow) {
  return {
    ...row,
    weight: toNumber(row.weight, 1),
  };
}

function mapTypeCount(row: KbTypeCountRow) {
  return {
    type_name: row.type_name,
    count: toNumber(row.count),
  };
}

function mapMetricPoint(row: KbMetricPointRow) {
  return {
    ...row,
    metric_value: toNumber(row.metric_value),
  };
}

function mapPriceComparison(row: KbPriceComparisonRow) {
  return {
    service_name: row.service_name,
    our_price: row.our_price === null ? null : toNumber(row.our_price),
    competitor_name: row.competitor_name,
    competitor_price: row.competitor_price === null ? null : toNumber(row.competitor_price),
    price_diff_percent: row.price_diff_percent === null ? null : toNumber(row.price_diff_percent),
  };
}

async function getEntityByKey(key: string): Promise<KbEntityRow> {
  const row = await db.queryOne<KbEntityRow>(
    `SELECT ${ENTITY_SELECT}
     FROM kb_entities e
     WHERE (e.id::text = $1 OR e.slug = $1)
       AND e.deleted_at IS NULL
     LIMIT 1`,
    [key],
  );
  if (!row) throw new AppError(404, 'KB entity not found');
  return row;
}

function addParam(params: unknown[], value: unknown): string {
  params.push(value);
  return `$${params.length}`;
}

router.get('/health', async (_req, res) => {
  const row = await db.queryOne<KbCountRow>(
    'SELECT COUNT(*)::text AS count FROM kb_entities WHERE deleted_at IS NULL',
  );
  res.json({
    status: 'ok',
    service: 'knowledge-base',
    version: '1',
    entities_count: toNumber(row?.count),
  });
});

router.get('/categories', async (_req, res) => {
  const rows = await db.query<KbCategoryRow>(
    `SELECT id, parent_id, slug, name, description, icon, sort_order,
            metadata, is_active, entity_count, depth, path, created_at, updated_at
     FROM kb_categories
     ORDER BY path, sort_order, name`,
  );
  res.json(rows);
});

router.get('/categories/:key', async (req, res) => {
  const key = requiredParam(req, 'key');
  const row = await db.queryOne<KbCategoryRow>(
    `SELECT id, parent_id, slug, name, description, icon, sort_order,
            metadata, is_active, entity_count, depth, path, created_at, updated_at
     FROM kb_categories
     WHERE id::text = $1 OR slug = $1
     LIMIT 1`,
    [key],
  );
  if (!row) throw new AppError(404, 'KB category not found');
  res.json(row);
});

router.post('/categories', async (req: AuthRequest, res) => {
  requireUser(req);
  const body = readBody(req);
  const slug = requireString(body, 'slug');
  const name = requireString(body, 'name');
  const parentSlug = readString(body['parent_slug']);
  const parent = parentSlug
    ? await db.queryOne<KbCategoryRow>(
        `SELECT id, parent_id, slug, name, description, icon, sort_order,
                metadata, is_active, entity_count, depth, path, created_at, updated_at
         FROM kb_categories WHERE slug = $1 LIMIT 1`,
        [parentSlug],
      )
    : null;

  const row = await db.queryOne<KbCategoryRow>(
    `INSERT INTO kb_categories (parent_id, slug, name, description, icon, sort_order, metadata, depth, path)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, parent_id, slug, name, description, icon, sort_order,
               metadata, is_active, entity_count, depth, path, created_at, updated_at`,
    [
      parent?.id ?? null,
      slug,
      name,
      readString(body['description']) ?? null,
      readString(body['icon']) ?? null,
      readInt(body['sort_order'], 0, 10000),
      isKbJsonObject(body['metadata']) ? body['metadata'] : {},
      parent ? parent.depth + 1 : 0,
      parent ? `${parent.path}/${slug}` : slug,
    ],
  );
  res.status(201).json(row);
});

router.patch('/categories/:key', async (req, res) => {
  const key = requiredParam(req, 'key');
  const body = readBody(req);
  const updates: string[] = [];
  const params: unknown[] = [];

  const name = readString(body['name']);
  if (name) updates.push(`name = ${addParam(params, name)}`);
  if (body['description'] === null || readString(body['description'])) {
    updates.push(`description = ${addParam(params, readString(body['description']) ?? null)}`);
  }
  if (body['icon'] === null || readString(body['icon'])) {
    updates.push(`icon = ${addParam(params, readString(body['icon']) ?? null)}`);
  }
  if (body['sort_order'] !== undefined) {
    updates.push(`sort_order = ${addParam(params, readInt(body['sort_order'], 0, 10000))}`);
  }
  const isActive = readBoolean(body['is_active']);
  if (isActive !== undefined) updates.push(`is_active = ${addParam(params, isActive)}`);

  if (!updates.length) {
    const row = await db.queryOne<KbCategoryRow>(
      `SELECT id, parent_id, slug, name, description, icon, sort_order,
              metadata, is_active, entity_count, depth, path, created_at, updated_at
       FROM kb_categories WHERE id::text = $1 OR slug = $1 LIMIT 1`,
      [key],
    );
    if (!row) throw new AppError(404, 'KB category not found');
    res.json(row);
    return;
  }

  const keyRef = addParam(params, key);
  const row = await db.queryOne<KbCategoryRow>(
    `UPDATE kb_categories
     SET ${updates.join(', ')}
     WHERE id::text = ${keyRef} OR slug = ${keyRef}
     RETURNING id, parent_id, slug, name, description, icon, sort_order,
               metadata, is_active, entity_count, depth, path, created_at, updated_at`,
    params,
  );
  if (!row) throw new AppError(404, 'KB category not found');
  res.json(row);
});

router.get('/entities', async (req, res) => {
  const params: unknown[] = [];
  const where = ['e.deleted_at IS NULL'];
  const category = readString(req.query['category']);
  const entityType = readString(req.query['entity_type']);
  const status = readString(req.query['status']);
  const verified = readBoolean(req.query['verified']);
  const tag = readString(req.query['tag']);

  if (category) where.push(`c.path LIKE ${addParam(params, `${category}%`)}`);
  if (entityType) where.push(`e.entity_type = ${addParam(params, entityType)}`);
  if (status) where.push(`e.status = ${addParam(params, status)}`);
  if (verified !== undefined) where.push(`e.is_verified = ${addParam(params, verified)}`);
  if (tag) where.push(`${addParam(params, tag)} = ANY(e.tags)`);

  const limitRef = addParam(params, readInt(req.query['limit'], 50, 200));
  const offsetRef = addParam(params, readInt(req.query['offset'], 0, 10000));
  const rows = await db.query<KbEntitySummaryRow>(
    `SELECT e.id, e.entity_type, e.slug, e.status, e.name, e.summary, e.tags,
            e.confidence, e.is_verified, c.path AS category_path, e.created_at, e.updated_at
     FROM kb_entities e
     JOIN kb_categories c ON c.id = e.category_id
     WHERE ${where.join(' AND ')}
     ORDER BY e.updated_at DESC
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params,
  );
  res.json(rows.map(mapEntitySummary));
});

router.post('/entities', async (req: AuthRequest, res) => {
  requireUser(req);
  const body = readBody(req);
  const categorySlug = requireString(body, 'category_slug');
  const category = await db.queryOne<KbCategoryRow>(
    `SELECT id, parent_id, slug, name, description, icon, sort_order,
            metadata, is_active, entity_count, depth, path, created_at, updated_at
     FROM kb_categories WHERE slug = $1 LIMIT 1`,
    [categorySlug],
  );
  if (!category) throw new AppError(400, 'category_slug not found');

  const row = await db.queryOne<KbEntityRow>(
    `INSERT INTO kb_entities (
       category_id, entity_type, slug, name, summary, content, metadata, tags,
       status, visibility, source_type, source_ref, confidence, created_by, updated_by
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, 'draft'), COALESCE($10, 'internal'),
             COALESCE($11, 'manual'), $12, COALESCE($13, 1), $14, $14)
     RETURNING ${ENTITY_RETURNING}`,
    [
      category.id,
      requireString(body, 'entity_type'),
      requireString(body, 'slug'),
      requireString(body, 'name'),
      readString(body['summary']) ?? null,
      readString(body['content']) ?? null,
      isKbJsonObject(body['metadata']) ? body['metadata'] : {},
      readStringArray(body['tags']),
      readString(body['status']) ?? null,
      readString(body['visibility']) ?? null,
      readString(body['source_type']) ?? null,
      readString(body['source_ref']) ?? null,
      toNumber(typeof body['confidence'] === 'number' ? body['confidence'] : undefined, 1),
      req.user.id,
    ],
  );
  res.status(201).json(row ? mapEntity(row) : null);
});

router.get('/entities/:key/relations', async (req, res) => {
  const key = requiredParam(req, 'key');
  const rows = await db.query<KbRelationExpandedRow>(
    `SELECT r.id, r.relation_type, r.label, r.weight, r.bidirectional,
            f.id AS from_id, f.name AS from_name, f.entity_type AS from_type,
            t.id AS to_id, t.name AS to_name, t.entity_type AS to_type
     FROM kb_relations r
     JOIN kb_entities f ON f.id = r.from_entity_id
     JOIN kb_entities t ON t.id = r.to_entity_id
     WHERE r.from_entity_id::text = $1 OR r.to_entity_id::text = $1
     ORDER BY r.weight DESC, r.created_at DESC`,
    [key],
  );
  res.json(rows.map(mapRelation));
});

router.get('/entities/:key/versions', async (req, res) => {
  const key = requiredParam(req, 'key');
  const rows = await db.query<KbEntityVersionRow>(
    `SELECT v.id, v.entity_id, v.version, v.name, v.change_type,
            v.change_reason, v.changed_by, v.created_at
     FROM kb_entity_versions v
     WHERE v.entity_id::text = $1
     ORDER BY v.version DESC, v.created_at DESC`,
    [key],
  );
  res.json(rows);
});

router.post('/entities/:key/verify', async (req: AuthRequest, res) => {
  requireUser(req);
  const key = requiredParam(req, 'key');
  const row = await db.queryOne<KbEntityRow>(
    `UPDATE kb_entities
     SET is_verified = TRUE, verified_by = $2, verified_at = NOW(), updated_by = $2
     WHERE (id::text = $1 OR slug = $1) AND deleted_at IS NULL
     RETURNING ${ENTITY_RETURNING}`,
    [key, req.user.id],
  );
  if (!row) throw new AppError(404, 'KB entity not found');
  res.json(mapEntity(row));
});

router.get('/entities/:key', async (req, res) => {
  const row = await getEntityByKey(requiredParam(req, 'key'));
  res.json(mapEntity(row));
});

router.patch('/entities/:key', async (req: AuthRequest, res) => {
  requireUser(req);
  const key = requiredParam(req, 'key');
  const body = readBody(req);
  const updates: string[] = [];
  const params: unknown[] = [];

  const stringColumns = ['name', 'summary', 'content', 'status', 'visibility'] as const;
  for (const column of stringColumns) {
    if (body[column] === null || readString(body[column])) {
      updates.push(`${column} = ${addParam(params, readString(body[column]) ?? null)}`);
    }
  }
  if (isKbJsonObject(body['metadata'])) updates.push(`metadata = ${addParam(params, body['metadata'])}`);
  if (Array.isArray(body['tags'])) updates.push(`tags = ${addParam(params, readStringArray(body['tags']))}`);
  if (typeof body['confidence'] === 'number') updates.push(`confidence = ${addParam(params, toNumber(body['confidence'], 1))}`);
  updates.push(`updated_by = ${addParam(params, req.user.id)}`);

  const keyRef = addParam(params, key);
  const row = await db.queryOne<KbEntityRow>(
    `UPDATE kb_entities
     SET ${updates.join(', ')}
     WHERE (id::text = ${keyRef} OR slug = ${keyRef}) AND deleted_at IS NULL
     RETURNING ${ENTITY_RETURNING}`,
    params,
  );
  if (!row) throw new AppError(404, 'KB entity not found');
  res.json(mapEntity(row));
});

router.delete('/entities/:key', async (req: AuthRequest, res) => {
  requireUser(req);
  const key = requiredParam(req, 'key');
  const row = await db.queryOne<KbCountRow>(
    `UPDATE kb_entities
     SET deleted_at = NOW(), updated_by = $2
     WHERE (id::text = $1 OR slug = $1) AND deleted_at IS NULL
     RETURNING 1 AS count`,
    [key, req.user.id],
  );
  res.json({ deleted: Boolean(row) });
});

router.post('/relations', async (req: AuthRequest, res) => {
  requireUser(req);
  const body = readBody(req);
  const row = await db.queryOne<KbCountRow>(
    `INSERT INTO kb_relations (from_entity_id, to_entity_id, relation_type, label, weight, bidirectional, created_by)
     SELECT f.id, t.id, $3, $4, $5, $6, $7
     FROM kb_entities f
     JOIN kb_entities t ON t.slug = $2
     WHERE f.slug = $1
     RETURNING 1 AS count`,
    [
      requireString(body, 'from_slug'),
      requireString(body, 'to_slug'),
      requireString(body, 'relation_type'),
      readString(body['label']) ?? null,
      toNumber(typeof body['weight'] === 'number' ? body['weight'] : undefined, 1),
      readBoolean(body['bidirectional']) ?? false,
      req.user.id,
    ],
  );
  res.status(201).json({ created: Boolean(row) });
});

router.delete('/relations/:id', async (req, res) => {
  const id = requiredParam(req, 'id');
  const row = await db.queryOne<KbCountRow>('DELETE FROM kb_relations WHERE id::text = $1 RETURNING 1 AS count', [id]);
  res.json({ deleted: Boolean(row) });
});

router.post('/search', async (req, res) => {
  const body = readBody(req);
  const query = requireString(body, 'q');
  const category = readString(body['category']) ?? null;
  const entityType = readString(body['entity_type']) ?? null;
  const limit = readInt(body['limit'], 20, 100);
  const offset = readInt(body['offset'], 0, 10000);
  const rows = await db.query<KbSearchTextRow>(
    'SELECT * FROM kb_search_text($1, $2, $3, $4, $5, $6)',
    [query, category, entityType, 'active', limit, offset],
  );
  const response: KbSearchResponse = {
    results: rows.map(mapSearchResult),
    total: rows.length,
    query,
    method: 'fts',
  };
  res.json(response);
});

router.post('/search/suggest', async (req, res) => {
  const body = readBody(req);
  const query = requireString(body, 'q');
  const rows = await db.query<KbFuzzySearchRow>(
    'SELECT * FROM kb_search_fuzzy($1, $2, $3)',
    [query, 0.2, readInt(body['limit'], 8, 25)],
  );
  res.json(rows.map(mapFuzzyResult));
});

router.post('/search/combined', async (req, res) => {
  const body = readBody(req);
  const query = requireString(body, 'q');
  const rows = await db.query<KbSearchCombinedRow>(
    'SELECT * FROM kb_search_combined($1, $2, $3, $4)',
    [query, readString(body['category']) ?? null, readString(body['entity_type']) ?? null, readInt(body['limit'], 20, 100)],
  );
  res.json({ results: rows, total: rows.length, query, method: 'combined' });
});

router.post('/search/semantic', async (_req, res) => {
  res.json({ results: [], total: 0, method: 'semantic-unavailable' });
});

router.get('/dashboard', async (_req, res) => {
  const [
    totalRows,
    typeRows,
    statusRows,
    unverifiedRows,
    pendingRows,
    failedRows,
    relationRows,
    categoryRows,
    recentRows,
  ] = await Promise.all([
    db.query<KbCountRow>('SELECT COUNT(*)::text AS count FROM kb_entities WHERE deleted_at IS NULL'),
    db.query<KbTypeCountRow>(
      `SELECT entity_type AS type_name, COUNT(*)::text AS count
       FROM kb_entities WHERE deleted_at IS NULL GROUP BY entity_type ORDER BY count DESC`,
    ),
    db.query<KbTypeCountRow>(
      `SELECT status AS type_name, COUNT(*)::text AS count
       FROM kb_entities WHERE deleted_at IS NULL GROUP BY status ORDER BY count DESC`,
    ),
    db.query<KbCountRow>(
      `SELECT COUNT(*)::text AS count
       FROM kb_entities WHERE deleted_at IS NULL AND status = 'active' AND is_verified = FALSE`,
    ),
    db.query<KbCountRow>("SELECT COUNT(*)::text AS count FROM kb_enrichment_tasks WHERE status = 'pending'"),
    db.query<KbCountRow>("SELECT COUNT(*)::text AS count FROM kb_enrichment_tasks WHERE status = 'failed'"),
    db.query<KbCountRow>('SELECT COUNT(*)::text AS count FROM kb_relations'),
    db.query<KbDashboardCategoryRow>(
      `SELECT slug, name, entity_count, path
       FROM kb_categories
       WHERE is_active = TRUE
       ORDER BY entity_count DESC, path
       LIMIT 20`,
    ),
    db.query<KbRecentChangeRow>(
      `SELECT v.entity_id, e.name AS entity_name, e.entity_type, v.change_type,
              v.created_at AS changed_at, COALESCE(u.display_name, u.email) AS changed_by_name
       FROM kb_entity_versions v
       JOIN kb_entities e ON e.id = v.entity_id
       LEFT JOIN users u ON u.id = v.changed_by
       ORDER BY v.created_at DESC
       LIMIT 10`,
    ),
  ]);

  res.json({
    total_entities: toNumber(totalRows[0]?.count),
    entities_by_type: typeRows.map(mapTypeCount),
    entities_by_status: statusRows.map(mapTypeCount),
    unverified_count: toNumber(unverifiedRows[0]?.count),
    enrichment_pending: toNumber(pendingRows[0]?.count),
    enrichment_failed: toNumber(failedRows[0]?.count),
    relation_count: toNumber(relationRows[0]?.count),
    category_coverage: categoryRows,
    recent_changes: recentRows,
  });
});

router.get('/graph', async (_req, res) => {
  const [nodes, edges, typeStats, relationStats] = await Promise.all([
    db.query<KbGraphNodeRow>(
      `SELECT e.id, e.name, e.entity_type, e.slug, c.path AS category_path,
              (COUNT(DISTINCT outgoing.id) + COUNT(DISTINCT incoming.id))::text AS relation_count
       FROM kb_entities e
       JOIN kb_categories c ON c.id = e.category_id
       LEFT JOIN kb_relations outgoing ON outgoing.from_entity_id = e.id
       LEFT JOIN kb_relations incoming ON incoming.to_entity_id = e.id
       WHERE e.deleted_at IS NULL AND e.status = 'active'
       GROUP BY e.id, e.name, e.entity_type, e.slug, c.path
       ORDER BY relation_count DESC, e.name
       LIMIT 250`,
    ),
    db.query<KbGraphEdgeRow>(
      `SELECT id, from_entity_id AS source, to_entity_id AS target,
              relation_type, label, weight, bidirectional
       FROM kb_relations
       ORDER BY weight DESC, created_at DESC
       LIMIT 500`,
    ),
    db.query<KbTypeCountRow>(
      `SELECT entity_type AS type_name, COUNT(*)::text AS count
       FROM kb_entities WHERE deleted_at IS NULL GROUP BY entity_type ORDER BY count DESC`,
    ),
    db.query<KbTypeCountRow>(
      `SELECT relation_type AS type_name, COUNT(*)::text AS count
       FROM kb_relations GROUP BY relation_type ORDER BY count DESC`,
    ),
  ]);

  const graphNodes = nodes.map(mapGraphNode);
  const graphEdges = edges.map(mapGraphEdge);
  res.json({
    nodes: graphNodes,
    edges: graphEdges,
    stats: {
      node_count: graphNodes.length,
      edge_count: graphEdges.length,
      entity_types: typeStats.map(mapTypeCount),
      relation_types: relationStats.map(mapTypeCount),
    },
  });
});

router.get('/graph/neighbors/:id', async (req, res) => {
  const id = requiredParam(req, 'id');
  const rows = await db.query<KbNeighborRow>(
    `WITH base AS (
       SELECT id, slug FROM kb_entities WHERE id::text = $1 OR slug = $1 LIMIT 1
     ),
     connected AS (
       SELECT r.to_entity_id AS entity_id, r.relation_type
       FROM kb_relations r JOIN base b ON b.id = r.from_entity_id
       UNION ALL
       SELECT r.from_entity_id AS entity_id, r.relation_type
       FROM kb_relations r JOIN base b ON b.id = r.to_entity_id
     )
     SELECT e.id, e.name, e.entity_type, e.slug, 1 AS depth,
            ARRAY[(SELECT slug FROM base), e.slug] AS path,
            c.relation_type
     FROM connected c
     JOIN kb_entities e ON e.id = c.entity_id
     WHERE e.deleted_at IS NULL
     LIMIT 50`,
    [id],
  );
  res.json(rows);
});

router.get('/price-comparison', async (req, res) => {
  const rows = await db.query<KbPriceComparisonRow>(
    'SELECT * FROM kb_price_comparison($1)',
    [readString(req.query['service_slug']) ?? null],
  );
  res.json(rows.map(mapPriceComparison));
});

router.get('/metrics/definitions', async (_req, res) => {
  const rows = await db.query<KbMetricDefinitionRow>(
    `SELECT id, slug, name, description, unit, aggregation, category, is_cumulative,
            alert_threshold, dashboard_config, is_active, created_at
     FROM kb_metric_definitions
     WHERE is_active = TRUE
     ORDER BY category, name`,
  );
  res.json(rows);
});

router.post('/metrics', async (req, res) => {
  const body = readBody(req);
  const row = await db.queryOne<KbCountRow>(
    `INSERT INTO kb_metrics (definition_id, metric_value, dimensions, period_type, period_start, period_end, source_type, notes)
     SELECT d.id, $2, $3, COALESCE($4, 'daily'), $5::date, $6::date, COALESCE($7, 'manual'), $8
     FROM kb_metric_definitions d
     WHERE d.slug = $1
     RETURNING 1 AS count`,
    [
      requireString(body, 'metric_slug'),
      toNumber(typeof body['value'] === 'number' ? body['value'] : undefined),
      isKbJsonObject(body['dimensions']) ? body['dimensions'] : {},
      readString(body['period_type']) ?? null,
      requireString(body, 'period_start'),
      requireString(body, 'period_end'),
      readString(body['source_type']) ?? null,
      readString(body['notes']) ?? null,
    ],
  );
  res.status(201).json({ recorded: Boolean(row) });
});

router.get('/metrics/series/:slug', async (req, res) => {
  const slug = requiredParam(req, 'slug');
  let dimensions: KbMetricDimensionsJsonb = {};
  const rawDimensions = readString(req.query['dimensions']);
  if (rawDimensions) {
    const parsed: unknown = JSON.parse(rawDimensions);
    if (isKbJsonObject(parsed)) dimensions = parsed;
  }
  const rows = await db.query<KbMetricPointRow>(
    'SELECT * FROM kb_metric_series($1, $2, $3::date, $4::date, $5)',
    [
      slug,
      readString(req.query['period_type']) ?? 'daily',
      readString(req.query['from']) ?? '2000-01-01',
      readString(req.query['to']) ?? '2999-12-31',
      dimensions,
    ],
  );
  res.json(rows.map(mapMetricPoint));
});

router.get('/enrichment', async (req, res) => {
  const params: unknown[] = [];
  const where: string[] = [];
  const status = readString(req.query['status']);
  const taskType = readString(req.query['task_type']);
  const entityId = readString(req.query['entity_id']);
  if (status) where.push(`t.status = ${addParam(params, status)}`);
  if (taskType) where.push(`t.task_type = ${addParam(params, taskType)}`);
  if (entityId) where.push(`t.entity_id::text = ${addParam(params, entityId)}`);
  const limitRef = addParam(params, readInt(req.query['limit'], 50, 200));
  const offsetRef = addParam(params, readInt(req.query['offset'], 0, 10000));
  const rows = await db.query<KbEnrichmentTaskRow>(
    `SELECT t.id, t.entity_id, t.task_type, t.status, t.priority, t.payload, t.result,
            t.error, t.attempts, t.max_attempts, e.name AS entity_name, e.entity_type,
            t.scheduled_at, t.started_at, t.completed_at, t.created_at
     FROM kb_enrichment_tasks t
     LEFT JOIN kb_entities e ON e.id = t.entity_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY t.priority ASC, t.scheduled_at ASC
     LIMIT ${limitRef} OFFSET ${offsetRef}`,
    params,
  );
  res.json(rows);
});

router.get('/enrichment/queue', async (_req, res) => {
  const rows = await db.query<KbEnrichmentTaskRow>(
    `SELECT t.id, t.entity_id, t.task_type, t.status, t.priority, t.payload, t.result,
            t.error, t.attempts, t.max_attempts, e.name AS entity_name, e.entity_type,
            t.scheduled_at, t.started_at, t.completed_at, t.created_at
     FROM kb_enrichment_tasks t
     LEFT JOIN kb_entities e ON e.id = t.entity_id
     WHERE t.status = 'pending'
     ORDER BY t.priority ASC, t.scheduled_at ASC
     LIMIT 100`,
  );
  res.json(rows);
});

router.get('/enrichment/stats', async (_req, res) => {
  const rows = await db.query<KbTypeCountRow>(
    'SELECT status AS type_name, COUNT(*)::text AS count FROM kb_enrichment_tasks GROUP BY status ORDER BY status',
  );
  res.json({ by_status: rows.map(mapTypeCount) });
});

router.post('/enrichment', async (req, res) => {
  const body = readBody(req);
  const entitySlug = readString(body['entity_slug']);
  const payload: KbTaskPayloadJsonb = isKbJsonObject(body['payload']) ? body['payload'] : {};
  const row = await db.queryOne<KbEnrichmentTaskRow>(
    `INSERT INTO kb_enrichment_tasks (entity_id, task_type, priority, payload)
     SELECT e.id, $2, $3, $4
     FROM (SELECT $1::text AS entity_slug) s
     LEFT JOIN kb_entities e ON e.slug = s.entity_slug
     WHERE $1::text IS NULL OR e.id IS NOT NULL
     RETURNING id, entity_id, task_type, status, priority, payload, result, error,
               attempts, max_attempts, NULL::text AS entity_name, NULL::text AS entity_type,
               scheduled_at, started_at, completed_at, created_at`,
    [entitySlug ?? null, requireString(body, 'task_type'), readInt(body['priority'], 5, 10) || 5, payload],
  );
  if (!row) throw new AppError(400, 'entity_slug not found');
  res.status(201).json(row);
});

router.post('/enrichment/batch', async (req, res) => {
  const body = readBody(req);
  const taskType = requireString(body, 'task_type');
  const rows = await db.query<KbCountRow>(
    `INSERT INTO kb_enrichment_tasks (entity_id, task_type, priority, payload)
     SELECT e.id, $1, $2, '{}'::jsonb
     FROM kb_entities e
     JOIN kb_categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NULL
       AND ($3::text IS NULL OR e.entity_type = $3)
       AND ($4::text IS NULL OR c.path LIKE $4 || '%')
     RETURNING 1 AS count`,
    [
      taskType,
      readInt(body['priority'], 5, 10) || 5,
      readString(body['entity_type']) ?? null,
      readString(body['category_slug']) ?? null,
    ],
  );
  res.status(201).json({ enqueued: rows.length, task_type: taskType });
});

router.patch('/enrichment/:id', async (req, res) => {
  const id = requiredParam(req, 'id');
  const body = readBody(req);
  const updates: string[] = [];
  const params: unknown[] = [];
  const status = readString(body['status']);
  if (status) updates.push(`status = ${addParam(params, status)}`);
  if (body['priority'] !== undefined) updates.push(`priority = ${addParam(params, readInt(body['priority'], 5, 10) || 5)}`);
  if (isKbJsonObject(body['result'])) updates.push(`result = ${addParam(params, body['result'])}`);
  if (body['error'] === null || readString(body['error'])) updates.push(`error = ${addParam(params, readString(body['error']) ?? null)}`);
  if (!updates.length) throw new AppError(400, 'No enrichment fields to update');
  const idRef = addParam(params, id);
  const row = await db.queryOne<KbEnrichmentTaskRow>(
    `UPDATE kb_enrichment_tasks t
     SET ${updates.join(', ')}
     WHERE t.id::text = ${idRef}
     RETURNING t.id, t.entity_id, t.task_type, t.status, t.priority, t.payload, t.result,
               t.error, t.attempts, t.max_attempts, NULL::text AS entity_name, NULL::text AS entity_type,
               t.scheduled_at, t.started_at, t.completed_at, t.created_at`,
    params,
  );
  if (!row) throw new AppError(404, 'KB enrichment task not found');
  res.json(row);
});

router.post('/enrichment/:id/retry', async (req, res) => {
  const id = requiredParam(req, 'id');
  const row = await db.queryOne<KbEnrichmentTaskRow>(
    `UPDATE kb_enrichment_tasks t
     SET status = 'pending', attempts = 0, error = NULL, scheduled_at = NOW()
     WHERE t.id::text = $1
     RETURNING t.id, t.entity_id, t.task_type, t.status, t.priority, t.payload, t.result,
               t.error, t.attempts, t.max_attempts, NULL::text AS entity_name, NULL::text AS entity_type,
               t.scheduled_at, t.started_at, t.completed_at, t.created_at`,
    [id],
  );
  if (!row) throw new AppError(404, 'KB enrichment task not found');
  res.json(row);
});

router.delete('/enrichment/:id', async (req, res) => {
  const id = requiredParam(req, 'id');
  const row = await db.queryOne<KbCountRow>(
    "UPDATE kb_enrichment_tasks SET status = 'cancelled' WHERE id::text = $1 RETURNING 1 AS count",
    [id],
  );
  res.json({ cancelled: Boolean(row) });
});

router.get('/sources', async (_req, res) => {
  const rows = await db.query<KbDataSourceRow>(
    `SELECT id, slug, name, source_type, config, sync_schedule, last_synced_at,
            sync_status, sync_error, entity_count, is_active, created_at, updated_at
     FROM kb_data_sources
     ORDER BY name`,
  );
  res.json(rows);
});

router.get('/sources/:key', async (req, res) => {
  const key = requiredParam(req, 'key');
  const row = await db.queryOne<KbDataSourceRow>(
    `SELECT id, slug, name, source_type, config, sync_schedule, last_synced_at,
            sync_status, sync_error, entity_count, is_active, created_at, updated_at
     FROM kb_data_sources
     WHERE id::text = $1 OR slug = $1
     LIMIT 1`,
    [key],
  );
  if (!row) throw new AppError(404, 'KB source not found');
  res.json(row);
});

router.post('/sources/:key/sync', async (req, res) => {
  const key = requiredParam(req, 'key');
  const source = await db.queryOne<KbDataSourceRow>(
    `UPDATE kb_data_sources
     SET sync_status = 'syncing'
     WHERE id::text = $1 OR slug = $1
     RETURNING id, slug, name, source_type, config, sync_schedule, last_synced_at,
               sync_status, sync_error, entity_count, is_active, created_at, updated_at`,
    [key],
  );
  if (!source) throw new AppError(404, 'KB source not found');
  await db.query<KbCountRow>(
    `INSERT INTO kb_enrichment_tasks (task_type, priority, payload)
     VALUES ('source_sync', 3, $1)
     RETURNING 1 AS count`,
    [{ source_slug: source.slug } satisfies KbTaskPayloadJsonb],
  );
  res.json({ sync_triggered: true, source: source.slug, task_type: 'source_sync' });
});

router.get('/access', async (_req, res) => {
  const rows = await db.query<KbAccessRuleRow>(
    `SELECT id, role, category_slug, entity_type, can_read, can_create, can_update,
            can_delete, can_verify, can_export, metadata, created_at
     FROM kb_access_rules
     ORDER BY role, category_slug NULLS FIRST, entity_type NULLS FIRST`,
  );
  res.json(rows);
});

router.get('/access/role/:role', async (req, res) => {
  const role = requiredParam(req, 'role');
  const rows = await db.query<KbAccessRuleRow>(
    `SELECT id, role, category_slug, entity_type, can_read, can_create, can_update,
            can_delete, can_verify, can_export, metadata, created_at
     FROM kb_access_rules
     WHERE role = $1
     ORDER BY category_slug NULLS FIRST, entity_type NULLS FIRST`,
    [role],
  );
  res.json(rows);
});

router.get('/access/check', async (req, res) => {
  const role = readString(req.query['role']);
  if (!role) throw new AppError(400, 'role is required');
  const row = await db.queryOne<KbAccessRuleRow>(
    `SELECT id, role, category_slug, entity_type, can_read, can_create, can_update,
            can_delete, can_verify, can_export, metadata, created_at
     FROM kb_access_rules
     WHERE role = $1
       AND ($2::text IS NULL OR category_slug IS NULL OR category_slug = $2)
       AND ($3::text IS NULL OR entity_type IS NULL OR entity_type = $3)
     ORDER BY category_slug NULLS LAST, entity_type NULLS LAST
     LIMIT 1`,
    [role, readString(req.query['category_slug']) ?? null, readString(req.query['entity_type']) ?? null],
  );
  res.json(row ?? {
    can_read: true,
    can_create: false,
    can_update: false,
    can_delete: false,
    can_verify: false,
    can_export: false,
  });
});

router.get('/config', async (_req, res) => {
  const rows = await db.query<KbConfigRow>(
    'SELECT key, value, description, updated_by, updated_at FROM kb_config ORDER BY key',
  );
  res.json(rows);
});

router.get('/config/:key', async (req, res) => {
  const key = requiredParam(req, 'key');
  const row = await db.queryOne<KbConfigRow>(
    'SELECT key, value, description, updated_by, updated_at FROM kb_config WHERE key = $1',
    [key],
  );
  if (!row) throw new AppError(404, 'KB config not found');
  res.json(row);
});

router.put('/config/:key', async (req: AuthRequest, res) => {
  requireUser(req);
  const key = requiredParam(req, 'key');
  const body = readBody(req);
  const value = body['value'];
  if (!isKbJsonValue(value)) throw new AppError(400, 'value must be JSON serializable');
  const row = await db.queryOne<KbConfigRow>(
    `INSERT INTO kb_config (key, value, description, updated_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value,
         description = EXCLUDED.description,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
     RETURNING key, value, description, updated_by, updated_at`,
    [key, value satisfies KbConfigValueJsonb, readString(body['description']) ?? null, req.user.id],
  );
  res.json(row);
});

router.post('/bulk/entities', async (req: AuthRequest, res) => {
  requireUser(req);
  const body = readBody(req);
  const entities = Array.isArray(body['entities']) ? body['entities'] : [];
  let created = 0;
  const errors: { index: number; slug: string; error: string }[] = [];

  for (const [index, item] of entities.entries()) {
    if (!isKbJsonObject(item)) continue;
    try {
      const categorySlug = requireString(item, 'category_slug');
      const row = await db.queryOne<KbCountRow>(
        `INSERT INTO kb_entities (category_id, entity_type, slug, name, summary, content, metadata, tags, created_by, updated_by)
         SELECT c.id, $2, $3, $4, $5, $6, $7, $8, $9, $9
         FROM kb_categories c
         WHERE c.slug = $1
         ON CONFLICT (slug) DO NOTHING
         RETURNING 1 AS count`,
        [
          categorySlug,
          requireString(item, 'entity_type'),
          requireString(item, 'slug'),
          requireString(item, 'name'),
          readString(item['summary']) ?? null,
          readString(item['content']) ?? null,
          isKbJsonObject(item['metadata']) ? item['metadata'] : {},
          readStringArray(item['tags']),
          req.user.id,
        ],
      );
      if (row) created += 1;
    } catch (error) {
      errors.push({
        index,
        slug: readString(item['slug']) ?? '',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  res.json({ total: entities.length, created, skipped: entities.length - created - errors.length, errors });
});

router.post('/bulk/relations', async (_req, res) => {
  res.json({ total: 0, created: 0, skipped: 0, errors: [] });
});

router.get('/export/entities', async (req, res: Response) => {
  const rows = await db.query<KbEntitySummaryRow>(
    `SELECT e.id, e.entity_type, e.slug, e.status, e.name, e.summary, e.tags,
            e.confidence, e.is_verified, c.path AS category_path, e.created_at, e.updated_at
     FROM kb_entities e
     JOIN kb_categories c ON c.id = e.category_id
     WHERE e.deleted_at IS NULL
       AND ($1::text IS NULL OR e.entity_type = $1)
       AND ($2::text IS NULL OR c.path LIKE $2 || '%')
       AND ($3::text IS NULL OR e.status = $3)
     ORDER BY e.updated_at DESC`,
    [
      readString(req.query['entity_type']) ?? null,
      readString(req.query['category']) ?? null,
      readString(req.query['status']) ?? null,
    ],
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kb-entities.json"');
  res.send(JSON.stringify(rows.map(mapEntitySummary), null, 2));
});

router.get('/export/relations', async (_req, res: Response) => {
  const rows = await db.query<KbRelationExpandedRow>(
    `SELECT r.id, r.relation_type, r.label, r.weight, r.bidirectional,
            f.id AS from_id, f.name AS from_name, f.entity_type AS from_type,
            t.id AS to_id, t.name AS to_name, t.entity_type AS to_type
     FROM kb_relations r
     JOIN kb_entities f ON f.id = r.from_entity_id
     JOIN kb_entities t ON t.id = r.to_entity_id
     ORDER BY r.created_at DESC`,
  );
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="kb-relations.json"');
  res.send(JSON.stringify(rows.map(mapRelation), null, 2));
});

export default router;
