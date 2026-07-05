import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Observable, of, map } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { PhotoApproval, PhotoForApproval, PhotoAnnotation, ApprovalStatus } from '../models/photo-approval.model';

@Injectable({
  providedIn: 'root'
})
export class PhotoApprovalService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);

  private readonly PENDING_TOKENS_KEY = 'approval_pending_tokens';

  isLoading = signal(false);
  error = signal<string | null>(null);
  private _pendingApprovals = signal<PhotoApproval[]>([]);
  readonly pendingApprovals = this._pendingApprovals.asReadonly();

  getPhotosForApproval(sessionId?: string): Observable<PhotoForApproval[]> {
    this.isLoading.set(true);
    this.error.set(null);
    let url = '/api/photo-approvals';
    if (sessionId) url += `?session_id=${sessionId}`;

    return this.http.get<{ approvals: Record<string, unknown>[] }>(url).pipe(
      map(res => (res.approvals || []).map(a => this.mapToPhotoForApproval(a))),
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.message || 'Failed to load');
        return of([]);
      }),
    );
  }

  getPhotographerPhotosForApproval(_photographerId?: string): Observable<PhotoForApproval[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<{ approvals: Record<string, unknown>[] }>('/api/photo-approvals/photographer').pipe(
      map(res => (res.approvals || []).map(a => this.mapToPhotoForApproval(a))),
      tap(() => this.isLoading.set(false)),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.message || 'Failed to load');
        return of([]);
      }),
    );
  }

  approvePhoto(photoId: string, comment?: string): Observable<PhotoApproval> {
    return this.http.post<Record<string, unknown>>(`/api/photo-approvals/${photoId}/approve`, { comment }).pipe(
      map(res => this.mapToPhotoApproval(res)),
      catchError(err => {
        this.error.set(err.message || 'Failed to approve');
        return of({} as PhotoApproval);
      }),
    );
  }

  rejectPhoto(photoId: string, reason: string): Observable<PhotoApproval> {
    return this.http.post<Record<string, unknown>>(`/api/photo-approvals/${photoId}/reject`, { reason }).pipe(
      map(res => this.mapToPhotoApproval(res)),
      catchError(err => {
        this.error.set(err.message || 'Failed to reject');
        return of({} as PhotoApproval);
      }),
    );
  }

  requestChanges(photoId: string, changes: string): Observable<PhotoApproval> {
    return this.http.post<Record<string, unknown>>(`/api/photo-approvals/${photoId}/request-changes`, { changes }).pipe(
      map(res => this.mapToPhotoApproval(res)),
      catchError(err => {
        this.error.set(err.message || 'Failed to request changes');
        return of({} as PhotoApproval);
      }),
    );
  }

  addAnnotation(photoId: string, annotation: { x?: number; y?: number; text: string }): Observable<PhotoAnnotation> {
    return this.http.post<Record<string, unknown>>(`/api/photo-approvals/${photoId}/annotations`, {
      x_position: annotation.x,
      y_position: annotation.y,
      comment: annotation.text,
    }).pipe(
      map(res => ({
        id: String(res['id'] || ''),
        x: Number(res['x'] || annotation.x || 0),
        y: Number(res['y'] || annotation.y || 0),
        text: annotation.text,
        createdAt: new Date(String(res['created_at'] || '')),
        createdBy: 'client' as const,
      })),
      catchError(err => {
        this.error.set(err.message || 'Failed to add annotation');
        return of({} as PhotoAnnotation);
      }),
    );
  }

  getPhotoAnnotations(photoId: string): Observable<PhotoAnnotation[]> {
    return this.http.get<{ annotations: Record<string, unknown>[] }>(`/api/photo-approvals/${photoId}/annotations`).pipe(
      map(res => (res.annotations || []).map(a => this.mapAnnotation(a))),
      catchError(() => of([])),
    );
  }

  deleteAnnotation(_photoId: string, annotationId: string): Observable<void> {
    return this.http.delete<void>(`/api/photo-approvals/annotations/${annotationId}`).pipe(
      catchError(() => of(void 0)),
    );
  }

  removeAnnotation(photoId: string, annotationId: string): Observable<void> {
    return this.deleteAnnotation(photoId, annotationId);
  }

  getApprovalById(approvalId: string): Observable<PhotoApproval | null> {
    return this.http.get<Record<string, unknown>>(`/api/photo-approvals/${approvalId}`).pipe(
      map(res => this.mapToPhotoApproval(res)),
      catchError(() => of(null)),
    );
  }

  getApprovalHistory(photoId: string): Observable<PhotoApproval[]> {
    return this.http.get<{ history: Record<string, unknown>[] }>(`/api/photo-approvals/${photoId}/history`).pipe(
      map(res => (res.history || []).map(h => ({
        id: photoId,
        orderId: '',
        userId: '',
        createdAt: new Date(String(h['timestamp'] || '')),
        updatedAt: new Date(String(h['timestamp'] || '')),
        status: (h['status'] as ApprovalStatus) || ApprovalStatus.PENDING,
        photos: [],
      }))),
      catchError(() => of([])),
    );
  }

  bulkApprovePhotos(photoIds: string[], _comment?: string): Observable<PhotoApproval[]> {
    return this.http.post<{ approved_count: number }>('/api/photo-approvals/bulk/approve', {
      approval_ids: photoIds,
    }).pipe(
      map(() => []),
      catchError(err => {
        this.error.set(err.message || 'Failed to bulk approve');
        return of([]);
      }),
    );
  }

  getApprovalStats(userId?: string): Observable<Record<string, number>> {
    const asPhotographer = userId ? 'true' : 'false';
    return this.http.get<Record<string, number>>(`/api/photo-approvals/stats/summary?as_photographer=${asPhotographer}`).pipe(
      catchError(() => of({})),
    );
  }

  updatePhotoStatus(photoId: string, status: ApprovalStatus, _comment?: string): Observable<PhotoApproval> {
    return this.http.put<Record<string, unknown>>(`/api/photo-approvals/${photoId}/status`, { status }).pipe(
      map(res => this.mapToPhotoApproval(res)),
      catchError(err => {
        this.error.set(err.message || 'Failed to update status');
        return of({} as PhotoApproval);
      }),
    );
  }

  approveAll(approvalId: string, comment?: string): Observable<PhotoApproval[]> {
    return this.bulkApprovePhotos([approvalId], comment);
  }

  rejectAll(approvalId: string, reason: string): Observable<PhotoApproval[]> {
    return this.rejectPhoto(approvalId, reason).pipe(map(r => [r]));
  }

  getPendingApprovals(): Observable<PhotoApproval[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<{ approvals: Record<string, unknown>[] }>('/api/photo-approvals?status=pending').pipe(
      map(res => (res.approvals || []).map(a => this.mapToPhotoApproval(a))),
      tap(approvals => {
        this._pendingApprovals.set(approvals);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.message || 'Failed to load');
        return of([]);
      }),
    );
  }

  clearError(): void {
    this.error.set(null);
  }

  reset(): void {
    this.isLoading.set(false);
    this.error.set(null);
  }

  /** Link a public review session to the current authenticated user */
  linkSession(token: string): Observable<{ success: boolean; sessionId?: string }> {
    return this.http.post<{ success: boolean; sessionId?: string }>(
      '/api/photo-approvals/link-session', { token }
    ).pipe(catchError(() => of({ success: false })));
  }

  /** Auto-link orphaned sessions by phone/email match */
  autoLink(): Observable<{ linked: number }> {
    return this.http.post<{ linked: number }>('/api/photo-approvals/auto-link', {}).pipe(
      catchError(() => of({ linked: 0 }))
    );
  }

  /** Get all client approvals (not just pending) */
  getClientApprovals(): Observable<PhotoApproval[]> {
    this.isLoading.set(true);
    this.error.set(null);

    return this.http.get<{ approvals: Record<string, unknown>[] }>(
      '/api/photo-approvals?status=pending,approved,completed,partially_approved,changes_requested'
    ).pipe(
      map(res => (res.approvals || []).map(a => this.mapToPhotoApproval(a))),
      tap(approvals => {
        this._pendingApprovals.set(approvals);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        this.error.set(err.message || 'Ошибка загрузки');
        return of([]);
      }),
    );
  }

  /** Get download links for approved session photos */
  getSessionDownloadLinks(sessionId: string): Observable<{ photos: { id: string; url: string; thumbnailUrl?: string }[] }> {
    return this.http.get<{ photos: { id: string; url: string; thumbnailUrl?: string }[] }>(
      `/api/photo-approvals/sessions/${sessionId}/download`
    ).pipe(
      catchError(() => of({ photos: [] }))
    );
  }

  /** Save token in localStorage for linking after future login/registration */
  storePendingToken(token: string): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const stored = JSON.parse(localStorage.getItem(this.PENDING_TOKENS_KEY) || '[]') as string[];
      if (!stored.includes(token)) {
        stored.push(token);
        localStorage.setItem(this.PENDING_TOKENS_KEY, JSON.stringify(stored.slice(-20)));
      }
    } catch { /* localStorage unavailable */ }
  }

  /** Link all stored pending tokens to the current authenticated user */
  linkPendingTokens(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const stored = JSON.parse(localStorage.getItem(this.PENDING_TOKENS_KEY) || '[]') as string[];
      if (stored.length === 0) return;
      localStorage.removeItem(this.PENDING_TOKENS_KEY);
      for (const token of stored) {
        this.linkSession(token).subscribe();
      }
    } catch { /* */ }
  }

  private mapToPhotoForApproval(raw: Record<string, unknown>): PhotoForApproval {
    const rawStatus = String(raw['status'] || 'pending') as 'pending' | 'approved' | 'rejected' | 'changes_requested';
    return {
      id: String(raw['id'] || ''),
      originalPhotoUrl: String(raw['original_photo_url'] || raw['file_url'] || ''),
      retouchedPhotoUrl: String(raw['retouched_photo_url'] || ''),
      approved: rawStatus === 'approved',
      annotations: [],
      comments: String(raw['comment'] || ''),
      sessionId: raw['approval_session_id'] ? String(raw['approval_session_id']) : undefined,
      sessionName: raw['session_name'] ? String(raw['session_name']) : undefined,
      serviceName: raw['service_name'] ? String(raw['service_name']) : undefined,
      orderId: raw['order_id'] ? String(raw['order_id']) : undefined,
      publicToken: raw['public_token'] ? String(raw['public_token']) : undefined,
      status: rawStatus,
      createdAt: raw['created_at'] ? new Date(String(raw['created_at'])) : undefined,
    };
  }

  private mapToPhotoApproval(raw: Record<string, unknown>): PhotoApproval {
    const statusMap: Record<string, ApprovalStatus> = {
      pending: ApprovalStatus.PENDING,
      approved: ApprovalStatus.APPROVED,
      rejected: ApprovalStatus.REJECTED,
      changes_requested: ApprovalStatus.NEEDS_REVISION,
      partially_approved: ApprovalStatus.PARTIALLY_APPROVED,
    };

    return {
      id: String(raw['id'] || ''),
      orderId: String(raw['order_id'] || ''),
      userId: String(raw['client_id'] || ''),
      createdAt: new Date(String(raw['created_at'] || '')),
      updatedAt: new Date(String(raw['updated_at'] || '')),
      status: statusMap[String(raw['status'] || 'pending')] || ApprovalStatus.PENDING,
      photos: [],
    };
  }

  private mapAnnotation(raw: Record<string, unknown>): PhotoAnnotation {
    const annotation = (raw['annotation'] || {}) as Record<string, unknown>;
    return {
      id: String(raw['id'] || ''),
      x: Number(annotation['x'] || 0),
      y: Number(annotation['y'] || 0),
      text: String(annotation['comment'] || ''),
      createdAt: new Date(String(raw['created_at'] || '')),
      createdBy: 'client',
    };
  }
}
