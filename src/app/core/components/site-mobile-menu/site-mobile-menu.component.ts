import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../../services/auth.service';

type SiteAudienceId = 'personal' | 'business' | 'study';

interface SiteMenuLink {
  readonly label: string;
  readonly href: string;
  readonly icon: string;
  readonly description?: string;
}

interface SiteMenuSection {
  readonly title: string;
  readonly links: readonly SiteMenuLink[];
}

interface SiteAudience {
  readonly id: SiteAudienceId;
  readonly label: string;
  readonly title: string;
  readonly sections: readonly SiteMenuSection[];
  readonly quickLinks: readonly SiteMenuLink[];
}

const STUDY_SITE_AUDIENCE: SiteAudience = {
  id: 'study',
  label: 'Для учёбы',
  title: 'Учёба, печать и подтверждение статуса',
  sections: [
    {
      title: 'Образовательный доступ',
      links: [
        {
          label: 'Оформить доступ',
          href: '/education',
          icon: 'school',
          description: 'Спецусловия на печать А4 для студентов, педагогов и учебных организаций.',
        },
        {
          label: 'Мой образовательный доступ',
          href: '/user-profile/education',
          icon: 'verified_user',
          description: 'Проверка статуса, документы и оплата доступа в профиле.',
        },
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
          description: 'Курсовые, отчёты, методички и ВКР.',
        },
      ],
    },
    {
      title: 'Учёба и документы',
      links: [
        {
          label: 'Ксерокопия',
          href: '/kserokopiya',
          icon: 'content_copy',
          description: 'Копии зачёток, справок, заявлений и учебных материалов.',
        },
        {
          label: 'Сканирование',
          href: '/skanirovanie',
          icon: 'scanner',
          description: 'Оцифровка документов для загрузки и отправки.',
        },
        {
          label: 'Ламинирование',
          href: '/laminirovanie',
          icon: 'layers',
          description: 'Защита справок, карточек и важных листов.',
        },
        {
          label: 'Фото на студенческий',
          href: '/foto-na-studencheskiy',
          icon: 'badge',
          description: 'Фото для студенческого билета и пропуска.',
        },
      ],
    },
    {
      title: 'Фото для поступления',
      links: [
        {
          label: 'Фото на документы',
          href: '/foto-na-document',
          icon: 'portrait',
          description: 'Комплекты под требования вуза, колледжа или ведомства.',
        },
        {
          label: 'Фото на паспорт',
          href: '/foto-na-pasport',
          icon: 'assignment_ind',
        },
        {
          label: 'Фото на загранпаспорт',
          href: '/foto-na-zagran',
          icon: 'travel_explore',
        },
        {
          label: 'Фото на визу',
          href: '/foto-na-vizu',
          icon: 'language',
        },
      ],
    },
  ],
  quickLinks: [
    { label: 'А4 от 3 ₽', href: '/pechat-dokumentov', icon: 'print' },
    { label: 'Переплёт 10 ₽', href: '/pereplet-na-plastikovuyu-pruzhinu', icon: 'article' },
    { label: 'Статус', href: '/education', icon: 'verified_user' },
  ],
};

const SITE_AUDIENCE_MENU: readonly SiteAudience[] = [
  {
    id: 'personal',
    label: 'Для себя',
    title: 'Личный аккаунт, фото и печать',
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
            description: 'Паспорт, права, анкеты, справки и ведомственные форматы.',
          },
          {
            label: 'Фото на паспорт',
            href: '/foto-na-pasport',
            icon: 'assignment_ind',
          },
          {
            label: 'Фото на загранпаспорт',
            href: '/foto-na-zagran',
            icon: 'travel_explore',
          },
          {
            label: 'Фото на визу',
            href: '/foto-na-vizu',
            icon: 'language',
          },
          {
            label: 'Фото на документы онлайн',
            href: '/foto-na-documenty-online',
            icon: 'smartphone',
          },
        ],
      },
      {
        title: 'Печать и подарки',
        links: [
          {
            label: 'Печать фотографий',
            href: '/pechat-foto',
            icon: 'photo_library',
            description: 'Классические форматы, альбомы и семейный архив.',
          },
          {
            label: 'Печать на холсте',
            href: '/pechat-foto-na-holste',
            icon: 'image',
          },
          {
            label: 'Печать на кружках',
            href: '/pechat-na-kruzhkah',
            icon: 'local_cafe',
          },
          {
            label: 'Печать на футболках',
            href: '/pechat-na-futbolkah',
            icon: 'checkroom',
          },
          {
            label: 'Печать на подарках',
            href: '/pechat-na-podarki',
            icon: 'redeem',
          },
        ],
      },
      {
        title: 'Фотоархив и портрет',
        links: [
          {
            label: 'Реставрация фото',
            href: '/restavratsiya-foto',
            icon: 'auto_fix_high',
          },
          {
            label: 'Ретушь фото',
            href: '/retush',
            icon: 'brush',
          },
          {
            label: 'Портретная съёмка',
            href: '/portretnaya-sjomka',
            icon: 'photo_camera',
          },
          {
            label: 'Нейрофотосессия',
            href: '/neyrofotosessiya',
            icon: 'auto_awesome',
          },
        ],
      },
    ],
    quickLinks: [
      { label: 'Личный аккаунт', href: '/personal', icon: 'account_circle' },
      { label: 'Записаться', href: '/booking', icon: 'event_available' },
      { label: 'Контакты', href: '/contacts', icon: 'support_agent' },
    ],
  },
  {
    id: 'business',
    label: 'Для бизнеса',
    title: 'Бизнес-аккаунт, документы и печать',
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
          {
            label: 'Инфографика карточек',
            href: '/infografika-kartochek',
            icon: 'dashboard_customize',
          },
          {
            label: 'SMM-контент',
            href: '/smm-content',
            icon: 'campaign',
          },
          {
            label: 'Супер-пакет «Продающий»',
            href: '/super-paket-prodayushiy',
            icon: 'workspace_premium',
          },
        ],
      },
      {
        title: 'Команда и студии',
        links: [
          {
            label: 'Бизнес-портрет',
            href: '/portretnaya-sjomka',
            icon: 'groups',
            description: 'Портреты для сайта, резюме, бейджей и карточек сотрудников.',
          },
          {
            label: 'Визитки',
            href: '/vizitki',
            icon: 'contact_page',
          },
          {
            label: 'Печать документов',
            href: '/pechat-dokumentov',
            icon: 'print',
          },
          {
            label: 'Сканирование',
            href: '/skanirovanie',
            icon: 'scanner',
          },
          {
            label: 'Ламинирование',
            href: '/laminirovanie',
            icon: 'layers',
          },
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
          {
            label: 'Партнёрам',
            href: '/partners',
            icon: 'handshake',
          },
          {
            label: 'Записать команду',
            href: '/booking',
            icon: 'event_available',
          },
          {
            label: 'Связаться',
            href: '/contacts',
            icon: 'support_agent',
          },
        ],
      },
    ],
    quickLinks: [
      { label: 'Бизнес-аккаунт', href: '/business', icon: 'business_center' },
      { label: 'Контакты', href: '/contacts', icon: 'place' },
      { label: 'Партнёрам', href: '/partners', icon: 'handshake' },
    ],
  },
  STUDY_SITE_AUDIENCE,
] as const;

const BUSINESS_ROUTES = new Set([
  '/business',
  '/b2b',
  '/biznes',
  '/tovarnaya-sjomka',
  '/infografika-kartochek',
  '/smm-content',
  '/super-paket-prodayushiy',
  '/vizitki',
  '/partners',
]);

const STUDY_ROUTES = new Set([
  '/education',
  '/students',
  '/studentam',
  '/user-profile/education',
  '/pereplet-na-plastikovuyu-pruzhinu',
  '/foto-na-studencheskiy',
]);

@Component({
  selector: 'app-site-mobile-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatExpansionModule,
    MatIconModule,
    RouterLink,
  ],
  templateUrl: './site-mobile-menu.component.html',
  styleUrl: './site-mobile-menu.component.scss',
})
export class SiteMobileMenuComponent {
  readonly open = input(false);
  readonly defaultAudienceId = input<SiteAudienceId | null>(null);
  readonly closed = output<void>();

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly siteAudienceMenu = SITE_AUDIENCE_MENU;
  protected readonly activeAudienceId = signal<SiteAudienceId>('personal');
  protected readonly activeAudience = computed(() =>
    this.siteAudienceMenu.find((audience) => audience.id === this.activeAudienceId())
      ?? this.siteAudienceMenu[0],
  );
  protected readonly isLoggedIn = computed(() => this.authService.isAuthenticated());
  protected readonly loginQueryParams = computed(() => ({
    returnUrl: this.router.url || '/',
  }));
  constructor() {
    effect(() => {
      if (this.open()) {
        this.activeAudienceId.set(this.defaultAudienceId() ?? this.audienceFromUrl(this.router.url));
      }
    });

    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => {
        if (!this.open()) {
          this.activeAudienceId.set(this.defaultAudienceId() ?? this.audienceFromUrl(event.urlAfterRedirects));
        }
      });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected selectAudience(id: SiteAudienceId): void {
    this.activeAudienceId.set(id);
  }

  private audienceFromUrl(url: string): SiteAudienceId {
    const path = (url || '/').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    if (STUDY_ROUTES.has(path)) {
      return 'study';
    }
    if (BUSINESS_ROUTES.has(path)) {
      return 'business';
    }

    return 'personal';
  }
}
