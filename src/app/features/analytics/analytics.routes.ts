import { Routes } from '@angular/router';
import { analyticsGuard } from './guards/analytics.guard';

export const ANALYTICS_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'dashboard',
    pathMatch: 'full'
  },
  {
    path: 'login',
    loadComponent: () => import('./components/analytics-login/analytics-login.component')
      .then(c => c.AnalyticsLoginComponent),
    title: 'Вход в аналитику - Своё Фото'
  },
  {
    path: 'dashboard',
    loadComponent: () => import('./components/dashboard/dashboard.component')
      .then(c => c.DashboardComponent),
    canActivate: [analyticsGuard],
    title: 'Дашборд аналитики - Своё Фото'
  }
];

