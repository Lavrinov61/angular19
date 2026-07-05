import type {
  PhotoWorkspaceAssetView,
  PhotoWorkspaceCounters,
  PhotoWorkspaceReadinessDto,
  PhotoWorkspaceVariantStatus,
} from '../../models/photo-workspace.model';

export interface PhotoWorkspaceCounterVariant {
  status: PhotoWorkspaceVariantStatus | string;
  enabled: boolean;
}

export interface PhotoWorkspaceInitialAiVariant {
  status: PhotoWorkspaceVariantStatus | string;
  enabled: boolean;
  ai_job_id?: string | null;
  ai_original_url?: string | null;
}

export interface PhotoWorkspaceCounterItem {
  id: string;
  variants: readonly PhotoWorkspaceCounterVariant[];
}

export type PhotoWorkspaceAiProgressPhase =
  | 'queued'
  | 'submitted'
  | 'in_progress'
  | 'fetching_result'
  | 'completed'
  | 'failed';

export interface PhotoWorkspaceAiProgressStatus {
  phase: PhotoWorkspaceAiProgressPhase;
  providerStatus?: string | null;
}

export interface PhotoWorkspaceInitialSourceEnvelope {
  item: {
    source_asset_url: string;
  };
}

const AI_DONE_STATUSES = new Set<string>(['checked', 'sent_to_client']);
const INITIAL_AI_READY_STATUSES = new Set<string>(['planned', 'pending_generation']);
const PHOTOSHOP_WAITING_STATUSES = new Set<string>([
  'needs_photoshop_check',
  'downloaded_for_check',
  'photoshop_uploaded',
]);

export function photoWorkspaceCounters(items: readonly PhotoWorkspaceCounterItem[]): PhotoWorkspaceCounters {
  const counters: PhotoWorkspaceCounters = {
    aiDone: 0,
    aiTotal: 0,
    aiErrors: 0,
    photoshopWaiting: 0,
    readyToSend: 0,
  };

  for (const item of items) {
    for (const variant of item.variants) {
      if (!variant.enabled) continue;
      counters.aiTotal += 1;
      if (AI_DONE_STATUSES.has(variant.status)) counters.aiDone += 1;
      if (variant.status === 'error') counters.aiErrors += 1;
      if (PHOTOSHOP_WAITING_STATUSES.has(variant.status)) counters.photoshopWaiting += 1;
      if (variant.status === 'checked') counters.readyToSend += 1;
    }
  }

  return counters;
}

export function notificationCountdownLabel(now: Date, scheduledFor: string): string {
  const diffMs = Math.max(0, new Date(scheduledFor).getTime() - now.getTime());
  const totalSeconds = Math.ceil(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function photoWorkspaceAiProgressLabel(progress: PhotoWorkspaceAiProgressStatus): string {
  switch (progress.phase) {
    case 'submitted':
      return 'Отправлено в fal.ai';
    case 'queued':
      return 'В очереди fal.ai';
    case 'in_progress':
      return progress.providerStatus === 'IN_PROGRESS' ? 'fal.ai генерирует' : 'Генерируется';
    case 'fetching_result':
      return 'Получаем файл';
    case 'completed':
      return 'Готово';
    case 'failed':
      return 'Ошибка генерации';
  }
}

export function photoWorkspaceAiProgressValue(progress: PhotoWorkspaceAiProgressStatus): number {
  switch (progress.phase) {
    case 'submitted':
      return 8;
    case 'queued':
      return 15;
    case 'in_progress':
      return 45;
    case 'fetching_result':
      return 85;
    case 'completed':
    case 'failed':
      return 100;
  }
}

export function photoWorkspaceAiProgressMode(progress: PhotoWorkspaceAiProgressStatus): 'determinate' | 'indeterminate' {
  return progress.phase === 'completed' || progress.phase === 'failed' ? 'determinate' : 'indeterminate';
}

export function photoWorkspaceAiElapsedLabel(now: Date, startedAtMs: number): string {
  const diffMs = Math.max(0, now.getTime() - startedAtMs);
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function canStartAiGeneration(readiness: PhotoWorkspaceReadinessDto): boolean {
  return readiness.promptReady && readiness.blockers.length === 0;
}

export function canStartInitialAiGeneration(
  readiness: PhotoWorkspaceReadinessDto,
  variants: readonly PhotoWorkspaceInitialAiVariant[],
  running: boolean,
  locallySubmitted: boolean,
): boolean {
  const enabled = variants.filter(variant => variant.enabled);
  return canStartAiGeneration(readiness)
    && enabled.length > 0
    && !running
    && !locallySubmitted
    && enabled.every(isInitialAiReadyVariant);
}

function isInitialAiReadyVariant(variant: PhotoWorkspaceInitialAiVariant): boolean {
  return INITIAL_AI_READY_STATUSES.has(variant.status)
    && !variant.ai_job_id
    && !variant.ai_original_url;
}

export function initialWorkspaceAssetToCreate(
  envelopes: readonly PhotoWorkspaceInitialSourceEnvelope[],
  initialSourceUrl: string | null,
  initialSourceName: string | null,
): PhotoWorkspaceAssetView | null {
  const url = initialSourceUrl?.trim();
  if (!url) return null;
  if (envelopes.some(envelope => samePhotoWorkspaceAssetUrl(envelope.item.source_asset_url, url))) return null;
  return {
    id: 'initial-source',
    url,
    name: initialSourceName?.trim() || 'Фото',
    source: 'order',
    thumbnailUrl: null,
  };
}

export function samePhotoWorkspaceAssetUrl(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftKey = photoWorkspaceAssetKey(left);
  const rightKey = photoWorkspaceAssetKey(right);
  return leftKey.length > 0 && leftKey === rightKey;
}

export function photoWorkspaceAssetKey(value: string | null | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed, 'https://svoefoto.ru');
    if (parsed.pathname.startsWith('/media/') || parsed.pathname.startsWith('/uploads/')) {
      return parsed.pathname;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return trimmed.split(/[?#]/)[0] ?? trimmed;
  }
}
