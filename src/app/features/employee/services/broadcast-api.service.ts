import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

// ── Types ──

export type BroadcastStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
export type RecipientStatus = 'queued' | 'sent' | 'failed' | 'blocked' | 'skipped' | 'suppressed';

/** Воронка доставки по статусам получателей */
export interface BroadcastFunnel {
  queued: number;
  sent: number;
  failed: number;
  blocked: number;
  skipped: number;
  suppressed: number;
  total: number;
}

/** Фильтр сегмента аудитории — сохраняется в marketing_campaigns.audience_filter (JSONB) */
export interface AudienceFilter {
  /** Канал диалога: 'telegram' | 'max' | 'vk' | 'whatsapp'. v1 dispatch — только telegram. */
  channel: string;
  /** Slug'и услуг (contacts.primary_service_slug). [] / отсутствие = все услуги. */
  serviceSlugs?: string[];
  /** Давность последнего контакта в днях (last_seen_at ≥ now()-N). null = любая. */
  recencyDays?: number | null;
}

export interface BroadcastListItem {
  id: string;
  name: string;
  status: BroadcastStatus;
  test_mode: boolean;
  allowed_count: number;
  created_at: string;
  funnel: BroadcastFunnel;
  /** Канал отправки кампании (DTO от backend): 'telegram' | 'max' | 'vk' | ... */
  channel?: string;
  /** Сегмент аудитории (если задан при создании); null/отсутствие — рассылка без сегментации */
  audience_filter?: AudienceFilter | null;
}

/** Расширенная воронка из GET /:id/stats */
export interface BroadcastStats {
  byStatus: Record<string, number>;
  total: number;
  sentRate: number;
  blockRate: number;
  etaSeconds: number | null;
  /** Уникальные контакты, кликнувшие по ссылке рассылки («Интересовались») */
  clicks: number;
}

export interface BroadcastRecipient {
  id: string;
  contact_id: string | null;
  contact_name: string | null;
  status: RecipientStatus;
  error_code: string | null;
  error_detail: string | null;
  sent_at: string | null;
  clicked: boolean;
  clicked_at: string | null;
}

export interface BroadcastRecipientsPage {
  items: BroadcastRecipient[];
  total: number;
}

/** Одна url-кнопка инлайн-клавиатуры */
export interface BroadcastButton {
  text: string;
  url: string;
}

/** Контент рассылки — соответствует marketing_campaigns.broadcast_payload */
export interface BroadcastPayload {
  text?: string;
  mediaUrl?: string;
  landingUrl?: string;
  /** Ряды url-кнопок (массив рядов, каждый ряд — массив кнопок) */
  buttons?: BroadcastButton[][];
  /** Какие служебные кнопки включить (Отписаться всегда). Отсутствие → обе вкл. */
  serviceButtons?: { addresses?: boolean; notStudent?: boolean };
}

export interface BroadcastUtm {
  source?: string;
  medium?: string;
  campaign?: string;
}

export interface CreateBroadcastInput {
  name: string;
  payload: BroadcastPayload;
  allowedContactIds?: string[];
  utm?: BroadcastUtm;
  /** Сегмент аудитории для боевой рассылки (test_mode форсится сервером в true при создании) */
  audienceFilter?: AudienceFilter;
}

/** Редактируемый снимок кампании (GET /:id) — для предзаполнения композера. */
export interface BroadcastEditData {
  id: string;
  name: string;
  status: string | null;
  channel: string | null;
  test_mode: boolean;
  allowed_contact_ids: string[] | null;
  audience_filter: AudienceFilter | null;
  broadcast_payload: BroadcastPayload | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

/** Услуга-опция для мультиселекта сегментации (slug + человеческий label + размер) */
export interface ServiceOption {
  slug: string;
  label: string;
  count: number;
}

/** Канал-опция (число активных контактов на канале) */
export interface ChannelOption {
  channel: string;
  count: number;
}

/** Варианты сегментации из GET /segments/options */
export interface SegmentsOptions {
  services: ServiceOption[];
  channels: ChannelOption[];
}

export interface RecipientsQuery {
  limit?: number;
  offset?: number;
  /** true → вид «Интересовались»: только кликнувшие по ссылке */
  clicked?: boolean;
}

/** Один presigned-слот загрузки флаера в S3 */
interface FlyerPresignUpload {
  s3Key: string;
  uploadUrl: string;
}

@Injectable({ providedIn: 'root' })
export class BroadcastApiService {
  private readonly http = inject(HttpClient);
  // ВАЖНО: broadcast-роуты смонтированы под /api/admin/campaigns — НЕ /api/campaigns (CRM).
  private readonly base = '/api/admin/campaigns';

  list(): Observable<BroadcastListItem[]> {
    return this.http.get<{ success: boolean; data: BroadcastListItem[] }>(this.base).pipe(
      map(r => r.data),
    );
  }

  create(dto: CreateBroadcastInput): Observable<{ id: string }> {
    return this.http.post<{ success: boolean; data: { id: string } }>(this.base, dto).pipe(
      map(r => r.data),
    );
  }

  /** Редактируемый снимок кампании для предзаполнения композера. */
  getCampaign(id: string): Observable<BroadcastEditData> {
    return this.http.get<{ success: boolean; data: BroadcastEditData }>(`${this.base}/${id}`).pipe(
      map(r => r.data),
    );
  }

  /** Обновить черновик (PATCH); сервер отклонит не-черновик (409). */
  update(id: string, dto: CreateBroadcastInput): Observable<{ id: string }> {
    return this.http.patch<{ success: boolean; data: { id: string } }>(`${this.base}/${id}`, dto).pipe(
      map(r => r.data),
    );
  }

  dispatch(id: string): Observable<unknown> {
    return this.http.post<{ success: boolean; data: unknown }>(`${this.base}/${id}/dispatch`, {}).pipe(
      map(r => r.data),
    );
  }

  stats(id: string): Observable<BroadcastStats> {
    // Бэкенд GET /:id/stats отдаёт { success, stats } — поле `stats`, НЕ `data`.
    return this.http.get<{ success: boolean; stats: BroadcastStats }>(`${this.base}/${id}/stats`).pipe(
      map(r => r.stats),
    );
  }

  recipients(id: string, query: RecipientsQuery = {}): Observable<BroadcastRecipientsPage> {
    let params = new HttpParams();
    if (query.limit !== undefined) params = params.set('limit', String(query.limit));
    if (query.offset !== undefined) params = params.set('offset', String(query.offset));
    if (query.clicked) params = params.set('clicked', 'true');
    return this.http.get<{ success: boolean; data: BroadcastRecipientsPage }>(
      `${this.base}/${id}/recipients`, { params },
    ).pipe(
      map(r => r.data),
    );
  }

  /** Единственный путь к test_mode=false — явный go-live (под danger-confirm в UI) */
  goLive(id: string): Observable<{ id: string; test_mode: boolean }> {
    return this.http.post<{ success: boolean; data: { id: string; test_mode: boolean } }>(
      `${this.base}/${id}/go-live`, {},
    ).pipe(
      map(r => r.data),
    );
  }

  /** Живой счётчик аудитории по фильтру — для preview в диалоге создания и go-live confirm */
  audiencePreview(filter: AudienceFilter): Observable<{ count: number }> {
    return this.http.post<{ success: boolean; data: { count: number } }>(
      `${this.base}/audience-preview`, filter,
    ).pipe(
      map(r => r.data),
    );
  }

  /** Варианты сегментации: услуги (slug+label+count) + каналы (count) */
  segmentsOptions(): Observable<SegmentsOptions> {
    return this.http.get<{ success: boolean; data: SegmentsOptions }>(
      `${this.base}/segments/options`,
    ).pipe(
      map(r => r.data),
    );
  }

  /**
   * Загрузка флаера: presign → прямой PUT в S3 (XHR, мимо HttpClient/интерцептора) → complete.
   * Возвращает постоянный public-read URL медиа для broadcast_payload.mediaUrl.
   */
  uploadFlyer(file: File, onProgress?: (percent: number) => void): Observable<{ url: string }> {
    return new Observable<{ url: string }>(subscriber => {
      const presignUrl = `${this.base}/upload/presign`;
      const completeUrl = `${this.base}/upload/complete`;
      const contentType = file.type || 'application/octet-stream';

      // Шаг 1: получить presigned PUT URL
      this.http.post<{ success: boolean; data: { uploads: FlyerPresignUpload[] } }>(
        presignUrl, { files: [{ fileName: file.name, contentType }] },
      ).subscribe({
        next: (presignRes) => {
          const upload = presignRes.data?.uploads?.[0];
          if (!presignRes.success || !upload) {
            subscriber.error(new Error('Presign failed'));
            return;
          }
          const { s3Key, uploadUrl } = upload;

          // Шаг 2: PUT файла напрямую в S3 через XHR (без Authorization — мимо интерцептора)
          const xhr = new XMLHttpRequest();
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              onProgress?.(Math.round((e.loaded / e.total) * 100));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // Шаг 3: подтвердить загрузку — бэкенд вернёт постоянный URL
              this.http.post<{ success: boolean; url: string }>(
                completeUrl,
                { files: [{ s3Key, fileName: file.name, contentType, fileSize: file.size }] },
              ).subscribe({
                next: (res) => { subscriber.next({ url: res.url }); subscriber.complete(); },
                error: (err) => subscriber.error(err),
              });
            } else {
              subscriber.error(new Error(`S3 upload failed: ${xhr.status}`));
            }
          };
          xhr.onerror = () => subscriber.error(new Error('S3 upload network error'));
          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', contentType);
          xhr.send(file);
        },
        error: (err) => subscriber.error(err),
      });
    });
  }
}
