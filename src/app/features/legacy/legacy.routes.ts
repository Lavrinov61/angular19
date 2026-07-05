import { Routes } from '@angular/router';

export const LEGACY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/photo-archive-landing/photo-archive-landing.component').then(c => c.PhotoArchiveLandingComponent),
    title: 'Фотография в архиве - Своё Фото'
  }
];
