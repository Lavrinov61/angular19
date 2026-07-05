import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { PhotoReviewService, ReviewPhoto, ReviewSession, ReviewVariant } from '../../features/photo-review/photo-review.service';

@Injectable({ providedIn: 'root' })
export class PhotoApprovalStore {
  private readonly reviewService = inject(PhotoReviewService);
  private token = '';

  readonly session = signal<ReviewSession | null>(null);
  readonly photos = signal<ReviewPhoto[]>([]);
  readonly selectedPhoto = signal<ReviewPhoto | null>(null);
  readonly selectedVariant = signal<ReviewVariant | null>(null);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly completed = signal(false);
  readonly actionLoading = signal(false);

  readonly reviewedCount = computed(() => {
    return this.photos().filter(p => p.status === 'approved' || p.status === 'rejected').length;
  });

  readonly selectedCount = computed(() => {
    return this.photos().filter(p => p.selected_variant_id).length;
  });

  readonly progressPct = computed(() => {
    const total = this.photos().length;
    return total === 0 ? 0 : Math.round((this.reviewedCount() / total) * 100);
  });

  readonly allReviewed = computed(() => {
    const ps = this.photos();
    return ps.length > 0 && ps.every(p => p.status === 'approved' || p.status === 'rejected');
  });

  readonly hasPending = computed(() => {
    return this.photos().some(p => p.status === 'pending' || p.status === 'changes_requested');
  });

  readonly currentPhotoIndex = computed(() => {
    const photo = this.selectedPhoto();
    if (!photo) return -1;
    return this.photos().findIndex(p => p.id === photo.id);
  });

  readonly displayUrl = computed(() => {
    const variant = this.selectedVariant();
    if (variant) return variant.variant_url;
    const photo = this.selectedPhoto();
    return photo?.retouched_photo_url ?? '';
  });

  loadSession(token: string): void {
    this.token = token;
    this.loading.set(true);
    this.error.set(null);

    this.reviewService.getSession(token).subscribe({
      next: (res) => {
        if (res.success) {
          this.session.set(res.session);
          this.photos.set(res.photos);

          if (res.session.status === 'approved' || res.session.status === 'completed') {
            this.completed.set(true);
          }

          if (res.photos.length > 0) {
            this.selectPhoto(res.photos[0]);
          }
        }
        this.loading.set(false);
      },
      error: (err: unknown) => {
        if (err instanceof HttpErrorResponse) {
          if (err.status === 404) {
            this.error.set('Ссылка не найдена');
          } else if (err.status === 410) {
            this.completed.set(true);
          } else {
            this.error.set('Не удалось загрузить фотографии');
          }
        } else {
          this.error.set('Не удалось загрузить фотографии');
        }
        this.loading.set(false);
      },
    });
  }

  selectPhoto(photo: ReviewPhoto): void {
    this.selectedPhoto.set(photo);
    const selectedVariant = photo.variants.find(v => v.is_selected);
    this.selectedVariant.set(selectedVariant ?? null);
  }

  selectVariant(variant: ReviewVariant): void {
    const photo = this.selectedPhoto();
    if (!photo) return;

    this.actionLoading.set(true);
    this.reviewService.selectVariant(this.token, photo.id, variant.id).subscribe({
      next: () => {
        const updatedVariants = photo.variants.map(v => ({
          ...v,
          is_selected: v.id === variant.id,
          selected_at: v.id === variant.id ? new Date().toISOString() : null,
        }));
        const updatedPhoto: ReviewPhoto = { ...photo, variants: updatedVariants, selected_variant_id: variant.id };
        this.photos.update(ps => ps.map(p => p.id === photo.id ? updatedPhoto : p));
        this.selectedPhoto.set(updatedPhoto);
        this.selectedVariant.set({ ...variant, is_selected: true, selected_at: new Date().toISOString() });
        this.actionLoading.set(false);
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  /** Callback invoked after successful approve with `completed` flag from backend */
  onApproveSuccess: ((completed: boolean) => void) | null = null;

  approvePhoto(): void {
    const photo = this.selectedPhoto();
    if (!photo) return;

    this.actionLoading.set(true);
    this.reviewService.approvePhoto(this.token, photo.id).subscribe({
      next: (res) => {
        this.actionLoading.set(false);
        if (res.completed) {
          // Backend auto-completed: update only approved photo, mark session done
          this.updatePhotoStatus(photo.id, 'approved');
          const s = this.session();
          if (s) this.session.set({ ...s, approvedCount: 1, rejectedCount: 0 });
          this.onApproveSuccess?.(true);
          this.completed.set(true);
        } else {
          this.updatePhotoStatus(photo.id, 'approved');
          this.onApproveSuccess?.(false);
          this.advanceToNextPending();
        }
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  /** Callback invoked after successful reject */
  onRejectSuccess: (() => void) | null = null;

  rejectPhoto(reason: string): void {
    const photo = this.selectedPhoto();
    if (!photo) return;

    this.actionLoading.set(true);
    this.reviewService.rejectPhoto(this.token, photo.id, reason).subscribe({
      next: () => {
        this.updatePhotoStatus(photo.id, 'rejected');
        this.actionLoading.set(false);
        this.onRejectSuccess?.();
        this.advanceToNextPending();
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  addComment(comment: string): void {
    const photo = this.selectedPhoto();
    if (!photo) return;

    this.reviewService.addComment(this.token, photo.id, comment).subscribe({
      next: (res) => {
        if (res.success) {
          const newAnnotation = {
            id: res.annotationId || '',
            annotation: { comment, type: 'text' as const },
            created_at: new Date().toISOString(),
          };
          const updatedPhoto: ReviewPhoto = {
            ...photo,
            annotations: [...photo.annotations, newAnnotation],
          };
          this.photos.update(ps => ps.map(p => p.id === photo.id ? updatedPhoto : p));
          this.selectedPhoto.set(updatedPhoto);
        }
      },
    });
  }

  addAnnotation(x: number, y: number, comment: string): void {
    const photo = this.selectedPhoto();
    if (!photo) return;

    this.reviewService.addAnnotation(this.token, photo.id, x, y, comment).subscribe({
      next: (res) => {
        if (res.success) {
          const newAnnotation = {
            id: res.annotationId || '',
            annotation: { comment, type: 'pin' as const, x, y },
            created_at: new Date().toISOString(),
          };
          const updatedPhoto: ReviewPhoto = {
            ...photo,
            annotations: [...photo.annotations, newAnnotation],
          };
          this.photos.update(ps => ps.map(p => p.id === photo.id ? updatedPhoto : p));
          this.selectedPhoto.set(updatedPhoto);
        }
      },
    });
  }

  approveAll(): void {
    this.actionLoading.set(true);
    this.reviewService.approveAll(this.token).subscribe({
      next: () => {
        this.photos.update(ps => ps.map(p => ({ ...p, status: 'approved' })));
        const current = this.selectedPhoto();
        if (current) {
          this.selectedPhoto.set({ ...current, status: 'approved' });
        }
        const s = this.session();
        if (s) this.session.set({ ...s, approvedCount: this.photos().length });
        this.actionLoading.set(false);
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  completeReview(): void {
    this.actionLoading.set(true);
    this.reviewService.completeReview(this.token).subscribe({
      next: () => {
        this.completed.set(true);
        const s = this.session();
        if (s) {
          this.session.set({
            ...s,
            approvedCount: this.photos().filter(p => p.status === 'approved').length,
            rejectedCount: this.photos().filter(p => p.status === 'rejected').length,
          });
        }
        this.actionLoading.set(false);
      },
      error: () => {
        this.actionLoading.set(false);
      },
    });
  }

  prevPhoto(): void {
    const idx = this.currentPhotoIndex();
    const ps = this.photos();
    if (idx > 0) {
      this.selectPhoto(ps[idx - 1]);
    }
  }

  nextPhoto(): void {
    const idx = this.currentPhotoIndex();
    const ps = this.photos();
    if (idx >= 0 && idx < ps.length - 1) {
      this.selectPhoto(ps[idx + 1]);
    }
  }

  reset(): void {
    this.token = '';
    this.session.set(null);
    this.photos.set([]);
    this.selectedPhoto.set(null);
    this.selectedVariant.set(null);
    this.loading.set(true);
    this.error.set(null);
    this.completed.set(false);
    this.actionLoading.set(false);
  }

  private updatePhotoStatus(photoId: string, status: string): void {
    this.photos.update(ps => ps.map(p => p.id === photoId ? { ...p, status } : p));
    const current = this.selectedPhoto();
    if (current?.id === photoId) {
      this.selectedPhoto.set({ ...current, status });
    }
  }

  private advanceToNextPending(): void {
    const ps = this.photos();
    const idx = this.currentPhotoIndex();
    const remaining = ps.filter((p, i) => i !== idx && (p.status === 'pending' || p.status === 'changes_requested'));
    if (remaining.length > 0) {
      this.selectPhoto(remaining[0]);
    }
  }
}
