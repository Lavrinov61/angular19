import { z } from 'zod';
import type { RestorationTier, RestorationWorkloadSnapshot } from './restoration-workload.service.js';
import { falAIService, type FalResult } from './fal-ai.service.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('restoration-image-analysis');

const RESTORATION_FAL_ROUTE = 'openrouter/router/vision';
const RESTORATION_VISION_MODEL = process.env['RESTORATION_ANALYSIS_MODEL'] || 'google/gemini-2.5-flash';
const RESTORATION_ANALYSIS_TIMEOUT_MS = Number.parseInt(
  process.env['RESTORATION_ANALYSIS_TIMEOUT_MS'] || '3500',
  10,
);
const RESTORATION_ANALYSIS_BUDGET_MS = Number.parseInt(
  process.env['RESTORATION_ANALYSIS_BUDGET_MS'] || '4000',
  10,
);
const DEFAULT_PRINT_DPI = 300;
const MANUAL_PRICE_LABEL = 'после оценки ретушёром';

const scoreSchema = z.coerce.number().int().min(0).max(3);

const outputTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('digital'),
    label: z.string().trim().min(1).max(80).optional(),
  }),
  z.object({
    kind: z.literal('print'),
    widthCm: z.coerce.number().positive().max(100),
    heightCm: z.coerce.number().positive().max(100),
    dpi: z.coerce.number().int().min(150).max(600).optional().default(DEFAULT_PRINT_DPI),
    label: z.string().trim().min(1).max(80).optional(),
  }),
]);

const confidenceSchema = z.coerce
  .number()
  .catch(0)
  .transform(v => (!Number.isFinite(v) || v <= 0 ? 0 : v <= 1 ? v : v <= 100 ? v / 100 : 1))
  .pipe(z.number().min(0).max(1));

const modelAnalysisSchema = z.object({
  confidence: confidenceSchema,
  clientReason: z.string().trim().min(1).max(700),
  internalNotes: z.string().trim().max(1200).optional().default(''),
  humanReviewRecommended: z.boolean().optional().default(false),
  scores: z.object({
    scratches: scoreSchema,
    tears: scoreSchema,
    missingAreas: scoreSchema,
    fadingContrast: scoreSchema,
    stains: scoreSchema,
    blurDetail: scoreSchema,
    faceDamage: scoreSchema,
    reconstruction: scoreSchema,
  }),
});

export type RestorationOutputTarget = z.infer<typeof outputTargetSchema>;
type ModelAnalysis = z.infer<typeof modelAnalysisSchema>;

export interface RestorationAnalysisFile {
  readonly s3Key: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly fileSize: number;
  readonly sourceUrl: string;
  readonly analysisImageUrl?: string;
  readonly width?: number;
  readonly height?: number;
}

export interface RestorationAnalysisScores {
  readonly scratches: number;
  readonly tears: number;
  readonly missingAreas: number;
  readonly fadingContrast: number;
  readonly stains: number;
  readonly blurDetail: number;
  readonly faceDamage: number;
  readonly reconstruction: number;
  readonly outputScale: number;
}

export interface RestorationSourceMetrics {
  readonly sourceWidthPx: number | null;
  readonly sourceHeightPx: number | null;
  readonly targetWidthPx: number | null;
  readonly targetHeightPx: number | null;
  readonly scaleFactor: number | null;
  readonly score: number;
}

export interface RestorationAnalysisResult {
  readonly tier: RestorationTier;
  readonly title: string;
  readonly price: number | null;
  readonly priceLabel: string;
  readonly leadTime: string;
  readonly reason: string;
  readonly clientReason: string;
  readonly internalNotes: string;
  readonly confidence: number;
  readonly humanReviewRequired: boolean;
  readonly automaticPaymentAllowed: boolean;
  readonly reviewReason: string | null;
  readonly model: string;
  readonly scores: RestorationAnalysisScores;
  readonly outputTarget: RestorationOutputTarget;
  readonly sourceMetrics: RestorationSourceMetrics;
}

export interface AnalyzeRestorationImagesInput {
  readonly files: readonly RestorationAnalysisFile[];
  readonly outputTarget?: unknown;
  readonly workload: RestorationWorkloadSnapshot;
}

interface TierPresentation {
  readonly title: string;
  readonly price: number;
}

type UnknownRecord = Record<string, unknown>;

interface ReviewDecision {
  readonly required: boolean;
  readonly reason: string | null;
}

interface FalVisionInput extends UnknownRecord {
  model: string;
  image_urls: string[];
  temperature: number;
  max_tokens: number;
  system_prompt: string;
  prompt: string;
}

const tierPresentation: Record<RestorationTier, TierPresentation> = {
  simple: { title: 'Простая реставрация', price: 900 },
  medium: { title: 'Реставрация средней сложности', price: 1600 },
  complex: { title: 'Сложная реставрация', price: 2800 },
  pro: { title: 'Реставрация профи', price: 4000 },
};

const emptyVisualScores = {
  scratches: 0,
  tears: 0,
  missingAreas: 0,
  fadingContrast: 0,
  stains: 0,
  blurDetail: 0,
  faceDamage: 0,
  reconstruction: 0,
} satisfies ModelAnalysis['scores'];

const DIGITAL_OUTPUT_TARGET: RestorationOutputTarget = {
  kind: 'digital',
  label: 'Цифровой файл',
};

export function getRestorationAnalysisBudgetMs(): number {
  return Number.isFinite(RESTORATION_ANALYSIS_BUDGET_MS) && RESTORATION_ANALYSIS_BUDGET_MS > 0
    ? RESTORATION_ANALYSIS_BUDGET_MS
    : 4000;
}

export function normalizeRestorationOutputTarget(raw: unknown): RestorationOutputTarget {
  if (raw === undefined || raw === null) {
    return { ...DIGITAL_OUTPUT_TARGET };
  }

  const safe = outputTargetSchema.safeParse(raw);
  if (!safe.success) {
    return { ...DIGITAL_OUTPUT_TARGET };
  }

  const parsed = safe.data;
  if (parsed.kind === 'digital') {
    return {
      kind: 'digital',
      label: parsed.label || 'Цифровой файл',
    };
  }

  return {
    kind: 'print',
    widthCm: roundCm(parsed.widthCm),
    heightCm: roundCm(parsed.heightCm),
    dpi: parsed.dpi,
    label: parsed.label || `${formatCm(parsed.widthCm)}x${formatCm(parsed.heightCm)} см`,
  };
}

export function calculateOutputScale(
  files: readonly RestorationAnalysisFile[],
  outputTarget: RestorationOutputTarget,
): RestorationSourceMetrics {
  const source = largestKnownSource(files);
  if (outputTarget.kind === 'digital') {
    return {
      sourceWidthPx: source?.width ?? null,
      sourceHeightPx: source?.height ?? null,
      targetWidthPx: null,
      targetHeightPx: null,
      scaleFactor: 1,
      score: 0,
    };
  }

  const targetWidthPx = cmToPixels(outputTarget.widthCm, outputTarget.dpi);
  const targetHeightPx = cmToPixels(outputTarget.heightCm, outputTarget.dpi);

  if (!source) {
    return {
      sourceWidthPx: null,
      sourceHeightPx: null,
      targetWidthPx,
      targetHeightPx,
      scaleFactor: null,
      score: 2,
    };
  }

  const sameOrientationScale = Math.max(targetWidthPx / source.width, targetHeightPx / source.height);
  const rotatedOrientationScale = Math.max(targetWidthPx / source.height, targetHeightPx / source.width);
  const scaleFactor = Math.max(1, Math.min(sameOrientationScale, rotatedOrientationScale));

  return {
    sourceWidthPx: source.width,
    sourceHeightPx: source.height,
    targetWidthPx,
    targetHeightPx,
    scaleFactor: roundScale(scaleFactor),
    score: scoreScale(scaleFactor),
  };
}

export function buildBudgetFallbackEstimate(input: {
  readonly files: readonly RestorationAnalysisFile[];
  readonly outputTarget?: unknown;
  readonly workload: RestorationWorkloadSnapshot;
}): RestorationAnalysisResult {
  const outputTarget = normalizeRestorationOutputTarget(input.outputTarget);
  const sourceMetrics = calculateOutputScale(input.files, outputTarget);
  return buildManualReviewResult({
    outputTarget,
    sourceMetrics,
    workload: input.workload,
    reason: 'Фото получено. Стоимость подтвердит ретушёр до начала работы.',
    internalNotes: 'budget fallback: analysis exceeded time budget',
  });
}

export async function analyzeRestorationImages(
  input: AnalyzeRestorationImagesInput,
): Promise<RestorationAnalysisResult> {
  const outputTarget = normalizeRestorationOutputTarget(input.outputTarget);
  const sourceMetrics = calculateOutputScale(input.files, outputTarget);

  if (!falAIService.enabled) {
    return buildManualReviewResult({
      outputTarget,
      sourceMetrics,
      workload: input.workload,
      reason: 'Фото получено. Автоматический анализ сейчас недоступен, стоимость подтвердит ретушёр до начала работы.',
      internalNotes: 'fal.ai disabled',
    });
  }

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await falAIService.run(
        RESTORATION_FAL_ROUTE,
        buildFalInput(input.files, outputTarget, sourceMetrics, attempt),
        { timeoutMs: RESTORATION_ANALYSIS_TIMEOUT_MS },
      );
      const modelAnalysis = parseFalResult(result);
      return buildResultFromModel({
        modelAnalysis,
        outputTarget,
        sourceMetrics,
        workload: input.workload,
      });
    } catch (error) {
      lastError = error;
      log.warn('restoration vision analysis attempt failed', {
        attempt,
        fileCount: input.files.length,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return buildManualReviewResult({
    outputTarget,
    sourceMetrics,
    workload: input.workload,
    reason: 'Фото получено, но автоматический анализ не дал надёжный результат. Стоимость подтвердит ретушёр до начала работы.',
    internalNotes: `analysis fallback: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  });
}

function buildResultFromModel(input: {
  readonly modelAnalysis: ModelAnalysis;
  readonly outputTarget: RestorationOutputTarget;
  readonly sourceMetrics: RestorationSourceMetrics;
  readonly workload: RestorationWorkloadSnapshot;
}): RestorationAnalysisResult {
  const scores: RestorationAnalysisScores = {
    ...input.modelAnalysis.scores,
    outputScale: input.sourceMetrics.score,
  };
  const tier = classifyTier(scores);
  const reviewDecision = buildReviewDecision(input.modelAnalysis, scores);
  const humanReviewRequired = reviewDecision.required;
  const presentation = tierPresentation[tier];
  const price = humanReviewRequired ? null : presentation.price;
  const clientReason = buildClientReason(input.modelAnalysis.clientReason, input.sourceMetrics);

  return {
    tier,
    title: presentation.title,
    price,
    priceLabel: price === null ? MANUAL_PRICE_LABEL : formatRuble(price),
    leadTime: input.workload.leadTimeByTier[tier],
    reason: clientReason,
    clientReason,
    internalNotes: input.modelAnalysis.internalNotes,
    confidence: roundConfidence(input.modelAnalysis.confidence),
    humanReviewRequired,
    automaticPaymentAllowed: !humanReviewRequired,
    reviewReason: reviewDecision.reason,
    model: RESTORATION_VISION_MODEL,
    scores,
    outputTarget: input.outputTarget,
    sourceMetrics: input.sourceMetrics,
  };
}

function buildManualReviewResult(input: {
  readonly outputTarget: RestorationOutputTarget;
  readonly sourceMetrics: RestorationSourceMetrics;
  readonly workload: RestorationWorkloadSnapshot;
  readonly reason: string;
  readonly internalNotes: string;
}): RestorationAnalysisResult {
  const scores: RestorationAnalysisScores = {
    ...emptyVisualScores,
    outputScale: input.sourceMetrics.score,
  };
  const tier: RestorationTier = input.sourceMetrics.score >= 3 ? 'complex' : 'medium';
  const presentation = tierPresentation[tier];

  return {
    tier,
    title: presentation.title,
    price: null,
    priceLabel: MANUAL_PRICE_LABEL,
    leadTime: input.workload.leadTimeByTier[tier],
    reason: input.reason,
    clientReason: input.reason,
    internalNotes: input.internalNotes,
    confidence: 0,
    humanReviewRequired: true,
    automaticPaymentAllowed: false,
    reviewReason: input.reason,
    model: 'manual_review',
    scores,
    outputTarget: input.outputTarget,
    sourceMetrics: input.sourceMetrics,
  };
}

function classifyTier(scores: RestorationAnalysisScores): RestorationTier {
  const visualTotal = scores.scratches
    + scores.tears
    + scores.missingAreas
    + scores.fadingContrast
    + scores.stains
    + scores.blurDetail
    + scores.faceDamage
    + scores.reconstruction;
  const total = visualTotal + scores.outputScale;

  if (
    total >= 16
    || scores.faceDamage >= 3
    || scores.missingAreas >= 3
    || scores.reconstruction >= 3
  ) {
    return 'pro';
  }

  if (scores.outputScale >= 3) {
    return 'complex';
  }

  if (
    total >= 10
    || scores.scratches >= 3
    || scores.tears >= 3
    || scores.fadingContrast >= 3
    || scores.stains >= 3
    || scores.blurDetail >= 3
    || (scores.outputScale >= 3 && scores.blurDetail >= 2)
  ) {
    return 'complex';
  }

  if (total >= 5 || scores.outputScale >= 2) {
    return 'medium';
  }

  return 'simple';
}

function buildClientReason(reason: string, sourceMetrics: RestorationSourceMetrics): string {
  const scaleReason = buildScaleReason(sourceMetrics);
  if (!scaleReason) {
    return reason;
  }

  return `${reason} ${scaleReason}`;
}

function buildScaleReason(sourceMetrics: RestorationSourceMetrics): string | null {
  if (!sourceMetrics.targetWidthPx || !sourceMetrics.targetHeightPx) {
    return null;
  }

  if (!sourceMetrics.sourceWidthPx || !sourceMetrics.sourceHeightPx || sourceMetrics.scaleFactor === null) {
    return 'Масштаб печати учли отдельно: исходный размер файла не удалось определить автоматически.';
  }

  if (sourceMetrics.score === 0) {
    return null;
  }

  const scaleLabel = `x${sourceMetrics.scaleFactor}`;
  if (sourceMetrics.score >= 3) {
    return `Также учли сильное увеличение ${scaleLabel}: исходник ${sourceMetrics.sourceWidthPx}x${sourceMetrics.sourceHeightPx} px до ${sourceMetrics.targetWidthPx}x${sourceMetrics.targetHeightPx} px.`;
  }

  return `Также учли увеличение ${scaleLabel}: исходник ${sourceMetrics.sourceWidthPx}x${sourceMetrics.sourceHeightPx} px до ${sourceMetrics.targetWidthPx}x${sourceMetrics.targetHeightPx} px.`;
}

function buildReviewDecision(modelAnalysis: ModelAnalysis, scores: RestorationAnalysisScores): ReviewDecision {
  if (modelAnalysis.confidence < 0.75) {
    return {
      required: true,
      reason: 'Низкая уверенность автоматического анализа: стоимость должен подтвердить ретушёр до оплаты.',
    };
  }

  if (modelAnalysis.humanReviewRecommended) {
    return {
      required: true,
      reason: 'Модель рекомендовала ручную проверку: стоимость должен подтвердить ретушёр до оплаты.',
    };
  }

  if (scores.faceDamage >= 3) {
    return {
      required: true,
      reason: 'Критичные повреждения лица: стоимость должен подтвердить ретушёр до оплаты.',
    };
  }

  if (scores.missingAreas >= 3 || scores.reconstruction >= 3) {
    return {
      required: true,
      reason: 'Критичные утраты или дорисовка: стоимость должен подтвердить ретушёр до оплаты.',
    };
  }

  if (hasStrongScaleLowQualityRisk(scores)) {
    return {
      required: true,
      reason: 'Сильное увеличение при низком качестве исходника: стоимость должен подтвердить ретушёр до оплаты.',
    };
  }

  return { required: false, reason: null };
}

function hasStrongScaleLowQualityRisk(scores: RestorationAnalysisScores): boolean {
  if (scores.outputScale < 3) {
    return false;
  }

  return scores.blurDetail >= 1
    || scores.fadingContrast >= 2
    || scores.stains >= 2
    || scores.faceDamage >= 2
    || scores.missingAreas >= 2
    || scores.reconstruction >= 2;
}

function buildFalInput(
  files: readonly RestorationAnalysisFile[],
  outputTarget: RestorationOutputTarget,
  sourceMetrics: RestorationSourceMetrics,
  attempt: number,
): FalVisionInput {
  return {
    model: RESTORATION_VISION_MODEL,
    image_urls: files.map(file => file.analysisImageUrl || file.sourceUrl),
    temperature: 0,
    max_tokens: 1200,
    system_prompt: [
      'You are a photo restoration estimator.',
      'Inspect the uploaded archival photo visually and estimate manual restoration complexity.',
      'Return only valid JSON. Do not wrap it in markdown.',
    ].join(' '),
    prompt: [
      'Evaluate visible photo-restoration difficulty, not beauty or artistic quality.',
      'Score every criterion from 0 to 3: 0 none, 1 light, 2 noticeable, 3 severe.',
      'Criteria: scratches, tears, missingAreas, fadingContrast, stains, blurDetail, faceDamage, reconstruction.',
      'Set humanReviewRecommended=true when important image areas are ambiguous or cannot be priced safely.',
      'Set humanReviewRecommended=true when requested print enlargement is strong and the source has low detail, heavy fading, or stains.',
      `Desired output target: ${describeOutputTarget(outputTarget)}.`,
      `Source/scale metrics: ${JSON.stringify(sourceMetrics)}.`,
      attempt > 1 ? 'Previous response was invalid. Return strict JSON exactly matching the requested schema.' : '',
      'JSON schema: {"confidence":0.0,"clientReason":"short Russian explanation for client","internalNotes":"short internal English/Russian note","humanReviewRecommended":false,"scores":{"scratches":0,"tears":0,"missingAreas":0,"fadingContrast":0,"stains":0,"blurDetail":0,"faceDamage":0,"reconstruction":0}}',
    ].filter(Boolean).join('\n'),
  };
}

function parseFalResult(result: FalResult): ModelAnalysis {
  const text = extractFalText(result);
  if (!text) {
    throw new Error('fal.ai vision result did not contain text');
  }
  const parsedJson = extractJsonObject(text);
  return modelAnalysisSchema.parse(parsedJson);
}

function extractFalText(result: FalResult): string | null {
  const directKeys = ['output', 'text', 'response', 'content', 'message'];
  for (const key of directKeys) {
    const value = result[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }

  const choices = result['choices'];
  if (Array.isArray(choices)) {
    const first = choices[0];
    if (isRecord(first)) {
      const message = first['message'];
      if (isRecord(message) && typeof message['content'] === 'string') {
        return message['content'];
      }
      if (typeof first['text'] === 'string') {
        return first['text'];
      }
    }
  }

  const data = result['data'];
  if (isRecord(data)) {
    for (const key of directKeys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
  }

  return null;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('vision result is not a JSON object');
  }
  const parsed: unknown = JSON.parse(trimmed.slice(start, end + 1));
  return parsed;
}

function largestKnownSource(files: readonly RestorationAnalysisFile[]): { readonly width: number; readonly height: number } | null {
  let largest: { readonly width: number; readonly height: number; readonly area: number } | null = null;
  for (const file of files) {
    if (!file.width || !file.height) {
      continue;
    }
    const area = file.width * file.height;
    if (!largest || area > largest.area) {
      largest = { width: file.width, height: file.height, area };
    }
  }
  return largest ? { width: largest.width, height: largest.height } : null;
}

function scoreScale(scaleFactor: number): number {
  if (scaleFactor <= 1.2) return 0;
  if (scaleFactor <= 1.8) return 1;
  if (scaleFactor <= 3) return 2;
  return 3;
}

function cmToPixels(cm: number, dpi: number): number {
  return Math.round((cm / 2.54) * dpi);
}

function formatRuble(value: number): string {
  return `${value.toLocaleString('ru-RU').replace(/\u00a0/g, ' ')}₽`;
}

function roundCm(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatCm(value: number): string {
  return Number.isInteger(value) ? String(value) : String(roundCm(value));
}

function roundScale(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function describeOutputTarget(target: RestorationOutputTarget): string {
  if (target.kind === 'digital') {
    return target.label ?? 'Цифровой файл';
  }
  return `${target.label ?? `${formatCm(target.widthCm)}x${formatCm(target.heightCm)} см`}, ${target.widthCm}x${target.heightCm} cm, ${target.dpi} DPI`;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}
