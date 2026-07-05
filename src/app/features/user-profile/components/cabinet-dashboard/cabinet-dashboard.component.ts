import { ChangeDetectionStrategy, Component, OnInit, PLATFORM_ID, computed, inject } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { AuthService } from '../../../../core/services/auth.service';
import { PhotoApiService } from '../../../../core/services/photo-api.service';
import { ProfileDashboardService } from '../../../../core/services/profile-dashboard.service';
import { SubscriptionService } from '../../../../core/services/subscription.service';
import { OrderStatus, OrderType } from '../../../../core/models/order-history.model';
import { CabinetCatalogService, type CabinetCatalogItem } from '../../services/cabinet-catalog.service';

interface CabinetAction {
  label: string;
  icon: string;
  route: string;
  hint: string;
}

interface CabinetTask {
  title: string;
  description: string;
  icon: string;
  route: string;
  tone: 'red' | 'blue' | 'green' | 'violet';
}

interface CabinetPromo {
  title: string;
  description: string;
  image: string | null;
  route: string;
  tone: 'blue' | 'violet' | 'mint';
}

interface CabinetService {
  title: string;
  description: string;
  icon: string;
  route: string;
  badge?: string;
}

@Component({
  selector: 'app-cabinet-dashboard',
  imports: [
    CurrencyPipe,
    DatePipe,
    DecimalPipe,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './cabinet-dashboard.component.html',
  styleUrl: './cabinet-dashboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CabinetDashboardComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly authService = inject(AuthService);
  private readonly dashboardService = inject(ProfileDashboardService);
  private readonly subscriptionService = inject(SubscriptionService);
  private readonly photoApiService = inject(PhotoApiService);
  private readonly catalog = inject(CabinetCatalogService);

  protected readonly loading = this.dashboardService.loading;
  protected readonly dashboardData = this.dashboardService.dashboardData;
  protected readonly loyaltySummary = this.dashboardService.loyaltySummary;
  protected readonly photoSessions = this.photoApiService.photoSessions;
  protected readonly user = this.authService.currentUser;

  protected readonly displayName = computed(() => {
    const user = this.user();
    return user?.displayName || user?.display_name || user?.email || 'Клиент';
  });

  protected readonly recentOrders = computed(() => this.dashboardData()?.recentOrders ?? []);
  protected readonly upcomingBookings = computed(() => this.dashboardData()?.upcomingBookings ?? []);
  protected readonly recentSessions = computed(() => this.photoSessions().slice(0, 5));
  protected readonly pointsBalance = computed(() => this.loyaltySummary()?.points ?? 0);
  protected readonly pointsAsRubles = computed(() => this.loyaltySummary()?.pointsAsRubles ?? 0);
  protected readonly totalOrders = computed(() => this.dashboardData()?.loyaltyProfile?.totalOrders ?? 0);
  protected readonly totalSpent = computed(() => this.dashboardData()?.loyaltyProfile?.totalSpent ?? 0);
  protected readonly canClaimDaily = computed(() => this.loyaltySummary()?.canClaimDaily ?? false);
  protected readonly promos = computed(() => this.catalog.featuredItems().slice(0, 3).map((item, index) => ({
    title: item.title,
    description: item.description,
    image: item.imageUrl,
    route: item.route,
    tone: PROMO_TONES[index % PROMO_TONES.length] ?? 'blue',
  })));
  protected readonly serviceHighlights = computed(() => this.catalog.items().slice(0, 4).map(toCabinetService));

  protected readonly quickActions: CabinetAction[] = [
    { label: 'Чат', icon: 'chat_bubble', route: '/chat', hint: 'Поддержка и онлайн-заказы' },
    { label: 'Новый заказ', icon: 'add_circle', route: '/services', hint: 'Документы, печать, ретушь' },
    { label: 'Мои фото', icon: 'photo_library', route: '/user-profile/my-photos', hint: 'Сессии и готовые файлы' },
    { label: 'Записаться', icon: 'event_available', route: '/booking', hint: 'Выберите дату съёмки' },
    { label: 'Пакеты печати', icon: 'inventory_2', route: '/user-profile/subscription', hint: 'Скидка на конкретный объём' },
    { label: 'История', icon: 'history', route: '/user-profile/orders', hint: 'Заказы и оплаты' },
  ];

  protected readonly taskCards: CabinetTask[] = [
    {
      title: 'Проверить готовые фото',
      description: 'Откройте последние съёмки и скачайте файлы.',
      icon: 'collections',
      route: '/user-profile/my-photos',
      tone: 'blue',
    },
    {
      title: 'Оформить печать',
      description: 'Фото, документы, визитки и копии.',
      icon: 'print',
      route: '/pechat-foto',
      tone: 'red',
    },
    {
      title: 'Выбрать пакет печати',
      description: 'Отдельная скидка на выбранный объём документов или фото.',
      icon: 'inventory_2',
      route: '/user-profile/subscription',
      tone: 'violet',
    },
    {
      title: 'Выгодно',
      description: 'Личный, бизнес и образовательный доступ: цены после оплаты.',
      icon: 'percent',
      route: '/user-profile/education',
      tone: 'green',
    },
  ];

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    this.subscriptionService.ensureLoaded();
    this.dashboardService.loadDashboard();

    const userId = this.authService.getCurrentUser()?.id;
    if (userId) {
      this.photoApiService.getClientPhotoSessions(userId).subscribe({
        error: () => undefined,
      });
    }
  }

  protected getOrderTypeLabel(type: OrderType): string {
    const labels: Record<OrderType, string> = {
      [OrderType.DOCUMENT_PHOTO]: 'Фото на документы',
      [OrderType.PHOTO_SESSION]: 'Фотосессия',
      [OrderType.PHOTO_RESTORATION]: 'Реставрация',
      [OrderType.PHOTO_PRINTING]: 'Печать фото',
      [OrderType.PHOTO_EDITING]: 'Ретушь',
      [OrderType.PHOTO_PRODUCTS]: 'Фотопродукция',
      [OrderType.FRAMING]: 'Багет',
    };
    return labels[type] ?? 'Заказ';
  }

  protected getOrderTypeIcon(type: OrderType): string {
    const icons: Record<OrderType, string> = {
      [OrderType.DOCUMENT_PHOTO]: 'badge',
      [OrderType.PHOTO_SESSION]: 'photo_camera',
      [OrderType.PHOTO_RESTORATION]: 'auto_fix_high',
      [OrderType.PHOTO_PRINTING]: 'print',
      [OrderType.PHOTO_EDITING]: 'tune',
      [OrderType.PHOTO_PRODUCTS]: 'inventory_2',
      [OrderType.FRAMING]: 'crop_square',
    };
    return icons[type] ?? 'receipt_long';
  }

  protected getStatusLabel(status: OrderStatus | string): string {
    const labels: Record<string, string> = {
      new: 'Новый',
      processing: 'В работе',
      waiting: 'На согласовании',
      ready: 'Готов',
      completed: 'Завершён',
      cancelled: 'Отменён',
      refunded: 'Возврат',
    };
    return labels[status] ?? String(status);
  }
}

const PROMO_TONES: CabinetPromo['tone'][] = ['blue', 'violet', 'mint'];

function toCabinetService(item: CabinetCatalogItem): CabinetService {
  return {
    title: item.title,
    description: item.description,
    icon: item.icon,
    route: item.route,
    badge: item.badge ?? undefined,
  };
}
