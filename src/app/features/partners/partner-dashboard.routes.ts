import { Routes } from '@angular/router';

export const PARTNER_DASHBOARD_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./partner-dashboard-shell/partner-dashboard-shell.component').then(c => c.PartnerDashboardShellComponent),
    children: [
      {
        path: '',
        redirectTo: 'overview',
        pathMatch: 'full',
      },
      {
        path: 'overview',
        loadComponent: () => import('./partner-overview/partner-overview.component').then(c => c.PartnerOverviewComponent),
        title: 'Обзор, Кабинет партнёра',
      },
      {
        path: 'referrals',
        loadComponent: () => import('./partner-referrals/partner-referrals.component').then(c => c.PartnerReferralsComponent),
        title: 'Рефералы, Кабинет партнёра',
      },
      {
        path: 'payouts',
        loadComponent: () => import('./partner-payouts/partner-payouts.component').then(c => c.PartnerPayoutsComponent),
        title: 'Выплаты, Кабинет партнёра',
      },
      {
        path: 'settings',
        loadComponent: () => import('./partner-settings/partner-settings.component').then(c => c.PartnerSettingsComponent),
        title: 'Настройки, Кабинет партнёра',
      },
    ],
  },
];
