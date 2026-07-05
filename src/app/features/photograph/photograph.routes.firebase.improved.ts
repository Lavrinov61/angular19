import { Routes } from '@angular/router';

export const PHOTOGRAPHER_ROUTES_FIREBASE_IMPROVED: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/photographer-list/photographer-list.component')
      .then(m => m.PhotographerListComponent),
    title: 'Фотографы и художники - Своё Фото'
  },
  {
    path: ':slug',
    loadComponent: () => import('./components/photographer-profile-minimal/photographer-profile-minimal.component')
      .then(m => m.PhotographerProfileMinimalComponent),
    title: 'Профиль фотографа - Своё Фото'
  }
];
