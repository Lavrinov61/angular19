import { Routes } from '@angular/router';
import { PhotographerListComponent } from './components/photographer-list/photographer-list.component';
import { PhotographerProfileApiComponent } from './components/photographer-profile/photographer-profile.api.component';

export const PHOTOGRAPHER_ROUTES: Routes = [
  {
    path: '',
    component: PhotographerListComponent,
    title: 'Фотографы - Своё Фото',
  },
  {
    path: ':slug',
    component: PhotographerProfileApiComponent,
    title: 'Фотограф - Своё Фото',
  }
];
