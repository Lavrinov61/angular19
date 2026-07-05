import { Routes } from '@angular/router';
import { authGuard, phoneVerifiedGuard } from '../../core/guards/auth.guard';

export const CLIENT_GALLERY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./client-gallery.component').then(c => c.ClientGalleryComponent),
    title: 'Моя галерея - Своё Фото',
    canActivate: [authGuard, phoneVerifiedGuard]
  },
  {
    path: 'session/:id',
    loadComponent: () => import('./session-view.component').then(c => c.SessionViewComponent),
    title: 'Просмотр фотосессии - Своё Фото',
    canActivate: [authGuard, phoneVerifiedGuard]
  }
];
