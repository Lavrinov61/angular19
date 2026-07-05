import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

interface FineEntry {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly amount: number;
  readonly status: 'pending' | 'applied' | 'cancelled';
}

interface FinePolicy {
  readonly key: string;
  readonly icon: string;
  readonly title: string;
  readonly amount: number;
}

const FINE_POLICIES: readonly FinePolicy[] = [
  {
    key: 'wrong-address',
    icon: 'wrong_location',
    title: 'Неверный адрес при старте рабочего дня',
    amount: 500,
  },
  {
    key: 'no-scheduled-shift',
    icon: 'event_busy',
    title: 'Рабочий день открыт без согласованной смены',
    amount: 500,
  },
  {
    key: 'studio-occupied',
    icon: 'storefront',
    title: 'На адресе уже открыт рабочий день другим сотрудником',
    amount: 500,
  },
] as const;

@Component({
  selector: 'app-my-fines',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, MatIconModule],
  template: `
    <div class="fines-page">
      <section class="fines-header glass-card">
        <div class="fines-title-block">
          <span class="fines-eyebrow">Мой профиль</span>
          <h1>Штрафы</h1>
          <p>{{ monthLabel() }}</p>
        </div>
        <div class="fines-total">
          <span>{{ totalAmount() | number:'1.0-0' }} ₽</span>
          <small>за месяц</small>
        </div>
      </section>

      <section class="fines-section glass-card">
        <div class="section-title">
          <mat-icon>receipt_long</mat-icon>
          <h2>Начисления</h2>
        </div>

        @if (fines().length === 0) {
          <div class="empty-state">
            <mat-icon>verified</mat-icon>
            <span>Штрафов за месяц нет</span>
          </div>
        } @else {
          <div class="fine-list">
            @for (fine of fines(); track fine.id) {
              <div class="fine-row">
                <div class="fine-row-main">
                  <span class="fine-date">{{ fine.date }}</span>
                  <strong>{{ fine.title }}</strong>
                </div>
                <div class="fine-amount">{{ fine.amount | number:'1.0-0' }} ₽</div>
              </div>
            }
          </div>
        }
      </section>

      <section class="policy-section">
        <div class="section-title">
          <mat-icon>gavel</mat-icon>
          <h2>Правила</h2>
        </div>
        <div class="policy-grid">
          @for (policy of finePolicies; track policy.key) {
            <article class="policy-card glass-card">
              <mat-icon>{{ policy.icon }}</mat-icon>
              <div class="policy-body">
                <strong>{{ policy.title }}</strong>
                <span>{{ policy.amount | number:'1.0-0' }} ₽</span>
              </div>
            </article>
          }
        </div>
      </section>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      padding: 16px;
      box-sizing: border-box;
    }

    .fines-page {
      max-width: 860px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .glass-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-lg);
      box-shadow: var(--crm-shadow-card);
    }

    .fines-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 18px 20px;
    }

    .fines-title-block {
      min-width: 0;

      h1 {
        margin: 2px 0 0;
        font-family: var(--crm-font-display, 'Oswald', sans-serif);
        font-size: 28px;
        font-weight: 500;
        line-height: 1.05;
        color: var(--crm-text-primary);
      }

      p {
        margin: 6px 0 0;
        color: var(--crm-text-muted);
        font-size: 13px;
      }
    }

    .fines-eyebrow {
      color: var(--crm-accent);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .fines-total {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      flex-shrink: 0;

      span {
        font-family: var(--crm-font-display, 'Oswald', sans-serif);
        font-size: 30px;
        font-weight: 500;
        color: var(--crm-status-error);
        line-height: 1;
      }

      small {
        color: var(--crm-text-muted);
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }
    }

    .fines-section {
      padding: 16px;
    }

    .section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;

      mat-icon {
        color: var(--crm-accent);
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 700;
        color: var(--crm-text-primary);
      }
    }

    .empty-state {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 96px;
      border: 1px dashed var(--crm-border);
      border-radius: var(--crm-radius-md);
      color: var(--crm-text-muted);
      font-size: 13px;

      mat-icon {
        color: var(--crm-status-success);
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .fine-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .fine-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
    }

    .fine-row-main {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;

      strong {
        color: var(--crm-text-primary);
        font-size: 13px;
        font-weight: 700;
      }
    }

    .fine-date {
      color: var(--crm-text-muted);
      font-size: 11px;
    }

    .fine-amount {
      flex-shrink: 0;
      color: var(--crm-status-error);
      font-weight: 800;
      font-size: 14px;
    }

    .policy-section {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .policy-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
    }

    .policy-card {
      display: flex;
      gap: 10px;
      padding: 14px;
      min-width: 0;

      > mat-icon {
        color: var(--crm-status-warning);
        font-size: 22px;
        width: 22px;
        height: 22px;
        flex-shrink: 0;
      }
    }

    .policy-body {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;

      strong {
        color: var(--crm-text-primary);
        font-size: 13px;
        line-height: 1.25;
      }

      span {
        color: var(--crm-status-error);
        font-size: 18px;
        font-weight: 800;
      }
    }

    @media (max-width: 720px) {
      :host {
        padding: 12px;
      }

      .fines-header {
        align-items: flex-start;
        flex-direction: column;
      }

      .fines-total {
        align-items: flex-start;
      }

      .policy-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class MyFinesComponent {
  readonly finePolicies = FINE_POLICIES;
  readonly fines = signal<readonly FineEntry[]>([]);

  readonly monthLabel = computed(() => {
    const now = new Date();
    return now.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  });

  readonly totalAmount = computed(() =>
    this.fines().reduce((sum, fine) => sum + fine.amount, 0)
  );
}
