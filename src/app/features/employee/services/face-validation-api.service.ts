import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface FaceValidationResult {
  id: string;
  photo_approval_id: string | null;
  message_id: string | null;
  image_url: string;
  face_detected: boolean;
  face_count: number;
  face_height_px: number | null;
  face_height_mm: number | null;
  face_width_px: number | null;
  face_width_mm: number | null;
  forehead_y: number | null;
  chin_y: number | null;
  eye_level_delta_px: number | null;
  image_dpi: number;
  dpi_source: string;
  landmarks_count: number;
  is_valid_passport: boolean;
  is_valid_greencard: boolean;
  verdict: string;
  verdict_details: Record<string, unknown>;
  processing_time_ms: number;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class FaceValidationApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/face-validation';

  validate(imageUrl: string, opts?: {
    dpi_override?: number;
    photo_approval_id?: string;
    message_id?: string;
  }): Observable<FaceValidationResult> {
    return this.http.post<{ success: boolean; data: FaceValidationResult }>(
      `${this.base}/validate`,
      { image_url: imageUrl, ...opts },
    ).pipe(map(r => r.data));
  }

  getByPhoto(photoApprovalId: string): Observable<FaceValidationResult | null> {
    return this.http.get<{ success: boolean; data: FaceValidationResult | null }>(
      `${this.base}/by-photo/${photoApprovalId}`,
    ).pipe(map(r => r.data));
  }

  getByMessage(messageId: string): Observable<FaceValidationResult | null> {
    return this.http.get<{ success: boolean; data: FaceValidationResult | null }>(
      `${this.base}/by-message/${messageId}`,
    ).pipe(map(r => r.data));
  }
}
