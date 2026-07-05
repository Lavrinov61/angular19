/**
 * Prices Service (бывший Kontur Market Prices Service)
 *
 * Kontur Маркет полностью удалён. Все цены берутся из magnus_photo_db
 * (service_options через pricing engine).
 *
 * Функции getKonturPrices() / findPriceNum() / findPrice() сохранены
 * как есть — chat-bot-engine.ts использует их без изменений.
 */

import db from '../database/db.js';
import { toErrorMessage } from '../utils/error-helpers.js';

import { createLogger } from '../utils/logger.js';
// ============================================================================
// Types
// ============================================================================

const logger = createLogger('kontur-prices.service');
export interface PriceMap {
  [name: string]: number;
}

export type PriceEntry = {
  name: string;
  price: number;
};

// ============================================================================
// In-memory cache
// ============================================================================

const CACHE_TTL = 60_000; // 60 сек

let pricingDbMap: PriceMap = {};
let pricingDbLastRead = 0;

/**
 * Загрузить цены из magnus_photo_db (pricing engine).
 * Маппинг: service_option.name → price_studio (studio-only) или base_price.
 */
async function loadPricingEngineMap(): Promise<PriceMap> {
  const now = Date.now();
  if (Object.keys(pricingDbMap).length > 0 && (now - pricingDbLastRead) < CACHE_TTL) {
    return pricingDbMap;
  }

  try {
    const rows = await db.query<{ name: string; price_studio: string | null; base_price: string }>(
      `SELECT so.name, so.price_studio, so.base_price
       FROM service_options so
       JOIN option_groups og ON so.option_group_id = og.id
       JOIN service_categories sc ON og.service_category_id = sc.id
       WHERE so.is_active = true AND sc.is_active = true`
    );
    const map: PriceMap = {};
    for (const row of rows) {
      const price = row.price_studio != null ? parseFloat(row.price_studio) : parseFloat(row.base_price);
      if (price > 0) map[row.name] = price;
    }
    pricingDbMap = map;
    pricingDbLastRead = now;
  } catch (err: unknown) {
    logger.warn('Cannot read pricing engine prices', { error: toErrorMessage(err) });
  }

  return pricingDbMap;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Загрузить цены из magnus_photo_db (pricing engine).
 * Kontur Маркет удалён — все цены управляются через CRM.
 */
export async function getKonturPrices(): Promise<PriceMap> {
  return loadPricingEngineMap();
}

/**
 * Найти цену по ключевому слову (нечёткий поиск по названиям).
 * Возвращает строку "123₽" или пустую строку.
 */
export function findPrice(prices: PriceMap, query: string): string {
  const q = query.toLowerCase();
  for (const [name, price] of Object.entries(prices)) {
    if (name.toLowerCase().includes(q)) {
      return `${Math.round(price)}₽`;
    }
  }
  return '';
}

/**
 * Найти числовую цену по ключевому слову (для расчётов).
 * Возвращает число или 0.
 */
export function findPriceNum(prices: PriceMap, query: string): number {
  const q = query.toLowerCase();
  for (const [name, price] of Object.entries(prices)) {
    if (name.toLowerCase().includes(q)) {
      return Math.round(price);
    }
  }
  return 0;
}

/**
 * Формирует строку с ценой — динамическая из БД, или fallback.
 */
export function priceStr(prices: PriceMap, konturQuery: string, fallback: string): string {
  const dynamic = findPrice(prices, konturQuery);
  return dynamic || fallback;
}

/**
 * Форматировать все цены одной компактной строкой для AI-контекста.
 */
export function formatPricesForAI(prices: PriceMap): string {
  return Object.entries(prices)
    .map(([name, price]) => `${name}: ${Math.round(price)}₽`)
    .join(', ');
}

// ============================================================================
// Price matching helpers (for AI prompt context)
// ============================================================================

const PRICE_STOP_WORDS = new Set([
  'сколько',
  'стоит',
  'стоить',
  'стоимость',
  'цена',
  'цены',
  'прайс',
  'прайслист',
  'прайс-лист',
  'лист',
  'есть',
  'нужно',
  'нужен',
  'нужна',
  'нужны',
  'можно',
  'хочу',
  'хотел',
  'хотела',
  'на',
  'за',
  'ли',
  'это',
  'какой',
  'какая',
  'какие',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-z0-9а-я]+/gi, ' ')
    .trim();
}

function buildQueryTokens(query: string): { primary: string[]; expanded: string[] } {
  const normalized = normalizeText(query);
  if (!normalized) return { primary: [], expanded: [] };

  const rawTokens = normalized.split(/\s+/);
  const primaryTokens = new Set<string>();
  const expandedTokens = new Set<string>();
  const compact = normalized.replace(/\s+/g, '');

  for (const token of rawTokens) {
    if (token.length < 2) continue;
    if (PRICE_STOP_WORDS.has(token)) continue;

    primaryTokens.add(token);
    expandedTokens.add(token);

    if (token.length >= 6 && /[a-zа-я]/i.test(token)) {
      expandedTokens.add(token.slice(0, -1));
      expandedTokens.add(token.slice(0, -2));
    }

    if (/^a\d+$/i.test(token)) {
      expandedTokens.add(token.replace(/^a/i, 'а'));
    }
    if (/^а\d+$/i.test(token)) {
      expandedTokens.add(token.replace(/^а/i, 'a'));
    }
    if (token === 'чб' || token === 'ч/б') {
      expandedTokens.add('черн');
      expandedTokens.add('черно');
    }
    if (token.startsWith('цветн')) {
      expandedTokens.add('цвет');
    }
  }

  if (compact.includes('чб')) {
    expandedTokens.add('черн');
    expandedTokens.add('черно');
  }

  return { primary: Array.from(primaryTokens), expanded: Array.from(expandedTokens) };
}

function tokenMatchKey(token: string): string {
  if (token.length >= 6 && /[a-zа-я]/i.test(token)) {
    return token.slice(0, 5);
  }
  return token;
}

function scorePriceEntry(
  name: string,
  scoreTokens: string[],
  normalizedQuery: string,
): { score: number; matchCount: number } {
  const normalizedName = normalizeText(name);
  if (!normalizedName) return { score: 0, matchCount: 0 };

  let score = 0;
  const matchedKeys = new Set<string>();

  if (normalizedQuery && normalizedQuery.length >= 4 && normalizedName.includes(normalizedQuery)) {
    score += 4;
  }

  for (const token of scoreTokens) {
    if (!token) continue;
    if (normalizedName.includes(token)) {
      score += token.length >= 4 ? 2 : 1;
      matchedKeys.add(tokenMatchKey(token));
    }
  }

  return { score, matchCount: matchedKeys.size };
}

/**
 * Подобрать релевантные цены для запроса пользователя, чтобы не давать весь прайс.
 */
export function selectPriceEntriesForQuery(
  prices: PriceMap,
  query: string,
  maxItems = 6,
): PriceEntry[] {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return [];

  const { primary: primaryTokens, expanded: scoreTokens } = buildQueryTokens(query);
  if (primaryTokens.length === 0) return [];

  const scored = Object.entries(prices).map(([name, price]) => {
    const { score, matchCount } = scorePriceEntry(name, scoreTokens, normalizedQuery);
    return { name, price, score, matchCount };
  }).filter((entry) => entry.score > 0);

  if (scored.length === 0) return [];

  const requiredMatches = primaryTokens.length >= 2 ? 2 : 1;
  const filtered = scored.filter((entry) => entry.matchCount >= requiredMatches);

  const sorted = (filtered.length > 0 ? filtered : scored)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  return sorted.slice(0, maxItems).map(({ name, price }) => ({ name, price }));
}

export function formatPriceEntriesForAI(entries: PriceEntry[]): string {
  return entries
    .map(({ name, price }) => `${name}: ${Math.round(price)}₽`)
    .join(', ');
}
