import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  output,
  signal,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { CurrencyPipe } from '@angular/common';

interface SubscriptionPlan {
  id: string;
  slug: string;
  name: string;
  base_price: number;
  billing_period: string;
  category: string;
  features: string[];
  is_popular: boolean;
  icon?: string;
}

@Component({
  selector: 'app-subscription-picker',
  imports: [MatIconModule, MatProgressSpinnerModule, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    <div class="sp-root">
      <div class="sp-header">
        <button class="sp-back" (click)="closed.emit()">
          <mat-icon>arrow_back</mat-icon>
        </button>
        <span class="sp-title">Оформить подписку</span>
      </div>

      @if (loading()) {
        <div class="sp-loading">
          <mat-spinner diameter="24" />
        </div>
      } @else if (sending()) {
        <div class="sp-loading">
          <mat-spinner diameter="24" />
          <span>Отправляем ссылку...</span>
        </div>
      } @else {
        <div class="sp-categories">
          @for (cat of categories(); track cat.slug) {
            <button
              class="sp-cat-btn"
              [class.sp-cat-active]="selectedCategory() === cat.slug"
              (click)="selectedCategory.set(cat.slug)"
            >
              {{ cat.label }}
            </button>
          }
        </div>

        <div class="sp-plans">
          @for (plan of filteredPlans(); track plan.id) {
            <button
              class="sp-plan"
              [class.sp-plan-popular]="plan.is_popular"
              (click)="selectPlan(plan)"
            >
              @if (plan.is_popular) {
                <div class="sp-popular-badge">Популярный</div>
              }
              <div class="sp-plan-name">{{ plan.name }}</div>
              <div class="sp-plan-price">{{ plan.base_price | currency:'RUB':'symbol-narrow':'1.0-0':'ru' }}/мес</div>
              <ul class="sp-plan-features">
                @for (f of plan.features.slice(0, 3); track f) {
                  <li>{{ f }}</li>
                }
              </ul>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .sp-root {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 12px 0;
    }

    .sp-header {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .sp-back {
      background: none;
      border: none;
      cursor: pointer;
      color: #a0a0a0;
      padding: 4px;
      display: flex;
      align-items: center;
      border-radius: 6px;
      transition: all 150ms;

      &:hover { background: rgba(255,255,255,0.06); color: #fff; }
    }

    .sp-title {
      font-size: 14px;
      font-weight: 600;
      color: #e0e0e0;
    }

    .sp-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      font-size: 12px;
      color: #7a7a7a;
    }

    .sp-categories {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 4px;

      &::-webkit-scrollbar { height: 2px; }
      &::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
    }

    .sp-cat-btn {
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      color: #a0a0a0;
      padding: 5px 12px;
      border-radius: 16px;
      font-size: 11px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      white-space: nowrap;
      transition: all 150ms;

      &:hover { background: rgba(255,255,255,0.08); color: #e0e0e0; }
    }

    .sp-cat-active {
      background: rgba(251, 191, 36, 0.14);
      border-color: rgba(251, 191, 36, 0.30);
      color: #fbbf24;
    }

    .sp-plans {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
      gap: 8px;
    }

    .sp-plan {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 10px;
      padding: 12px;
      cursor: pointer;
      text-align: left;
      font-family: inherit;
      transition: all 150ms;
      position: relative;

      &:hover {
        background: rgba(255,255,255,0.06);
        border-color: rgba(251, 191, 36, 0.30);
        transform: translateY(-1px);
      }
    }

    .sp-plan-popular {
      border-color: rgba(251, 191, 36, 0.25);
    }

    .sp-popular-badge {
      position: absolute;
      top: -8px;
      right: 8px;
      background: #fbbf24;
      color: #1a1a1a;
      font-size: 9px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      letter-spacing: 0.02em;
    }

    .sp-plan-name {
      font-size: 13px;
      font-weight: 600;
      color: #e0e0e0;
      margin-bottom: 4px;
    }

    .sp-plan-price {
      font-size: 15px;
      font-weight: 700;
      color: #fbbf24;
      margin-bottom: 8px;
    }

    .sp-plan-features {
      list-style: none;
      padding: 0;
      margin: 0;

      li {
        font-size: 10px;
        color: #7a7a7a;
        padding: 1px 0;
        &::before {
          content: '✓ ';
          color: #34d399;
        }
      }
    }
  `],
})
export class SubscriptionPickerComponent implements OnInit {
  private readonly http = inject(HttpClient);

  readonly phone = input.required<string>();
  readonly sessionId = input<string>();
  readonly clientName = input<string>();

  readonly closed = output<void>();
  readonly subscriptionSent = output<{ planName: string }>();

  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly plans = signal<SubscriptionPlan[]>([]);
  readonly selectedCategory = signal<string>('all');

  private readonly categoryLabels: Record<string, string> = {
    'all': 'Все',
    'doc-print': 'Печать A4',
  };

  readonly categories = signal<{ slug: string; label: string }[]>([]);

  readonly filteredPlans = () => {
    const cat = this.selectedCategory();
    const all = this.plans();
    if (cat === 'all') return all;
    return all.filter(p => p.category === cat);
  };

  ngOnInit(): void {
    this.http.get<{ success: boolean; plans: SubscriptionPlan[] }>('/api/subscriptions/plans')
      .subscribe({
        next: (res) => {
          this.plans.set(res.plans);
          const cats = new Set(res.plans.map(p => p.category));
          const catList: { slug: string; label: string }[] = [{ slug: 'all', label: 'Все' }];
          for (const c of cats) {
            catList.push({ slug: c, label: this.categoryLabels[c] || c });
          }
          this.categories.set(catList);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  selectPlan(plan: SubscriptionPlan): void {
    this.sending.set(true);

    const sessionId = this.sessionId();
    if (sessionId) {
      // Use subscription offer API — creates offer + sends link to client in chat
      this.http.post<{ success: boolean; offer_id: string; token: string }>('/api/subscriptions/offer', {
        plan_id: plan.id,
        chat_session_id: sessionId,
      }).subscribe({
        next: () => {
          this.sending.set(false);
          this.subscriptionSent.emit({ planName: plan.name });
        },
        error: () => {
          // Fallback: copy subscribe link to clipboard
          const phone = this.phone().replace(/\D/g, '');
          const url = `https://svoefoto.ru/subscriptions?plan=${plan.slug}&phone=${phone}`;
          navigator.clipboard.writeText(url);
          this.sending.set(false);
          this.subscriptionSent.emit({ planName: plan.name });
        },
      });
    } else {
      // No chat session — copy link
      const phone = this.phone().replace(/\D/g, '');
      const url = `https://svoefoto.ru/subscriptions?plan=${plan.slug}&phone=${phone}`;
      navigator.clipboard.writeText(url);
      this.sending.set(false);
      this.subscriptionSent.emit({ planName: plan.name });
    }
  }
}
