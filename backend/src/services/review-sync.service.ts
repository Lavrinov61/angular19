import db from '../database/db.js';
import { config } from '../config/index.js';
import { fetchWithCB, SERVICE_BREAKERS } from '../utils/circuit-breaker.js';
import type { ReviewStatsRawResponse, ReviewStatsRawSource } from '../types/jsonb/review-sync-jsonb.js';
import type { ReviewPlatformStatsRow } from '../types/views/review-views.js';

import { createLogger } from '../utils/logger.js';
const TAG = '[ReviewSync]';
const INTERVAL_MS = config.reviewSync.intervalHours * 60 * 60 * 1000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

const logger = createLogger('review-sync.service');
const REVIEW_SYNC_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const AUTO_SYNCED_REVIEW_PLATFORMS: ReadonlySet<string> = new Set(['2gis', 'yandex']);

type ReviewSyncPlatform = '2gis' | 'yandex';

interface ReviewSyncLocation {
  slug: string;
  name: string;
  dgisOrgId: string;
  dgisUrl: string;
  yandexReviewUrl: string;
}

interface ExternalReviewStats {
  rating: number;
  reviewCount: number;
  raw: ReviewStatsRawResponse;
}

interface ReviewStats {
  platform: string;
  location: string;
  name: string;
  rating: number;
  reviewCount: number;
  lastSynced: string;
}

interface PlatformSummary {
  platform: string;
  rating: number;
  reviewCount: number;
  url: string;
}

interface AggregatedStats {
  totalReviews: number;
  averageRating: number;
  platforms: ReviewStats[];
  platformSummary: PlatformSummary[];
  lastSynced: string | null;
}

// ===== 2GIS Парсинг =====

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseLocalizedFloat(value: string | null | undefined): number {
  if (!value) return 0;

  const parsed = Number.parseFloat(value.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLocalizedInt(value: string | null | undefined): number {
  if (!value) return 0;

  const parsed = Number.parseInt(value.replace(/[^\d]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasReviewStats(stats: Pick<ExternalReviewStats, 'rating' | 'reviewCount'>): boolean {
  return stats.rating > 0 || stats.reviewCount > 0;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function getMetaContentByAttribute(html: string, attrName: string, attrValue: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const attrPattern = new RegExp(`\\b${escapeRegExp(attrName)}\\s*=\\s*["']${escapeRegExp(attrValue)}["']`, 'i');

  for (const tag of metaTags) {
    if (!attrPattern.test(tag)) continue;

    const contentMatch = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(tag);
    if (contentMatch) {
      return decodeHtmlAttribute(contentMatch[2]);
    }
  }

  return null;
}

function parse2gisEmbeddedStats(html: string, source: ReviewStatsRawSource): ExternalReviewStats | null {
  const ratingMatch = /"general_rating"\s*:\s*([\d.,]+)/.exec(html);
  const countMatch = /"general_review_count"\s*:\s*(\d+)/.exec(html);
  const rating = parseLocalizedFloat(ratingMatch?.[1]);
  const reviewCount = parseLocalizedInt(countMatch?.[1]);

  if (!hasReviewStats({ rating, reviewCount })) {
    return null;
  }

  return { rating, reviewCount, raw: { source, rating, reviewCount } };
}

function parse2gisDescriptionStats(html: string): ExternalReviewStats | null {
  const description = getMetaContentByAttribute(html, 'name', 'description')
    ?? getMetaContentByAttribute(html, 'property', 'og:description');

  if (!description) {
    return null;
  }

  const countMatch = /(\d[\d\s]*)\s+отзыв(?:ов|а)?/i.exec(description);
  const ratingMatch = /рейтинг\s+([\d.,]+)/i.exec(description);
  const rating = parseLocalizedFloat(ratingMatch?.[1]);
  const reviewCount = parseLocalizedInt(countMatch?.[1]);

  if (!hasReviewStats({ rating, reviewCount })) {
    return null;
  }

  return { rating, reviewCount, raw: { source: 'meta-description', rating, reviewCount } };
}

function parse2gisStatsFromHtml(html: string, orgId: string): ExternalReviewStats | null {
  const orgBlockPattern = new RegExp(`"${escapeRegExp(orgId)}":\\s*\\{"data"`);
  const orgMatch = orgBlockPattern.exec(html);

  if (orgMatch) {
    const chunk = html.substring(orgMatch.index, orgMatch.index + 5000);
    const orgStats = parse2gisEmbeddedStats(chunk, 'embedded-org');

    if (orgStats) {
      return { ...orgStats, raw: { ...orgStats.raw, orgId } };
    }
  }

  const embeddedStats = parse2gisEmbeddedStats(html, 'embedded-page');
  if (embeddedStats) {
    return { ...embeddedStats, raw: { ...embeddedStats.raw, orgId } };
  }

  const descriptionStats = parse2gisDescriptionStats(html);
  if (descriptionStats) {
    return { ...descriptionStats, raw: { ...descriptionStats.raw, orgId } };
  }

  return null;
}

function parseJsonNumber(html: string, key: string): number {
  const match = new RegExp(`"${escapeRegExp(key)}"\\s*:\\s*"?([\\d.,]+)"?`, 'i').exec(html);
  return parseLocalizedFloat(match?.[1]);
}

function parseYandexStatsFromHtml(html: string): ExternalReviewStats | null {
  const jsonRating = parseJsonNumber(html, 'ratingValue');
  const jsonReviewCount = parseLocalizedInt(new RegExp(`"${escapeRegExp('reviewCount')}"\\s*:\\s*"?([\\d\\s]+)"?`, 'i').exec(html)?.[1]);

  if (hasReviewStats({ rating: jsonRating, reviewCount: jsonReviewCount })) {
    return {
      rating: jsonRating,
      reviewCount: jsonReviewCount,
      raw: { source: 'json', rating: jsonRating, reviewCount: jsonReviewCount },
    };
  }

  const metaRating = parseLocalizedFloat(getMetaContentByAttribute(html, 'itemProp', 'ratingValue'));
  const metaReviewCount = parseLocalizedInt(getMetaContentByAttribute(html, 'itemProp', 'reviewCount'));

  if (hasReviewStats({ rating: metaRating, reviewCount: metaReviewCount })) {
    return {
      rating: metaRating,
      reviewCount: metaReviewCount,
      raw: { source: 'itemprop-meta', rating: metaRating, reviewCount: metaReviewCount },
    };
  }

  return null;
}

async function fetchReviewHtml(platform: string, url: string): Promise<string | null> {
  try {
    const response = await fetchWithCB(SERVICE_BREAKERS.reviewSync, url, {
      headers: {
        'User-Agent': REVIEW_SYNC_USER_AGENT,
        'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      },
    });

    if (!response.ok) {
      logger.error(`${TAG} ${platform} HTTP ${response.status} for ${url}`);
      return null;
    }

    return await response.text();
  } catch (err) {
    logger.error(`${TAG} ${platform} fetch error for ${url}:`, { error: String(err) });
    return null;
  }
}

async function fetch2gisStats(orgId: string, url: string): Promise<ExternalReviewStats | null> {
  const html = await fetchReviewHtml('2GIS', url);
  if (!html) return null;

  const stats = parse2gisStatsFromHtml(html, orgId);
  if (!stats) {
    logger.warn(`${TAG} 2GIS: no review data found for ${orgId}`);
  }

  return stats;
}

async function fetchYandexStats(url: string): Promise<ExternalReviewStats | null> {
  const html = await fetchReviewHtml('Yandex', url);
  if (!html) return null;

  const stats = parseYandexStatsFromHtml(html);
  if (!stats) {
    logger.warn(`${TAG} Yandex: no review data found for ${url}`);
  }

  return stats;
}

// ===== БД операции =====

async function upsertStats(
  platform: string,
  locationSlug: string,
  locationName: string,
  externalUrl: string,
  rating: number,
  reviewCount: number,
  raw: ReviewStatsRawResponse,
): Promise<void> {
  const params: unknown[] = [platform, locationSlug, locationName, externalUrl, rating, reviewCount, JSON.stringify(raw)];

  await db.query(
    `INSERT INTO review_platform_stats (platform, location_slug, location_name, external_url, rating, review_count, last_synced_at, raw_response, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, NOW())
     ON CONFLICT (platform, location_slug) DO UPDATE SET
       rating = $5,
       review_count = $6,
       last_synced_at = NOW(),
       sync_error = NULL,
       raw_response = $7,
       updated_at = NOW()`,
    params,
  );
}

async function setSyncError(
  platform: string,
  locationSlug: string,
  locationName: string,
  externalUrl: string,
  error: string,
): Promise<void> {
  const params: unknown[] = [platform, locationSlug, locationName, externalUrl, error];

  await db.query(
    `INSERT INTO review_platform_stats (platform, location_slug, location_name, external_url, review_count, sync_error, updated_at)
     VALUES ($1, $2, $3, $4, 0, $5, NOW())
     ON CONFLICT (platform, location_slug) DO UPDATE SET
       location_name = $3,
       external_url = $4,
       sync_error = $5,
       updated_at = NOW()`,
    params,
  );
}

// ===== Синхронизация =====

async function syncPlatform(
  platform: ReviewSyncPlatform,
  location: ReviewSyncLocation,
  externalUrl: string,
  fetchStats: () => Promise<ExternalReviewStats | null>,
): Promise<void> {
  try {
    const stats = await fetchStats();

    if (!stats) {
      const message = 'No review data found';
      await setSyncError(platform, location.slug, location.name, externalUrl, message);
      logger.warn(`${TAG} ${platform} ${location.name}: ${message}`);
      return;
    }

    await upsertStats(platform, location.slug, location.name, externalUrl, stats.rating, stats.reviewCount, stats.raw);
    logger.info(`${TAG} ${platform} ${location.name}: ${stats.rating}★ (${stats.reviewCount} отзывов)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`${TAG} ${platform} ${location.name} sync failed:`, { detail: message });

    try {
      await setSyncError(platform, location.slug, location.name, externalUrl, message);
    } catch (syncErr) {
      logger.error(`${TAG} ${platform} ${location.name} failed to store sync error:`, { detail: String(syncErr) });
    }
  }
}

async function syncAllPlatforms(): Promise<void> {
  logger.info(`${TAG} Starting sync...`);

  for (const location of config.reviewSync.locations) {
    await syncPlatform('2gis', location, location.dgisUrl, () => fetch2gisStats(location.dgisOrgId, location.dgisUrl));
    await syncPlatform('yandex', location, location.yandexReviewUrl, () => fetchYandexStats(location.yandexReviewUrl));
  }

  logger.info(`${TAG} Sync complete`);
}

// ===== API — чтение из БД =====

export async function getAggregatedStats(): Promise<AggregatedStats> {
  const rows = await db.query<ReviewPlatformStatsRow>(
    `SELECT platform, location_slug, location_name, rating, review_count, last_synced_at
     FROM review_platform_stats
     WHERE platform IN ('2gis', 'yandex')
       AND (review_count > 0 OR rating IS NOT NULL)
     ORDER BY platform, location_slug`,
  );

  const platforms: ReviewStats[] = rows.filter(r => AUTO_SYNCED_REVIEW_PLATFORMS.has(r.platform)).map(r => ({
    platform: r.platform,
    location: r.location_slug,
    name: r.location_name || r.location_slug,
    rating: parseLocalizedFloat(r.rating),
    reviewCount: r.review_count ?? 0,
    lastSynced: r.last_synced_at ?? '',
  }));

  const totalReviews = platforms.reduce((sum, p) => sum + p.reviewCount, 0);
  const ratedPlatforms = platforms.filter(p => p.rating > 0 && p.reviewCount > 0);
  const ratedReviewCount = ratedPlatforms.reduce((sum, p) => sum + p.reviewCount, 0);
  const weightedRating = ratedPlatforms.reduce((sum, p) => sum + p.rating * p.reviewCount, 0);
  const avgRating = ratedReviewCount > 0
    ? Math.round((weightedRating / ratedReviewCount) * 10) / 10
    : 0;

  const lastSyncedValues = rows.map(r => r.last_synced_at).filter((value): value is string => Boolean(value));
  const lastSynced = lastSyncedValues.length > 0
    ? lastSyncedValues.reduce((max, value) => (value > max ? value : max), lastSyncedValues[0])
    : null;

  // Агрегируем по площадкам (суммируем локации одной платформы)
  const platformUrls: Record<string, string> = {
    yandex: 'https://yandex.ru/maps/-/CHDBudSq',
    '2gis': 'https://2gis.ru/rostov-on-don/firm/70000001006548410/tab/reviews',
  };

  const platformMap: Record<string, { totalReviews: number; ratedReviews: number; weightedRating: number }> = {};
  for (const p of platforms) {
    if (!platformMap[p.platform]) {
      platformMap[p.platform] = { totalReviews: 0, ratedReviews: 0, weightedRating: 0 };
    }
    platformMap[p.platform].totalReviews += p.reviewCount;

    if (p.rating > 0 && p.reviewCount > 0) {
      platformMap[p.platform].ratedReviews += p.reviewCount;
      platformMap[p.platform].weightedRating += p.rating * p.reviewCount;
    }
  }

  const platformSummary: PlatformSummary[] = Object.entries(platformMap).map(([platform, data]) => ({
    platform,
    rating: data.ratedReviews > 0
      ? Math.round((data.weightedRating / data.ratedReviews) * 10) / 10
      : 0,
    reviewCount: data.totalReviews,
    url: platformUrls[platform] ?? '',
  }));

  // Сортируем: яндекс первый (больше всего отзывов)
  platformSummary.sort((a, b) => b.reviewCount - a.reviewCount);

  return { totalReviews, averageRating: avgRating, platforms, platformSummary, lastSynced };
}

// ===== Ручной запуск =====

export async function triggerSync(): Promise<void> {
  await syncAllPlatforms();
}

// ===== Планировщик =====

export function startReviewSyncScheduler(): void {
  if (!config.reviewSync.enabled) {
    logger.info(`${TAG} Scheduler disabled`);
    return;
  }

  if (intervalHandle) {
    logger.warn(`${TAG} Scheduler already running`);
    return;
  }

  logger.info(`${TAG} Scheduler started (interval: ${config.reviewSync.intervalHours}h)`);

  // Первый запуск через 60 секунд после старта
  setTimeout(() => {
    syncAllPlatforms().catch(err => logger.error(`${TAG} Initial sync error`, { error: String(err) }));
  }, 60_000);

  intervalHandle = setInterval(() => {
    syncAllPlatforms().catch(err => logger.error(`${TAG} Scheduled sync error`, { error: String(err) }));
  }, INTERVAL_MS);
}

export function stopReviewSyncScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    logger.info(`${TAG} Scheduler stopped`);
  }
}
