import { Component, inject, computed, signal, ChangeDetectionStrategy, afterNextRender } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { InboxService } from '../../services/inbox.service';
import { AuthService } from '../../../../core/services/auth.service';
import { DeliveryOperatorService } from '../../services/delivery-operator.service';
import { isNewBadgeVisible, markBadgeSeen } from '../../../../shared/utils/new-badge.util';

interface MoreItem {
  icon: string;
  label: string;
  description: string;
  route: string;
  badgeKey?: 'booking' | 'approval' | 'order' | 'delivery';
  adminOnly?: boolean;
  permission?: string | readonly string[];
}

interface MoreCategory {
  key: string;
  label: string;
  icon: string;
  items: MoreItem[];
}

const CATEGORIES: MoreCategory[] = [
  {
    key: 'profile',
    label: 'Мой профиль',
    icon: 'person',
    items: [
      { icon: 'person', label: 'Мой профиль', description: 'Смены, ставка, XP', route: '/employee/my-profile' },
      { icon: 'calendar_month', label: 'Мои смены', description: 'Расписание, check-in, выручка', route: '/employee/my-shifts', permission: 'shifts:manage' },
      { icon: 'edit_calendar', label: 'Запрос на график', description: 'Подать заявку на смену', route: '/employee/schedule-request', permission: 'shifts:manage' },
      { icon: 'gavel', label: 'Штрафы', description: 'Начисления и правила', route: '/employee/my-fines' },
    ],
  },
  {
    key: 'operations',
    label: 'Операции',
    icon: 'storefront',
    items: [
      { icon: 'queue_play_next', label: 'Очередь заказов', description: 'Workflow заказов', route: '/employee/order-queue' },
      { icon: 'local_shipping', label: 'Доставка', description: 'Курьерская доставка заказов', route: '/employee/delivery', badgeKey: 'delivery', permission: 'pos:use' },
      { icon: 'inventory_2', label: 'Каталог', description: 'Товары и услуги', route: '/employee/catalog', permission: 'catalog:manage' },
      { icon: 'warehouse', label: 'Склад', description: 'Приёмка и остатки', route: '/employee/inventory', permission: 'pos:use' },
      { icon: 'folder_copy', label: 'Готовые формы', description: 'PSD, JPG и PNG макеты', route: '/employee/ready-forms', adminOnly: true },
      { icon: 'account_balance_wallet', label: 'Сдача кассы', description: 'Подсчёт наличных по номиналам', route: '/employee/cash-handover', permission: 'pos:use' },
      { icon: 'card_membership', label: 'Подписки', description: 'Планы и подписчики', route: '/employee/subscription-manager', permission: 'subscriptions:manage' },
      { icon: 'price_change', label: 'Цены', description: 'Управление прайс-листом', route: '/employee/pricing', permission: 'catalog:manage' },
      { icon: 'schedule', label: 'Часы работы', description: 'Расписание студий', route: '/employee/studio-hours', permission: 'settings:manage' },
      { icon: 'timer', label: 'Настройка SLA', description: 'Время выполнения услуг', route: '/employee/sla-config', permission: 'settings:manage' },
    ],
  },
  {
    key: 'instructions',
    label: 'Инструкции',
    icon: 'menu_book',
    items: [
      { icon: 'menu_book', label: 'База знаний', description: 'Инструкции и ответы для сотрудников', route: '/employee/knowledge' },
    ],
  },
  {
    key: 'clients',
    label: 'Клиенты',
    icon: 'people',
    items: [
      { icon: 'person_search', label: 'Клиенты', description: 'Поиск по телефону', route: '/employee/clients', permission: 'clients:view' },
      { icon: 'event', label: 'Записи', description: 'Календарь бронирований', route: '/employee/bookings', badgeKey: 'booking', permission: 'bookings:manage' },
      { icon: 'photo_camera', label: 'Ретушь', description: 'Согласование фото', route: '/employee/approvals', badgeKey: 'approval' },
      { icon: 'factory', label: 'Производства', description: 'Заказы в типографии', route: '/employee/production', permission: 'production:manage' },
    ],
  },
  {
    key: 'analytics',
    label: 'Аналитика',
    icon: 'analytics',
    items: [
      { icon: 'point_of_sale', label: 'Продажи', description: 'Касса и выставленные счета', route: '/employee/sales', permission: 'pos:use' },
      { icon: 'bar_chart', label: 'Отчёты', description: 'Выручка и продажи', route: '/employee/reports', permission: 'reports:view' },
      { icon: 'account_balance_wallet', label: 'Контроль кассы', description: 'Недостачи по сменам и кассирам', route: '/employee/cash-control', permission: 'reports:view' },
      { icon: 'record_voice_over', label: 'Пожелания', description: 'Расшифровки звонков-опросов', route: '/employee/service-surveys', adminOnly: true },
      { icon: 'analytics', label: 'Аналитика', description: 'Статистика задач', route: '/employee/analytics', permission: 'analytics:view' },
      { icon: 'support_agent', label: 'Операторы', description: 'Метрики операторов', route: '/employee/operators', permission: 'analytics:view' },
      { icon: 'campaign', label: 'Маркетинг', description: 'Конверсии, воронки, реклама', route: '/employee/marketing', permission: 'analytics:view' },
      { icon: 'speed', label: 'KPI', description: 'Метрики эффективности', route: '/employee/kpi', permission: 'analytics:view' },
      { icon: 'flag', label: 'Кампании', description: 'Маркетинговые кампании', route: '/employee/campaigns', permission: 'analytics:view' },
      { icon: 'send', label: 'Рассылки', description: 'TG-рассылки и воронка', route: '/employee/broadcasts', permission: 'settings:manage' },
      { icon: 'pie_chart', label: 'Revenue Attribution', description: 'Выручка по каналам', route: '/employee/analytics/revenue', permission: 'analytics:view' },
    ],
  },
  {
    key: 'team',
    label: 'Команда',
    icon: 'groups',
    items: [
      { icon: 'groups', label: 'Команда', description: 'Сотрудники, расписание, зарплаты', route: '/employee/team-hub', permission: 'users:manage' },
      { icon: 'person_add', label: 'Регистрации', description: 'Новые пользователи сайта', route: '/employee/registrations', permission: 'users:manage' },
      { icon: 'handshake', label: 'Партнёры', description: 'Партнёры и экономика', route: '/employee/partners', permission: 'partners:manage' },
    ],
  },
  {
    key: 'ai',
    label: 'AI',
    icon: 'auto_awesome',
    items: [
      { icon: 'auto_fix_high', label: 'Follow-Up', description: 'AI-напоминания клиентам', route: '/employee/follow-up' },
      { icon: 'insights', label: 'AI Аналитика', description: 'Прогнозы и тренды', route: '/employee/ai-insights' },
    ],
  },
  {
    key: 'infra',
    label: 'Инфраструктура',
    icon: 'dns',
    items: [
      { icon: 'location_on', label: 'Студии', description: 'Открыть/закрыть точки', route: '/employee/studios', permission: 'settings:manage' },
      { icon: 'dns', label: 'Инфраструктура', description: 'Агенты и обновления', route: '/employee/infrastructure', permission: 'settings:manage' },
      { icon: 'hub', label: 'Каналы', description: 'Статус мессенджеров', route: '/employee/channels', permission: 'settings:manage' },
      { icon: 'print', label: 'Принтеры', description: 'Управление принтерами', route: '/employee/printers', permission: 'catalog:manage' },
      { icon: 'monitor_heart', label: 'Мониторинг парка', description: 'Телеметрия, алерты, задания', route: '/employee/fleet', permission: 'catalog:manage' },
      { icon: 'tune', label: 'Пресеты печати', description: 'Быстрые настройки печати', route: '/employee/print-presets', permission: 'catalog:manage' },
      { icon: 'upload_file', label: 'Единая печать', description: 'Локальные файлы и серверная обработка', route: '/employee/print-center', permission: 'pos:use' },
      { icon: 'queue', label: 'Очередь печати', description: 'Мониторинг заданий', route: '/employee/print-queue' },
      { icon: 'analytics', label: 'Аналитика печати', description: 'Статистика и выручка', route: '/employee/print-analytics' },
      { icon: 'inventory_2', label: 'Расходники', description: 'Мониторинг расходных материалов', route: '/employee/consumables', permission: 'catalog:manage' },
      { icon: 'videocam', label: 'Session Replay', description: 'Записи сессий', route: '/employee/replay', permission: 'clients:view' },
      { icon: 'local_fire_department', label: 'Тепловая карта', description: 'Heatmap кликов', route: '/employee/heatmap', permission: 'clients:view' },
      { icon: 'bug_report', label: 'Error Logs', description: 'Мониторинг ошибок', route: '/employee/error-logs', permission: 'reports:view' },
      { icon: 'policy', label: 'Аудит', description: 'Лог действий', route: '/employee/audit', permission: 'reports:view' },
      { icon: 'automation', label: 'Автоматизации', description: 'Workflow триггеры', route: '/employee/workflows', permission: 'settings:manage' },
    ],
  },
];

@Component({
  selector: 'app-more-section',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatCardModule, MatIconModule, MatBadgeModule],
  template: `
    <div class="more-layout">
      <!-- Sidebar -->
      <aside class="more-sidebar glass-card">
        <div class="more-search">
          <mat-icon>search</mat-icon>
          <input class="more-search-input" placeholder="Поиск..."
                 [value]="searchQuery()"
                 (input)="searchQuery.set($any($event.target).value)" />
        </div>
        @for (cat of visibleCategories(); track cat.key) {
          <button class="sidebar-item"
                  [class.active]="activeCategory() === cat.key"
                  (click)="activeCategory.set(cat.key)">
            <mat-icon>{{ cat.icon }}</mat-icon>
            <span class="sidebar-label">{{ cat.label }}</span>
            <span class="sidebar-count">{{ cat.items.length }}</span>
          </button>
        }
      </aside>

      <!-- Content -->
      <div class="more-content">
        @if (searchQuery()) {
          <h2 class="more-content-title">Результаты: {{ filteredItems().length }}</h2>
          <div class="more-grid">
            @for (item of filteredItems(); track item.route) {
              <a [routerLink]="item.route" class="more-link" (click)="onCardClick(item)">
                <mat-card class="more-card">
                  <mat-icon class="more-icon"
                            [matBadge]="getBadge(item)" matBadgeSize="small"
                            matBadgeColor="warn" [matBadgeHidden]="!getBadge(item)">
                    {{ item.icon }}
                  </mat-icon>
                  <div class="more-label">{{ item.label }} @if (isNewFeature(item)) { <span class="new-badge">NEW</span> }</div>
                  <div class="more-desc">{{ item.description }}</div>
                </mat-card>
              </a>
            }
          </div>
        } @else {
          <h2 class="more-content-title">{{ activeCategoryLabel() }}</h2>
          <div class="more-grid">
            @for (item of activeCategoryItems(); track item.route) {
              <a [routerLink]="item.route" class="more-link" (click)="onCardClick(item)">
                <mat-card class="more-card">
                  <mat-icon class="more-icon"
                            [matBadge]="getBadge(item)" matBadgeSize="small"
                            matBadgeColor="warn" [matBadgeHidden]="!getBadge(item)">
                    {{ item.icon }}
                  </mat-icon>
                  <div class="more-label">{{ item.label }} @if (isNewFeature(item)) { <span class="new-badge">NEW</span> }</div>
                  <div class="more-desc">{{ item.description }}</div>
                </mat-card>
              </a>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }

    .glass-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
    }

    .more-layout {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 16px;
      padding: 16px;
      height: 100%;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    .more-sidebar {
      padding: 12px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .more-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: var(--crm-radius-md);
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--crm-glass-border);
      margin-bottom: 8px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-text-muted);
      }
    }

    .more-search-input {
      flex: 1;
      border: none;
      background: transparent;
      color: var(--crm-text-primary);
      font-size: 13px;
      outline: none;

      &::placeholder { color: var(--crm-text-muted); }
    }

    .sidebar-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border: none;
      border-radius: var(--crm-radius-md);
      background: transparent;
      color: var(--crm-text-secondary);
      font-size: 13px;
      cursor: pointer;
      transition: all 0.15s;
      text-align: left;
      width: 100%;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-text-muted);
        flex-shrink: 0;
      }

      &:hover {
        background: rgba(255, 255, 255, 0.04);
      }

      &.active {
        background: linear-gradient(135deg, rgba(245, 158, 11, 0.12), rgba(245, 158, 11, 0.04));
        color: var(--crm-accent);

        mat-icon { color: var(--crm-accent); }
        .sidebar-count { color: var(--crm-accent); }
      }
    }

    .sidebar-label { flex: 1; font-weight: 500; }

    .sidebar-count {
      font-size: 11px;
      color: var(--crm-text-muted);
      font-weight: 600;
    }

    /* ── Content ── */
    .more-content {
      overflow-y: auto;
      padding-right: 8px;
    }

    .more-content-title {
      font-size: 18px;
      font-weight: 600;
      margin: 0 0 16px;
      color: var(--crm-text-primary);
    }

    .more-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 12px;
    }

    .more-link { text-decoration: none; }

    .more-card {
      padding: 20px 16px;
      text-align: center;
      cursor: pointer;
      transition: transform 0.15s, box-shadow 0.15s;

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
      }
    }

    .more-icon {
      font-size: 32px;
      width: 32px;
      height: 32px;
      color: var(--crm-accent);
      margin-bottom: 8px;
    }

    .more-label {
      font-size: 14px;
      font-weight: 500;
      color: var(--crm-text-primary);
      margin-bottom: 4px;
    }

    .more-desc {
      font-size: 12px;
      color: var(--crm-text-secondary);
    }

    .new-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      background: #ff6b35;
      color: white;
      margin-left: 6px;
      vertical-align: middle;
      animation: newBadgePulse 2s ease-in-out infinite;
    }
    @keyframes newBadgePulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
  `],
})
export class MoreSectionComponent {
  private readonly inboxService = inject(InboxService);
  private readonly auth = inject(AuthService);
  private readonly delivery = inject(DeliveryOperatorService);

  readonly activeCategory = signal(CATEGORIES[0].key);
  readonly searchQuery = signal('');

  constructor() {
    // Подтянуть счётчик доставки для badge (SSR-safe). Скрывается, если у пользователя нет pos:use.
    afterNextRender(() => {
      if (this.auth.hasPermission('pos:use')) this.delivery.loadQueue();
    });
  }

  readonly visibleCategories = computed(() =>
    CATEGORIES.map(cat => ({
      ...cat,
      items: cat.items.filter(item => this.hasItemPermission(item)),
    })).filter(cat => cat.items.length > 0)
  );

  readonly activeCategoryLabel = computed(() => {
    const cats = this.visibleCategories();
    const active = cats.find(c => c.key === this.activeCategory());
    return active?.label || '';
  });

  readonly activeCategoryItems = computed(() => {
    const cats = this.visibleCategories();
    const active = cats.find(c => c.key === this.activeCategory());
    return active?.items || [];
  });

  readonly filteredItems = computed(() => {
    const q = this.searchQuery().toLowerCase().trim();
    if (!q) return [];
    const all = this.visibleCategories().flatMap(c => c.items);
    return all.filter(item =>
      item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    );
  });

  private readonly newFeatureRoutes: Record<string, string> = {
    '/employee/workflows': 'auto-reply',
  };

  readonly hiddenBadges = signal<readonly string[]>([]);

  getBadge(item: MoreItem): number {
    if (!item.badgeKey) return 0;
    if (item.badgeKey === 'delivery') return this.delivery.badgeCount();
    const counts = this.inboxService.counts();
    switch (item.badgeKey) {
      case 'booking':
        return counts.booking;
      case 'approval':
        return counts.approval;
      case 'order':
        return counts.order;
    }
  }

  isNewFeature(item: MoreItem): boolean {
    const key = this.newFeatureRoutes[item.route];
    if (!key) return false;
    if (this.hiddenBadges().includes(key)) return false;
    return isNewBadgeVisible(key);
  }

  onCardClick(item: MoreItem): void {
    const key = this.newFeatureRoutes[item.route];
    if (key && isNewBadgeVisible(key)) {
      markBadgeSeen(key);
      this.hiddenBadges.update(keys => (keys.includes(key) ? keys : [...keys, key]));
    }
  }

  private hasItemPermission(item: MoreItem): boolean {
    if (item.adminOnly && !this.auth.isAdmin()) return false;
    if (!item.permission) return true;
    if (typeof item.permission === 'string') return this.auth.hasPermission(item.permission);
    return item.permission.every(permission => this.auth.hasPermission(permission));
  }
}
