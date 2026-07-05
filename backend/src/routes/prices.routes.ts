/**
 * Маршруты для получения актуальных цен из Контур Маркет.
 * Цены читаются из БД multiplatform_publication.market_data_cache,
 * куда их складывает Python-синхронизатор (conturmarket/).
 * Используются только для офлайн-студии.
 */

import { Router, Request, Response } from 'express';
import { mpPool } from '../database/mp-db.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ===== Redis cache (shared across nodes, 60 sec TTL) =====
import { cacheGet, cacheSet } from '../services/redis-cache.service.js';

import { createLogger } from '../utils/logger.js';
type PriceMap = Record<string, number>;

const logger = createLogger('prices.routes');
interface ServiceItem {
  id: string;
  code: number;
  name: string;
  price: number;
  group_id?: string;
  group_name?: string;
  product_type?: string;
}

interface PricesCache {
  prices: PriceMap;
  services: ServiceItem[];
}

interface PhotoPrintPrices {
  premium_10x15: number;
  premium_15x20: number;
  premium_20x30: number;
  super_10x15: number;
  super_15x20: number;
  super_20x30: number;
}

const PRICES_CACHE_KEY = 'kontur:prices';
const PRICES_CACHE_TTL_SEC = 60;
const PHOTO_PRINT_PRICES: PhotoPrintPrices = {
  premium_10x15: 20,
  premium_15x20: 49,
  premium_20x30: 117,
  super_10x15: 36,
  super_15x20: 70,
  super_20x30: 140,
};

function minPhotoPrintPrice(prices: PhotoPrintPrices): number {
  return Math.min(
    prices.premium_10x15,
    prices.premium_15x20,
    prices.premium_20x30,
    prices.super_10x15,
    prices.super_15x20,
    prices.super_20x30,
  );
}

/**
 * Загрузить цены из market_data_cache (через Redis cache)
 */
async function loadFromDb(): Promise<PricesCache> {
  // Check Redis cache first
  const cached = await cacheGet<PricesCache>(PRICES_CACHE_KEY);
  if (cached) return cached;

  let prices: PriceMap = {};
  const services: ServiceItem[] = [];

  try {
    // Читаем prices (словарь {name: price})
    const pricesResult = await mpPool.query(
      `SELECT data FROM market_data_cache
       WHERE cache_key LIKE 'prices_%' AND cache_key != 'prices_None'
       ORDER BY expires_at DESC LIMIT 1`
    );

    if (pricesResult.rows.length > 0) {
      prices = pricesResult.rows[0].data as PriceMap;
    }

    // Читаем services (массив [{id, code, name, price, ...}])
    const servicesResult = await mpPool.query(
      `SELECT data FROM market_data_cache
       WHERE cache_key LIKE 'services_%' AND cache_key != 'services_None'
       ORDER BY expires_at DESC LIMIT 1`
    );

    if (servicesResult.rows.length > 0) {
      const rawServices = servicesResult.rows[0].data;
      if (Array.isArray(rawServices)) {
        // Дедупликация по id (в кеше могут быть дубли для разных магазинов)
        const seen = new Set<string>();
        for (const svc of rawServices) {
          const key = `${svc.id}_${svc.group_id || ''}`;
          if (!seen.has(key)) {
            seen.add(key);
            services.push(svc);
          }
        }
      }
    }

    const result: PricesCache = { prices, services };
    await cacheSet(PRICES_CACHE_KEY, result, PRICES_CACHE_TTL_SEC);
    logger.info(`Prices loaded from DB: ${Object.keys(prices).length} prices, ${services.length} services`);
    return result;
  } catch (err) {
    logger.error('Error loading prices from DB:', { error: String(err) });
    return { prices: {}, services: [] };
  }
}

// ===== Роуты =====

/**
 * GET /api/prices
 * Получить все актуальные цены (словарь {название: цена})
 */
router.get('/', async (_req: Request, res: Response): Promise<void> => {
  const data = await loadFromDb();
  res.json({
    prices: data.prices,
    services: data.services,
    updatedAt: new Date().toISOString(),
  });
});

/**
 * GET /api/prices/photo-print
 * Online photo print landing prices.
 */
router.get('/photo-print', async (_req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    prices: PHOTO_PRINT_PRICES,
    min_price: minPhotoPrintPrice(PHOTO_PRINT_PRICES),
  });
});

/**
 * GET /api/prices/search?q=визитка
 * Поиск цены по названию
 */
router.get('/search', async (req: Request, res: Response): Promise<void> => {
  const query = (req.query['q'] as string || '').toLowerCase().trim();
  if (!query) throw new AppError(400, 'Параметр q обязателен');

  const data = await loadFromDb();

  // Ищем в словаре цен
  const results: { name: string; price: number }[] = [];
  for (const [name, price] of Object.entries(data.prices)) {
    if (name.toLowerCase().includes(query)) {
      results.push({ name, price });
    }
  }

  res.json({ query, results, total: results.length });
});

/**
 * POST /api/prices/refresh
 * Принудительно перечитать кеш из БД
 */
router.post('/refresh', async (_req: Request, res: Response): Promise<void> => {
  // Invalidate Redis cache, then reload from DB
  const { cacheDel: delKey } = await import('../services/redis-cache.service.js');
  await delKey(PRICES_CACHE_KEY);
  const data = await loadFromDb();
  res.json({
    success: true,
    pricesCount: Object.keys(data.prices).length,
    servicesCount: data.services.length,
  });
});

export default router;
