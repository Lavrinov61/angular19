import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { PhotoReviewService, ReviewSession, ReviewPhoto } from '../../features/photo-review/photo-review.service';
import type { PhotoForApproval } from '../models/photo-approval.model';

export interface TokenSessionData {
  session: ReviewSession;
  approvals: PhotoForApproval[];
}

@Injectable({ providedIn: 'root' })
export class PhotoReviewTokenService {
  private readonly reviewService = inject(PhotoReviewService);

  getSession(token: string): Observable<TokenSessionData> {
    return this.reviewService.getSession(token).pipe(
      map(res => ({
        session: res.session,
        approvals: res.photos.map(p => this.mapToApproval(p, res.session)),
      }))
    );
  }

  approvePhoto(token: string, photoId: string, comment?: string): Observable<void> {
    return this.reviewService.approvePhoto(token, photoId, comment).pipe(map(() => void 0));
  }

  rejectPhoto(token: string, photoId: string, reason: string): Observable<void> {
    return this.reviewService.rejectPhoto(token, photoId, reason).pipe(map(() => void 0));
  }

  requestChanges(token: string, photoId: string, changes: string): Observable<void> {
    return this.reviewService.rejectPhoto(token, photoId, changes).pipe(map(() => void 0));
  }

  addAnnotation(token: string, photoId: string, x: number, y: number, comment: string): Observable<{ id: string }> {
    return this.reviewService.addAnnotation(token, photoId, x, y, comment).pipe(
      map(res => ({ id: res.annotationId || '' }))
    );
  }

  approveAll(token: string): Observable<void> {
    return this.reviewService.approveAll(token).pipe(map(() => void 0));
  }

  completeReview(token: string): Observable<void> {
    return this.reviewService.completeReview(token).pipe(map(() => void 0));
  }

  private mapToApproval(photo: ReviewPhoto, session: ReviewSession): PhotoForApproval {
    return {
      id: photo.id,
      originalPhotoUrl: photo.original_photo_url || '',
      retouchedPhotoUrl: photo.retouched_photo_url,
      approved: photo.status === 'approved',
      annotations: (photo.annotations || [])
        .filter(a => a.annotation['type'] === 'pin' && a.annotation['x'] != null)
        .map(a => ({
          id: a.id,
          x: Number(a.annotation['x'] || 0),
          y: Number(a.annotation['y'] || 0),
          text: String(a.annotation['comment'] || ''),
          createdAt: new Date(a.created_at),
          createdBy: 'client' as const,
        })),
      status: photo.status as 'pending' | 'approved' | 'rejected' | 'changes_requested',
      sessionId: session.id,
      sessionName: session.title,
      createdAt: new Date(photo.created_at),
    };
  }
}
