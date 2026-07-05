import {
  Component, inject, signal, computed, ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe, DecimalPipe } from '@angular/common';
import {
  PartnersApiService,
  Partner,
  PartnerReferral,
  PartnerPayout,
} from '../../services/partners-api.service';
import { PartnerCommissionRulesComponent } from '../partner-commission-rules/partner-commission-rules.component';

type ViewMode = 'list' | 'form' | 'detail';
type DetailTab = 'referrals' | 'payouts' | 'commissions';

const PARTNER_TYPES = [
  { value: 'referral',  label: 'Реферальный',  desc: 'Приводит клиентов по ссылке' },
  { value: 'business',  label: 'Бизнес',        desc: 'Партнёр-организация' },
  { value: 'affiliate', label: 'Аффилиат',      desc: 'Партнёрская сеть' },
  { value: 'promoter',  label: 'Промоутер',     desc: 'Раздаёт флаеры, привлекает офлайн' },
  { value: 'agent',     label: 'Агент',          desc: 'Принимает заказы от клиентов' },
  { value: 'online',    label: 'Онлайн',         desc: 'Продвигает в интернете' },
] as const;

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:   { label: 'На модерации', color: '#f59e0b' },
  approved:  { label: 'Активен',      color: '#10b981' },
  suspended: { label: 'Приостановлен', color: '#ef4444' },
  rejected:  { label: 'Отклонён',    color: '#6b7280' },
};

interface FormState {
  name: string;
  email: string;
  phone: string;
  type: 'referral' | 'business' | 'affiliate' | 'promoter' | 'agent' | 'online';
  commission_rate: number;
  promo_code: string;
  referral_url: string;
  notes: string;
}

function emptyForm(): FormState {
  return { name: '', email: '', phone: '', type: 'referral', commission_rate: 50, promo_code: '', referral_url: '', notes: '' };
}

@Component({
  selector: 'app-partners',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatTooltipModule, DatePipe, DecimalPipe, PartnerCommissionRulesComponent],
  template: `
<div class="p-page">
  <!-- Header -->
  <div class="p-header">
    <div class="p-header-left">
      @if (view() !== 'list') {
        <button class="btn-icon" (click)="backToList()" matTooltip="Назад">
          <mat-icon>arrow_back</mat-icon>
        </button>
      }
      <h2 class="p-title">
        @if (view() === 'list') { Партнёрская программа }
        @if (view() === 'form') { {{ editingId() ? 'Редактировать партнёра' : 'Добавить партнёра' }} }
        @if (view() === 'detail') { {{ selectedPartner()?.name }} }
      </h2>
    </div>
    @if (view() === 'list') {
      <button class="btn-primary" (click)="openCreate()">
        <mat-icon>person_add</mat-icon> Добавить
      </button>
    }
    @if (view() === 'form') {
      <button class="btn-primary" [disabled]="saving()" (click)="save()">
        <mat-icon>{{ saving() ? 'hourglass_empty' : 'save' }}</mat-icon>
        {{ saving() ? 'Сохранение…' : 'Сохранить' }}
      </button>
    }
  </div>

  @if (error()) {
    <div class="p-error">
      <mat-icon>error</mat-icon> {{ error() }}
      <button class="btn-icon btn-close" (click)="error.set(null)"><mat-icon>close</mat-icon></button>
    </div>
  }

  <!-- Filter bar -->
  @if (view() === 'list') {
    <div class="filter-bar">
      <div class="filter-status">
        @for (s of statusFilters; track s.value) {
          <button class="filter-btn" [class.filter-btn--active]="statusFilter() === s.value"
                  (click)="statusFilter.set(s.value)">{{ s.label }}</button>
        }
      </div>
      <input class="search-input" [(ngModel)]="searchQuery" (ngModelChange)="onSearch($event)"
             placeholder="🔍 Поиск по имени, телефону…" />
    </div>

    <!-- Summary stats -->
    <div class="stats-row">
      <div class="stat-card">
        <div class="stat-val">{{ totalPartners() }}</div>
        <div class="stat-key">Всего партнёров</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">{{ activePartners() }}</div>
        <div class="stat-key">Активных</div>
      </div>
      <div class="stat-card">
        <div class="stat-val">{{ pendingPartners() }}</div>
        <div class="stat-key">На модерации</div>
      </div>
    </div>
  }

  <!-- ── List ──────────────────────────────────────────── -->
  @if (view() === 'list') {
    @if (loading()) {
      <div class="p-loading"><mat-icon class="spin">sync</mat-icon> Загрузка…</div>
    } @else if (filteredPartners().length === 0) {
      <div class="p-empty">
        <mat-icon>handshake</mat-icon>
        <p>Нет партнёров{{ statusFilter() !== 'all' ? ' с выбранным статусом' : '' }}</p>
        <button class="btn-primary" (click)="openCreate()">Добавить партнёра</button>
      </div>
    } @else {
      <div class="p-list">
        @for (p of filteredPartners(); track p.id) {
          <div class="p-card">
            <div class="p-card-left">
              <div class="p-avatar">{{ p.name[0]?.toUpperCase() }}</div>
              <div class="p-info">
                <div class="p-name">{{ p.name }}</div>
                <div class="p-contacts">
                  @if (p.phone) { <span><mat-icon class="icon-sm">phone</mat-icon>{{ p.phone }}</span> }
                  @if (p.email) { <span><mat-icon class="icon-sm">email</mat-icon>{{ p.email }}</span> }
                </div>
                <div class="p-tags">
                  <span class="tag tag--type">{{ getTypeLabel(p.type) }}</span>
                  @if (p.promo_code) { <span class="tag tag--promo">{{ p.promo_code }}</span> }
                  <span class="tag" [style.color]="getStatusColor(p.status)">{{ getStatusLabel(p.status) }}</span>
                </div>
              </div>
            </div>
            <div class="p-card-right">
              <div class="p-fin">
                <div class="fin-item">
                  <span class="fin-val">{{ p.balance | number:'1.0-0' }} ₽</span>
                  <span class="fin-key">Баланс</span>
                </div>
                <div class="fin-item">
                  <span class="fin-val">{{ p.total_earned | number:'1.0-0' }} ₽</span>
                  <span class="fin-key">Заработано</span>
                </div>
                <div class="fin-item">
                  <span class="fin-val">{{ p.commission_rate }}%</span>
                  <span class="fin-key">Комиссия</span>
                </div>
              </div>
              <div class="p-actions">
                @if (p.status === 'pending') {
                  <button class="btn-sm btn-sm--green" (click)="approve(p)" matTooltip="Одобрить">
                    <mat-icon>check_circle</mat-icon>
                  </button>
                  <button class="btn-sm btn-sm--danger" (click)="reject(p)" matTooltip="Отклонить">
                    <mat-icon>cancel</mat-icon>
                  </button>
                }
                @if (p.status === 'approved') {
                  <button class="btn-sm" (click)="suspend(p)" matTooltip="Приостановить">
                    <mat-icon>pause_circle</mat-icon>
                  </button>
                }
                <button class="btn-sm" (click)="openDetail(p)" matTooltip="Рефералы и выплаты">
                  <mat-icon>bar_chart</mat-icon>
                </button>
                <button class="btn-sm" (click)="openEdit(p)" matTooltip="Редактировать">
                  <mat-icon>edit</mat-icon>
                </button>
              </div>
            </div>
          </div>
        }
      </div>
    }
  }

  <!-- ── Form ──────────────────────────────────────────── -->
  @if (view() === 'form') {
    <div class="p-form">
      <section class="p-section">
        <h3 class="section-title">Контакты</h3>
        <div class="form-grid">
          <div class="form-row">
            <span class="form-label" aria-label="Имя или Компания">Имя / Компания *</span>
            <input class="form-input" [(ngModel)]="form.name" placeholder="Анна Петрова" />
          </div>
          <div class="form-row">
            <span class="form-label" aria-label="Телефон">Телефон</span>
            <input class="form-input" [(ngModel)]="form.phone" placeholder="+7 900 000-00-00" />
          </div>
          <div class="form-row">
            <span class="form-label" aria-label="Email">Email</span>
            <input class="form-input" [(ngModel)]="form.email" type="email" placeholder="partner@example.com" />
          </div>
        </div>
      </section>

      <section class="p-section">
        <h3 class="section-title">Тип партнёра</h3>
        <div class="type-grid">
          @for (t of partnerTypes; track t.value) {
            <button class="type-btn" [class.type-btn--active]="form.type === t.value"
                    (click)="selectType(t.value)">
              <span class="type-label">{{ t.label }}</span>
              <span class="type-desc">{{ t.desc }}</span>
            </button>
          }
        </div>
      </section>

      <section class="p-section">
        <h3 class="section-title">Коммерческие условия</h3>
        <div class="form-grid">
          <div class="form-row">
            <span class="form-label" aria-label="Комиссия">Комиссия (%)</span>
            <div class="input-suffix">
              <input class="form-input" [(ngModel)]="form.commission_rate" type="number" min="0" max="100" />
              <span class="suffix">%</span>
            </div>
          </div>
          <div class="form-row">
            <span class="form-label" aria-label="Промо-код">Промо-код</span>
            <input class="form-input" [(ngModel)]="form.promo_code" placeholder="PARTNER2026" />
          </div>
          <div class="form-row">
            <span class="form-label" aria-label="Реферальная ссылка">Реферальная ссылка</span>
            <input class="form-input" [(ngModel)]="form.referral_url" placeholder="https://svoefoto.ru/?ref=..." />
          </div>
        </div>
      </section>

      <section class="p-section">
        <h3 class="section-title">Заметки</h3>
        <textarea class="form-textarea" [(ngModel)]="form.notes" rows="3"
                  placeholder="Внутренние заметки для команды"></textarea>
      </section>
    </div>
  }

  <!-- ── Detail ─────────────────────────────────────────── -->
  @if (view() === 'detail') {
    @if (selectedPartner(); as p) {
      <div class="detail-header">
        <div class="detail-fin">
          <div class="detail-fin-item">
            <span class="dfin-val">{{ p.balance | number:'1.0-0' }} ₽</span>
            <span class="dfin-key">Текущий баланс</span>
          </div>
          <div class="detail-fin-item">
            <span class="dfin-val">{{ p.total_earned | number:'1.0-0' }} ₽</span>
            <span class="dfin-key">Всего заработано</span>
          </div>
          <div class="detail-fin-item">
            <span class="dfin-val">{{ p.commission_rate }}%</span>
            <span class="dfin-key">Комиссия</span>
          </div>
        </div>

        @if (Number(p.balance) > 0) {
          <div class="payout-form">
            <span class="payout-label">Выплата:</span>
            <input class="form-input payout-amount" type="number" [(ngModel)]="payoutAmount"
                   [max]="p.balance" placeholder="Сумма" />
            <select class="form-select" [(ngModel)]="payoutMethod">
              <option value="card">Карта</option>
              <option value="phone">СБП</option>
              <option value="bank_transfer">Перевод</option>
            </select>
            <button class="btn-primary" (click)="createPayout(p)" [disabled]="!payoutAmount">
              Запросить выплату
            </button>
          </div>
        }
      </div>

      <!-- Tabs -->
      <div class="detail-tabs">
        <button class="detail-tab" [class.detail-tab--active]="detailTab() === 'referrals'"
                (click)="switchTab('referrals')">
          Рефералы {{ referrals().length ? '(' + referrals().length + ')' : '' }}
        </button>
        <button class="detail-tab" [class.detail-tab--active]="detailTab() === 'payouts'"
                (click)="switchTab('payouts')">
          Выплаты {{ payouts().length ? '(' + payouts().length + ')' : '' }}
        </button>
        <button class="detail-tab" [class.detail-tab--active]="detailTab() === 'commissions'"
                (click)="switchTab('commissions')">
          Комиссии
        </button>
      </div>

      <!-- Referrals tab -->
      @if (detailTab() === 'referrals') {
        @if (detailLoading()) {
          <div class="p-loading"><mat-icon class="spin">sync</mat-icon></div>
        } @else if (referrals().length === 0) {
          <div class="p-empty"><mat-icon>link_off</mat-icon><p>Нет рефералов</p></div>
        } @else {
          <div class="ref-table">
            <div class="ref-header">
              <span>Дата</span><span>Клиент</span><span>Тип</span>
              <span>Сумма заказа</span><span>Комиссия</span><span>Статус</span>
            </div>
            @for (r of referrals(); track r.id) {
              <div class="ref-row">
                <span>{{ r.created_at | date:'dd.MM.yy' }}</span>
                <span>{{ r.client_phone || '—' }}</span>
                <span>{{ r.order_type }}</span>
                <span>{{ r.order_amount | number:'1.0-0' }} ₽</span>
                <span class="commission">+{{ r.commission_amount | number:'1.0-0' }} ₽</span>
                <span [class]="'ref-status ref-status--' + r.status">{{ getRefStatusLabel(r.status) }}</span>
              </div>
            }
          </div>
        }
      }

      <!-- Payouts tab -->
      @if (detailTab() === 'payouts') {
        @if (detailLoading()) {
          <div class="p-loading"><mat-icon class="spin">sync</mat-icon></div>
        } @else if (payouts().length === 0) {
          <div class="p-empty"><mat-icon>money_off</mat-icon><p>Нет выплат</p></div>
        } @else {
          <div class="pay-list">
            @for (pay of payouts(); track pay.id) {
              <div class="pay-row">
                <mat-icon class="pay-icon">{{ getPayoutMethodIcon(pay.method) }}</mat-icon>
                <div class="pay-info">
                  <div class="pay-amount">{{ pay.amount | number:'1.0-0' }} ₽</div>
                  <div class="pay-meta">
                    {{ pay.method }} · {{ pay.created_at | date:'dd.MM.yyyy' }}
                    @if (pay.processed_by_name) { · обработал {{ pay.processed_by_name }} }
                  </div>
                </div>
                <div class="pay-status" [style.color]="getPayoutStatusColor(pay.status)">
                  {{ getPayoutStatusLabel(pay.status) }}
                </div>
                @if (pay.status === 'pending') {
                  <button class="btn-sm btn-sm--green" (click)="completePayout(pay)" matTooltip="Подтвердить выплату">
                    <mat-icon>check</mat-icon>
                  </button>
                  <button class="btn-sm btn-sm--danger" (click)="cancelPayout(pay)" matTooltip="Отменить">
                    <mat-icon>close</mat-icon>
                  </button>
                }
              </div>
            }
          </div>
        }
      }

      <!-- Commissions tab -->
      @if (detailTab() === 'commissions') {
        <app-partner-commission-rules [partnerId]="p.id" />
      }
    }
  }
</div>
  `,
  styles: [`
    .p-page { max-width: 960px; margin: 0 auto; padding: 16px; }

    .p-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 16px; gap: 12px;
    }
    .p-header-left { display: flex; align-items: center; gap: 8px; }
    .p-title { font-size: 20px; font-weight: 600; color: var(--crm-text-primary); margin: 0; }

    /* Buttons */
    .btn-primary {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer;
      background: var(--crm-accent); color: #fff; font-size: 14px; font-weight: 500;
      transition: opacity 0.15s;
      &:hover { opacity: 0.85; } &:disabled { opacity: 0.5; cursor: default; }
    }
    .btn-sm {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px; border-radius: 6px; border: 1px solid var(--crm-border);
      background: var(--crm-surface-hover); color: var(--crm-text-primary);
      cursor: pointer; font-size: 13px;
      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }
    .btn-sm--green { border-color: #10b981; color: #10b981; }
    .btn-sm--danger { border-color: #ef4444; color: #ef4444; }
    .btn-icon {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 6px; border: none;
      background: transparent; cursor: pointer; color: var(--crm-text-secondary);
    }
    .btn-close { width: 24px; height: 24px; }

    /* Error */
    .p-error {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-radius: 8px; margin-bottom: 16px;
      background: rgba(239,68,68,0.1); color: #ef4444; font-size: 14px;
    }

    /* Filter bar */
    .filter-bar { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; flex-wrap: wrap; }
    .filter-status { display: flex; gap: 6px; flex-wrap: wrap; }
    .filter-btn {
      padding: 6px 12px; border-radius: 99px; border: 1px solid var(--crm-border);
      background: var(--crm-surface-hover); color: var(--crm-text-secondary);
      cursor: pointer; font-size: 13px;
    }
    .filter-btn--active { background: var(--crm-accent); color: #fff; border-color: var(--crm-accent); }
    .search-input {
      padding: 8px 12px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-bg); color: var(--crm-text-primary); font-size: 14px;
      flex: 1; min-width: 200px; outline: none;
      &:focus { border-color: var(--crm-accent); }
    }

    /* Stats */
    .stats-row { display: flex; gap: 12px; margin-bottom: 16px; }
    .stat-card {
      flex: 1; padding: 12px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-surface); text-align: center;
    }
    .stat-val { font-size: 24px; font-weight: 700; color: var(--crm-text-primary); }
    .stat-key { font-size: 12px; color: var(--crm-text-secondary); }

    /* Loading / Empty */
    .p-loading {
      display: flex; align-items: center; gap: 8px; justify-content: center;
      padding: 48px; color: var(--crm-text-secondary);
    }
    .p-empty {
      text-align: center; padding: 60px 20px; color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 16px; }
      p { margin: 0 0 20px; }
    }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Partner cards */
    .p-list { display: flex; flex-direction: column; gap: 10px; }
    .p-card {
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      padding: 14px 16px; border-radius: 10px; border: 1px solid var(--crm-border);
      background: var(--crm-surface); flex-wrap: wrap;
    }
    .p-card-left { display: flex; gap: 12px; align-items: center; flex: 1; min-width: 200px; }
    .p-avatar {
      width: 44px; height: 44px; border-radius: 50%; background: rgba(139,92,246,0.15);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700; color: var(--crm-accent); flex-shrink: 0;
    }
    .p-info { flex: 1; }
    .p-name { font-weight: 600; color: var(--crm-text-primary); margin-bottom: 3px; }
    .p-contacts {
      display: flex; gap: 8px; flex-wrap: wrap; font-size: 12px;
      color: var(--crm-text-secondary); margin-bottom: 5px;
      span { display: flex; align-items: center; gap: 2px; }
    }
    .p-tags { display: flex; gap: 5px; flex-wrap: wrap; }
    .p-card-right { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
    .p-fin { display: flex; gap: 16px; }
    .fin-item { text-align: center; }
    .fin-val { display: block; font-size: 16px; font-weight: 600; color: var(--crm-text-primary); }
    .fin-key { display: block; font-size: 11px; color: var(--crm-text-secondary); }
    .p-actions { display: flex; gap: 6px; }

    /* Tags */
    .tag {
      display: inline-flex; padding: 2px 8px; border-radius: 99px; font-size: 11px;
      background: var(--crm-surface-hover); color: var(--crm-text-secondary);
    }
    .tag--type { background: rgba(139,92,246,0.1); color: var(--crm-accent); }
    .tag--promo { background: rgba(16,185,129,0.1); color: #10b981; font-family: monospace; }

    .icon-sm { font-size: 14px; width: 14px; height: 14px; }

    /* Form */
    .p-form { display: flex; flex-direction: column; gap: 16px; }
    .p-section { border: 1px solid var(--crm-border); border-radius: 10px; padding: 16px; background: var(--crm-surface); }
    .section-title { font-size: 15px; font-weight: 600; color: var(--crm-text-primary); margin: 0 0 12px; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
    .form-row { display: flex; flex-direction: column; gap: 5px; }
    .form-label { font-size: 13px; color: var(--crm-text-secondary); font-weight: 500; }
    .form-input, .form-select {
      padding: 8px 10px; border-radius: 6px; border: 1px solid var(--crm-border);
      background: var(--crm-bg); color: var(--crm-text-primary); font-size: 14px; outline: none;
      &:focus { border-color: var(--crm-accent); }
    }
    .form-textarea {
      width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid var(--crm-border);
      background: var(--crm-bg); color: var(--crm-text-primary); font-size: 14px;
      resize: vertical; outline: none; box-sizing: border-box;
      &:focus { border-color: var(--crm-accent); }
    }
    .input-suffix { display: flex; align-items: center; gap: 4px; }
    .suffix { font-size: 14px; color: var(--crm-text-secondary); }

    /* Type buttons */
    .type-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
    .type-btn {
      display: flex; flex-direction: column; gap: 4px; padding: 12px;
      border: 1px solid var(--crm-border); border-radius: 8px;
      background: var(--crm-surface-hover); cursor: pointer; text-align: left;
    }
    .type-btn--active { border-color: var(--crm-accent); background: rgba(139,92,246,0.08); }
    .type-label { font-size: 13px; font-weight: 600; color: var(--crm-text-primary); }
    .type-desc { font-size: 11px; color: var(--crm-text-secondary); }

    /* Detail */
    .detail-header { display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px; }
    .detail-fin { display: flex; gap: 20px; flex-wrap: wrap; }
    .detail-fin-item { text-align: center; }
    .dfin-val { display: block; font-size: 24px; font-weight: 700; color: var(--crm-text-primary); }
    .dfin-key { display: block; font-size: 12px; color: var(--crm-text-secondary); }
    .payout-form { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 12px; border-radius: 8px; border: 1px solid var(--crm-border); background: var(--crm-surface); }
    .payout-label { font-size: 14px; font-weight: 500; color: var(--crm-text-primary); }
    .payout-amount { width: 120px; min-width: 80px; }

    /* Tabs */
    .detail-tabs { display: flex; gap: 0; border-bottom: 1px solid var(--crm-border); margin-bottom: 16px; }
    .detail-tab {
      padding: 10px 20px; border: none; background: transparent;
      color: var(--crm-text-secondary); cursor: pointer; font-size: 14px; font-weight: 500;
      border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    .detail-tab--active { color: var(--crm-accent); border-bottom-color: var(--crm-accent); }

    /* Referrals table */
    .ref-table { border-radius: 8px; border: 1px solid var(--crm-border); overflow: hidden; }
    .ref-header {
      display: grid; grid-template-columns: 72px 1fr 80px 100px 100px 90px;
      padding: 8px 12px; background: var(--crm-surface-hover);
      font-size: 12px; font-weight: 500; color: var(--crm-text-secondary);
    }
    .ref-row {
      display: grid; grid-template-columns: 72px 1fr 80px 100px 100px 90px;
      padding: 10px 12px; font-size: 13px; color: var(--crm-text-primary);
      border-top: 1px solid var(--crm-border);
    }
    .commission { color: #10b981; font-weight: 600; }
    .ref-status { font-size: 12px; }
    .ref-status--pending { color: #f59e0b; }
    .ref-status--confirmed { color: #10b981; }
    .ref-status--paid { color: #6b7280; }
    .ref-status--cancelled { color: #ef4444; }

    /* Payouts */
    .pay-list { display: flex; flex-direction: column; gap: 8px; }
    .pay-row {
      display: flex; align-items: center; gap: 12px;
      padding: 12px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-surface);
    }
    .pay-icon { color: var(--crm-text-secondary); flex-shrink: 0; }
    .pay-info { flex: 1; }
    .pay-amount { font-size: 16px; font-weight: 600; color: var(--crm-text-primary); }
    .pay-meta { font-size: 12px; color: var(--crm-text-secondary); }
    .pay-status { font-size: 13px; font-weight: 500; }
  `],
})
export class PartnersComponent {
  private readonly api = inject(PartnersApiService);

  readonly partnerTypes = PARTNER_TYPES;
  readonly statusFilters = [
    { value: 'all', label: 'Все' },
    { value: 'pending', label: 'На модерации' },
    { value: 'approved', label: 'Активные' },
    { value: 'suspended', label: 'Приостановленные' },
  ];

  // State
  readonly view = signal<ViewMode>('list');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly detailLoading = signal(false);
  readonly error = signal<string | null>(null);

  readonly partners = signal<Partner[]>([]);
  readonly referrals = signal<PartnerReferral[]>([]);
  readonly payouts = signal<PartnerPayout[]>([]);
  readonly selectedPartner = signal<Partner | null>(null);

  readonly editingId = signal<number | null>(null);
  readonly statusFilter = signal('all');
  readonly detailTab = signal<DetailTab>('referrals');

  searchQuery = '';
  payoutAmount: number | null = null;
  payoutMethod = 'card';

  // Computed
  readonly filteredPartners = computed(() => {
    let list = this.partners();
    const sf = this.statusFilter();
    if (sf !== 'all') list = list.filter(p => p.status === sf);
    return list;
  });

  readonly totalPartners = computed(() => this.partners().length);
  readonly activePartners = computed(() => this.partners().filter(p => p.status === 'approved').length);
  readonly pendingPartners = computed(() => this.partners().filter(p => p.status === 'pending').length);

  form: FormState = emptyForm();

  // Math reference for template
  readonly Number = Number;

  constructor() { this.loadList(); }

  loadList(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: ({ data }) => { this.partners.set(data); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.error || 'Ошибка загрузки'); this.loading.set(false); },
    });
  }

  onSearch(query: string): void {
    this.loading.set(true);
    this.api.list({ search: query || undefined, status: this.statusFilter() !== 'all' ? this.statusFilter() : undefined }).subscribe({
      next: ({ data }) => { this.partners.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private readonly COMMISSION_BY_TYPE: Record<string, number> = {
    referral: 50, business: 50, affiliate: 50,
    promoter: 10, agent: 15, online: 20,
  };

  selectType(value: string): void {
    this.form.type = value as FormState['type'];
    // Only auto-set commission when creating (not editing)
    if (!this.editingId()) {
      this.form.commission_rate = this.COMMISSION_BY_TYPE[value] ?? 15;
    }
  }

  openCreate(): void {
    this.editingId.set(null);
    this.form = emptyForm();
    this.view.set('form');
  }

  openEdit(p: Partner): void {
    this.editingId.set(p.id);
    this.form = {
      name: p.name, email: p.email || '', phone: p.phone || '',
      type: p.type, commission_rate: parseFloat(p.commission_rate),
      promo_code: p.promo_code || '', referral_url: p.referral_url || '', notes: p.notes || '',
    };
    this.view.set('form');
  }

  openDetail(p: Partner): void {
    this.selectedPartner.set(p);
    this.view.set('detail');
    this.detailTab.set('referrals');
    this.loadReferrals(p.id);
  }

  backToList(): void {
    this.view.set('list');
    this.error.set(null);
    this.loadList();
  }

  switchTab(tab: DetailTab): void {
    this.detailTab.set(tab);
    const id = this.selectedPartner()?.id;
    if (!id) return;
    if (tab === 'referrals') this.loadReferrals(id);
    if (tab === 'payouts') this.loadPayouts(id);
  }

  loadReferrals(id: number): void {
    this.detailLoading.set(true);
    this.api.getReferrals(id).subscribe({
      next: ({ data }) => { this.referrals.set(data); this.detailLoading.set(false); },
      error: () => this.detailLoading.set(false),
    });
  }

  loadPayouts(id: number): void {
    this.detailLoading.set(true);
    this.api.getPayouts(id).subscribe({
      next: (data) => { this.payouts.set(data); this.detailLoading.set(false); },
      error: () => this.detailLoading.set(false),
    });
  }

  save(): void {
    if (!this.form.name.trim()) { this.error.set('Имя обязательно'); return; }
    this.saving.set(true);
    this.error.set(null);

    const payload = {
      name: this.form.name.trim(),
      email: this.form.email.trim() || null,
      phone: this.form.phone.trim() || null,
      type: this.form.type,
      commission_rate: this.form.commission_rate,
      promo_code: this.form.promo_code.trim() || null,
      referral_url: this.form.referral_url.trim() || null,
      notes: this.form.notes.trim() || null,
    };

    const req$ = this.editingId()
      ? this.api.update(this.editingId()!, payload)
      : this.api.create(payload);

    req$.subscribe({
      next: () => { this.saving.set(false); this.backToList(); },
      error: (e) => { this.error.set(e?.error?.error || 'Ошибка сохранения'); this.saving.set(false); },
    });
  }

  approve(p: Partner): void {
    this.api.approve(p.id, 'approved').subscribe({
      next: (updated) => this.partners.update(list => list.map(x => x.id === updated.id ? updated : x)),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка'),
    });
  }

  reject(p: Partner): void {
    if (!confirm(`Отклонить заявку ${p.name}?`)) return;
    this.api.approve(p.id, 'rejected').subscribe({
      next: (updated) => this.partners.update(list => list.map(x => x.id === updated.id ? updated : x)),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка'),
    });
  }

  suspend(p: Partner): void {
    if (!confirm(`Приостановить партнёра ${p.name}?`)) return;
    this.api.approve(p.id, 'suspended').subscribe({
      next: (updated) => this.partners.update(list => list.map(x => x.id === updated.id ? updated : x)),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка'),
    });
  }

  createPayout(p: Partner): void {
    if (!this.payoutAmount || this.payoutAmount <= 0) return;
    this.api.createPayout(p.id, this.payoutAmount, this.payoutMethod).subscribe({
      next: () => { this.payoutAmount = null; this.switchTab('payouts'); },
      error: (e) => this.error.set(e?.error?.error || 'Ошибка создания выплаты'),
    });
  }

  completePayout(pay: PartnerPayout): void {
    this.api.processPayout(pay.id, 'completed').subscribe({
      next: () => this.loadPayouts(this.selectedPartner()!.id),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка'),
    });
  }

  cancelPayout(pay: PartnerPayout): void {
    if (!confirm('Отменить выплату?')) return;
    this.api.processPayout(pay.id, 'cancelled').subscribe({
      next: () => this.loadPayouts(this.selectedPartner()!.id),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка'),
    });
  }

  // Helpers
  getTypeLabel(type: string): string {
    return PARTNER_TYPES.find(t => t.value === type)?.label || type;
  }

  getStatusLabel(status: string): string {
    return STATUS_LABELS[status]?.label || status;
  }

  getStatusColor(status: string): string {
    return STATUS_LABELS[status]?.color || 'var(--crm-text-secondary)';
  }

  getRefStatusLabel(status: string): string {
    return { pending: 'Ожидает', confirmed: 'Подтверждён', paid: 'Выплачен', cancelled: 'Отменён' }[status] || status;
  }

  getPayoutMethodIcon(method: string): string {
    return { card: 'credit_card', phone: 'phone', bank_transfer: 'account_balance' }[method] || 'payment';
  }

  getPayoutStatusLabel(status: string): string {
    return { pending: 'Ожидает', processing: 'В обработке', completed: 'Выплачено', failed: 'Ошибка', cancelled: 'Отменено' }[status] || status;
  }

  getPayoutStatusColor(status: string): string {
    return { pending: '#f59e0b', processing: 'var(--crm-accent)', completed: '#10b981', failed: '#ef4444', cancelled: '#6b7280' }[status] || 'var(--crm-text-secondary)';
  }
}
