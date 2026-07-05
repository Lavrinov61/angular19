import {
  Component, inject, signal, computed,
  ChangeDetectionStrategy, ElementRef, ViewChild, AfterViewInit, OnDestroy,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ReplayApiService, HeatmapClick, HeatmapPage } from '../../services/replay-api.service';

export interface HeatmapDialogData {
  /** If provided — filter by specific visitor_id */
  visitor_id?: string;
  /** Starting page_path */
  page_path?: string;
  title?: string;
}

@Component({
  selector: 'app-heatmap-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogModule, FormsModule,
    MatButtonModule, MatIconModule,
    MatSelectModule, MatFormFieldModule,
    MatProgressSpinnerModule, MatTooltipModule,
  ],
  template: `
    <div class="hm-dialog">
      <!-- ─── Header ─── -->
      <div class="hm-header">
        <div class="hm-title">
          <mat-icon>local_fire_department</mat-icon>
          <span>{{ data.title || 'Тепловая карта кликов' }}</span>
        </div>

        <!-- Filters -->
        <div class="hm-filters">
          <mat-form-field appearance="outline" class="filter-field">
            <mat-label>Страница</mat-label>
            <mat-select [(ngModel)]="selectedPage" (ngModelChange)="reload()">
              <mat-option value="">Все страницы</mat-option>
              @for (p of pages(); track p.page_path) {
                <mat-option [value]="p.page_path">{{ p.page_path }} ({{ p.total_clicks }})</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field filter-field-sm">
            <mat-label>Период</mat-label>
            <mat-select [(ngModel)]="selectedDays" (ngModelChange)="reload()">
              <mat-option [value]="7">7 дней</mat-option>
              <mat-option [value]="30">30 дней</mat-option>
              <mat-option [value]="90">90 дней</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="filter-field filter-field-sm">
            <mat-label>Устройство</mat-label>
            <mat-select [(ngModel)]="selectedDevice" (ngModelChange)="reload()">
              <mat-option value="">Все</mat-option>
              <mat-option value="desktop">Desktop</mat-option>
              <mat-option value="mobile">Mobile</mat-option>
              <mat-option value="tablet">Tablet</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <button mat-icon-button matTooltip="Обновить" (click)="reload()">
          <mat-icon>refresh</mat-icon>
        </button>
        <button mat-icon-button matTooltip="Экспорт PNG" (click)="exportPng()"
                [disabled]="totalClicks() === 0">
          <mat-icon>image</mat-icon>
        </button>
        @if (dialogRef) {
          <button mat-icon-button (click)="dialogRef.close()" class="hm-close">
            <mat-icon>close</mat-icon>
          </button>
        } @else {
          <button mat-icon-button (click)="goBack()" class="hm-close" matTooltip="Назад">
            <mat-icon>arrow_back</mat-icon>
          </button>
        }
      </div>

      <!-- ─── Stats bar ─── -->
      <div class="hm-stats">
        <span><mat-icon>touch_app</mat-icon> {{ totalClicks() }} кликов</span>
        <span><mat-icon>location_on</mat-icon> {{ uniquePoints() }} точек</span>
        @if (data.visitor_id) {
          <span class="filter-badge">
            <mat-icon>person</mat-icon> Клиент
          </span>
        }
      </div>

      <!-- ─── Canvas area ─── -->
      <div class="hm-canvas-wrap">
        @if (loading()) {
          <div class="hm-loading">
            <mat-spinner diameter="36" />
            <span>Загрузка данных…</span>
          </div>
        } @else if (heatmapError()) {
          <div class="hm-error">
            <mat-icon>cloud_off</mat-icon>
            <p>{{ heatmapError() }}</p>
            <button mat-stroked-button (click)="reload()">
              <mat-icon>refresh</mat-icon> Повторить
            </button>
          </div>
        } @else if (totalClicks() === 0) {
          <div class="hm-empty">
            <mat-icon>touch_app</mat-icon>
            <p>Нет данных о кликах для выбранных фильтров</p>
          </div>
        } @else {
          <canvas #heatmapCanvas class="heatmap-canvas"
                  (mousemove)="onCanvasMouseMove($event)"
                  (mouseleave)="onCanvasMouseLeave()"></canvas>
          @if (tooltipVisible()) {
            <div class="hm-tooltip"
                 [style.left.px]="tooltipX()"
                 [style.top.px]="tooltipY()">
              <strong>{{ tooltipPath() }}</strong>
              <span>{{ tooltipCount() }} кликов</span>
            </div>
          }
        }
      </div>
    </div>
  `,
  styles: [`
    .hm-dialog {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--crm-surface);
      color: var(--crm-text-primary);
      overflow: hidden;
    }

    /* ─── Header ─── */
    .hm-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .hm-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 15px;
      font-weight: 600;
      flex-shrink: 0;

      mat-icon { color: #ff6b35; font-size: 18px; width: 18px; height: 18px; }
    }

    .hm-filters {
      display: flex;
      gap: 8px;
      flex: 1;
      flex-wrap: wrap;
    }

    .filter-field {
      min-width: 200px;

      ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
      ::ng-deep .mat-mdc-text-field-wrapper { padding-bottom: 0; }
    }

    .filter-field-sm { min-width: 110px; }

    .hm-close { flex-shrink: 0; }

    /* ─── Stats ─── */
    .hm-stats {
      display: flex;
      gap: 16px;
      padding: 6px 16px;
      font-size: 12px;
      color: var(--crm-text-muted);
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;

      span {
        display: flex;
        align-items: center;
        gap: 4px;
        mat-icon { font-size: 14px; width: 14px; height: 14px; }
      }
    }

    .filter-badge {
      color: var(--crm-accent) !important;
      mat-icon { color: var(--crm-accent) !important; }
    }

    /* ─── Canvas ─── */
    .hm-canvas-wrap {
      flex: 1;
      min-height: 0;
      position: relative;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .heatmap-canvas {
      width: 100%;
      height: 100%;
      display: block;
    }

    .hm-loading, .hm-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: rgba(255,255,255,0.5);
      font-size: 13px;

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.3; }
    }

    .hm-error {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: rgba(255,255,255,0.6);
      font-size: 13px;

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.5; }
      p { margin: 0; }

      button {
        color: rgba(255,255,255,0.7);
        border-color: rgba(255,255,255,0.3);
        mat-icon { font-size: 18px; width: 18px; height: 18px; margin-right: 4px; }
      }
    }

    /* ─── Tooltip ─── */
    .hm-tooltip {
      position: absolute;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11px;
      pointer-events: none;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 2px;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);

      strong { font-size: 12px; }
    }
  `],
})
export class HeatmapViewerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('heatmapCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  protected readonly data: HeatmapDialogData = inject(MAT_DIALOG_DATA, { optional: true }) ?? {};
  private readonly replayApi = inject(ReplayApiService);
  private readonly router = inject(Router);
  protected readonly dialogRef = inject(MatDialogRef<HeatmapViewerComponent>, { optional: true });

  private resizeObserver: ResizeObserver | null = null;

  loading = signal(false);
  heatmapError = signal<string | null>(null);
  clicks  = signal<HeatmapClick[]>([]);
  pages   = signal<HeatmapPage[]>([]);

  // Tooltip state
  tooltipVisible = signal(false);
  tooltipX = signal(0);
  tooltipY = signal(0);
  tooltipPath = signal('');
  tooltipCount = signal(0);

  selectedPage   = this.data.page_path || '';
  selectedDays   = 30;
  selectedDevice = '';

  totalClicks  = computed(() => this.clicks().reduce((s, c) => s + c.count, 0));
  uniquePoints = computed(() => this.clicks().length);

  private viewInitialized = false;

  ngAfterViewInit(): void {
    this.viewInitialized = true;
    this.reload();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  goBack(): void {
    this.router.navigate(['/employee']);
  }

  // ─── PNG Export ──────────────────────────────────────────────────────────────

  exportPng(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `heatmap_${this.selectedPage || 'all'}_${this.selectedDays}d.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }

  // ─── Hover tooltip ──────────────────────────────────────────────────────────

  onCanvasMouseMove(event: MouseEvent): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;

    // Convert mouse position to normalized coords (0-1000)
    const normX = (mouseX / w) * 1000;
    const normY = (mouseY / h) * 1000;

    const radius = Math.max(20, Math.min(60, w / 15));
    const normRadius = (radius / w) * 1000;

    // Find closest click point within radius
    let closest: HeatmapClick | null = null;
    let closestDist = Infinity;

    for (const pt of this.clicks()) {
      const dx = pt.nx - normX;
      const dy = pt.ny - normY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < normRadius && dist < closestDist) {
        closest = pt;
        closestDist = dist;
      }
    }

    if (closest) {
      this.tooltipVisible.set(true);
      this.tooltipX.set(mouseX + 14);
      this.tooltipY.set(mouseY - 8);
      this.tooltipPath.set(closest.page_path || '—');
      this.tooltipCount.set(closest.count);
    } else {
      this.tooltipVisible.set(false);
    }
  }

  onCanvasMouseLeave(): void {
    this.tooltipVisible.set(false);
  }

  // ─── Data loading ───────────────────────────────────────────────────────────

  reload(): void {
    this.loading.set(true);
    this.heatmapError.set(null);
    this.clicks.set([]);

    this.replayApi.getHeatmapData({
      page_path: this.selectedPage || undefined,
      days: this.selectedDays,
      device_type: this.selectedDevice || undefined,
      visitor_id: this.data.visitor_id,
    }).subscribe({
      next: (result) => {
        this.pages.set(result.pages);
        this.clicks.set(result.clicks);
        this.loading.set(false);
        // Draw after Angular updates DOM
        setTimeout(() => {
          this.drawHeatmap();
          this.attachResizeObserver();
        }, 50);
      },
      error: () => {
        this.heatmapError.set('Не удалось загрузить данные тепловой карты');
        this.loading.set(false);
      },
    });
  }

  private attachResizeObserver(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas || this.resizeObserver) return;
    this.resizeObserver = new ResizeObserver(() => this.drawHeatmap());
    this.resizeObserver.observe(canvas.parentElement!);
  }

  private drawHeatmap(): void {
    const canvas = this.canvasRef?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.clientWidth  || 800;
    const h = canvas.clientHeight || 500;
    canvas.width  = w;
    canvas.height = h;

    ctx.clearRect(0, 0, w, h);

    // Dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    const clicks = this.clicks();
    if (clicks.length === 0) return;

    const maxCount = Math.max(...clicks.map(c => c.count));

    // Dot radius — depends on data density
    const radius = Math.max(20, Math.min(60, w / 15));

    for (const pt of clicks) {
      // Normalized coordinates (nx/ny in range 0-1000)
      const x = (pt.nx / 1000) * w;
      const y = (pt.ny / 1000) * h;
      const intensity = Math.pow(pt.count / maxCount, 0.4); // power normalization

      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(255, 50, 0, ${intensity * 0.85})`);
      gradient.addColorStop(0.4, `rgba(255, 160, 0, ${intensity * 0.5})`);
      gradient.addColorStop(0.8, `rgba(0, 80, 200, ${intensity * 0.2})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    }

    // Legend
    this.drawLegend(ctx, w, h);
  }

  private drawLegend(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const legW = 120;
    const legH = 16;
    const legX = w - legW - 12;
    const legY = h - 30;

    const grad = ctx.createLinearGradient(legX, 0, legX + legW, 0);
    grad.addColorStop(0, 'rgba(0, 80, 200, 0.6)');
    grad.addColorStop(0.5, 'rgba(255, 160, 0, 0.7)');
    grad.addColorStop(1, 'rgba(255, 50, 0, 0.85)');

    ctx.fillStyle = grad;
    ctx.fillRect(legX, legY, legW, legH);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '10px sans-serif';
    ctx.fillText('Мало', legX, legY - 3);
    ctx.fillText('Много', legX + legW - 36, legY - 3);
  }
}
