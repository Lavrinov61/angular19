import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type {
  CropDocumentParams,
  DetectCropLinesResponse,
  RetouchJobStatus,
} from '../models/ai-retouch.models';

/**
 * Запрос на создание job операции `crop_document`.
 * Клиент шлёт ТОЛЬКО `documentType` + положения линий — геометрию (мм/dpi)
 * бэк грузит из пресета по `documentType` (граница доверия).
 */
export interface CreateCropJobRequest {
  sessionId: string;
  /** id фото; роут маппит его в колонку `source_photo_id` (n4). */
  photoId?: string;
  photoUrl: string;
  params: CropDocumentParams;
  resultMode?: 'approval_photo' | 'work_result';
}

/** Ответ создания job (`202`, data-часть). */
export interface CreateCropJobResponse {
  job_id: string;
  status: string;
}

export interface SaveCropJobOriginalResponse {
  url: string;
  thumbnailUrl: string | null;
}

/**
 * HTTP-клиент операции AI-ретуши «Кадрирование под документ».
 * Эндпоинты по `30-architecture.md`: detect-линии, создание crop-job, поллинг статуса.
 * Формат ответов — `{ success, data }`, как у остального ai-retouch.
 */
@Injectable({ providedIn: 'root' })
export class AiRetouchJobsService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/photo-retouch';

  /**
   * Авто-определение трёх линий (макушка/подбородок/центр) по фото.
   * `POST /api/photo-retouch/detect-crop-lines`.
   */
  detectCropLines(photoUrl: string): Observable<DetectCropLinesResponse> {
    return this.http
      .post<{ success: boolean; data: DetectCropLinesResponse }>(
        `${this.baseUrl}/detect-crop-lines`,
        { photo_url: photoUrl },
      )
      .pipe(map((res) => res.data));
  }

  /**
   * Создать job кадрирования. `POST /api/photo-retouch/jobs` с операцией `crop_document`.
   * Возвращает `{ job_id, status }`.
   */
  createCropJob(req: CreateCropJobRequest): Observable<CreateCropJobResponse> {
    return this.http
      .post<{ success: boolean; data: CreateCropJobResponse }>(`${this.baseUrl}/jobs`, {
        session_id: req.sessionId,
        photo_id: req.photoId,
        photo_url: req.photoUrl,
        result_mode: req.resultMode ?? 'approval_photo',
        operations: [{ type: 'crop_document', params: req.params }],
      })
      .pipe(map((res) => res.data));
  }

  /**
   * Получить статус job для поллинга результата кадрирования.
   * `GET /api/photo-retouch/jobs/:id`.
   */
  pollJob(id: string): Observable<RetouchJobStatus> {
    return this.http
      .get<{ success: boolean; data: RetouchJobStatus }>(`${this.baseUrl}/jobs/${id}`)
      .pipe(map((res) => res.data));
  }

  saveJobResultAsOriginal(id: string): Observable<SaveCropJobOriginalResponse> {
    return this.http
      .post<{ success: boolean; original: SaveCropJobOriginalResponse }>(
        `${this.baseUrl}/jobs/${id}/save-as-original`,
        {},
      )
      .pipe(map((res) => res.original));
  }
}
