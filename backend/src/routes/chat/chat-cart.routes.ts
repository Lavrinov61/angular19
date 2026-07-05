import { Router, Request, Response } from 'express';
import { pool } from '../../database/db.js';
import { AppError } from '../../middleware/errorHandler.js';
import { requireUser, type AuthRequest } from '../../middleware/auth.js';
import { getOwnedConversation } from './chat-shared.js';
import type { ChatCartItemMetadataJson } from '../../types/jsonb/chat-cart-jsonb.js';

type CartItemRow = {
  id: string;
  session_id: string;
  service_id: string;
  service_name: string;
  service_description: string | null;
  service_icon: string | null;
  price: string;
  next_price: string | null;
  price_max: string | null;
  quantity: number;
  note: string | null;
  metadata: ChatCartItemMetadataJson;
  created_at: string;
  updated_at: string;
};

type SyncCartItem = {
  serviceId: string;
  name: string;
  description?: string;
  icon?: string;
  price: number;
  nextPrice?: number;
  priceMax?: number;
  quantity: number;
  note?: string;
  metadata?: ChatCartItemMetadataJson;
};

const router = Router();

interface UnknownObject {
  [key: string]: unknown;
}

function isUnknownObject(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isChatCartItemMetadata(value: unknown): value is ChatCartItemMetadataJson {
  return isUnknownObject(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function syncCartItemFromUnknown(value: unknown): SyncCartItem | null {
  if (!isUnknownObject(value)) return null;

  const serviceId = stringValue(value['serviceId']);
  const name = stringValue(value['name']);
  const price = numberValue(value['price']);
  if (!serviceId || !name || price == null) return null;

  return {
    serviceId,
    name,
    description: stringValue(value['description']),
    icon: stringValue(value['icon']),
    price,
    nextPrice: numberValue(value['nextPrice']),
    priceMax: numberValue(value['priceMax']),
    quantity: numberValue(value['quantity']) ?? 1,
    note: stringValue(value['note']),
    metadata: isChatCartItemMetadata(value['metadata']) ? value['metadata'] : undefined,
  };
}

function toNumber(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapRow(row: CartItemRow) {
  return {
    id: row.id,
    sessionId: row.session_id,
    serviceId: row.service_id,
    name: row.service_name,
    description: row.service_description || undefined,
    icon: row.service_icon || undefined,
    price: Number(row.price),
    nextPrice: toNumber(row.next_price) ?? undefined,
    priceMax: toNumber(row.price_max) ?? undefined,
    quantity: row.quantity,
    note: row.note || undefined,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function subtotal(item: ReturnType<typeof mapRow>): number {
  if (item.nextPrice != null && item.nextPrice !== item.price && item.quantity > 1) {
    return item.price + item.nextPrice * (item.quantity - 1);
  }
  return item.price * item.quantity;
}

/**
 * Вспомогательная обёртка: проверяет, что conversation принадлежит user'у
 * из JWT. Используется во всех /sessions/:id/cart/* маршрутах.
 */
export async function ensureSessionOwnerByUser(req: AuthRequest, sessionId: string): Promise<void> {
  requireUser(req);
  await getOwnedConversation(req.user.id, sessionId);
}

async function loadCart(sessionId: string) {
  const rows = await pool.query<CartItemRow>(
    `SELECT * FROM visitor_chat_cart_items WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId],
  );
  const items = rows.rows.map(mapRow);
  const total = items.reduce((sum, item) => sum + subtotal(item), 0);
  return { items, total };
}

function emitCartUpdated(req: Request, sessionId: string, items: unknown[]): void {
  const io = req.app.socketServer?.getIO();
  if (!io) return;

  const payload = { sessionId, items };
  io.to(`visitor:${sessionId}`).emit('operator:cart-update', payload);
  io.to('admin:visitor-chats').emit('visitor:cart-update', payload);
}

router.get('/sessions/:sessionId/cart', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  await ensureSessionOwnerByUser(req, sessionId);

  const { items, total } = await loadCart(sessionId);
  res.json({ success: true, data: { items, total } });
});

router.post('/sessions/:sessionId/cart/items', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const rawBody: unknown = req.body;
  const body: UnknownObject = isUnknownObject(rawBody) ? rawBody : {};
  const serviceId = stringValue(body['serviceId']);
  const name = stringValue(body['name']);
  const description = stringValue(body['description']);
  const icon = stringValue(body['icon']);
  const price = numberValue(body['price']);
  const nextPrice = numberValue(body['nextPrice']);
  const priceMax = numberValue(body['priceMax']);
  const quantity = numberValue(body['quantity']) ?? 1;
  const note = stringValue(body['note']);
  const metadata = isChatCartItemMetadata(body['metadata']) ? body['metadata'] : undefined;

  if (!serviceId || !name || price == null) {
    throw new AppError(400, 'serviceId, name and price are required');
  }

  const normalizedQty = Math.max(1, Math.min(999, Number(quantity) || 1));
  await ensureSessionOwnerByUser(req, sessionId);

  await pool.query(
    `INSERT INTO visitor_chat_cart_items
      (session_id, service_id, service_name, service_description, service_icon, price, next_price, price_max, quantity, note, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::jsonb, '{}'::jsonb))
     ON CONFLICT (session_id, service_id)
     DO UPDATE SET
       service_name = EXCLUDED.service_name,
       service_description = EXCLUDED.service_description,
       service_icon = EXCLUDED.service_icon,
       price = EXCLUDED.price,
       next_price = EXCLUDED.next_price,
       price_max = EXCLUDED.price_max,
       quantity = LEAST(999, visitor_chat_cart_items.quantity + EXCLUDED.quantity),
       note = COALESCE(EXCLUDED.note, visitor_chat_cart_items.note),
       metadata = COALESCE(visitor_chat_cart_items.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb),
       updated_at = NOW()`,
    [
      sessionId,
      serviceId,
      name,
      description || null,
      icon || null,
      price,
      nextPrice ?? null,
      priceMax ?? null,
      normalizedQty,
      note || null,
      metadata ? JSON.stringify(metadata) : null,
    ],
  );

  const { items, total } = await loadCart(sessionId);
  emitCartUpdated(req, sessionId, items);

  res.json({ success: true, data: { items, total } });
});

router.patch('/sessions/:sessionId/cart/items/:itemId', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId, itemId } = req.params;
  const rawBody: unknown = req.body;
  const body: UnknownObject = isUnknownObject(rawBody) ? rawBody : {};
  const quantity = numberValue(body['quantity']);
  const note = stringValue(body['note']);

  await ensureSessionOwnerByUser(req, sessionId);

  if (quantity != null) {
    const normalizedQty = Math.max(0, Math.min(999, Number(quantity) || 0));
    if (normalizedQty === 0) {
      await pool.query(
        'DELETE FROM visitor_chat_cart_items WHERE id = $1 AND session_id = $2',
        [itemId, sessionId],
      );
    } else {
      await pool.query(
        'UPDATE visitor_chat_cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2 AND session_id = $3',
        [normalizedQty, itemId, sessionId],
      );
    }
  }

  if (note != null) {
    await pool.query(
      'UPDATE visitor_chat_cart_items SET note = $1, updated_at = NOW() WHERE id = $2 AND session_id = $3',
      [note, itemId, sessionId],
    );
  }

  const { items, total } = await loadCart(sessionId);
  emitCartUpdated(req, sessionId, items);

  res.json({ success: true, data: { items, total } });
});

router.delete('/sessions/:sessionId/cart/items/:itemId', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId, itemId } = req.params;
  await ensureSessionOwnerByUser(req, sessionId);

  await pool.query('DELETE FROM visitor_chat_cart_items WHERE id = $1 AND session_id = $2', [itemId, sessionId]);

  const { items, total } = await loadCart(sessionId);
  emitCartUpdated(req, sessionId, items);

  res.json({ success: true, data: { items, total } });
});

router.delete('/sessions/:sessionId/cart', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  await ensureSessionOwnerByUser(req, sessionId);

  await pool.query('DELETE FROM visitor_chat_cart_items WHERE session_id = $1', [sessionId]);
  emitCartUpdated(req, sessionId, []);

  res.json({ success: true, data: { items: [], total: 0 } });
});

router.post('/sessions/:sessionId/cart/sync', async (req: AuthRequest, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  const rawBody: unknown = req.body;
  const body: UnknownObject = isUnknownObject(rawBody) ? rawBody : {};
  const rawItems = body['items'];

  if (!Array.isArray(rawItems)) {
    throw new AppError(400, 'items array is required');
  }
  const items = rawItems
    .map(syncCartItemFromUnknown)
    .filter((item): item is SyncCartItem => item !== null);

  await ensureSessionOwnerByUser(req, sessionId);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM visitor_chat_cart_items WHERE session_id = $1', [sessionId]);

    for (const item of items) {
      if (!item.serviceId || !item.name || typeof item.price !== 'number') continue;
      const normalizedQty = Math.max(1, Math.min(999, Number(item.quantity) || 1));

      await client.query(
        `INSERT INTO visitor_chat_cart_items
          (session_id, service_id, service_name, service_description, service_icon, price, next_price, price_max, quantity, note, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::jsonb, '{}'::jsonb))`,
        [
          sessionId,
          item.serviceId,
          item.name,
          item.description || null,
          item.icon || null,
          item.price,
          item.nextPrice ?? null,
          item.priceMax ?? null,
          normalizedQty,
          item.note || null,
          item.metadata ? JSON.stringify(item.metadata) : null,
        ],
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const { items: updatedItems, total } = await loadCart(sessionId);
  emitCartUpdated(req, sessionId, updatedItems);

  res.json({ success: true, data: { items: updatedItems, total } });
});

export default router;
