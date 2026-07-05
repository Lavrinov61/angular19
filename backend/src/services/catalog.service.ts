import db from '../database/db.js';

export interface ProductCategory {
  id: string;
  parent_id: string | null;
  name: string;
  sort_order: number;
  icon: string | null;
  is_active: boolean;
  created_at: string;
  children?: ProductCategory[];
}

export interface Product {
  id: string;
  category_id: string | null;
  name: string;
  product_type: 'product' | 'service';
  code: string | null;
  barcode: string | null;
  unit: string;
  sell_price: number;
  cost_price: number | null;
  vat_rate: string;
  tax_system: string;
  is_discount_allowed: boolean;
  is_bonus_allowed: boolean;
  is_subscription_eligible: boolean;
  subscription_credit_value: number | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  is_favorite: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  category_name?: string;
}

export interface ProductStock {
  id: string;
  product_id: string;
  studio_id: string;
  quantity: number;
  min_quantity: number;
  updated_at: string;
}

// ─── CATEGORIES ───────────────────────────────────────

export async function getCategories(): Promise<ProductCategory[]> {
  const rows = await db.query<ProductCategory>(
    `SELECT id, parent_id, name, sort_order, icon, is_active, created_at FROM product_categories WHERE is_active = true ORDER BY sort_order, name`
  );
  return buildCategoryTree(rows);
}

export async function getAllCategories(): Promise<ProductCategory[]> {
  return db.query<ProductCategory>(
    `SELECT id, parent_id, name, sort_order, icon, is_active, created_at FROM product_categories ORDER BY sort_order, name`
  );
}

function buildCategoryTree(categories: ProductCategory[]): ProductCategory[] {
  const map = new Map<string, ProductCategory>();
  const roots: ProductCategory[] = [];

  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [] });
  }

  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function createCategory(data: {
  name: string;
  parent_id?: string;
  sort_order?: number;
  icon?: string;
}): Promise<ProductCategory> {
  const result = await db.queryOne<ProductCategory>(
    `INSERT INTO product_categories (name, parent_id, sort_order, icon)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [data.name, data.parent_id || null, data.sort_order || 0, data.icon || null]
  );
  return result!;
}

export async function updateCategory(
  id: string,
  data: Partial<{ name: string; parent_id: string | null; sort_order: number; icon: string; is_active: boolean }>
): Promise<ProductCategory | null> {
  const allowed = ['name', 'parent_id', 'sort_order', 'icon', 'is_active'] as const;
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const key of allowed) {
    if (key in data && data[key] !== undefined) {
      fields.push(`${key} = $${idx}`);
      values.push(data[key]);
      idx++;
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  return db.queryOne<ProductCategory>(
    `UPDATE product_categories SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
}

export async function deleteCategory(id: string): Promise<boolean> {
  const result = await db.queryOne<ProductCategory>(
    `UPDATE product_categories SET is_active = false WHERE id = $1 RETURNING id`,
    [id]
  );
  return !!result;
}

// ─── PRODUCTS ─────────────────────────────────────────

export async function getProducts(filters: {
  category_id?: string;
  search?: string;
  active_only?: boolean;
  favorites_only?: boolean;
  subscription_eligible?: boolean;
  product_type?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: Product[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (filters.active_only !== false) {
    conditions.push(`p.is_active = true`);
  }

  if (filters.category_id) {
    conditions.push(`p.category_id = $${idx}`);
    params.push(filters.category_id);
    idx++;
  }

  if (filters.search) {
    conditions.push(`(p.name ILIKE $${idx} OR p.code ILIKE $${idx} OR p.barcode = $${idx + 1})`);
    params.push(`%${filters.search}%`, filters.search);
    idx += 2;
  }

  if (filters.favorites_only) {
    conditions.push(`p.is_favorite = true`);
  }

  if (filters.subscription_eligible) {
    conditions.push(`p.is_subscription_eligible = true`);
  }

  if (filters.product_type) {
    conditions.push(`p.product_type = $${idx}`);
    params.push(filters.product_type);
    idx++;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 100;
  const offset = filters.offset || 0;

  const [items, countResult] = await Promise.all([
    db.query<Product>(
      `SELECT p.*, pc.name as category_name
       FROM products p
       LEFT JOIN product_categories pc ON p.category_id = pc.id
       ${where}
       ORDER BY p.sort_order, p.name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    ),
    db.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM products p ${where}`,
      params
    ),
  ]);

  return { items, total: parseInt(countResult?.count || '0', 10) };
}

export async function getProductById(id: string): Promise<Product | null> {
  return db.queryOne<Product>(
    `SELECT p.*, pc.name as category_name
     FROM products p
     LEFT JOIN product_categories pc ON p.category_id = pc.id
     WHERE p.id = $1`,
    [id]
  );
}

export async function getProductByBarcode(barcode: string): Promise<Product | null> {
  return db.queryOne<Product>(
    `SELECT p.*, pc.name as category_name
     FROM products p
     LEFT JOIN product_categories pc ON p.category_id = pc.id
     WHERE p.barcode = $1 AND p.is_active = true`,
    [barcode]
  );
}

export async function createProduct(data: {
  name: string;
  category_id?: string;
  product_type?: string;
  code?: string;
  barcode?: string;
  unit?: string;
  sell_price: number;
  cost_price?: number;
  vat_rate?: string;
  tax_system?: string;
  is_discount_allowed?: boolean;
  is_bonus_allowed?: boolean;
  is_subscription_eligible?: boolean;
  subscription_credit_value?: number;
  image_url?: string;
  sort_order?: number;
  is_favorite?: boolean;
  metadata?: Record<string, unknown>;
}): Promise<Product> {
  const result = await db.queryOne<Product>(
    `INSERT INTO products (
      name, category_id, product_type, code, barcode, unit,
      sell_price, cost_price, vat_rate, tax_system,
      is_discount_allowed, is_bonus_allowed,
      is_subscription_eligible, subscription_credit_value,
      image_url, sort_order, is_favorite, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
    RETURNING *`,
    [
      data.name,
      data.category_id || null,
      data.product_type || 'service',
      data.code || null,
      data.barcode || null,
      data.unit || 'piece',
      data.sell_price,
      data.cost_price || null,
      data.vat_rate || 'NoVat',
      data.tax_system || 'StsIncome',
      data.is_discount_allowed ?? true,
      data.is_bonus_allowed ?? true,
      data.is_subscription_eligible ?? false,
      data.subscription_credit_value || null,
      data.image_url || null,
      data.sort_order || 0,
      data.is_favorite ?? false,
      JSON.stringify(data.metadata || {}),
    ]
  );
  return result!;
}

export async function updateProduct(
  id: string,
  data: Partial<Omit<Product, 'id' | 'created_at'>>
): Promise<Product | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const allowed = [
    'name', 'category_id', 'product_type', 'code', 'barcode', 'unit',
    'sell_price', 'cost_price', 'vat_rate', 'tax_system',
    'is_discount_allowed', 'is_bonus_allowed',
    'is_subscription_eligible', 'subscription_credit_value',
    'image_url', 'sort_order', 'is_active', 'is_favorite', 'metadata',
  ];

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && allowed.includes(key)) {
      fields.push(`${key} = $${idx}`);
      values.push(key === 'metadata' ? JSON.stringify(value) : value);
      idx++;
    }
  }

  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  values.push(id);

  return db.queryOne<Product>(
    `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );
}

export async function deactivateProduct(id: string): Promise<boolean> {
  const result = await db.queryOne<Product>(
    `UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id]
  );
  return !!result;
}

// ─── IMPORT ──────────────────────────────────────────

export interface ImportResult {
  created: number;
  updated: number;
  errors: Array<{ row: number; name: string; error: string }>;
}

export async function importProducts(
  items: Array<Record<string, unknown> & { name: string; sell_price: number }>,
  mode: 'create_only' | 'upsert' = 'upsert',
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, errors: [] };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (!item.name || item.sell_price === undefined) {
        result.errors.push({ row: i + 1, name: item.name || '', error: 'name и sell_price обязательны' });
        continue;
      }

      let existing: Product | null = null;
      if (item['barcode'] && typeof item['barcode'] === 'string') {
        existing = await getProductByBarcode(item['barcode']);
      }
      if (!existing && mode === 'upsert') {
        existing = await db.queryOne<Product>(
          `SELECT id, category_id, name, product_type, code, barcode, unit, sell_price, cost_price, vat_rate, tax_system, is_discount_allowed, is_bonus_allowed, is_subscription_eligible, subscription_credit_value, image_url, sort_order, is_active, is_favorite, metadata, created_at, updated_at FROM products WHERE name = $1 AND is_active = true LIMIT 1`,
          [item.name],
        );
      }

      if (existing && mode === 'upsert') {
        await updateProduct(existing.id, item as Partial<Product>);
        result.updated++;
      } else if (!existing) {
        await createProduct(item);
        result.created++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      result.errors.push({ row: i + 1, name: item.name, error: msg });
    }
  }

  return result;
}

// ─── STOCK ────────────────────────────────────────────

export async function getStock(studioId: string): Promise<(ProductStock & { product_name: string })[]> {
  return db.query(
    `SELECT ps.*, p.name as product_name
     FROM product_stock ps
     JOIN products p ON ps.product_id = p.id
     WHERE ps.studio_id = $1
     ORDER BY p.name`,
    [studioId]
  );
}

export async function updateStock(
  productId: string,
  studioId: string,
  quantity: number
): Promise<ProductStock> {
  const result = await db.queryOne<ProductStock>(
    `INSERT INTO product_stock (product_id, studio_id, quantity, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (product_id, studio_id)
     DO UPDATE SET quantity = $3, updated_at = NOW()
     RETURNING *`,
    [productId, studioId, quantity]
  );
  return result!;
}

export async function adjustStock(
  productId: string,
  studioId: string,
  delta: number
): Promise<ProductStock> {
  const result = await db.queryOne<ProductStock>(
    `INSERT INTO product_stock (product_id, studio_id, quantity, updated_at)
     VALUES ($1, $2, GREATEST(0, $3), NOW())
     ON CONFLICT (product_id, studio_id)
     DO UPDATE SET quantity = GREATEST(0, product_stock.quantity + $3), updated_at = NOW()
     RETURNING *`,
    [productId, studioId, delta]
  );
  return result!;
}
