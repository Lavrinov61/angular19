import { Routes } from '@angular/router';
import { ContactsComponent } from './components/contacts.component';

export const CONTACTS_ROUTES: Routes = [
  {
    path: '',
    component: ContactsComponent,
    title: 'Контакты - Своё Фото'
  }
];
