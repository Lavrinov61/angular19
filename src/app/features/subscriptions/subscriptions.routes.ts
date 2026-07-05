import { Routes } from '@angular/router';

export const SUBSCRIPTION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./subscription-plans/subscription-plans.component').then(m => m.SubscriptionPlansComponent),
    title: 'Подписка на печать документов A4, Своё Фото',
  },
  {
    path: 'activate',
    loadComponent: () => import('./gift-activation/gift-activation.component').then(m => m.GiftActivationComponent),
    title: 'Активация подарочной подписки, Своё Фото',
  },
  {
    path: 'my',
    redirectTo: '/profile/subscription',
  },
];
