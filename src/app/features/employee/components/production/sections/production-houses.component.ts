import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DecimalPipe } from '@angular/common';
import { ProductionApiService, PrintingHouse } from '../../../services/production-api.service';
import { ProductionHouseFormComponent } from './production-house-form.component';
import { CAPABILITY_LABELS, HOUSE_STATUS_CONFIG, formatProductionCost } from '../production.constants';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

const STATUS_CONFIG = HOUSE_STATUS_CONFIG;

@Component({
  selector: 'app-production-houses',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatChipsModule,
    MatProgressSpinnerModule, MatTooltipModule, MatSnackBarModule, DecimalPipe,
  ],
  template: `
    <div class="houses-page">
      <div class="page-toolbar">
        <h2>Справочник типографий</h2>
        <button mat-flat-button color="primary" (click)="openForm()">
          <mat-icon>add</mat-icon>
          Добавить типографию
        </button>
      </div>

      @if (loading()) {
        <div class="loading-state"><mat-spinner diameter="40" /></div>
      } @else if (error()) {
        <div class="error-state">
          <mat-icon>error_outline</mat-icon>
          <p>{{ error() }}</p>
          <button mat-flat-button (click)="load()">Повторить</button>
        </div>
      } @else if (houses().length === 0) {
        <div class="empty-state">
          <mat-icon>business</mat-icon>
          <p>Нет типографий</p>
          <button mat-flat-button color="primary" (click)="openForm()">Добавить первую</button>
        </div>
      } @else {
        <div class="houses-grid">
          @for (house of houses(); track house.id) {
            <mat-card class="house-card" appearance="outlined">
              <div class="house-header">
                <div class="house-title">
                  <span class="house-name">{{ house.name }}</span>
                  <span class="house-status"
                        [style.background]="STATUS[house.status].color + '22'"
                        [style.color]="STATUS[house.status].color">
                    {{ STATUS[house.status].label }}
                  </span>
                </div>
                <div class="house-actions">
                  <button mat-icon-button (click)="openForm(house)" matTooltip="Редактировать"
                        aria-label="Редактировать типографию">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button color="warn" (click)="deleteHouse(house)" matTooltip="Удалить"
                          aria-label="Удалить типографию">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>

              <!-- Capabilities -->
              <div class="capabilities">
                @for (cap of house.capabilities; track cap) {
                  <span class="cap-chip">{{ capLabel(cap) }}</span>
                }
              </div>

              <!-- Metrics -->
              <div class="metrics-row">
                <div class="metric">
                  <span class="metric-value">{{ house.quality_score | number:'1.1-1' }}</span>
                  <span class="metric-label">Рейтинг</span>
                  <div class="stars-mini">
                    @for (s of [1,2,3,4,5]; track s) {
                      <mat-icon class="star-mini" [class.filled]="s <= house.quality_score">
                        {{ s <= house.quality_score ? 'star' : 'star_border' }}
                      </mat-icon>
                    }
                  </div>
                </div>
                <div class="metric">
                  <span class="metric-value">{{ house.on_time_rate | number:'1.0-0' }}%</span>
                  <span class="metric-label">В срок</span>
                </div>
                <div class="metric">
                  <span class="metric-value">{{ house.total_orders }}</span>
                  <span class="metric-label">Заказов</span>
                </div>
                <div class="metric">
                  <span class="metric-value">{{ formatCost(house.total_spent) }}</span>
                  <span class="metric-label">Потрачено</span>
                </div>
              </div>

              <!-- Contacts -->
              <div class="contacts">
                @if (house.contact_phone) {
                  <a [href]="'tel:' + house.contact_phone" class="contact-link">
                    <mat-icon>phone</mat-icon>
                    {{ house.contact_phone }}
                  </a>
                }
                @if (house.website) {
                  <a [href]="house.website" target="_blank" class="contact-link">
                    <mat-icon>language</mat-icon>
                    Сайт
                  </a>
                }
                @if (house.address) {
                  <span class="contact-link">
                    <mat-icon>location_on</mat-icon>
                    {{ house.address }}
                  </span>
                }
              </div>

              <!-- API type badge -->
              <div class="api-badge" [class]="'api-' + house.api_type">
                <mat-icon>{{ apiIcon(house.api_type) }}</mat-icon>
                {{ apiLabel(house.api_type) }}
              </div>
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .houses-page { padding: 16px; max-width: 1000px; margin: 0 auto; }

    .page-toolbar {
      display: flex; align-items: center; margin-bottom: 16px;
      h2 { margin: 0; flex: 1; font-size: 18px; font-weight: 600; color: var(--crm-text-primary); }
    }

    .houses-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 16px;
    }

    .house-card { padding: 0; overflow: hidden; }

    .house-header {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding: 16px 16px 8px;
    }
    .house-actions { display: flex; gap: 0; }
    .house-title { display: flex; flex-direction: column; gap: 4px; }
    .house-name { font-size: 16px; font-weight: 600; color: var(--crm-text-primary); }
    .house-status {
      font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 10px; width: fit-content;
    }

    .capabilities {
      display: flex; flex-wrap: wrap; gap: 4px; padding: 0 16px 12px;
    }
    .cap-chip {
      font-size: 11px; padding: 2px 8px; border-radius: 10px;
      background: var(--crm-surface-hover); color: var(--crm-text-secondary);
    }

    .metrics-row {
      display: grid; grid-template-columns: repeat(4, 1fr);
      border-top: 1px solid var(--crm-border); border-bottom: 1px solid var(--crm-border);
      padding: 12px 16px; gap: 8px;
    }
    .metric { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .metric-value { font-size: 16px; font-weight: 700; color: var(--crm-text-primary); }
    .metric-label { font-size: 10px; color: var(--crm-text-secondary); text-transform: uppercase; }
    .stars-mini { display: flex; gap: 0; }
    .star-mini { font-size: 12px; width: 12px; height: 12px; color: #d1d5db; }
    .star-mini.filled { color: #fbbf24; }

    .contacts {
      display: flex; flex-direction: column; gap: 4px; padding: 12px 16px;
    }
    .contact-link {
      display: flex; align-items: center; gap: 6px; font-size: 12px;
      color: var(--crm-text-secondary); text-decoration: none;
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
      &[href] { color: var(--crm-accent); }
    }

    .api-badge {
      display: flex; align-items: center; gap: 4px;
      padding: 6px 16px; font-size: 11px; font-weight: 500;
      border-top: 1px solid var(--crm-border);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &.api-manual { color: #9ca3af; }
      &.api-api { color: #34d399; }
      &.api-email { color: #60a5fa; }
    }

    .loading-state, .empty-state, .error-state {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; }
      p { margin: 12px 0 16px; font-size: 16px; }
    }
    .error-state mat-icon { color: var(--crm-danger, #f87171); }
  `,
})
export class ProductionHousesComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  readonly STATUS = STATUS_CONFIG;
  readonly houses = signal<PrintingHouse[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  ngOnInit() { this.load(); }

  load() {
    this.loading.set(true);
    this.error.set(null);
    this.api.getHouses().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: h => { this.houses.set(h); this.loading.set(false); },
      error: () => {
        this.error.set('Не удалось загрузить типографии');
        this.loading.set(false);
      },
    });
  }

  deleteHouse(house: PrintingHouse) {
    const message = house.total_orders > 0
      ? `Удалить "${house.name}"? (${house.total_orders} заказов) — типография будет деактивирована.`
      : `Удалить "${house.name}"? Это действие необратимо.`;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Удалить типографию',
        message,
        icon: 'delete',
        warn: true,
        confirmLabel: 'Удалить',
      } as ConfirmDialogData,
    });
    ref.afterClosed().subscribe(ok => {
      if (!ok) return;
      this.api.deleteHouse(house.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.snackBar.open('Типография удалена', 'OK', { duration: 3000 }); this.load(); },
        error: err => this.snackBar.open(err?.error?.message ?? 'Не удалось удалить типографию', 'OK', { duration: 4000 }),
      });
    });
  }

  openForm(house?: PrintingHouse) {
    this.dialog.open(ProductionHouseFormComponent, {
      width: '560px',
      maxWidth: '98vw',
      data: { house },
    }).afterClosed().subscribe(saved => { if (saved) this.load(); });
  }

  capLabel(cap: string): string { return CAPABILITY_LABELS[cap] ?? cap; }
  formatCost = formatProductionCost;

  apiIcon(type: string): string {
    return { manual: 'mouse', api: 'api', email: 'email' }[type] ?? 'help';
  }

  apiLabel(type: string): string {
    return { manual: 'Ручной режим', api: 'API-интеграция', email: 'По email' }[type] ?? type;
  }
}
