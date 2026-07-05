export interface RestorationAnalysisScoresMetadata {
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

export interface RestorationSourceMetricsMetadata {
  readonly sourceWidthPx: number | null;
  readonly sourceHeightPx: number | null;
  readonly targetWidthPx: number | null;
  readonly targetHeightPx: number | null;
  readonly scaleFactor: number | null;
  readonly score: number;
}

export interface RestorationAnalysisMetadata {
  readonly tier: string;
  readonly title: string;
  readonly price: number | null;
  readonly priceLabel: string;
  readonly confidence: number;
  readonly humanReviewRequired: boolean;
  readonly automaticPaymentAllowed: boolean;
  readonly reviewReason: string | null;
  readonly model: string;
  readonly scores: RestorationAnalysisScoresMetadata;
  readonly sourceMetrics: RestorationSourceMetricsMetadata | null;
}

interface UnknownRecord {
  readonly [key: string]: unknown;
}

const emptyScores: RestorationAnalysisScoresMetadata = {
  scratches: 0,
  tears: 0,
  missingAreas: 0,
  fadingContrast: 0,
  stains: 0,
  blurDetail: 0,
  faceDamage: 0,
  reconstruction: 0,
  outputScale: 0,
};

const scoreLabels: readonly { readonly key: keyof RestorationAnalysisScoresMetadata; readonly label: string }[] = [
  { key: 'outputScale', label: 'Масштаб' },
  { key: 'faceDamage', label: 'Лицо' },
  { key: 'missingAreas', label: 'Утраты' },
  { key: 'reconstruction', label: 'Дорисовка' },
  { key: 'tears', label: 'Заломы' },
  { key: 'fadingContrast', label: 'Выцветание' },
  { key: 'stains', label: 'Пятна' },
  { key: 'blurDetail', label: 'Детали' },
  { key: 'scratches', label: 'Царапины' },
];

export function readRestorationAnalysisMetadata(
  metadata: Record<string, unknown> | null | undefined,
): RestorationAnalysisMetadata | null {
  if (!metadata) {
    return null;
  }

  const nested = asRecord(metadata['restorationAnalysis']);
  const payload = nested ?? metadata;
  if (!nested && !looksLikeRestorationAnalysis(payload)) {
    return null;
  }

  const confidence = readNumber(payload['confidence']) ?? readNumber(metadata['confidence']) ?? 0;
  const reviewReason = readNullableString(payload['reviewReason']) ?? readNullableString(metadata['reviewReason']);

  return {
    tier: readString(payload['tier']) || readString(metadata['estimateTier']),
    title: readString(payload['title']) || readString(metadata['estimateTitle']),
    price: readNullableNumber(payload['price']) ?? readNullableNumber(metadata['estimatePrice']),
    priceLabel: readString(payload['priceLabel']) || readString(metadata['priceLabel']),
    confidence,
    humanReviewRequired: readBoolean(payload['humanReviewRequired']) ?? readBoolean(metadata['humanReviewRequired']) ?? false,
    automaticPaymentAllowed: readBoolean(payload['automaticPaymentAllowed']) ?? readBoolean(metadata['paymentRequired']) ?? false,
    reviewReason,
    model: readString(payload['model']) || readString(metadata['model']),
    scores: readScores(asRecord(payload['scores']) ?? asRecord(metadata['scores'])),
    sourceMetrics: readSourceMetrics(asRecord(payload['sourceMetrics']) ?? asRecord(metadata['sourceMetrics'])),
  };
}

export function formatRestorationAnalysisStatusLabel(
  analysis: RestorationAnalysisMetadata | null | undefined,
): string {
  if (!analysis) return '';
  return analysis.humanReviewRequired ? 'оценка ретушёром' : 'автоцена';
}

export function formatRestorationAnalysisConfidence(
  analysis: RestorationAnalysisMetadata | null | undefined,
): string {
  if (!analysis) return '';
  return `${Math.round(clamp(analysis.confidence, 0, 1) * 100)}%`;
}

export function formatRestorationAnalysisModel(
  analysis: RestorationAnalysisMetadata | null | undefined,
): string {
  if (!analysis?.model) return '';
  if (analysis.model === 'manual_review') return 'ручная оценка';
  return analysis.model.split('/').at(-1) || analysis.model;
}

export function formatRestorationAnalysisScale(
  analysis: RestorationAnalysisMetadata | null | undefined,
): string {
  const metrics = analysis?.sourceMetrics;
  if (!metrics) return '';

  const scale = metrics.scaleFactor === null ? null : `x${formatScale(metrics.scaleFactor)}`;
  const source = metrics.sourceWidthPx && metrics.sourceHeightPx
    ? `${metrics.sourceWidthPx}x${metrics.sourceHeightPx}`
    : null;
  const target = metrics.targetWidthPx && metrics.targetHeightPx
    ? `${metrics.targetWidthPx}x${metrics.targetHeightPx}`
    : null;

  if (scale && source && target) return `${scale} · ${source} → ${target} px`;
  if (source && target) return `${source} → ${target} px`;
  if (scale) return scale;
  return '';
}

export function restorationAnalysisScoreChips(
  analysis: RestorationAnalysisMetadata | null | undefined,
): string[] {
  if (!analysis) return [];

  return scoreLabels
    .map(({ key, label }) => ({ label, value: analysis.scores[key] }))
    .filter(({ value }) => value > 0)
    .map(({ label, value }) => `${label} ${value}/3`);
}

function looksLikeRestorationAnalysis(payload: UnknownRecord): boolean {
  return asRecord(payload['sourceMetrics']) !== null
    || readString(payload['model']) !== ''
    || readNumber(payload['confidence']) !== null
    || readNullableString(payload['reviewReason']) !== null;
}

function readScores(raw: UnknownRecord | null): RestorationAnalysisScoresMetadata {
  if (!raw) return emptyScores;
  return {
    scratches: readScore(raw['scratches']),
    tears: readScore(raw['tears']),
    missingAreas: readScore(raw['missingAreas']),
    fadingContrast: readScore(raw['fadingContrast']),
    stains: readScore(raw['stains']),
    blurDetail: readScore(raw['blurDetail']),
    faceDamage: readScore(raw['faceDamage']),
    reconstruction: readScore(raw['reconstruction']),
    outputScale: readScore(raw['outputScale']),
  };
}

function readSourceMetrics(raw: UnknownRecord | null): RestorationSourceMetricsMetadata | null {
  if (!raw) return null;
  return {
    sourceWidthPx: readNullableNumber(raw['sourceWidthPx']),
    sourceHeightPx: readNullableNumber(raw['sourceHeightPx']),
    targetWidthPx: readNullableNumber(raw['targetWidthPx']),
    targetHeightPx: readNullableNumber(raw['targetHeightPx']),
    scaleFactor: readNullableNumber(raw['scaleFactor']),
    score: readScore(raw['score']),
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function readNullableNumber(value: unknown): number | null {
  return readNumber(value);
}

function readScore(value: unknown): number {
  const numeric = readNumber(value);
  if (numeric === null) return 0;
  return Math.round(clamp(numeric, 0, 3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatScale(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
