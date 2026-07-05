import {
  Component,
  inject,
  output,
  signal,
  computed,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { HttpClient } from '@angular/common/http';
import {
  SERVICE_CATEGORIES,
  SERVICE_PACKAGES,
  ServiceCategory,
  ServiceOption,
  SubscriptionPlan,
} from '../../data/services.data';
import { CartService } from '../../services/cart.service';
import { PricingApiService, PricingCategory } from '../../../../core/services/pricing-api.service';

// ── Slug → Material icon ──────────────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, string> = {
  'foto-na-documenty': 'badge',
  'pechat-foto':       'print',
  'retush-foto':       'auto_fix_high',
  'foto-na-zakaz':     'photo_camera',
};

function mapPricingCategory(cat: PricingCategory): ServiceCategory {
  const icon = cat.icon ?? CATEGORY_ICONS[cat.slug] ?? 'photo';
  const services: ServiceOption[] = cat.optionGroups.flatMap(group =>
    group.options.map(opt => ({
      id:          opt.id,
      name:        opt.name,
      description: opt.description ?? '',
      price:       opt.price_online ?? opt.base_price,
      priceMax:    opt.price_max ?? undefined,
      icon:        opt.icon ?? 'photo',
      popular:     opt.popular,
      oldPrice:    opt.original_price ?? undefined,
      features:    opt.features,
    }))
  );
  return {
    id:          cat.id,
    name:        cat.name,
    description: cat.description ?? '',
    icon,
    priceRange:  cat.price_range ?? 'от 250₽',
    services,
  };
}

// Re-export for parent component
export type { ServiceOption, SubscriptionPlan } from '../../data/services.data';

type ViewState = 
  | { type: 'categories' }
  | { type: 'category'; category: ServiceCategory };

@Component({
  selector: 'app-service-selector',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="service-selector">
      @switch (viewState().type) {
        @case ('categories') {
          <!-- Экран категорий -->
          <div class="categories-view">
            <div class="selector-hero">
              <h2>Онлайн-услуги</h2>
              <p>Работаем по всей России</p>
            </div>

            <div class="categories-grid">
              @for (category of categories(); track category.id) {
                <div
                  class="category-card"
                  (click)="openCategory(category)"
                  (keydown.enter)="openCategory(category)"
                  tabindex="0"
                >
                  <div class="card-icon-wrap">
                    <mat-icon>{{ category.icon }}</mat-icon>
                  </div>
                  <div class="card-body">
                    <h3>{{ category.name }}</h3>
                    <p>{{ category.description }}</p>
                    <div class="card-footer">
                      <span class="price-range">{{ category.priceRange }}</span>
                      <span class="card-cta">
                        Выбрать
                        <mat-icon>arrow_forward</mat-icon>
                      </span>
                    </div>
                  </div>
                </div>
              }
            </div>

            <!-- Пакеты под ключ -->
            <div class="packages-section">
              <h3>
                <mat-icon>local_offer</mat-icon>
                Пакеты под ключ
              </h3>
              <div class="packages-grid">
                @for (pkg of packages; track pkg.id) {
                  <div
                    class="package-card"
                    [class.popular]="pkg.popular"
                    (click)="orderService(pkg)"
                    (keydown.enter)="orderService(pkg)"
                    tabindex="0"
                  >
                    @if (pkg.popular) {
                      <div class="popular-badge">Выгодно</div>
                    }
                    <div class="package-icon">
                      <mat-icon>{{ pkg.icon }}</mat-icon>
                    </div>
                    <h4>{{ pkg.name }}</h4>
                    <p>{{ pkg.description }}</p>
                    <div class="package-price">
                      {{ pkg.price | number }}₽
                      @if (pkg.priceMax) {
                        <span>- {{ pkg.priceMax | number }}₽</span>
                      }
                    </div>
                    <div class="card-actions">
                      <button class="cart-btn" (click)="addToCart(pkg, $event)">
                        @if (cart.isInCart(pkg.id)) {
                          <mat-icon>check</mat-icon>
                          В корзине
                        } @else {
                          <mat-icon>add_shopping_cart</mat-icon>
                          В корзину
                        }
                      </button>
                      <button class="chat-btn" (click)="orderService(pkg, $event)">
                        <mat-icon>chat</mat-icon>
                      </button>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Подписки -->
            <div class="subscriptions-section">
              <div class="section-header">
                <h3>
                  <mat-icon>autorenew</mat-icon>
                  Подписки
                </h3>
                <p class="section-subtitle">Регулярный дизайн по выгодной цене, автоматическое продление</p>
              </div>

              <div class="subscriptions-grid">
                @for (plan of subscriptionPlans(); track plan.id) {
                  <div
                    class="subscription-card"
                    [class.popular]="plan.is_popular"
                  >
                    @if (plan.is_popular) {
                      <div class="popular-badge">Лучший выбор</div>
                    }
                    @if (plan.savings_label) {
                      <div class="savings-badge">{{ plan.savings_label }}</div>
                    }

                    <div class="sub-header">
                      <div class="sub-icon">
                        <mat-icon>{{ plan.icon }}</mat-icon>
                      </div>
                      <div class="sub-title">
                        <h4>{{ plan.name }}</h4>
                        <p>{{ plan.description }}</p>
                      </div>
                    </div>

                    <div class="sub-price">
                      <span class="amount">{{ plan.base_price | number }}₽</span>
                      <span class="period">/ мес</span>
                    </div>

                    <ul class="sub-features">
                      @for (feature of plan.features; track feature) {
                        <li>
                          <mat-icon>check_circle</mat-icon>
                          {{ feature }}
                        </li>
                      }
                    </ul>

                    <div class="sub-actions">
                      <button 
                        class="subscribe-btn"
                        [class.popular]="plan.is_popular"
                        (click)="subscribeToPlan(plan)"
                      >
                        <mat-icon>credit_card</mat-icon>
                        Подписаться
                      </button>
                      <button class="chat-btn" (click)="askAboutPlan(plan)" title="Узнать подробнее">
                        <mat-icon>chat</mat-icon>
                      </button>
                    </div>
                  </div>
                }
              </div>

              <div class="subscription-info">
                <mat-icon>info</mat-icon>
                <p>Подписку можно отменить в любой момент. Первый платёж, установочный, далее автосписание по графику.</p>
              </div>
            </div>
          </div>
        }

        @case ('category') {
          <!-- Экран категории -->
          <div class="category-view">
            <div class="view-header">
              <button class="back-btn" (click)="goBack()">
                <mat-icon>arrow_back</mat-icon>
              </button>
              <div class="header-info">
                <mat-icon>{{ currentCategory()!.icon }}</mat-icon>
                <h2>{{ currentCategory()!.name }}</h2>
              </div>
            </div>

            <div class="services-list">
              @for (service of currentCategory()!.services; track service.id) {
                <div
                  class="service-card"
                  [class.popular]="service.popular"
                  [class.has-image]="service.image"
                  [class.selected]="selectedService()?.id === service.id"
                  (click)="selectService(service)"
                  (keydown.enter)="selectService(service)"
                  tabindex="0"
                >
                  @if (service.popular) {
                    <div class="popular-badge">Хит</div>
                  }
                  
                  <!-- Изображение услуги (если есть) -->
                  @if (service.image) {
                    <div class="service-image">
                      <img [src]="service.image" [alt]="service.name" loading="lazy" />
                    </div>
                  }
                  
                  <!-- Контент -->
                  <div class="service-content">
                    <!-- Заголовок с иконкой и описанием -->
                    <div class="service-header">
                      @if (!service.image) {
                        <div class="service-icon">
                          <mat-icon>{{ service.icon }}</mat-icon>
                        </div>
                      }
                      <div class="service-info">
                        <h4>{{ service.name }}</h4>
                        <p>{{ service.description }}</p>
                      </div>
                    </div>
                    
                    <!-- Фичи -->
                    @if (service.features && service.features.length > 0) {
                      <ul class="service-features">
                        @for (feature of service.features; track feature) {
                          <li><mat-icon>check_circle</mat-icon> {{ feature }}</li>
                        }
                      </ul>
                    }
                    
                    <!-- Цена и кнопки -->
                    <div class="service-footer">
                      <div class="service-price">
                        @if (service.oldPrice) {
                          <span class="old-price">{{ service.oldPrice }}₽</span>
                        }
                        <span class="current-price">
                          {{ service.price | number }}₽
                          @if (service.priceMax) {
                            <span class="price-max">- {{ service.priceMax | number }}₽</span>
                          }
                        </span>
                      </div>
                      <div class="card-actions">
                        <button 
                          class="cart-btn" 
                          [class.in-cart]="cart.isInCart(service.id)"
                          (click)="addToCart(service, $event)"
                        >
                          @if (cart.isInCart(service.id)) {
                            <mat-icon>check</mat-icon>
                            В корзине
                          } @else {
                            <mat-icon>add_shopping_cart</mat-icon>
                            В корзину
                          }
                        </button>
                        <button class="chat-btn" (click)="orderService(service, $event)" title="Заказать через чат">
                          <mat-icon>chat</mat-icon>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>
        }
      }
    </div>
  `,
  styles: [`
    .service-selector {
      padding: 16px;
      padding-bottom: 100px; /* Для нижней навигации */
    }

    /* ============ Hero ============ */
    .selector-hero {
      text-align: center;
      padding: 20px 16px;
      margin-bottom: 20px;

      h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
      }

      p {
        margin: 8px 0 0;
        font-size: 0.9rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    /* ============ Categories Grid ============ */
    .categories-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;
    }

    .category-card {
      position: relative;
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 18px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 20px;
      cursor: pointer;
      transition: border-color 0.25s, transform 0.25s, box-shadow 0.25s;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        transform: translateY(-2px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);

        .card-cta {
          border-color: var(--ed-accent, #f59e0b);
          color: var(--ed-accent, #f59e0b);
        }
      }

      &:active {
        transform: scale(0.98);
      }
    }

    .card-icon-wrap {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: var(--ed-accent-container, #451a03);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
        color: var(--ed-accent, #f59e0b);
      }
    }

    .card-body {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;

      h3 {
        margin: 0;
        font-size: 1rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
        line-height: 1.3;
      }

      p {
        margin: 0;
        font-size: 0.85rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        line-height: 1.4;
      }
    }

    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 4px;
    }

    .price-range {
      display: inline-flex;
      align-items: center;
      padding: 4px 12px;
      background: var(--ed-accent-container, #451a03);
      border-radius: 100px;
      font-size: 0.85rem;
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
    }

    .card-cta {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 12px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 100px;
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition: border-color 0.25s, color 0.25s;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
      }
    }

    /* ============ Packages Section ============ */
    .packages-section {
      margin-top: 32px;

      h3 {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 0 16px;
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);

        mat-icon {
          color: var(--ed-accent, #f59e0b);
          font-size: 28px;
          width: 28px;
          height: 28px;
        }
      }
    }

    .packages-grid {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .package-card {
      position: relative;
      padding: 20px;
      background: var(--ed-accent-container, #451a03);
      border: 2px solid transparent;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.25s;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        transform: translateY(-2px);
      }

      &.popular {
        border-color: var(--ed-accent, #f59e0b);
      }
    }

    .package-card .popular-badge {
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
    }

    .package-icon {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: var(--ed-accent, #f59e0b);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 14px;

      mat-icon {
        color: var(--ed-on-accent, #0a0a0a);
        font-size: 26px;
        width: 26px;
        height: 26px;
      }
    }

    .package-card h4 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 700;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .package-card p {
      margin: 8px 0 12px;
      font-size: 0.95rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.5;
    }

    .package-price {
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
      margin-bottom: 14px;

      span {
        font-size: 1.1rem;
        font-weight: 600;
      }
    }

    /* ============ View Header ============ */
    .view-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 16px 20px;
      background: var(--ed-accent, #f59e0b);
      border-radius: 20px;
      margin-bottom: 20px;
      color: var(--ed-on-accent, #0a0a0a);
    }

    .back-btn {
      width: 44px;
      height: 44px;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.2);
      color: var(--ed-on-accent, #0a0a0a);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;

      &:hover {
        background: rgba(255, 255, 255, 0.3);
      }
    }

    .header-info {
      display: flex;
      align-items: center;
      gap: 12px;

      mat-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
      }

      h2 {
        margin: 0;
        font-size: 1.25rem;
        font-weight: 700;
      }
    }

    /* ============ Services List ============ */
    .services-list {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;

      @media (min-width: 600px) {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .service-card {
      position: relative;
      display: flex;
      flex-direction: column;
      background: var(--ed-surface-container, #1a1a1a);
      border: 2px solid transparent;
      border-radius: 20px;
      cursor: pointer;
      transition: all 0.25s;
      overflow: hidden;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
        transform: translateY(-2px);

        .service-image img {
          transform: scale(1.05);
        }
      }

      &.selected {
        border-color: var(--ed-accent, #f59e0b);
        background: var(--ed-accent-container, #451a03);
      }

      &.popular {
        border-color: var(--ed-accent, #f59e0b);
      }

      /* Карточка без изображения */
      &:not(.has-image) {
        padding: 18px;
        gap: 12px;
      }

      /* Карточка с изображением */
      &.has-image {
        .service-content {
          padding: 16px;
        }
      }
    }

    /* Изображение услуги */
    .service-image {
      position: relative;
      width: 100%;
      height: 140px;
      overflow: hidden;

      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transition: transform 0.4s ease;
      }
    }

    .service-content {
      display: flex;
      flex-direction: column;
      gap: 12px;
      flex: 1;
    }

    .popular-badge {
      position: absolute;
      top: 12px;
      right: 12px;
      padding: 4px 14px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 0.8rem;
      font-weight: 700;
      border-radius: 100px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      z-index: 2;
    }

    .service-card:not(.has-image) .popular-badge {
      top: -10px;
    }

    .service-header {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .service-icon {
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: var(--ed-accent, #f59e0b);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon {
        color: var(--ed-on-accent, #0a0a0a);
        font-size: 26px;
        width: 26px;
        height: 26px;
      }
    }

    .service-info {
      flex: 1;
      min-width: 0;

      h4 {
        margin: 0;
        font-size: 1.1rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
        line-height: 1.3;
      }

      p {
        margin: 6px 0 0;
        font-size: 0.95rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        line-height: 1.5;
      }
    }

    .service-features {
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;

      li {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 0.85rem;
        font-weight: 500;
        color: var(--ed-accent, #f59e0b);

        mat-icon {
          font-size: 16px;
          width: 16px;
          height: 16px;
        }
      }
    }

    .service-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 4px;
    }

    .service-price {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .old-price {
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-decoration: line-through;
    }

    .current-price {
      font-size: 1.4rem;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
    }

    .price-max {
      font-size: 1rem;
      font-weight: 600;
    }

    .card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .cart-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 12px 20px;
      border: none;
      border-radius: 100px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.25s;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      white-space: nowrap;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }

      &:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
      }

      &:active {
        transform: scale(0.97);
      }

      &.in-cart {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
      }
    }

    .chat-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 50%;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover {
        background: var(--ed-surface-container, #1a1a1a);
        border-color: var(--ed-accent, #f59e0b);
        color: var(--ed-accent, #f59e0b);
      }
    }

    /* ============ Subscriptions ============ */
    .subscriptions-section {
      margin-top: 40px;

      .section-header {
        text-align: center;
        margin-bottom: 24px;

        h3 {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          margin: 0;
          font-size: 1.3rem;
          font-weight: 700;
          color: var(--ed-on-surface, #f5f5f5);

          mat-icon {
            font-size: 28px;
            width: 28px;
            height: 28px;
            color: var(--ed-accent, #f59e0b);
          }
        }

        .section-subtitle {
          margin: 8px 0 0;
          font-size: 0.95rem;
          color: var(--ed-on-surface-variant, #a0a0a0);
        }
      }
    }

    .subscriptions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }

    .subscription-card {
      position: relative;
      background: var(--ed-surface-container, #1a1a1a);
      border: 2px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 20px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      transition: all 0.3s ease;

      &:hover {
        border-color: var(--ed-accent, #f59e0b);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
        transform: translateY(-4px);
      }

      &.popular {
        border-color: var(--ed-accent, #f59e0b);
        background: linear-gradient(
          135deg,
          var(--ed-surface-container, #1a1a1a) 0%,
          color-mix(in srgb, var(--ed-accent, #f59e0b) 8%, var(--ed-surface, #0a0a0a)) 100%
        );
      }

      .popular-badge {
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        padding: 4px 20px;
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
        font-size: 0.8rem;
        font-weight: 700;
        border-radius: 100px;
        white-space: nowrap;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .savings-badge {
        position: absolute;
        top: 14px;
        right: 14px;
        padding: 3px 12px;
        background: var(--ed-accent-container, #451a03);
        color: var(--ed-on-surface, #f5f5f5);
        font-size: 0.75rem;
        font-weight: 700;
        border-radius: 100px;
      }
    }

    .sub-header {
      display: flex;
      align-items: flex-start;
      gap: 14px;
    }

    .sub-icon {
      width: 52px;
      height: 52px;
      border-radius: 16px;
      background: var(--ed-accent-container, #451a03);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;

      mat-icon {
        font-size: 26px;
        width: 26px;
        height: 26px;
        color: var(--ed-on-accent, #0a0a0a);
      }
    }

    .sub-title {
      flex: 1;
      min-width: 0;

      h4 {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 700;
        color: var(--ed-on-surface, #f5f5f5);
      }

      p {
        margin: 4px 0 0;
        font-size: 0.88rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        line-height: 1.4;
      }
    }

    .sub-price {
      display: flex;
      align-items: baseline;
      gap: 6px;
      padding: 12px 0;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);

      .amount {
        font-size: 1.8rem;
        font-weight: 800;
        color: var(--ed-accent, #f59e0b);
        letter-spacing: -0.5px;
      }

      .period {
        font-size: 1rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        font-weight: 500;
      }
    }

    .sub-features {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
      flex: 1;

      li {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.9rem;
        color: var(--ed-on-surface, #f5f5f5);
        line-height: 1.4;

        mat-icon {
          font-size: 18px;
          width: 18px;
          height: 18px;
          color: var(--ed-accent, #f59e0b);
          flex-shrink: 0;
        }
      }
    }

    .sub-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-top: auto;
      padding-top: 8px;
    }

    .subscribe-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 12px 20px;
      border: none;
      border-radius: 14px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      &:hover {
        filter: brightness(1.1);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      }

      &:active {
        transform: scale(0.98);
      }
    }

    .subscription-info {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-top: 20px;
      padding: 16px;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 14px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--ed-on-surface-variant, #a0a0a0);
        flex-shrink: 0;
        margin-top: 2px;
      }

      p {
        margin: 0;
        font-size: 0.88rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        line-height: 1.5;
      }
    }

    @media (max-width: 600px) {
      .subscriptions-grid {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class ServiceSelectorComponent implements OnInit {
  protected readonly cart = inject(CartService);
  private readonly pricingApi = inject(PricingApiService);
  private readonly http = inject(HttpClient);

  serviceSelected = output<ServiceOption>();
  planSelected = output<SubscriptionPlan>();

  readonly categories = computed<ServiceCategory[]>(() => {
    const api = this.pricingApi.onlineCategories().map(mapPricingCategory);
    return api.length > 0 ? api : SERVICE_CATEGORIES;
  });

  readonly packages = SERVICE_PACKAGES;
  readonly subscriptionPlans = signal<SubscriptionPlan[]>([]);

  viewState = signal<ViewState>({ type: 'categories' });
  selectedService = signal<ServiceOption | null>(null);

  ngOnInit(): void {
    this.pricingApi.loadCategories();
    this.loadSubscriptionPlans();
  }

  private loadSubscriptionPlans(): void {
    this.http.get<{ success: boolean; plans: SubscriptionPlan[] }>('/api/subscriptions/plans?category=smm')
      .subscribe({
        next: (res) => this.subscriptionPlans.set(res.plans || []),
        error: () => { /* silently fail, plans section won't show */ },
      });
  }

  currentCategory = () => {
    const state = this.viewState();
    if (state.type === 'category') {
      return state.category;
    }
    return null;
  };

  openCategory(category: ServiceCategory): void {
    this.viewState.set({ type: 'category', category });
  }

  goBack(): void {
    this.viewState.set({ type: 'categories' });
  }

  selectService(service: ServiceOption): void {
    this.selectedService.set(service);
  }

  /** Добавить в корзину */
  addToCart(service: ServiceOption, event?: Event): void {
    event?.stopPropagation();
    if (this.cart.isInCart(service.id)) {
      this.cart.removeItem(service.id);
    } else {
      this.cart.addItem(service);
    }
  }

  /** Заказать через чат (legacy) */
  orderService(service: ServiceOption, event?: Event): void {
    event?.stopPropagation();
    this.selectedService.set(service);
    this.serviceSelected.emit(service);
  }

  /** Подписаться на план */
  subscribeToPlan(plan: SubscriptionPlan): void {
    this.planSelected.emit(plan);
  }

  /** Спросить о подписке в чате */
  askAboutPlan(plan: SubscriptionPlan): void {
    const msg = `Здравствуйте! Хочу узнать подробнее о подписке «${plan.name}» за ${plan.base_price.toLocaleString('ru-RU')}₽/мес`;
    this.serviceSelected.emit({
      id: plan.id,
      name: plan.name,
      description: msg,
      price: plan.base_price,
      icon: plan.icon,
    });
  }
}
