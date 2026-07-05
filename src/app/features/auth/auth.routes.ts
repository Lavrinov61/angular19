import { Routes } from '@angular/router';
import { guestGuard } from '../../core/guards/auth.guard';

export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/phone-login/phone-login.component').then(c => c.PhoneLoginComponent),
    title: 'Вход - Своё Фото',
    canActivate: [guestGuard]
  },
  {
    path: 'email-login',
    loadComponent: () => import('./components/phone-login/phone-login.component').then(c => c.PhoneLoginComponent),
    title: 'Вход по email - Своё Фото',
    canActivate: [guestGuard],
    data: { authMode: 'email' }
  },
  {
    path: 'register',
    redirectTo: 'login',
    pathMatch: 'full'
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./components/forgot-password/forgot-password.component').then(c => c.ForgotPasswordComponent),
    title: 'Восстановление пароля - Своё Фото',
    canActivate: [guestGuard]
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./components/reset-password/reset-password.component').then(c => c.ResetPasswordComponent),
    title: 'Новый пароль - Своё Фото',
    canActivate: [guestGuard]
  },
  {
    path: 'employee',
    loadComponent: () => import('./components/employee-login/employee-login.component').then(c => c.EmployeeLoginComponent),
    title: 'Вход для сотрудников - Своё Фото',
    canActivate: [guestGuard]
  },
  {
    path: 'employee-login',
    redirectTo: 'employee',
    pathMatch: 'full'
  },
  {
    path: 'pin',
    loadComponent: () => import('./components/pin-auth/pin-auth.component').then(c => c.PinAuthComponent),
    title: 'PIN - Своё Фото'
  },
  {
    path: 'callback',
    loadComponent: () => import('./components/auth-callback/auth-callback.component').then(c => c.AuthCallbackComponent),
    title: 'Обработка авторизации - Своё Фото'
  },
  {
    path: 'complete-profile',
    loadComponent: () => import('./components/profile-completion/profile-completion.component').then(c => c.ProfileCompletionComponent),
    title: 'Завершение профиля - Своё Фото'
  },
  {
    path: 'phone-verification',
    redirectTo: 'complete-profile',
    pathMatch: 'full'
  },
  {
    path: 'oauth-pending',
    loadComponent: () => import('./components/oauth-pending/oauth-pending.component').then(c => c.OAuthPendingComponent),
    title: 'Подтверждение привязки - Своё Фото'
  },
  {
    path: 'confirm-oauth-link',
    redirectTo: 'callback',
    pathMatch: 'full'
  },
  {
    path: 'phone-login',
    loadComponent: () => import('./components/phone-login/phone-login.component').then(c => c.PhoneLoginComponent),
    title: 'Вход по телефону - Своё Фото',
    canActivate: [guestGuard]
  },
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full'
  }
];
