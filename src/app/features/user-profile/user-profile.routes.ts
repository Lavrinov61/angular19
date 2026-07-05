import { Routes } from '@angular/router';

export const USER_PROFILE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/profile-shell/profile-shell.component').then(
        c => c.ProfileShellComponent
      ),
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./components/cabinet-dashboard/cabinet-dashboard.component').then(
            c => c.CabinetDashboardComponent
          ),
        title: 'Личный кабинет - Своё Фото',
      },
      {
        path: 'services',
        loadComponent: () =>
          import('./components/cabinet-services/cabinet-services.component').then(
            c => c.CabinetServicesComponent
          ),
        title: 'Сервисы - Своё Фото',
      },
      {
        path: 'account/edit',
        loadComponent: () =>
          import('./components/account-center/account-center.component').then(
            c => c.AccountCenterComponent
          ),
        title: 'Редактирование профиля - Своё Фото',
      },
      {
        path: 'account',
        loadComponent: () =>
          import('./components/cabinet-settings/cabinet-settings.component').then(
            c => c.CabinetSettingsComponent
          ),
        title: 'Аккаунт - Своё Фото',
      },
      // Redirects to account (consolidated pages)
      { path: 'settings', redirectTo: 'account', pathMatch: 'full' },
      { path: 'notifications', redirectTo: 'account', pathMatch: 'full' },
      { path: 'notification-settings', redirectTo: 'account', pathMatch: 'full' },
      { path: 'channels', redirectTo: 'account', pathMatch: 'full' },
      {
        path: 'bookings',
        loadComponent: () =>
          import('./components/user-bookings/user-bookings.component').then(
            c => c.UserBookingsComponent
          ),
        title: 'Мои записи - Своё Фото',
      },
      {
        path: 'orders',
        loadComponent: () =>
          import('./components/cabinet-history/cabinet-history.component').then(
            c => c.CabinetHistoryComponent
          ),
        title: 'Заказы - Своё Фото',
      },
      // Redirect old path
      { path: 'order-history', redirectTo: 'orders', pathMatch: 'full' },
      {
        path: 'orders/:id',
        loadComponent: () =>
          import('./components/order-details/order-details.component').then(
            c => c.OrderDetailsComponent
          ),
        title: 'Детали заказа - Своё Фото',
      },
      {
        path: 'loyalty',
        loadComponent: () =>
          import('./components/loyalty-redesign/loyalty-redesign.component').then(
            c => c.LoyaltyRedesignComponent
          ),
        title: 'Бонусная программа - Своё Фото',
      },
      {
        path: 'subscription',
        loadComponent: () =>
          import('./components/subscription-manager/subscription-manager.component').then(
            c => c.SubscriptionManagerComponent
          ),
        title: 'Выгодно - Своё Фото',
      },
      {
        path: 'education',
        loadComponent: () =>
          import('./components/student-account/student-account.component').then(
            c => c.StudentAccountComponent
          ),
        title: 'Выгодно - Своё Фото',
      },
      {
        path: 'student',
        redirectTo: '/user-profile/education',
        pathMatch: 'full',
      },
      {
        path: 'photo-permissions',
        loadComponent: () =>
          import('./components/photo-permissions/photo-permissions.component').then(
            c => c.PhotoPermissionsComponent
          ),
        title: 'Разрешения - Своё Фото',
      },
      {
        path: 'confirmation-required',
        loadComponent: () =>
          import('./components/confirmation-required/confirmation-required.component').then(
            c => c.ConfirmationRequiredComponent
          ),
        title: 'Требуется подтверждение - Своё Фото',
      },
      {
        path: 'photo-approval/:id',
        loadComponent: () =>
          import('./components/photo-approval-detail/photo-approval-detail.component').then(
            c => c.PhotoApprovalDetailComponent
          ),
        title: 'Подтверждение фотографий - Своё Фото',
      },
      {
        path: 'my-photos',
        loadComponent: () =>
          import('./components/user-photos/user-photos.component').then(
            c => c.UserPhotosComponent
          ),
        title: 'Мои фотографии - Своё Фото',
      },
      {
        path: 'approvals',
        loadComponent: () =>
          import('./components/photo-selections/photo-selections.component').then(
            c => c.PhotoSelectionsComponent
          ),
        title: 'Согласование фотографий - Своё Фото',
      },
      // Redirect old path
      { path: 'photo-selections', redirectTo: 'approvals', pathMatch: 'full' },
      {
        path: 'photo-selector/:sessionId',
        loadComponent: () =>
          import('./components/photo-selector/photo-selector.component').then(
            c => c.PhotoSelectorComponent
          ),
        title: 'Выбор фотографий - Своё Фото',
      },
      {
        path: 'payment/:selectionId',
        loadComponent: () =>
          import('./components/payment/payment.component').then(
            c => c.PaymentComponent
          ),
        title: 'Оплата фотографий - Своё Фото',
      },
      {
        path: 'photo-locations',
        loadComponent: () =>
          import('./components/photo-locations/photo-locations.component').then(
            c => c.PhotoLocationsComponent
          ),
        title: 'Наши студии - Своё Фото',
      },
      {
        path: 'photo-locations/:id',
        loadComponent: () =>
          import('./components/location-detail/location-detail.component').then(
            c => c.LocationDetailComponent
          ),
        title: 'Детали локации - Своё Фото',
      },
    ],
  },
];
