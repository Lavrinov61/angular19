import { Routes } from '@angular/router';

export const photographerDashboardRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/photographer-personal-dashboard/photographer-personal-dashboard.component').then(m => m.PhotographerPersonalDashboardComponent),
    title: 'Личный кабинет фотографа - Своё Фото'
  },  {
    path: 'schedule',
    loadComponent: () => import('./components/photographer-schedule-editor-v2/photographer-schedule-editor-v2.component').then(m => m.PhotographerScheduleEditorV2Component),
    title: 'Управление расписанием - Своё Фото'
  },
  {
    path: 'services',
    loadComponent: () => import('./components/services-management/services-management.component').then(m => m.ServicesManagementComponent),
    title: 'Управление услугами - Своё Фото'
  },
  {
    path: 'profile',
    loadComponent: () => import('./components/profile-editor/profile-editor.component').then(m => m.ProfileEditorComponent),
    title: 'Редактор профиля - Своё Фото'
  },
  {
    path: 'bookings',
    loadComponent: () => import('./components/booking-list/booking-list.component').then(m => m.BookingListComponent),
    title: 'Список бронирований - Своё Фото'
  }
];
