import { Component, signal, inject, afterNextRender, PLATFORM_ID, ChangeDetectionStrategy, NgZone, computed } from '@angular/core';
import { isPlatformBrowser, DOCUMENT } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

type DesktopAudienceId = 'personal' | 'study' | 'business';

interface NavLink {
  readonly label: string;
  readonly href: string;
  readonly optional?: boolean;
}

interface SearchQuickLink {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
}

interface DesktopAudienceLink {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
  readonly description?: string;
}

interface DesktopAudienceSection {
  readonly title: string;
  readonly links: readonly DesktopAudienceLink[];
}

interface DesktopAudience {
  readonly id: DesktopAudienceId;
  readonly label: string;
  readonly href: string;
  readonly title: string;
  readonly description: string;
  readonly sections: readonly DesktopAudienceSection[];
  readonly quickLinks: readonly DesktopAudienceLink[];
}

const DESKTOP_AUDIENCE_MENU: readonly DesktopAudience[] = [
  {
    id: 'personal',
    label: 'Для себя',
    href: '/personal',
    title: 'Личный аккаунт, фото и печать',
    description: 'Фото, документы, подарки, заказы, подписка и бонусы в одном профиле.',
    sections: [
      {
        title: 'Фото и документы',
        links: [
          {
            label: 'Личный аккаунт',
            href: '/personal',
            icon: 'account_circle',
            description: 'Заказы, статусы, подписка, бонусы и фото в одном профиле.',
          },
          {
            label: 'Фото на документы',
            href: '/foto-na-document',
            icon: 'portrait',
            description: 'Паспорт, виза, права, анкеты и ведомственные форматы.',
          },
          { label: 'Фото на паспорт', href: '/foto-na-pasport', icon: 'assignment_ind' },
          { label: 'Фото на загранпаспорт', href: '/foto-na-zagran', icon: 'travel_explore' },
          { label: 'Фото на визу', href: '/foto-na-vizu', icon: 'language' },
          { label: 'Фото онлайн', href: '/foto-na-documenty-online', icon: 'smartphone' },
        ],
      },
      {
        title: 'Печать и подарки',
        links: [
          {
            label: 'Печать фотографий',
            href: '/pechat-foto',
            icon: 'photo_library',
            description: 'Семейные фото, альбомы, архив и классические форматы.',
          },
          { label: 'Печать документов', href: '/pechat-dokumentov', icon: 'print' },
          { label: 'Печать на холсте', href: '/pechat-foto-na-holste', icon: 'image' },
          { label: 'Печать на кружках', href: '/pechat-na-kruzhkah', icon: 'local_cafe' },
          { label: 'Печать на подарках', href: '/pechat-na-podarki', icon: 'redeem' },
        ],
      },
      {
        title: 'Фотоархив и портрет',
        links: [
          { label: 'Ретушь фото', href: '/retush', icon: 'brush' },
          { label: 'Реставрация фото', href: '/restavratsiya-foto', icon: 'auto_fix_high' },
          { label: 'Портретная съёмка', href: '/portretnaya-sjomka', icon: 'photo_camera' },
          { label: 'Нейрофотосессия', href: '/neyrofotosessiya', icon: 'auto_awesome' },
        ],
      },
    ],
    quickLinks: [
      { label: 'Личный аккаунт', href: '/personal', icon: 'account_circle' },
      { label: 'Записаться', href: '/booking', icon: 'event_available' },
      { label: 'Все услуги', href: '/services', icon: 'apps' },
    ],
  },
  {
    id: 'study',
    label: 'Для учёбы',
    href: '/education',
    title: 'Учёба, печать и документы',
    description: 'Спецусловия доступны после подтверждения образовательного статуса.',
    sections: [
      {
        title: 'Образовательный доступ',
        links: [
          {
            label: 'Оформить доступ',
            href: '/education',
            icon: 'school',
            description: 'Для студентов, педагогов и учебных организаций.',
          },
          { label: 'Мой доступ', href: '/user-profile/education', icon: 'verified_user' },
          { label: 'Подписка на A4', href: '/user-profile/subscription', icon: 'description' },
        ],
      },
      {
        title: 'Учебные материалы',
        links: [
          {
            label: 'Печать документов',
            href: '/pechat-dokumentov',
            icon: 'print',
            description: 'Рефераты, заявления, методички и рабочие материалы.',
          },
          {
            label: 'Переплёт на пружину',
            href: '/pereplet-na-plastikovuyu-pruzhinu',
            icon: 'article',
            description: 'Курсовые, отчёты, методички и ВКР на пластиковой пружине.',
          },
          { label: 'Ксерокопия', href: '/kserokopiya', icon: 'content_copy' },
          { label: 'Сканирование', href: '/skanirovanie', icon: 'scanner' },
          { label: 'Ламинирование', href: '/laminirovanie', icon: 'layers' },
        ],
      },
      {
        title: 'Поступление и анкеты',
        links: [
          { label: 'Фото на студенческий', href: '/foto-na-studencheskiy', icon: 'badge' },
          { label: 'Фото на документы', href: '/foto-na-document', icon: 'portrait' },
          { label: 'Фото онлайн', href: '/foto-na-documenty-online', icon: 'smartphone' },
          { label: 'Ретушь онлайн', href: '/retush', icon: 'brush' },
        ],
      },
    ],
    quickLinks: [
      { label: 'Подтвердить статус', href: '/education', icon: 'school' },
      { label: 'Печать документов', href: '/pechat-dokumentov', icon: 'print' },
      { label: 'Переплёт 10 ₽', href: '/pereplet-na-plastikovuyu-pruzhinu', icon: 'article' },
      { label: 'Записаться', href: '/booking', icon: 'event_available' },
    ],
  },
  {
    id: 'business',
    label: 'Для бизнеса',
    href: '/business',
    title: 'Бизнес-аккаунт, документы и печать',
    description: 'Регулярная печать, сотрудники, счета, закрывающие документы и ЭДО.',
    sections: [
      {
        title: 'Контент для продаж',
        links: [
          {
            label: 'Товарная съёмка',
            href: '/tovarnaya-sjomka',
            icon: 'inventory_2',
            description: 'Фото товаров для сайта, маркетплейсов и каталогов.',
          },
          { label: 'Инфографика карточек', href: '/infografika-kartochek', icon: 'dashboard_customize' },
          { label: 'SMM-контент', href: '/smm-content', icon: 'campaign' },
          { label: 'Супер-пакет', href: '/super-paket-prodayushiy', icon: 'workspace_premium' },
        ],
      },
      {
        title: 'Команда и документы',
        links: [
          {
            label: 'Бизнес-портрет',
            href: '/biznes-portret',
            icon: 'groups',
            description: 'Портреты для сайта, резюме, бейджей и карточек сотрудников.',
          },
          { label: 'Визитки', href: '/vizitki', icon: 'contact_page' },
          { label: 'Печать документов', href: '/pechat-dokumentov', icon: 'print' },
          { label: 'Сканирование', href: '/skanirovanie', icon: 'scanner' },
          { label: 'Ламинирование', href: '/laminirovanie', icon: 'layers' },
        ],
      },
      {
        title: 'Работа с нами',
        links: [
          {
            label: 'Бизнес-аккаунт',
            href: '/business',
            icon: 'business_center',
            description: 'Ранний доступ к B2B-контуру для юрлиц и ИП.',
          },
          { label: 'Партнёрам', href: '/partners', icon: 'handshake' },
          { label: 'Записать команду', href: '/booking', icon: 'event_available' },
          { label: 'Связаться', href: '/contacts', icon: 'support_agent' },
        ],
      },
    ],
    quickLinks: [
      { label: 'Бизнес-аккаунт', href: '/business', icon: 'business_center' },
      { label: 'Партнёрам', href: '/partners', icon: 'handshake' },
      { label: 'Контакты', href: '/contacts', icon: 'place' },
    ],
  },
] as const;

@Component({
  selector: 'app-desktop-nav',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    RouterLinkActive,
    MatIconModule,
  ],
  host: {
    'class': 'desktop-nav-host',
    '[class.scrolled]': 'scrolled()',
  },
  template: `
    <nav class="topbar" aria-label="Основная навигация">
      <a routerLink="/" class="topbar-logo" aria-label="Своё Фото">
        <img class="topbar-logo__image" src="/assets/static/logo-white.webp" width="140" height="44" alt="Своё Фото">
      </a>

      <div class="topbar-links">
        <div
          class="topbar-audience-trigger"
          [class.menu-open]="audienceMenuOpen()"
          (mouseenter)="openAudienceMenu()"
          (mouseleave)="onAudienceLeave()"
        >
          @for (audience of audienceMenu; track audience.id) {
            <a
              [routerLink]="audience.href"
              class="topbar-link topbar-link--audience"
              [class.is-current]="audienceMenuOpen() && activeAudienceId() === audience.id"
              (mouseenter)="activateAudience(audience.id)"
              (focus)="openAudienceMenu(audience.id)"
              (click)="closeSearch()"
            >
              {{ audience.label }}
            </a>
          }

          <section
            class="audience-mega-menu"
            aria-label="Навигация по разделам"
            (mouseenter)="onMegaEnter()"
            (mouseleave)="onMegaLeave()"
          >
            <div class="audience-mega-menu__inner">
              <div class="audience-rail" aria-label="Разделы клиентов">
                @for (audience of audienceMenu; track audience.id) {
                  <a
                    [routerLink]="audience.href"
                    [class.is-active]="activeAudienceId() === audience.id"
                    (mouseenter)="activateAudience(audience.id)"
                    (focus)="activateAudience(audience.id)"
                    (click)="closeAudienceMenu()"
                  >
                    <span>{{ audience.label }}</span>
                    <small>{{ audience.description }}</small>
                  </a>
                }
              </div>

              <div class="audience-content">
                <div class="audience-content__head">
                  <div>
                    <h2>{{ activeAudience().title }}</h2>
                    <p>{{ activeAudience().description }}</p>
                  </div>
                  <div class="audience-quick-links">
                    @for (quickLink of activeAudience().quickLinks; track quickLink.href) {
                      <a [routerLink]="quickLink.href" (click)="closeAudienceMenu()">
                        <mat-icon>{{ quickLink.icon }}</mat-icon>
                        <span>{{ quickLink.label }}</span>
                      </a>
                    }
                  </div>
                </div>

                <div class="audience-columns">
                  @for (section of activeAudience().sections; track section.title) {
                    <div class="audience-column">
                      <h3>{{ section.title }}</h3>
                      <div class="audience-column__links">
                        @for (link of section.links; track link.href) {
                          <a [routerLink]="link.href" (click)="closeAudienceMenu()">
                            <mat-icon>{{ link.icon }}</mat-icon>
                            <span>
                              <strong>{{ link.label }}</strong>
                              @if (link.description) {
                                <small>{{ link.description }}</small>
                              }
                            </span>
                          </a>
                        }
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>
          </section>
        </div>

        @for (link of secondaryLinks; track link.href) {
          <a
            [routerLink]="link.href"
            routerLinkActive="active"
            class="topbar-link topbar-secondary-link"
            [class.topbar-secondary-link--optional]="link.optional"
            (click)="closeSearch()"
          >
            {{ link.label }}
          </a>
        }
      </div>

      <button
        type="button"
        class="topbar-search"
        [class.active]="searchOpen()"
        [attr.aria-expanded]="searchOpen()"
        aria-label="Поиск по услугам"
        (click)="toggleSearch()"
      >
        <mat-icon>{{ searchOpen() ? 'close' : 'search' }}</mat-icon>
      </button>

      <div class="topbar-actions">
        <a routerLink="/start-client" class="topbar-client">
          Стать клиентом
        </a>
        <a routerLink="/auth/login" [queryParams]="loginQueryParams" class="topbar-login">
          Войти
        </a>
      </div>
    </nav>

    @if (searchOpen()) {
      <button class="search-backdrop" type="button" aria-label="Закрыть поиск" (click)="closeSearch()"></button>
      <section class="search-panel" role="dialog" aria-modal="true" aria-label="Поиск по услугам">
        <div class="search-panel__inner">
          <div class="search-panel__title">
            <mat-icon>search</mat-icon>
            <span>Поиск по услугам</span>
          </div>
          <div class="search-panel__links">
            @for (link of searchLinks; track link.href) {
              <a [routerLink]="link.href" (click)="closeSearch()">
                <mat-icon>{{ link.icon }}</mat-icon>
                <span>{{ link.label }}</span>
              </a>
            }
          </div>
        </div>
      </section>
    }
  `,
  styles: [`
    :host {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 1050;
      height: 64px;
      background: #0b0b0d;
      color: #ffffff;
      box-shadow: 0 1px 0 rgb(255 255 255 / 8%);
    }

    @media (min-width: 600px) {
      :host {
        display: block;
      }
    }

    :host.scrolled {
      background: rgba(8, 8, 10, 0.98);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      box-shadow: 0 1px 0 rgb(255 255 255 / 10%), 0 16px 36px rgb(0 0 0 / 22%);
    }

    .topbar {
      display: flex;
      align-items: center;
      gap: 18px;
      width: min(100% - 48px, 1240px);
      height: 64px;
      margin: 0 auto;
    }

    .topbar-logo {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      color: #ffffff;
      text-decoration: none;
      white-space: nowrap;
      flex: 0 0 auto;
    }

    .topbar-logo__image {
      display: block;
      width: 140px;
      height: auto;
      max-height: 42px;
      flex: 0 0 auto;
      object-fit: contain;
    }

    .topbar-links {
      display: flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
      flex: 1;
    }

    .topbar-link {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-height: 42px;
      padding: 0 13px;
      border-radius: 999px;
      color: #d9d9dc;
      text-decoration: none;
      font-size: 14px;
      font-weight: 800;
      letter-spacing: 0;
      white-space: nowrap;
      transition:
        background-color 160ms ease,
        color 160ms ease;
    }

    .topbar-link:hover,
    .topbar-link.active,
    .topbar-link.is-current {
      background: #25252a;
      color: #ffffff;
    }

    .topbar-link.active::after {
      content: '';
      position: absolute;
      left: 16px;
      right: 16px;
      bottom: 3px;
      height: 2px;
      border-radius: 999px;
      background: #ef3124;
    }

    .topbar-audience-trigger {
      position: static;
      display: inline-flex;
      align-items: center;
    }

    .audience-mega-menu {
      position: fixed;
      top: 64px;
      left: 0;
      right: 0;
      z-index: 1060;
      max-height: calc(100dvh - 64px);
      overflow: auto;
      border-top: 1px solid #25252a;
      background: #0b0b0d;
      box-shadow: 0 34px 74px rgb(0 0 0 / 48%);
      opacity: 0;
      visibility: hidden;
      pointer-events: none;
      transform: translateY(8px);
      transition:
        opacity 180ms ease,
        transform 180ms ease,
        visibility 180ms ease;
    }

    .topbar-audience-trigger:hover .audience-mega-menu,
    .topbar-audience-trigger:focus-within .audience-mega-menu,
    .topbar-audience-trigger.menu-open .audience-mega-menu {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateY(0);
    }

    .audience-mega-menu__inner {
      display: grid;
      grid-template-columns: 230px minmax(0, 1fr);
      gap: 34px;
      width: min(100% - 48px, 1240px);
      margin: 0 auto;
      padding: 34px 0 42px;
    }

    .audience-rail {
      display: grid;
      align-content: start;
      gap: 6px;
      padding-right: 28px;
      border-right: 1px solid #2a2a30;
    }

    .audience-rail a {
      display: grid;
      gap: 6px;
      min-height: 70px;
      padding: 12px 14px;
      border-radius: 14px;
      color: #9b9ba2;
      text-decoration: none;
      transition:
        background-color 160ms ease,
        color 160ms ease;
    }

    .audience-rail a:hover,
    .audience-rail a.is-active {
      background: #18181c;
      color: #ffffff;
    }

    .audience-rail span {
      font-size: 16px;
      font-weight: 900;
      line-height: 1.15;
    }

    .audience-rail small {
      color: #85858d;
      font-size: 12px;
      line-height: 1.25;
    }

    .audience-content {
      min-width: 0;
    }

    .audience-content__head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(240px, 0.42fr);
      gap: 30px;
      align-items: start;
      margin-bottom: 30px;
    }

    .audience-content h2 {
      margin: 0;
      color: #ffffff;
      font-size: 30px;
      font-weight: 900;
      line-height: 1.08;
      letter-spacing: 0;
    }

    .audience-content p {
      max-width: 660px;
      margin: 10px 0 0;
      color: #a4a4ad;
      font-size: 15px;
      line-height: 1.42;
    }

    .audience-quick-links {
      display: grid;
      grid-template-columns: 1fr;
      gap: 8px;
    }

    .audience-quick-links a {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 0 12px;
      border-radius: 10px;
      background: #18181c;
      color: #ffffff;
      text-decoration: none;
      font-size: 14px;
      font-weight: 800;
    }

    .audience-quick-links a:hover {
      background: #24242a;
    }

    .audience-quick-links mat-icon {
      width: 20px;
      height: 20px;
      color: #ef3124;
      font-size: 20px;
      flex: 0 0 auto;
    }

    .audience-columns {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 34px;
    }

    .audience-column {
      min-width: 0;
    }

    .audience-column h3 {
      margin: 0 0 14px;
      color: #85858d;
      font-size: 13px;
      font-weight: 900;
      line-height: 1.2;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .audience-column__links {
      display: grid;
      gap: 6px;
    }

    .audience-column__links a {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      min-height: 42px;
      padding: 8px 0;
      color: #ffffff;
      text-decoration: none;
    }

    .audience-column__links a:hover strong {
      color: #ff4a40;
    }

    .audience-column__links mat-icon {
      width: 22px;
      height: 22px;
      color: #ef3124;
      font-size: 22px;
    }

    .audience-column__links span {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .audience-column__links strong {
      font-size: 15px;
      font-weight: 800;
      line-height: 1.22;
      transition: color 160ms ease;
    }

    .audience-column__links small {
      color: #9b9ba2;
      font-size: 12px;
      line-height: 1.3;
    }

    .topbar-search {
      display: grid;
      width: 42px;
      height: 42px;
      place-items: center;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #ffffff;
      cursor: pointer;
      flex: 0 0 auto;
      transition:
        background-color 160ms ease,
        color 160ms ease;
    }

    .topbar-search:hover,
    .topbar-search.active {
      background: #25252a;
      color: #ffffff;
    }

    .topbar-search mat-icon {
      width: 24px;
      height: 24px;
      font-size: 24px;
    }

    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: 0 0 auto;
    }

    .topbar-client,
    .topbar-login {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 0 22px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 900;
      line-height: 1;
      white-space: nowrap;
      transition:
        background-color 160ms ease,
        transform 100ms ease;
    }

    .topbar-client {
      background: #2a2a30;
      color: #ffffff;
    }

    .topbar-client:hover {
      background: #3a3a42;
    }

    .topbar-login {
      background: #ef3124;
      color: #ffffff;
    }

    .topbar-login:hover {
      background: #ff3b30;
    }

    .topbar-client:active,
    .topbar-login:active {
      transform: scale(0.98);
    }

    .search-backdrop {
      position: fixed;
      inset: 64px 0 0;
      z-index: 1040;
      border: 0;
      background: rgb(0 0 0 / 24%);
    }

    .search-panel {
      position: fixed;
      top: 64px;
      left: 0;
      right: 0;
      z-index: 1060;
      background: #0b0b0d;
      border-top: 1px solid #25252a;
      box-shadow: 0 28px 70px rgb(0 0 0 / 48%);
    }

    .search-panel__inner {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      gap: 38px;
      width: min(100% - 48px, 1240px);
      margin: 0 auto;
      padding: 30px 0 34px;
    }

    .search-panel__title {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #ffffff;
      font-size: 18px;
      font-weight: 900;
    }

    .search-panel__title mat-icon {
      color: #ef3124;
    }

    .search-panel__links {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .search-panel__links a {
      display: flex;
      align-items: center;
      gap: 12px;
      min-height: 58px;
      padding: 0 14px;
      border-radius: 10px;
      background: #151518;
      color: #ffffff;
      text-decoration: none;
      font-size: 14px;
      font-weight: 800;
    }

    .search-panel__links a:hover {
      background: #222228;
    }

    .search-panel__links mat-icon {
      color: #ef3124;
      flex: 0 0 auto;
    }

    @media (max-width: 1180px) {
      .topbar {
        gap: 10px;
        width: min(100% - 32px, 1240px);
      }

      .topbar-secondary-link--optional {
        display: none;
      }

      .topbar-logo__image {
        width: 124px;
        max-height: 38px;
      }

      .topbar-link {
        padding: 0 10px;
        font-size: 13px;
      }

      .topbar-client,
      .topbar-login {
        padding: 0 16px;
      }

      .audience-mega-menu__inner {
        grid-template-columns: 200px minmax(0, 1fr);
        gap: 24px;
      }

      .audience-content__head {
        grid-template-columns: 1fr;
      }

      .audience-quick-links {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .search-panel__links {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 900px) {
      .topbar-links {
        gap: 0;
      }

      .topbar-link {
        padding: 0 8px;
        font-size: 12px;
      }

      .topbar-client,
      .topbar-secondary-link {
        display: none;
      }

      .audience-mega-menu__inner {
        grid-template-columns: 1fr;
      }

      .audience-rail {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        padding-right: 0;
        padding-bottom: 18px;
        border-right: 0;
        border-bottom: 1px solid #2a2a30;
      }

      .audience-columns {
        grid-template-columns: 1fr;
        gap: 24px;
      }

      .search-panel__inner {
        grid-template-columns: 1fr;
        gap: 18px;
      }

      .search-panel__links {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
  `],
})
export class DesktopNavComponent {
  private platformId = inject(PLATFORM_ID);
  private document = inject(DOCUMENT);
  private ngZone = inject(NgZone);

  protected readonly scrolled = signal(false);
  protected readonly audienceMenuOpen = signal(false);
  protected readonly activeAudienceId = signal<DesktopAudienceId>('personal');
  protected readonly searchOpen = signal(false);

  protected readonly loginQueryParams = { returnUrl: '/user-profile' };
  protected readonly audienceMenu = DESKTOP_AUDIENCE_MENU;
  protected readonly activeAudience = computed(() =>
    this.audienceMenu.find((audience) => audience.id === this.activeAudienceId()) ?? this.audienceMenu[0],
  );
  protected readonly secondaryLinks: readonly NavLink[] = [
    { label: 'Фотографы', href: '/photographers' },
    { label: 'Отзывы', href: '/testimonials', optional: true },
    { label: 'Запись', href: '/booking' },
    { label: 'Контакты', href: '/contacts', optional: true },
  ];
  protected readonly searchLinks: readonly SearchQuickLink[] = [
    { label: 'Личный аккаунт', href: '/personal', icon: 'account_circle' },
    { label: 'Фото на документы', href: '/foto-na-document', icon: 'badge' },
    { label: 'Печать фотографий', href: '/pechat-foto', icon: 'photo_library' },
    { label: 'Печать документов', href: '/pechat-dokumentov', icon: 'print' },
    { label: 'Переплёт на пружину', href: '/pereplet-na-plastikovuyu-pruzhinu', icon: 'article' },
    { label: 'Образовательный доступ', href: '/education', icon: 'school' },
    { label: 'Бизнес-аккаунт', href: '/business', icon: 'business_center' },
    { label: 'Ретушь онлайн', href: '/retush', icon: 'brush' },
    { label: 'Печать на подарках', href: '/pechat-na-podarki', icon: 'redeem' },
    { label: 'Партнёрам', href: '/partners', icon: 'handshake' },
    { label: 'Контакты', href: '/contacts', icon: 'place' },
  ];

  private audienceLeaveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    afterNextRender(() => {
      if (isPlatformBrowser(this.platformId)) {
        this.ngZone.runOutsideAngular(() => {
          const scrollEl = this.document.querySelector('.mat-drawer-content') as HTMLElement | null;
          const target: EventTarget = scrollEl ?? this.document.defaultView!;
          target.addEventListener('scroll', () => {
            const scrollTop = scrollEl ? scrollEl.scrollTop : (this.document.defaultView?.scrollY ?? 0);
            const isScrolled = scrollTop > 20;
            if (this.scrolled() !== isScrolled) {
              this.ngZone.run(() => this.scrolled.set(isScrolled));
            }
          }, { passive: true });
        });
      }
    });
  }

  protected toggleSearch(): void {
    this.clearLeaveTimer();
    this.audienceMenuOpen.set(false);
    this.searchOpen.update((open) => !open);
  }

  protected closeSearch(): void {
    this.searchOpen.set(false);
  }

  protected openAudienceMenu(id?: DesktopAudienceId): void {
    this.closeSearch();
    this.clearLeaveTimer();
    if (id) {
      this.activeAudienceId.set(id);
    }
    this.audienceMenuOpen.set(true);
  }

  protected activateAudience(id: DesktopAudienceId): void {
    this.activeAudienceId.set(id);
  }

  protected onAudienceLeave(): void {
    this.scheduleClose();
  }

  protected onMegaEnter(): void {
    this.clearLeaveTimer();
  }

  protected onMegaLeave(): void {
    this.scheduleClose();
  }

  protected closeAudienceMenu(): void {
    this.clearLeaveTimer();
    this.audienceMenuOpen.set(false);
    this.closeSearch();
  }

  private scheduleClose(): void {
    this.clearLeaveTimer();
    this.audienceLeaveTimer = setTimeout(() => {
      this.audienceMenuOpen.set(false);
    }, 150);
  }

  private clearLeaveTimer(): void {
    if (this.audienceLeaveTimer) {
      clearTimeout(this.audienceLeaveTimer);
      this.audienceLeaveTimer = null;
    }
  }
}
