import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ReviewSession {
  id: string;
  title: string;
  description: string;
  clientName: string;
  status: string;
  totalPhotos: number;
  approvedCount: number;
  rejectedCount: number;
  createdAt: string;
}

export interface ReviewVariant {
  id: string;
  variant_url: string;
  thumbnail_url: string | null;
  label: string | null;
  sort_order: number;
  is_selected: boolean;
  selected_at: string | null;
}

export interface ReviewPhoto {
  id: string;
  status: string;
  comment: string | null;
  retouched_photo_url: string;
  original_photo_url: string | null;
  thumbnail_url: string | null;
  original_thumbnail_url: string | null;
  retouch_type: string;
  created_at: string;
  revision_count: number;
  selected_variant_id: string | null;
  variants: ReviewVariant[];
  annotations: {
    id: string;
    annotation: { comment?: string; type?: string; x?: number; y?: number };
    created_at: string;
  }[];
}

interface SessionResponse {
  success: boolean;
  session: ReviewSession;
  photos: ReviewPhoto[];
}

interface ActionResponse {
  success: boolean;
  annotationId?: string;
  approvedCount?: number;
  status?: string;
  completed?: boolean;
}

@Injectable({ providedIn: 'root' })
export class PhotoReviewService {
  private readonly http = inject(HttpClient);

  getSession(token: string): Observable<SessionResponse> {
    return this.http.get<SessionResponse>(`/api/photo-review/${token}`);
  }

  approvePhoto(token: string, photoId: string, comment?: string): Observable<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/api/photo-review/${token}/photos/${photoId}/approve`,
      { comment }
    );
  }

  rejectPhoto(token: string, photoId: string, reason: string): Observable<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/api/photo-review/${token}/photos/${photoId}/reject`,
      { reason }
    );
  }

  addComment(token: string, photoId: string, comment: string): Observable<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/api/photo-review/${token}/photos/${photoId}/comment`,
      { comment }
    );
  }

  approveAll(token: string): Observable<ActionResponse> {
    return this.http.post<ActionResponse>(`/api/photo-review/${token}/approve-all`, {});
  }

  completeReview(token: string): Observable<ActionResponse> {
    return this.http.post<ActionResponse>(`/api/photo-review/${token}/complete`, {});
  }

  selectVariant(token: string, photoId: string, variantId: string): Observable<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/api/photo-review/${token}/photos/${photoId}/select-variant`,
      { variantId }
    );
  }

  addAnnotation(token: string, photoId: string, x: number, y: number, comment: string): Observable<ActionResponse> {
    return this.http.post<ActionResponse>(
      `/api/photo-review/${token}/photos/${photoId}/annotate`,
      { x, y, comment }
    );
  }

  getDownloadLinks(token: string): Observable<DownloadResponse> {
    return this.http.get<DownloadResponse>(`/api/photo-review/${token}/download`);
  }
}

export interface DownloadPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
}

export interface DownloadResponse {
  success: boolean;
  title: string | null;
  expiresAt: string | null;
  photos: DownloadPhoto[];
}
