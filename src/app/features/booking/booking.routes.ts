import { Routes } from '@angular/router';

export const BOOKING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/simple-booking/simple-booking.component').then(c => c.SimpleBookingComponent),
    title: 'Онлайн запись - Своё Фото',
    data: {
      description: 'Онлайн запись в фотостудию Своё Фото в Ростове-на-Дону. Выберите студию, услугу, дату и время, быстро и удобно.',
      canonicalUrl: '/booking'
    }
  },
  {
    path: 'confirmation',
    loadComponent: () => import('./components/booking-confirmation/booking-confirmation.component').then(c => c.BookingConfirmationComponent),
    title: 'Подтверждение записи - Своё Фото'
  }
];
