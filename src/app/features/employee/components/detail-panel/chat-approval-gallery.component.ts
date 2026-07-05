import { Component, inject, input, output, signal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatMenuModule } from '@angular/material/menu';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { WebSocketService } from '../../../../core/services/websocket.service';
import { QuickPrintService } from '../../services/quick-print.service';
import { FaceValidationBadgeComponent, FaceValidationBadgeData } from '../../../../shared/components/face-validation-badge/face-validation-badge.component';
import { batchPrintDialogConfig, printDialogConfig } from '../../utils/print-dialog-config';

interface GallerySession {
  id: string;
  status: string;
  total_photos: number;
  approved_count: number;
  rejected_count: number;
  title: string;
}

interface GalleryVariant {
  id: string;
  variant_url: string;
  thumbnail_url: string | null;
  label: string | null;
  is_selected: boolean;
}

interface GalleryPhoto {
  id: string;
  retouched_photo_url: string;
  thumbnail_url: string | null;
  status: string;
  variants: GalleryVariant[] | null;
  face_validation?: {
    face_height_mm: number | null;
    is_valid_passport: boolean;
    face_detected: boolean;
  } | null;
}

@Component({
  selector: 'app-chat-approval-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule, MatMenuModule, MatDividerModule, FaceValidationBadgeComponent],
  template: `
    @if (session(); as s) {
      <div class="approval-gallery">
        <button class="gallery-header" (click)="collapsed.set(!collapsed())">
          <mat-icon>photo_camera</mat-icon>
          <span class="gallery-title">Ретушь ({{ photos().length }} фото)</span>
          <span class="gallery-status" [class]="'st-' + s.status">{{ statusLabel() }}</span>
          <mat-icon class="chevron">{{ collapsed() ? 'expand_more' : 'expand_less' }}</mat-icon>
        </button>

        @if (!collapsed()) {
          <div class="gallery-grid">
            @for (photo of photos(); track photo.id) {
              <div class="gallery-item" [class.item-selected]="photo.status === 'approved'">
                <a [href]="photo.retouched_photo_url" target="_blank" rel="noopener">
                  <img [src]="photo.thumbnail_url || photo.retouched_photo_url" alt="" loading="lazy">
                </a>
                <span class="status-dot" [class]="'dot-' + photo.status"></span>
                @if (photo.status === 'approved') {
                  <span class="selected-badge">
                    <mat-icon>check</mat-icon>
                  </span>
                }
                <button class="item-download" mat-icon-button
                        (click)="downloadPhoto(photo)" matTooltip="Скачать">
                  <mat-icon>download</mat-icon>
                </button>
                <button class="item-print" mat-icon-button
                        [matMenuTriggerFor]="printMenu" matTooltip="Быстрая печать">
                  <mat-icon>print</mat-icon>
                </button>
                <mat-menu #printMenu="matMenu" class="quick-print-menu">
                  <button mat-menu-item (click)="quickPrintPhoto(photo, 'passport_35x45')">
                    <mat-icon>badge</mat-icon>
                    <span>Паспорт РФ 3×4</span>
                  </button>
                  <button mat-menu-item (click)="quickPrintPhoto(photo, 'zagran_35x45')">
                    <mat-icon>flight</mat-icon>
                    <span>Загранпаспорт 3×4</span>
                  </button>
                  <button mat-menu-item (click)="quickPrintPhoto(photo, 'schengen_35x45')">
                    <mat-icon>public</mat-icon>
                    <span>Виза Шенген 3×4</span>
                  </button>
                  <button mat-menu-item (click)="quickPrintPhoto(photo, 'visa_us_50x50')">
                    <mat-icon>flag</mat-icon>
                    <span>Виза США 5×5</span>
                  </button>
                  <button mat-menu-item (click)="quickPrintPhoto(photo, 'driver_license_30x40')">
                    <mat-icon>directions_car</mat-icon>
                    <span>Водительское 3×4</span>
                  </button>
                  <mat-divider />
                  <button mat-menu-item (click)="cropForDocument(photo)">
                    <mat-icon>crop</mat-icon>
                    <span>Кадрировать под документ</span>
                  </button>
                  <button mat-menu-item (click)="printPhoto(photo)">
                    <mat-icon>tune</mat-icon>
                    <span>Настроить печать...</span>
                  </button>
                </mat-menu>
                @if (photo.face_validation?.face_detected) {
                  <div class="face-badge-overlay">
                    <app-face-validation-badge
                      [faceValidation]="toFaceValidationBadge(photo.face_validation)" />
                  </div>
                }
              </div>
            }
          </div>

          @if (isCompleted()) {
            <div class="gallery-selected-info">
              <mat-icon>check_circle</mat-icon>
              <span>Клиент выбрал финальный вариант</span>
            </div>
          }

          <div class="gallery-actions">
            @if (isCompleted()) {
              <button mat-stroked-button (click)="downloadAll()" matTooltip="Скачать финал">
                <mat-icon>download</mat-icon>
                Скачать финал
              </button>
            } @else {
              <button mat-stroked-button (click)="downloadAll()" matTooltip="Скачать архив">
                <mat-icon>archive</mat-icon>
                Скачать все (ZIP)
              </button>
            }
            @if (approvedPhotos().length) {
              <button mat-stroked-button (click)="printApproved()" matTooltip="Печать одобренных">
                <mat-icon>print</mat-icon>
                Печать ({{ approvedPhotos().length }})
              </button>
            }
            <button mat-stroked-button (click)="openApprovalPanel()">
              <mat-icon>open_in_new</mat-icon>
              ФотоПульт
            </button>
          </div>
        }
      </div>
    }

    @if (loading()) {
      <div class="gallery-loading">
        <mat-spinner diameter="20" />
      </div>
    }
  `,
  styles: [`
    .approval-gallery {
      margin: 8px 0;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-lg);
      overflow: hidden;
    }

    .gallery-header {
      display: flex; align-items: center; gap: 6px;
      width: 100%; padding: 8px 10px;
      background: var(--crm-surface-raised);
      border: none; cursor: pointer;
      color: var(--crm-text-primary);
      font-size: 13px; font-weight: 500;

      mat-icon:first-child { font-size: 18px; width: 18px; height: 18px; color: var(--crm-accent); }
      .chevron { margin-left: auto; font-size: 18px; width: 18px; height: 18px; color: var(--crm-text-muted); }
    }

    .gallery-title { flex: 1; text-align: left; }

    .gallery-status {
      font-size: 10px; font-weight: 600; padding: 2px 6px;
      border-radius: 8px; text-transform: uppercase; letter-spacing: 0.03em;

      &.st-approved, &.st-completed { background: rgba(34,197,94,0.15); color: var(--crm-status-success); }
      &.st-in_review, &.st-pending { background: rgba(255,255,255,0.1); color: var(--crm-text-muted); }
      &.st-changes_requested, &.st-partially_approved { background: rgba(239,68,68,0.15); color: var(--crm-status-error); }
    }

    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
      gap: 4px; padding: 8px;
    }

    .gallery-item {
      position: relative; aspect-ratio: 1;
      border-radius: var(--crm-radius-sm);
      overflow: hidden;
      border: 2px solid transparent;
      transition: border-color 0.2s;

      a { display: block; width: 100%; height: 100%; }
      img { width: 100%; height: 100%; object-fit: cover; display: block; }

      &:hover .item-download, &:hover .item-print { opacity: 1; }

      &.item-selected {
        border-color: var(--crm-status-success);
        box-shadow: 0 0 8px rgba(34,197,94,0.3);
      }
    }

    .status-dot {
      position: absolute; top: 3px; left: 3px;
      width: 8px; height: 8px; border-radius: 50%;
      border: 1.5px solid rgba(0,0,0,0.4);

      &.dot-approved { background: var(--crm-status-success); }
      &.dot-rejected, &.dot-changes_requested { background: var(--crm-status-error); }
      &.dot-pending { background: var(--crm-text-muted); }
    }

    .selected-badge {
      position: absolute; top: 2px; right: 2px;
      width: 20px; height: 20px; border-radius: 50%;
      background: var(--crm-status-success);
      display: flex; align-items: center; justify-content: center;
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: #fff; }
    }

    .item-download, .item-print {
      position: absolute;
      width: 22px !important; height: 22px !important;
      line-height: 22px;
      opacity: 0; transition: opacity 0.15s;
      background: rgba(0,0,0,0.6);
      mat-icon { font-size: 14px; width: 14px; height: 14px; color: #fff; }
    }

    .item-download { bottom: 2px; right: 2px; }
    .item-print { bottom: 2px; right: 26px; }

    .gallery-selected-info {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 10px;
      background: rgba(34,197,94,0.08);
      color: var(--crm-status-success);
      font-size: 12px; font-weight: 500;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .gallery-actions {
      display: flex; gap: 6px; padding: 6px 8px;
      border-top: 1px solid var(--crm-border);

      button {
        flex: 1; font-size: 11px; height: 30px;
        mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
      }
    }

    .face-badge-overlay {
      position: absolute; bottom: 0; left: 0; right: 0;
      display: flex; justify-content: center;
      padding: 2px;
      background: rgba(0, 0, 0, 0.5);
      app-face-validation-badge { transform: scale(0.85); }
    }

    .gallery-loading {
      display: flex; justify-content: center; padding: 12px;
    }
  `],
})
export class ChatApprovalGalleryComponent {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly wsService = inject(WebSocketService);
  private readonly dialog = inject(MatDialog);
  private readonly quickPrintService = inject(QuickPrintService);

  readonly chatSessionId = input.required<string>();
  readonly workspaceRequested = output<{ sourceUrl: string; sourceName: string; approvalSessionId: string | null }>();

  readonly loading = signal(false);
  readonly session = signal<GallerySession | null>(null);
  readonly photos = signal<GalleryPhoto[]>([]);
  readonly collapsed = signal(false);

  readonly statusLabel = computed(() => {
    const labels: Record<string, string> = {
      pending: 'Ожидает',
      in_review: 'На проверке',
      approved: 'Выбран',
      partially_approved: 'Частично',
      changes_requested: 'Правки',
      completed: 'Завершено',
    };
    return labels[this.session()?.status || ''] || '';
  });

  readonly isCompleted = computed(() => {
    const status = this.session()?.status;
    return status === 'approved' || status === 'completed';
  });

  readonly approvedPhotos = computed(() =>
    this.photos().filter(p => p.status === 'approved')
  );

  private readonly loadEffect = effect(() => {
    const csid = this.chatSessionId();
    if (csid) {
      this.loadSession(csid);
    }
  });

  private readonly wsEffect = effect(() => {
    const evt = this.wsService.approvalEvent();
    if (!evt) return;
    const sid = this.session()?.id;
    if (sid && (evt.data as Record<string, string>)['sessionId'] === sid) {
      this.loadSession(this.chatSessionId());
    }
  });

  downloadPhoto(photo: GalleryPhoto): void {
    const link = document.createElement('a');
    link.href = photo.retouched_photo_url;
    link.download = photo.retouched_photo_url.split('/').pop() || 'photo.jpg';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  downloadAll(): void {
    const s = this.session();
    if (!s) return;
    window.open(`/api/photo-approvals/sessions/${s.id}/download`, '_blank');
  }

  quickPrintPhoto(photo: GalleryPhoto, presetSlug: string): void {
    this.quickPrintService.quickPrint(photo.retouched_photo_url, presetSlug);
  }

  printPhoto(photo: GalleryPhoto): void {
    const s = this.session();
    import('../print-dialog/print-dialog.component').then(m => {
      this.dialog.open(
        m.PrintDialogComponent,
        printDialogConfig({
          file_url: photo.retouched_photo_url,
          file_name: photo.retouched_photo_url.split('/').pop() || 'photo.jpg',
          order_id: s?.id,
          preferred_printer_type: 'photo',
        } satisfies import('../print-dialog/print-dialog.component').PrintDialogData),
      );
    });
  }

  cropForDocument(photo: GalleryPhoto): void {
    const s = this.session();
    if (!s) return;
    this.workspaceRequested.emit({
      sourceUrl: photo.retouched_photo_url,
      sourceName: photo.retouched_photo_url.split('/').pop() || 'Фото согласования',
      approvalSessionId: s.id,
    });
  }

  printApproved(): void {
    const approved = this.approvedPhotos();
    if (!approved.length) return;

    if (approved.length === 1) {
      this.printPhoto(approved[0]);
      return;
    }

    const s = this.session();
    const files = approved.map((photo, i) => ({
      msgId: `approval-${i}`,
      url: photo.retouched_photo_url,
      name: photo.retouched_photo_url.split('/').pop() || `photo-${i + 1}.jpg`,
      type: 'image' as const,
    }));

    import('../batch-print-dialog/batch-print-dialog.component').then(m => {
      this.dialog.open(
        m.BatchPrintDialogComponent,
        batchPrintDialogConfig({
          files,
          sessionId: s?.id ?? '',
        } satisfies import('../batch-print-dialog/batch-print-dialog.component').BatchPrintDialogData),
      );
    });
  }

  // Note: approve/unapprove removed — client selects the final variant via /photo-review/:token

  openApprovalPanel(): void {
    const s = this.session();
    if (!s) return;
    void this.router.navigate(['/employee'], { queryParams: { approvalId: s.id } });
  }

  private loadSession(chatSessionId: string): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: GallerySession[] }>(
      `/api/photo-approvals/sessions?chat_session_id=${chatSessionId}&limit=1`
    ).subscribe({
      next: (res) => {
        if (res.success && res.data?.length) {
          const sess = res.data[0];
          this.session.set(sess);
          this.loadPhotos(sess.id);
        } else {
          this.session.set(null);
          this.loading.set(false);
        }
      },
      error: () => this.loading.set(false),
    });
  }

  toFaceValidationBadge(fv: GalleryPhoto['face_validation']): FaceValidationBadgeData | null {
    if (!fv?.face_detected) return null;
    // Use gost fields from face_validation if available, fallback to passport defaults
    const gostMin = (fv as Record<string, unknown>)['gost_height_min_mm'] as number | undefined;
    const gostMax = (fv as Record<string, unknown>)['gost_height_max_mm'] as number | undefined;
    const docType = (fv as Record<string, unknown>)['document_type'] as string | undefined;
    return {
      face_height_mm: fv.face_height_mm,
      gost_pass: fv.is_valid_passport,
      gost_height_min_mm: gostMin ?? 30,
      gost_height_max_mm: gostMax ?? 34,
      document_type: docType,
    };
  }

  private loadPhotos(sessionId: string): void {
    this.http.get<{ success: boolean; session: GallerySession; photos: GalleryPhoto[] }>(
      `/api/photo-approvals/sessions/${sessionId}`
    ).subscribe({
      next: (res) => {
        if (res.success) {
          this.session.set(res.session);
          this.photos.set(res.photos || []);
        }
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }
}
