import { Component, inject, signal, ChangeDetectionStrategy, OnInit, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';

interface SavedCard {
  id: string;
  card_first_six: string;
  card_last_four: string;
  card_type: string;
  card_exp_date: string;
  is_default: boolean;
  created_at: string;
  last_used_at: string;
}

@Component({
  selector: 'app-payment-methods',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule,
    MatProgressSpinnerModule, MatSnackBarModule,
  ],
  template: `
    <div class="pm-container">
      <div class="page-header">
        <h2 class="page-title">
          <mat-icon>credit_card</mat-icon>
          Способы оплаты
        </h2>
      </div>

      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="36" />
          <p>Загружаем карты...</p>
        </div>
      }

      @if (!loading()) {
        @if (cards().length > 0) {
          <div class="cards-list">
            @for (card of cards(); track card.id) {
              <mat-card appearance="outlined" class="card-item" [class.default-card]="card.is_default">
                <div class="card-content">
                  <div class="card-icon">
                    <mat-icon>{{ getCardIcon(card.card_type) }}</mat-icon>
                  </div>
                  <div class="card-info">
                    <span class="card-number">•••• {{ card.card_last_four }}</span>
                    <span class="card-meta">
                      {{ card.card_type || 'Карта' }}
                      @if (card.card_exp_date) { · до {{ card.card_exp_date }} }
                    </span>
                    @if (card.is_default) {
                      <span class="default-badge">Основная</span>
                    }
                  </div>
                  <div class="card-actions">
                    @if (!card.is_default) {
                      <button mat-button (click)="setDefault(card)" class="default-btn">
                        Сделать основной
                      </button>
                    }
                    <button mat-icon-button (click)="deleteCard(card)" class="delete-btn">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                </div>
              </mat-card>
            }
          </div>
        } @else {
          <div class="empty-state">
            <div class="empty-icon-wrap">
              <mat-icon>credit_card_off</mat-icon>
            </div>
            <h3>Нет сохранённых карт</h3>
            <p>Карты сохраняются автоматически при оплате заказов</p>
          </div>
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      --amber: #f59e0b;
      --surface-variant: var(--ed-surface-variant, #1e1e1e);
      --on-surface: var(--ed-on-surface, #f5f5f5);
      --on-surface-variant: var(--ed-on-surface-variant, #999);
      --border: var(--ed-outline, #333);
    }

    .pm-container { padding: 0 0 32px; max-width: 600px; margin: 0 auto; }

    .page-header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
    .page-title {
      font-size: 1.5rem; font-weight: 700; color: var(--on-surface); margin: 0;
      display: flex; align-items: center; gap: 10px;
    }
    .page-title mat-icon { color: var(--amber); font-size: 28px; width: 28px; height: 28px; }

    .loading { display: flex; flex-direction: column; align-items: center; padding: 60px 16px; gap: 16px; color: var(--on-surface-variant); }

    .cards-list { display: flex; flex-direction: column; gap: 10px; }

    .card-item {
      background: var(--surface-variant) !important;
      border-color: var(--border) !important;
    }
    .card-item.default-card { border-color: var(--amber) !important; }

    .card-content { display: flex; align-items: center; gap: 14px; padding: 14px 16px; }

    .card-icon {
      width: 44px; height: 44px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      background: rgba(245, 158, 11, 0.15);
    }
    .card-icon mat-icon { color: var(--amber); font-size: 22px; width: 22px; height: 22px; }

    .card-info { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .card-number { font-size: 1rem; font-weight: 600; color: var(--on-surface); letter-spacing: 1px; }
    .card-meta { font-size: 0.78rem; color: var(--on-surface-variant); }

    .default-badge {
      display: inline-block; width: fit-content;
      background: rgba(245, 158, 11, 0.15); color: var(--amber);
      font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 6px;
      margin-top: 2px;
    }

    .card-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
    .default-btn { color: var(--amber) !important; font-size: 0.8rem; }
    .delete-btn { color: var(--on-surface-variant) !important; }
    .delete-btn:hover { color: #ef4444 !important; }

    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      padding: 60px 16px; gap: 12px; text-align: center;
    }
    .empty-icon-wrap {
      width: 80px; height: 80px; border-radius: 50%;
      background: rgba(245, 158, 11, 0.12);
      display: flex; align-items: center; justify-content: center; margin-bottom: 8px;
    }
    .empty-icon-wrap mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--amber); opacity: 0.6; }
    .empty-state h3 { font-size: 1.1rem; font-weight: 600; color: var(--on-surface); margin: 0; }
    .empty-state p { font-size: 0.9rem; color: var(--on-surface-variant); margin: 0; }
  `,
})
export class PaymentMethodsComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);

  readonly loading = signal(false);
  readonly cards = signal<SavedCard[]>([]);

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadCards();
    }
  }

  private loadCards(): void {
    this.loading.set(true);
    this.http.get<{ data: SavedCard[] }>('/api/orders/saved-cards').subscribe({
      next: (res) => { this.cards.set(res.data || []); this.loading.set(false); },
      error: () => { this.loading.set(false); },
    });
  }

  getCardIcon(type: string): string {
    const t = (type || '').toLowerCase();
    if (t.includes('visa')) return 'credit_card';
    if (t.includes('master')) return 'credit_card';
    if (t.includes('mir') || t.includes('мир')) return 'account_balance';
    return 'credit_card';
  }

  setDefault(card: SavedCard): void {
    this.http.patch(`/api/orders/saved-cards/${card.id}/default`, {}).subscribe({
      next: () => {
        this.snackBar.open('Карта установлена как основная', 'OK', { duration: 3000 });
        this.loadCards();
      },
      error: () => {
        this.snackBar.open('Ошибка', 'Закрыть', { duration: 3000 });
      },
    });
  }

  deleteCard(card: SavedCard): void {
    if (!confirm(`Удалить карту •••• ${card.card_last_four}?`)) return;

    this.http.delete(`/api/orders/saved-cards/${card.id}`).subscribe({
      next: () => {
        this.snackBar.open('Карта удалена', 'OK', { duration: 3000 });
        this.loadCards();
      },
      error: () => {
        this.snackBar.open('Ошибка удаления', 'Закрыть', { duration: 3000 });
      },
    });
  }
}
