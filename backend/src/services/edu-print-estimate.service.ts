/**
 * edu-print-estimate.service.ts — оценка стоимости печати по образовательной льготе.
 *
 * Кабинет подписчика загружает файл, мы анализируем заливку через Rust print-api и
 * считаем edu-цену ТОЙ ЖЕ функцией, что реальный кассовый чек (calculatePriceWaterfall,
 * channel:'pos'). Это ТОЛЬКО оценка — ничего не пишется в БД, лимит не расходуется.
 *
 * Поток:
 *   presigned-GET (svoefoto.ru/s3-proxy) → Rust analyze-coverage → per-page items →
 *   calculatePriceWaterfall(customerId) → DTO (postранично catalog/edu/withinLimit + summary
 *   + allowance из getStudentDiscountForUser).
 *
 * Per-page edu берём из result.accountDiscount.lines[] (account-скидка 70% применяется
 * АГРЕГАТНЫМ шагом ПОСЛЕ цикла позиций — в items[i] для edu остаётся каталог). Headline
 * eduTotalRub = result.total минус надбавка «минимальный чек» (калькулятор оценивает один
 * файл, не весь чек — минимум показываем отдельным примечанием, не занижая/завышая цену).
 */

import db from '../database/db.js';
import { createLogger } from '../utils/logger.js';
import { cacheGet, cacheSet } from './redis-cache.service.js';
import { storageService } from './storage.service.js';
import {
  analyzeCoverageViaService,
  type CoverageColorMode,
  type RustCoverageResult,
} from './print-api-client.service.js';
import {
  calculatePriceWaterfall,
  minimumCheckSurchargeFromWaterfall,
  MINIMUM_CHECK_TOTAL,
} from './pricing-engine.service.js';
import { getStudentDiscountForUser } from './student-discount.service.js';

const log = createLogger('edu-print-estimate');

/** TTL кэша по (s3Key,colorMode) — тумблер Ч/Б↔Цвет между посчитанными режимами = cache hit. */
const CACHE_TTL_SEC = 15 * 60;

export interface EduPrintEstimatePage {
  page: number;
  coveragePercent: number;
  isColor: boolean;
  tier: string;
  slug: string;
  catalogPriceRub: number;
  eduPriceRub: number;
  withinLimit: boolean;
}

export interface EduPrintEstimateSummary {
  catalogTotalRub: number;
  eduTotalRub: number;
  savingsRub: number;
  documentsConsumed: number;
  documentsOverLimit: number;
  minimumCheckRub: number;
  belowMinimum: boolean;
}

export interface EduPrintEstimateAllowance {
  active: boolean;
  documentsRemaining: number;
  documentsLimit: number;
  photosRemaining: number;
  photosLimit: number;
  periodEnd: string | null;
}

export interface EduPrintEstimateResult {
  pageCount: number;
  documentType: string;
  detectedColor: boolean;
  appliedColorMode: CoverageColorMode;
  pages: EduPrintEstimatePage[];
  summary: EduPrintEstimateSummary;
  allowance: EduPrintEstimateAllowance | null;
  subscription: { active: boolean };
}

export interface EduPrintEstimateFailure {
  error: 'analyze_failed';
}

export type EduPrintEstimateResponse = EduPrintEstimateResult | EduPrintEstimateFailure;

export interface EstimateEduPrintParams {
  userId: string;
  s3Key: string;
  colorMode: CoverageColorMode;
}

function toNumber(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundRub(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Тиры с цветной печатью (Rust coverage_tier). Используется для индикации авто-детекта
 * цвета на фронте, т.к. Rust в JSON не отдаёт has_color_ink напрямую.
 */
const COLOR_TIERS = new Set(['light_color_document', 'color_document', 'photo_document']);

function isColorTier(tier: string): boolean {
  return COLOR_TIERS.has(tier);
}

function cacheKey(s3Key: string, colorMode: CoverageColorMode): string {
  return `edu-print-estimate:${s3Key}:${colorMode}`;
}

/**
 * Резолвер slug → serviceOptionId (только активные). Несколько страниц одного тира
 * ссылаются на один и тот же serviceOptionId — это ок, waterfall обрабатывает их как
 * отдельные позиции quantity=1 (кап min(remaining,qty) распределяется постранично).
 */
async function resolveSlugIds(slugs: string[]): Promise<Map<string, string>> {
  const unique = Array.from(new Set(slugs));
  if (unique.length === 0) return new Map();
  const rows = await db.query<{ id: string; slug: string }>(
    `SELECT id::text, slug FROM service_options WHERE slug = ANY($1) AND is_active = true`,
    [unique],
  );
  return new Map(rows.map(r => [r.slug, r.id]));
}

/**
 * Оценить стоимость печати файла по образовательной льготе пользователя.
 *
 * @throws AppError(502) если Rust analyze-coverage недоступен (пробрасывается из клиента).
 * @returns DTO с постраничной разбивкой или { error: 'analyze_failed' } для битого документа.
 */
export async function estimateEduPrint(params: EstimateEduPrintParams): Promise<EduPrintEstimateResponse> {
  const { userId, s3Key, colorMode } = params;

  const cached = await cacheGet<EduPrintEstimateResponse>(cacheKey(s3Key, colorMode));
  if (cached) return cached;

  const fileUrl = await storageService.generatePresignedGetUrl(s3Key, 3600);

  let coverage: RustCoverageResult;
  try {
    coverage = await analyzeCoverageViaService(fileUrl, colorMode);
  } catch (err: unknown) {
    // Битый/пустой/0-страничный документ → Rust отвечает 4xx; клиент маппит в 502.
    // Отличаем сбой анализа (дружелюбный analyze_failed) от недоступности сервиса:
    // analyzeCoverageViaService всегда кидает AppError(502); для калькулятора важнее
    // показать «не удалось проанализировать», чем голый 502. Кэшировать НЕ нужно.
    log.info('analyze-coverage failed, returning analyze_failed', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { error: 'analyze_failed' };
  }

  if (!Array.isArray(coverage.pages) || coverage.pages.length === 0) {
    return { error: 'analyze_failed' };
  }

  const slugIdMap = await resolveSlugIds(coverage.pages.map(p => p.recommended_slug));

  // Per-page items quantity=1 — кап распределяется постранично, итог = касса.
  const items = coverage.pages.map(page => {
    const serviceOptionId = slugIdMap.get(page.recommended_slug);
    return {
      page,
      serviceOptionId,
    };
  });

  const waterfallItems = items
    .filter((it): it is { page: typeof it.page; serviceOptionId: string } => Boolean(it.serviceOptionId))
    .map(it => ({
      serviceOptionId: it.serviceOptionId,
      quantity: 1,
      printFillPercent: it.page.coverage_percent,
    }));

  const result = await calculatePriceWaterfall({
    customerId: userId,
    channel: 'pos',
    items: waterfallItems,
    applyVolumeDiscount: false,
  });

  // Сколько покрытых льготой единиц (страниц) приходится на каждый serviceOptionId.
  // Мы шлём per-page items quantity=1, поэтому line.quantity=1 на запись; но суммируем
  // line.quantity (а не +1) — на случай, если waterfall сгруппирует позиции.
  const coveredCountBySlugId = new Map<string, number>();
  const discountAmountBySlugId = new Map<string, number>();
  for (const line of result.accountDiscount?.lines ?? []) {
    coveredCountBySlugId.set(line.serviceOptionId, (coveredCountBySlugId.get(line.serviceOptionId) ?? 0) + (line.quantity ?? 1));
    discountAmountBySlugId.set(line.serviceOptionId, (discountAmountBySlugId.get(line.serviceOptionId) ?? 0) + line.amount);
  }

  // Распределяем покрытие постранично в порядке страниц: первые N страниц тира — со скидкой.
  const remainingCoveredBySlugId = new Map(coveredCountBySlugId);
  const pages: EduPrintEstimatePage[] = items.map(({ page, serviceOptionId }) => {
    const catalogPriceRub = roundRub(toNumber(page.recommended_price));
    let eduPriceRub = catalogPriceRub;
    let withinLimit = false;

    if (serviceOptionId) {
      const covered = remainingCoveredBySlugId.get(serviceOptionId) ?? 0;
      const totalCovered = coveredCountBySlugId.get(serviceOptionId) ?? 0;
      const totalDiscount = discountAmountBySlugId.get(serviceOptionId) ?? 0;
      if (covered > 0 && totalCovered > 0) {
        // Скидка распределена равномерно по покрытым страницам одного тира.
        const perPageDiscount = totalDiscount / totalCovered;
        eduPriceRub = roundRub(Math.max(0, catalogPriceRub - perPageDiscount));
        withinLimit = true;
        remainingCoveredBySlugId.set(serviceOptionId, covered - 1);
      }
    }

    return {
      page: page.page_number,
      coveragePercent: roundRub(page.coverage_percent),
      isColor: isColorTier(page.tier),
      tier: page.tier,
      slug: page.recommended_slug,
      catalogPriceRub,
      eduPriceRub,
      withinLimit,
    };
  });

  const studentSummary = await getStudentDiscountForUser(userId);
  const allowance: EduPrintEstimateAllowance | null = studentSummary
    ? {
        active: studentSummary.status === 'active',
        documentsRemaining: studentSummary.print_sheets_remaining,
        documentsLimit: studentSummary.print_sheets_limit,
        photosRemaining: studentSummary.photo_remaining,
        photosLimit: studentSummary.photo_limit,
        periodEnd: studentSummary.allowance_period_end,
      }
    : null;

  const catalogTotalRub = roundRub(result.subtotal);
  const minimumCheckSurcharge = minimumCheckSurchargeFromWaterfall(result.waterfall);
  // result.total включает надбавку «минимальный чек» — для оценки одного файла её
  // вычитаем (показываем отдельным примечанием), чтобы не завышать edu-цену.
  const eduTotalRub = roundRub(result.total - minimumCheckSurcharge);
  const documentsConsumed = result.educationVolumeConsumed?.documents ?? 0;
  // Сверх лимита — только при активной льготе: страницы, не покрытые скидкой
  // (covered < total). Для неподписчика over-limit не имеет смысла → 0.
  const documentsOverLimit = allowance?.active
    ? Math.max(0, pages.length - pages.filter(p => p.withinLimit).length)
    : 0;

  const summary: EduPrintEstimateSummary = {
    catalogTotalRub,
    eduTotalRub,
    savingsRub: roundRub(Math.max(0, catalogTotalRub - eduTotalRub)),
    documentsConsumed,
    documentsOverLimit,
    minimumCheckRub: MINIMUM_CHECK_TOTAL,
    belowMinimum: eduTotalRub < MINIMUM_CHECK_TOTAL,
  };

  const response: EduPrintEstimateResult = {
    pageCount: coverage.page_count,
    documentType: coverage.document_type,
    // detectedColor при auto — что Rust выбрал по факту (color-тир в агрегате);
    // при явном color/bw отражает выбор пользователя.
    detectedColor: isColorTier(coverage.tier),
    appliedColorMode: colorMode,
    pages,
    summary,
    allowance,
    subscription: { active: allowance?.active ?? false },
  };

  await cacheSet(cacheKey(s3Key, colorMode), response, CACHE_TTL_SEC);
  return response;
}
