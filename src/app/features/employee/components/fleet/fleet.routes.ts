import { Routes } from '@angular/router';
import { FleetDetailStateService } from './services/fleet-detail-state.service';

export const FLEET_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./fleet-dashboard.component').then(m => m.FleetDashboardComponent),
    title: 'ФотоПульт — Мониторинг парка',
  },
  {
    path: ':id',
    loadComponent: () => import('./fleet-detail.component').then(m => m.FleetDetailComponent),
    title: 'ФотоПульт — Принтер',
    providers: [FleetDetailStateService],
    children: [
      { path: '', redirectTo: 'telemetry', pathMatch: 'full' },
      {
        path: 'telemetry',
        loadComponent: () =>
          import('./fleet-detail-telemetry-tab.component').then(m => m.FleetDetailTelemetryTabComponent),
      },
      {
        path: 'alerts',
        loadComponent: () =>
          import('./fleet-detail-alerts-tab.component').then(m => m.FleetDetailAlertsTabComponent),
      },
      {
        path: 'jobs',
        loadComponent: () =>
          import('./fleet-detail-jobs-tab.component').then(m => m.FleetDetailJobsTabComponent),
      },
    ],
  },
];
