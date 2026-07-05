import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { AuthService } from '../../../../core/services/auth.service';

interface SettingsItem {
  title: string;
  description: string;
  icon: string;
  route: string;
  badge?: string;
  featured?: boolean;
  mobileHidden?: boolean;
}

interface SettingsGroup {
  title: string;
  items: SettingsItem[];
}

@Component({
  selector: 'app-cabinet-settings',
  imports: [RouterLink, MatIconModule],
  templateUrl: './cabinet-settings.component.html',
  styleUrl: './cabinet-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CabinetSettingsComponent {
  private readonly authService = inject(AuthService);

  protected readonly user = this.authService.currentUser;

  protected readonly displayName = computed(() => {
    const user = this.user();
    return user?.displayName || user?.display_name || user?.email || 'Клиент';
  });

  protected readonly roleLabel = computed(() => {
    const role = this.user()?.role;
    const labels: Record<string, string> = {
      admin: 'Администратор',
      manager: 'Менеджер',
      employee: 'Сотрудник',
      photographer: 'Фотограф',
      client: 'Клиент',
    };
    return role ? labels[role] ?? role : 'Клиент';
  });

  protected readonly primaryItems: SettingsItem[] = [
    {
      title: 'Личные данные',
      description: 'Имя, контакты и фотография профиля',
      icon: 'person',
      route: '/user-profile/account/edit',
      mobileHidden: true,
    },
    {
      title: 'Пакеты печати',
      description: 'Объёмные скидки отдельно от типа аккаунта',
      icon: 'inventory_2',
      route: '/user-profile/subscription',
      featured: true,
    },
    {
      title: 'Выгодно',
      description: 'Личный, бизнес и образовательный доступ',
      icon: 'percent',
      route: '/user-profile/education',
    },
    {
      title: 'Способы связи',
      description: 'Телефон, мессенджеры и уведомления',
      icon: 'notifications',
      route: '/user-profile/account/edit',
    },
  ];

  protected readonly groups: SettingsGroup[] = [
    {
      title: 'Мой профиль',
      items: [
        {
          title: 'Карточка клиента',
          description: 'Контакты, адрес доставки и предпочтения',
          icon: 'business',
          route: '/user-profile/account/edit',
        },
        {
          title: 'Семья и доступ',
          description: 'Кто может выбирать и получать фото',
          icon: 'groups',
          route: '/user-profile/account/edit',
        },
        {
          title: 'Согласование фото',
          description: 'Правила выбора и подтверждения фото',
          icon: 'fact_check',
          route: '/user-profile/approvals',
        },
        {
          title: 'Получатели заказов',
          description: 'Кто может забрать печать и документы',
          icon: 'assignment_ind',
          route: '/user-profile/account/edit',
        },
        {
          title: 'Чеки и файлы',
          description: 'Квитанции, чеки и готовые материалы',
          icon: 'folder_copy',
          route: '/user-profile/orders',
        },
      ],
    },
    {
      title: 'Настройки',
      items: [
        {
          title: 'Безопасность',
          description: 'История входов и активные сеансы',
          icon: 'lock',
          route: '/user-profile/account/edit',
        },
        {
          title: 'Уведомления',
          description: 'Статусы заказов и сообщения студии',
          icon: 'campaign',
          route: '/user-profile/account/edit',
        },
        {
          title: 'Заявления',
          description: 'Запросы по заказам и оплатам',
          icon: 'article',
          route: '/user-profile/orders',
        },
        {
          title: 'Личный режим',
          description: 'Личные заказы и настройки профиля',
          icon: 'account_circle',
          route: '/user-profile',
        },
      ],
    },
    {
      title: 'Дополнительно',
      items: [
        {
          title: 'Наши студии',
          description: 'Адреса студий и как добраться',
          icon: 'storefront',
          route: '/user-profile/photo-locations',
        },
        {
          title: 'Помощь',
          description: 'Чат со студией и ответы на вопросы',
          icon: 'help',
          route: '/chat',
        },
      ],
    },
  ];
}
