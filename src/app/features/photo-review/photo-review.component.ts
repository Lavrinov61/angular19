import { Component, inject, signal, computed, effect, untracked, ChangeDetectionStrategy, PLATFORM_ID, ElementRef, viewChild, OnDestroy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatChipsModule } from '@angular/material/chips';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ReviewPhoto, ReviewVariant, PhotoReviewService, DownloadPhoto } from './photo-review.service';
import { AuthService } from '../../core/services/auth.service';
import { PhotoApprovalService } from '../../core/services/photo-approval.service';
import { PhotoApprovalStore } from '../../shared/photo-approval/photo-approval-store.service';
import { ResponsiveLayoutService } from '../../core/services/responsive-layout.service';

type DisplayImageState = 'idle' | 'loading' | 'loaded' | 'error';

interface ImageRetryState {
  readonly url: string;
  readonly nonce: number;
}

interface PendingVariantSelection {
  readonly id: string;
  readonly url: string;
}

@Component({
  selector: 'app-photo-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule, MatIconModule, MatProgressBarModule,
    MatProgressSpinnerModule, MatTooltipModule, MatChipsModule, FormsModule,
  ],
  templateUrl: './photo-review.component.html',
  styleUrl: './photo-review.component.scss',
})
export class PhotoReviewComponent implements OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly authService = inject(AuthService);
  private readonly approvalService = inject(PhotoApprovalService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly layout = inject(ResponsiveLayoutService);
  private readonly http = inject(HttpClient);
  private readonly reviewService = inject(PhotoReviewService);
  readonly store = inject(PhotoApprovalStore);

  readonly detailImageWrap = viewChild<ElementRef<HTMLElement>>('detailImageWrap');
  readonly storiesImageEl = viewChild<ElementRef<HTMLElement>>('storiesImage');

  // Responsive
  readonly isMobile = toSignal(this.layout.isMobile$, { initialValue: false });

  commentText = '';
  annotationText = '';

  readonly compareMode = signal(false);
  readonly sliderPosition = signal(50);
  readonly fullscreen = signal(false);
  readonly placingAnnotation = signal(false);
  readonly annotationPin = signal<{ x: number; y: number } | null>(null);
  readonly photoTransitioning = signal(false);

  // Mobile Stories state
  readonly storiesMode = signal(false);
  readonly storiesSwipeX = signal(0);
  readonly storiesSwipeY = signal(0);
  readonly storiesSwiping = signal(false);
  readonly bottomSheetOpen = signal(false);

  // Tap toggle: show original photo (Instagram-style before/after)
  readonly showingOriginal = signal(false);
  private tapTimer: ReturnType<typeof setTimeout> | null = null;

  readonly pendingVariantSelection = signal<PendingVariantSelection | null>(null);
  readonly imageRetry = signal<ImageRetryState | null>(null);
  readonly imageNavigationLoading = signal(false);
  readonly displayBaseImageUrl = computed(() => this.pendingVariantSelection()?.url ?? this.store.displayUrl());
  readonly displayImageState = signal<DisplayImageState>('idle');
  readonly displayImageUrl = computed(() => {
    const url = this.displayBaseImageUrl();
    const retry = this.imageRetry();
    if (!url || !retry || retry.url !== url) return url;
    return this.withRetryFragment(url, retry.nonce);
  });
  readonly displayImageLoading = computed(() => this.imageNavigationLoading() || this.displayImageState() === 'loading');
  readonly displayImageError = computed(() => this.displayImageState() === 'error');

  // Enhanced UX signals
  readonly cardDeparting = signal<'none' | 'right' | 'left'>('none');
  readonly undoAction = signal<{ photoId: string; prevStatus: string } | null>(null);
  readonly showCelebration = signal(false);
  readonly hintsDismissed = signal(false);

  // Confirmation screen
  readonly confirmationMode = signal(false);

  // Onboarding overlay
  readonly showOnboarding = signal(false);
  readonly showSwipeHint = computed(() => {
    const photo = this.store.selectedPhoto();
    return this.isMobile()
      && this.storiesMode()
      && !this.showOnboarding()
      && !this.hintsDismissed()
      && !this.bottomSheetOpen()
      && !this.annotationPin()
      && ((photo?.variants.length ?? 0) > 1 || this.store.photos().length > 1);
  });

  // Pinch-to-zoom state
  readonly zoomScale = signal(1);
  readonly zoomOriginX = signal(50);
  readonly zoomOriginY = signal(50);

  // Preset feedback chips
  readonly feedbackChips = ['Кожа', 'Цвет', 'Фон', 'Глаза', 'Волосы'] as const;

  // Expose Math for template
  readonly Math = Math;

  private token = '';
  private touchStartX = 0;
  private touchStartY = 0;
  private pinchStartDist = 0;
  private pinchStartScale = 1;
  private lastTapTime = 0;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private imageNavigationTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly SWIPE_DECIDE_THRESHOLD = 100;
  private readonly IMAGE_NAVIGATION_LOADING_MIN_MS = 650;
  private readonly ONBOARDING_STORAGE_KEY = 'svf_photo_review_onboarding_v2';
  private observedDisplayImageUrl = '';
  private readonly loadedDisplayUrls = signal<ReadonlySet<string>>(new Set());
  private readonly preloadImages = new Map<string, HTMLImageElement>();

  readonly needsComment = signal(false);
  readonly feedbackMode = signal(false);
  readonly npsSubmitted = signal(false);

  readonly isAuthenticated = computed(() => this.authService.isAuthenticated());
  readonly showNpsComment = signal(false);
  readonly npsCommentText = signal('');
  readonly npsCommentSubmitting = signal(false);
  readonly npsRating = signal<number | null>(null);

  // Download state
  readonly downloadPhotos = signal<DownloadPhoto[]>([]);
  readonly downloadLoading = signal(false);
  readonly downloadError = signal<string | null>(null);

  // Delegate to store's selectedCount
  readonly selectedCount = this.store.selectedCount;

  // Current variant index within photo.variants
  readonly currentVariantIndex = computed(() => {
    const photo = this.store.selectedPhoto();
    const variant = this.store.selectedVariant();
    if (!photo || !variant) return -1;
    return photo.variants.findIndex(v => v.id === variant.id);
  });

  // Precomputed confetti pieces for celebration
  readonly confettiPieces = Array.from({ length: 50 }, (_, i) => ({
    x: Math.random() * 100,
    delay: Math.random() * 600,
    color: ['#ef3124', '#ff6b5f', '#3b82f6', '#ef4444', '#a855f7', '#ec4899'][i % 6],
    size: 6 + Math.random() * 6,
    drift: (Math.random() - 0.5) * 200,
  }));

  constructor() {
    // Wire store callbacks for side effects
    this.store.onApproveSuccess = (completed) => {
      this.haptic([50, 30, 100]);
      if (completed) {
        this.triggerCelebration();
        setTimeout(() => this.storiesMode.set(false), 2000);
      }
    };
    this.store.onRejectSuccess = () => {
      this.haptic([50, 30, 50]);
    };

    if (isPlatformBrowser(this.platformId)) {
      this.token = this.route.snapshot.paramMap.get('token') || '';
      if (!this.token) {
        this.store.loading.set(false);
        this.store.error.set('Некорректная ссылка');
        return;
      }

      if (this.authService.isAuthenticated()) {
        // Link session to authenticated user in background
        this.approvalService.linkSession(this.token).subscribe();
      } else {
        // Anonymous → save token for future linking after registration
        this.approvalService.storePendingToken(this.token);
      }
      this.store.loadSession(this.token);

      // Auto-load download links when session is already completed
      effect(() => {
        const completed = this.store.completed();
        if (completed) {
          untracked(() => this.loadDownloadLinks());
        }
      });

      // Onboarding: show once per device (SSR-safe)
      try {
        if (!localStorage.getItem(this.ONBOARDING_STORAGE_KEY)) {
          this.showOnboarding.set(true);
        }
      } catch { /* SSR, ignore */ }
    }

    effect(() => {
      const url = this.displayImageUrl();
      const baseUrl = this.displayBaseImageUrl();
      const loadedUrls = this.loadedDisplayUrls();
      const currentState = untracked(() => this.displayImageState());

      untracked(() => {
        if (!baseUrl) {
          this.observedDisplayImageUrl = '';
          this.displayImageState.set('error');
          this.finishImageNavigationLoading();
          return;
        }

        if (url === this.observedDisplayImageUrl) {
          if (currentState === 'loading' && loadedUrls.has(baseUrl)) {
            this.displayImageState.set('loaded');
            this.finishImageNavigationLoading();
          }
          return;
        }

        this.observedDisplayImageUrl = url;
        const nextState: DisplayImageState = loadedUrls.has(baseUrl) ? 'loaded' : 'loading';
        this.displayImageState.set(nextState);
        if (nextState === 'loaded') {
          this.finishImageNavigationLoading();
        }
      });
    });

    effect(() => {
      const pending = this.pendingVariantSelection();
      const selectedVariantId = this.store.selectedVariant()?.id ?? null;
      const actionLoading = this.store.actionLoading();

      untracked(() => {
        if (!pending) return;
        if (selectedVariantId === pending.id || !actionLoading) {
          this.pendingVariantSelection.set(null);
        }
      });
    });

    effect(() => {
      const photos = this.store.photos();
      const index = this.store.currentPhotoIndex();
      untracked(() => this.preloadNearbyImages(photos, index));
    });

    // Auto-enter stories on mobile when session loads
    let initialLoad = true;
    effect(() => {
      const photo = this.store.selectedPhoto();
      const isLoading = this.store.loading();
      if (photo && !isLoading && initialLoad) {
        initialLoad = false;
        untracked(() => {
          if (photo.original_photo_url) this.compareMode.set(true);
          if (this.isMobile()) {
            setTimeout(() => this.enterStories(), 0);
          }
        });
      }
    });
  }

  loadDownloadLinks(): void {
    if (!this.token || this.downloadLoading()) return;
    this.downloadLoading.set(true);
    this.downloadError.set(null);
    this.reviewService.getDownloadLinks(this.token).subscribe({
      next: (resp) => {
        this.downloadPhotos.set(resp.photos);
        this.downloadLoading.set(false);
      },
      error: () => {
        this.downloadError.set('Не удалось загрузить ссылки');
        this.downloadLoading.set(false);
      },
    });
  }

  downloadPhoto(photo: DownloadPhoto): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const a = document.createElement('a');
    a.href = photo.url;
    a.download = `svoefoto-${photo.id}.jpg`;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }

  ngOnDestroy(): void {
    if (this.tapTimer) clearTimeout(this.tapTimer);
    if (this.undoTimer) clearTimeout(this.undoTimer);
    if (this.imageNavigationTimer) clearTimeout(this.imageNavigationTimer);
    this.preloadImages.forEach((img) => {
      img.onload = null;
      img.onerror = null;
    });
    this.preloadImages.clear();
    this.store.onApproveSuccess = null;
    this.store.onRejectSuccess = null;
    this.store.reset();
  }

  dismissOnboarding(): void {
    this.showOnboarding.set(false);
    try { localStorage.setItem(this.ONBOARDING_STORAGE_KEY, '1'); } catch { /* SSR */ }
  }

  toggleOriginal(): void {
    const photo = this.store.selectedPhoto();
    if (!photo?.original_photo_url) return;
    this.showingOriginal.update(v => !v);
    this.haptic(10);
  }

  selectPhoto(photo: ReviewPhoto): void {
    if (this.store.selectedPhoto()?.id !== photo.id) {
      this.startImageNavigationLoading();
    }
    this.photoTransitioning.set(true);
    setTimeout(() => {
      this.pendingVariantSelection.set(null);
      this.store.selectPhoto(photo);
      this.commentText = '';
      this.needsComment.set(false);
      this.feedbackMode.set(false);
      this.annotationPin.set(null);
      this.placingAnnotation.set(false);
      this.zoomScale.set(1);
      this.bottomSheetOpen.set(false);
      this.confirmationMode.set(false);
      this.showingOriginal.set(false);
      // Auto-enable compare if original available
      if (photo.original_photo_url) {
        this.compareMode.set(true);
      } else {
        this.compareMode.set(false);
      }
      this.photoTransitioning.set(false);
    }, 100);
  }

  selectVariant(variant: ReviewVariant): void {
    if (this.store.selectedVariant()?.id === variant.id) return;
    this.startImageNavigationLoading();
    this.store.selectVariant(variant);
    this.pendingVariantSelection.set({ id: variant.id, url: variant.variant_url });
    this.showingOriginal.set(false);
  }

  onDisplayImageLoad(event: Event): void {
    const image = event.currentTarget;
    if (!(image instanceof HTMLImageElement) || !this.isCurrentDisplayImage(image)) return;

    const baseUrl = this.displayBaseImageUrl();
    if (!baseUrl) return;
    this.rememberLoadedImage(baseUrl);
    this.displayImageState.set('loaded');
    this.finishImageNavigationLoading();
  }

  onDisplayImageError(event: Event): void {
    const image = event.currentTarget;
    if (!(image instanceof HTMLImageElement) || !this.isCurrentDisplayImage(image)) return;
    this.displayImageState.set('error');
    this.finishImageNavigationLoading();
  }

  retryDisplayImage(event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();

    const url = this.displayBaseImageUrl();
    if (!url) return;

    this.imageRetry.update((current) => ({
      url,
      nonce: current?.url === url ? current.nonce + 1 : 1,
    }));
    this.displayImageState.set('loading');
  }

  toggleCompare(): void {
    this.compareMode.update(v => !v);
    this.sliderPosition.set(50);
  }

  onSliderMove(event: MouseEvent | TouchEvent): void {
    const wrap = this.detailImageWrap()?.nativeElement;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    this.sliderPosition.set(pct);
  }

  toggleFullscreen(): void {
    this.fullscreen.update(v => !v);
  }

  // --- Stories mode ---

  enterStories(): void {
    this.storiesMode.set(true);
    this.zoomScale.set(1);
  }

  exitStories(): void {
    this.storiesMode.set(false);
    this.bottomSheetOpen.set(false);
    this.zoomScale.set(1);
    this.showingOriginal.set(false);
    this.cardDeparting.set('none');
  }

  // --- Touch swipe (desktop fallback) ---

  onTouchStart(event: TouchEvent): void {
    if (this.compareMode() || this.placingAnnotation()) return;
    this.touchStartX = event.touches[0].clientX;
  }

  onTouchEnd(event: TouchEvent): void {
    if (this.compareMode() || this.placingAnnotation()) return;
    const dx = event.changedTouches[0].clientX - this.touchStartX;
    if (Math.abs(dx) > 60) {
      if (dx < 0) this.nextPhoto();
      else this.prevPhoto();
    }
  }

  // --- Stories touch handlers ---

  onStoriesTouchStart(event: TouchEvent): void {
    if (this.bottomSheetOpen()) return;

    if (event.touches.length === 2) {
      this.pinchStartDist = this.getTouchDistance(event.touches);
      this.pinchStartScale = this.zoomScale();
      return;
    }

    this.touchStartX = event.touches[0].clientX;
    this.touchStartY = event.touches[0].clientY;
    this.storiesSwipeX.set(0);
    this.storiesSwipeY.set(0);
    this.storiesSwiping.set(true);
  }

  onStoriesTouchMove(event: TouchEvent): void {
    if (this.bottomSheetOpen()) return;

    if (event.touches.length === 2) {
      event.preventDefault();
      const dist = this.getTouchDistance(event.touches);
      const scale = Math.min(5, Math.max(1, this.pinchStartScale * (dist / this.pinchStartDist)));
      this.zoomScale.set(scale);

      const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      const el = this.storiesImageEl()?.nativeElement;
      if (el) {
        const rect = el.getBoundingClientRect();
        this.zoomOriginX.set(((midX - rect.left) / rect.width) * 100);
        this.zoomOriginY.set(((midY - rect.top) / rect.height) * 100);
      }
      return;
    }

    if (!this.storiesSwiping() || this.zoomScale() > 1) return;
    const dx = event.touches[0].clientX - this.touchStartX;
    const dy = event.touches[0].clientY - this.touchStartY;
    this.storiesSwipeX.set(dx);
    this.storiesSwipeY.set(dy);
  }

  onStoriesTouchEnd(event: TouchEvent): void {
    if (this.bottomSheetOpen()) return;

    if (!this.storiesSwiping()) return;
    this.storiesSwiping.set(false);

    const dx = this.storiesSwipeX();
    const dy = this.storiesSwipeY();

    // Swipe down = exit stories
    if (dy > 100 && Math.abs(dx) < 60) {
      this.storiesSwipeX.set(0);
      this.storiesSwipeY.set(0);
      this.exitStories();
      return;
    }

    // Swipe left/right = variant navigation
    if (dx < -this.SWIPE_DECIDE_THRESHOLD) {
      this.markSwipeHintSeen();
      this.nextVariant();
      this.storiesSwipeX.set(0);
      this.storiesSwipeY.set(0);
      return;
    }
    if (dx > this.SWIPE_DECIDE_THRESHOLD) {
      this.markSwipeHintSeen();
      this.prevVariant();
      this.storiesSwipeX.set(0);
      this.storiesSwipeY.set(0);
      return;
    }

    // Tap (no significant movement)
    if (Math.abs(dx) < 15 && Math.abs(dy) < 15 && this.zoomScale() <= 1 && event.changedTouches.length === 1) {
      const now = Date.now();
      if (now - this.lastTapTime < 300) {
        // Double tap → zoom
        if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; }
        this.onDoubleTap(event);
        this.lastTapTime = 0;
      } else {
        this.lastTapTime = now;
        // Delayed single tap → toggle original/retouched (Instagram-style)
        if (this.tapTimer) clearTimeout(this.tapTimer);
        this.tapTimer = setTimeout(() => {
          this.toggleOriginal();
          this.tapTimer = null;
        }, 310);
      }
    }

    this.storiesSwipeX.set(0);
    this.storiesSwipeY.set(0);
  }

  private onDoubleTap(event: TouchEvent): void {
    if (this.zoomScale() > 1) {
      this.zoomScale.set(1);
    } else {
      this.zoomScale.set(2.5);
      const touch = event.changedTouches[0];
      const el = this.storiesImageEl()?.nativeElement;
      if (el) {
        const rect = el.getBoundingClientRect();
        this.zoomOriginX.set(((touch.clientX - rect.left) / rect.width) * 100);
        this.zoomOriginY.set(((touch.clientY - rect.top) / rect.height) * 100);
      }
    }
  }

  private getTouchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // --- Bottom sheet ---

  openBottomSheet(): void {
    this.bottomSheetOpen.set(true);
    this.commentText = '';
    this.needsComment.set(false);
  }

  closeBottomSheet(): void {
    this.bottomSheetOpen.set(false);
  }

  addChip(chip: string): void {
    this.commentText = this.commentText
      ? `${this.commentText}, ${chip.toLowerCase()}`
      : chip;
  }

  // --- Haptic ---

  private haptic(pattern: number | number[]): void {
    if (isPlatformBrowser(this.platformId) && 'vibrate' in navigator) {
      navigator.vibrate(pattern);
    }
  }

  // --- Mobile annotation (touch with offset) ---

  onStoriesImageTap(event: TouchEvent): void {
    if (!this.placingAnnotation() || this.zoomScale() > 1) return;
    const touch = event.changedTouches[0];
    const el = this.storiesImageEl()?.nativeElement;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((touch.clientX - rect.left) / rect.width) * 100;
    // Pin 40px above touch point
    const yRaw = ((touch.clientY - rect.top) / rect.height) * 100;
    const offsetPct = (40 / rect.height) * 100;
    const y = Math.max(0, yRaw - offsetPct);
    this.annotationPin.set({ x, y });
    this.placingAnnotation.set(false);
  }

  // --- Annotations ---

  startAnnotation(): void {
    this.placingAnnotation.set(true);
  }

  onImageClick(event: Event): void {
    if (!this.placingAnnotation()) return;
    if (!(event instanceof MouseEvent)) return;
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    this.annotationPin.set({ x, y });
    this.placingAnnotation.set(false);
  }

  submitAnnotation(): void {
    const pin = this.annotationPin();
    const photo = this.store.selectedPhoto();
    if (!pin || !photo || !this.annotationText.trim()) return;

    const text = this.annotationText.trim();
    this.annotationText = '';
    this.annotationPin.set(null);
    this.store.addAnnotation(pin.x, pin.y, text);
  }

  cancelAnnotation(): void {
    this.annotationPin.set(null);
    this.placingAnnotation.set(false);
    this.annotationText = '';
  }

  // --- Confirmation ---

  requestApprove(): void {
    this.confirmationMode.set(true);
  }

  confirmApprove(): void {
    this.confirmationMode.set(false);
    this.approve();
  }

  cancelConfirmation(): void {
    this.confirmationMode.set(false);
  }

  // --- Actions ---

  finalize(): void {
    if (this.store.actionLoading()) return;
    this.store.approveAll();
    // After approveAll, complete review
    // Note: approveAll in store doesn't auto-complete, so chain manually
  }

  submitFeedback(): void {
    const p = this.store.selectedPhoto();
    if (!p || this.store.actionLoading()) return;
    const reason = this.commentText.trim();
    if (!reason) { this.needsComment.set(true); return; }
    this.commentText = '';
    this.feedbackMode.set(false);
    this.bottomSheetOpen.set(false);
    this.store.rejectPhoto(reason);
  }

  approve(): void {
    const p = this.store.selectedPhoto();
    if (!p || this.store.actionLoading()) return;
    this.store.approvePhoto();
  }

  reject(): void {
    const p = this.store.selectedPhoto();
    if (!p || this.store.actionLoading()) return;
    const reason = this.commentText.trim() || '';
    this.store.rejectPhoto(reason);
  }

  submitComment(): void {
    const p = this.store.selectedPhoto();
    if (!p || !this.commentText.trim()) return;
    const text = this.commentText.trim();
    this.commentText = '';
    this.store.addComment(text);
  }

  approveAll(): void {
    this.store.approveAll();
  }

  complete(): void {
    this.store.completeReview();
  }

  getAnnotationText(a: ReviewPhoto['annotations'][0]): string {
    return (a.annotation as Record<string, string>)['comment'] || '';
  }

  isPin(a: ReviewPhoto['annotations'][0]): boolean {
    return a.annotation['type'] === 'pin' && a.annotation['x'] != null;
  }

  isOperatorClarification(a: ReviewPhoto['annotations'][0]): boolean {
    return a.annotation['type'] === 'operator_clarification';
  }

  prevPhoto(): void {
    const idx = this.store.currentPhotoIndex();
    const list = this.store.photos();
    if (idx > 0) this.selectPhoto(list[idx - 1]);
  }

  nextPhoto(): void {
    const idx = this.store.currentPhotoIndex();
    const list = this.store.photos();
    if (idx >= 0 && idx < list.length - 1) this.selectPhoto(list[idx + 1]);
  }

  // --- Variant navigation (swipe) ---

  nextVariant(): void {
    const photo = this.store.selectedPhoto();
    if (!photo) return;
    if (photo.variants.length > 1) {
      const idx = this.currentVariantIndex();
      if (idx < photo.variants.length - 1) {
        this.selectVariant(photo.variants[idx + 1]);
        this.haptic(15);
        return;
      }
    }
    // Last variant or no variants, go to next photo
    this.nextPhoto();
  }

  prevVariant(): void {
    const photo = this.store.selectedPhoto();
    if (!photo) return;
    if (photo.variants.length > 1) {
      const idx = this.currentVariantIndex();
      if (idx > 0) {
        this.selectVariant(photo.variants[idx - 1]);
        this.haptic(15);
        return;
      }
    }
    // First variant or no variants, go to prev photo
    this.prevPhoto();
  }


  // --- Undo ---

  private showUndoToast(photoId: string, prevStatus: string): void {
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.undoAction.set({ photoId, prevStatus });
    this.undoTimer = setTimeout(() => this.undoAction.set(null), 4000);
  }

  undoLastAction(): void {
    const action = this.undoAction();
    if (!action) return;
    this.store.photos.update(list => list.map(p =>
      p.id === action.photoId ? { ...p, status: action.prevStatus } : p
    ));
    const photo = this.store.photos().find(p => p.id === action.photoId);
    if (photo) this.selectPhoto(photo);
    this.undoAction.set(null);
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.haptic(15);
  }

  // --- NPS ---

  submitNps(rating: number): void {
    if (this.npsSubmitted()) return;
    this.npsRating.set(rating);
    this.haptic(15);

    if (rating <= 2) {
      this.showNpsComment.set(true);
    } else {
      this.npsSubmitted.set(true);
      this.http.post(`/api/photo-review/${this.token}/feedback`, { rating }).subscribe();
    }
  }

  submitNpsComment(): void {
    const rating = this.npsRating();
    if (!rating || this.npsCommentSubmitting()) return;
    this.npsCommentSubmitting.set(true);
    const comment = this.npsCommentText().trim() || undefined;
    this.http.post(`/api/photo-review/${this.token}/feedback`, { rating, comment }).subscribe({
      next: () => {
        this.npsSubmitted.set(true);
        this.npsCommentSubmitting.set(false);
      },
      error: () => this.npsCommentSubmitting.set(false),
    });
  }

  skipNpsComment(): void {
    const rating = this.npsRating();
    if (!rating) return;
    this.npsSubmitted.set(true);
    this.http.post(`/api/photo-review/${this.token}/feedback`, { rating }).subscribe();
  }

  // --- Celebration ---

  private triggerCelebration(): void {
    if (this.showCelebration()) return;
    this.showCelebration.set(true);
    this.haptic([50, 30, 50, 30, 100]);
    setTimeout(() => this.showCelebration.set(false), 3500);
  }

  private startImageNavigationLoading(): void {
    if (this.imageNavigationTimer) {
      clearTimeout(this.imageNavigationTimer);
    }
    this.imageNavigationLoading.set(true);
    this.imageNavigationTimer = setTimeout(() => {
      this.imageNavigationTimer = null;
      this.finishImageNavigationLoading();
    }, this.IMAGE_NAVIGATION_LOADING_MIN_MS);
  }

  private finishImageNavigationLoading(): void {
    if (this.imageNavigationTimer) return;
    this.imageNavigationLoading.set(false);
  }

  private markSwipeHintSeen(): void {
    if (this.hintsDismissed()) return;
    this.hintsDismissed.set(true);
  }

  private preloadNearbyImages(photos: ReviewPhoto[], currentIndex: number): void {
    if (!isPlatformBrowser(this.platformId) || currentIndex < 0 || photos.length === 0) return;

    const currentPhoto = photos[currentIndex];
    if (currentPhoto) {
      for (const variant of currentPhoto.variants) {
        this.preloadImage(variant.variant_url);
      }
    }

    const preloadIndexes = [currentIndex + 1, currentIndex - 1, currentIndex + 2];
    for (const index of preloadIndexes) {
      const photo = photos[index];
      if (!photo) continue;

      this.preloadImage(this.getDisplayUrlForPhoto(photo));
      if (photo.original_photo_url) {
        this.preloadImage(photo.original_photo_url);
      }
    }
  }

  private preloadImage(url: string): void {
    if (!url || this.loadedDisplayUrls().has(url) || this.preloadImages.has(url)) return;

    const img = new Image();
    this.preloadImages.set(url, img);
    img.decoding = 'async';
    img.onload = () => {
      this.rememberLoadedImage(url);
      this.preloadImages.delete(url);
    };
    img.onerror = () => {
      this.preloadImages.delete(url);
    };
    img.src = url;
  }

  private getDisplayUrlForPhoto(photo: ReviewPhoto): string {
    const selectedVariant = photo.variants.find(v => v.is_selected);
    return selectedVariant?.variant_url ?? photo.retouched_photo_url;
  }

  private rememberLoadedImage(url: string): void {
    this.loadedDisplayUrls.update((current) => {
      if (current.has(url)) return current;
      const next = new Set(current);
      next.add(url);
      return next;
    });
  }

  private isCurrentDisplayImage(image: HTMLImageElement): boolean {
    const expectedUrl = this.displayImageUrl();
    if (!expectedUrl) return false;
    const actualUrl = image.currentSrc || image.src;
    return this.normalizeImageUrl(actualUrl) === this.normalizeImageUrl(expectedUrl);
  }

  private normalizeImageUrl(url: string): string {
    if (!url) return url;

    if (!isPlatformBrowser(this.platformId)) {
      return url.split('#')[0];
    }

    try {
      const normalized = new URL(url, window.location.href);
      normalized.hash = '';
      return normalized.href;
    } catch {
      return url.split('#')[0];
    }
  }

  private withRetryFragment(url: string, nonce: number): string {
    return `${url.split('#')[0]}#svf-retry-${nonce}`;
  }
}
