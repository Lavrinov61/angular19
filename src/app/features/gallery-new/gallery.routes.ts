import { Routes } from '@angular/router';

export const GALLERY_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./gallery-modern/gallery-modern.component').then(m => m.GalleryModernComponent),
    title: 'Галерея - Своё Фото'
  }
];
