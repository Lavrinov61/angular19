import { Routes } from '@angular/router';

export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/admin-dashboard/admin-dashboard.component').then(c => c.AdminDashboardComponent),
    title: 'Панель администратора - Своё Фото'
  },
  {
    path: 'user-management',
    loadComponent: () => import('./components/user-management/user-management.component').then(c => c.UserManagementComponent),
    title: 'Управление пользователями - Своё Фото'
  },
  {
    path: 'bookings',
    loadComponent: () => import('./components/admin-bookings/admin-bookings.component').then(c => c.AdminBookingsComponent),
    title: 'Управление записями - Своё Фото'
  },  {
    path: 'photographers',
    children: [
      {
        path: '',
        loadComponent: () => import('./components/photographers-overview/photographers-overview.component').then(c => c.PhotographersOverviewComponent),
        title: 'Обзор фотографов - Своё Фото'
      },
      {
        path: 'management',
        loadComponent: () => import('../photograph/components/admin-photographers/admin-photographers.component').then(c => c.AdminPhotographersComponent),
        title: 'Управление фотографами - Своё Фото'
      },      {
        path: 'schedule',
        loadComponent: () => import('../../shared/components/unified-schedule-manager/unified-schedule-manager.component').then(c => c.UnifiedScheduleManagerComponent),
        title: 'Управление расписанием - Своё Фото',
        data: { 
          scheduleConfig: {
            mode: 'admin',
            permissions: { canCreate: true, canEdit: true, canDelete: true, canAssign: true },
            features: { showAnalytics: true, showBulkActions: true, showTemplates: true, allowDragDrop: true }
          }
        }
      },
      {
        path: 'avatars-test',
        loadComponent: () => import('./components/photographer-avatars-test/photographer-avatars-test.component').then(c => c.PhotographerAvatarsTestComponent),
        title: 'Тест аватарок фотографов - Своё Фото'
      },
    ]
  },
  {
    path: 'gallery',
    loadComponent: () => import('./components/admin-gallery/admin-gallery.component').then(c => c.AdminGalleryComponent),
    title: 'Управление галереей - Своё Фото'  },
  {
    path: 'thumbnails-manager',
    loadComponent: () => import('./thumbnails-manager/thumbnails-manager.component').then(c => c.ThumbnailsManagerComponent),
    title: 'Управление миниатюрами - Своё Фото'
  }
];
