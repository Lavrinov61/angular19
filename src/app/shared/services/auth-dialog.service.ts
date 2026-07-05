import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../core/services/auth.service';
import { 
  AuthMethodDialogComponent, 
  AuthMethodDialogData 
} from '../../features/auth/components/auth-method-dialog/auth-method-dialog.component';

/**
 * Сервис для управления потоками аутентификации через модальные окна
 */
@Injectable({
  providedIn: 'root'
})
export class AuthDialogService {
  private dialog = inject(MatDialog);
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

  /**
   * Открывает диалог входа
   */
  async openLoginDialog(): Promise<void> {
    const data: AuthMethodDialogData = {
      title: 'Войти в Magnus Photo',
      subtitle: 'Выберите удобный способ входа',
      showEmail: true,
      showSocial: true,
      showPhone: false,
      mode: 'login',
      providers: ['google', 'apple']
    };

    const dialogRef = this.dialog.open(AuthMethodDialogComponent, {
      width: '400px',
      data
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result) return;

    try {
      switch (result.method) {
        case 'social':
          await this.handleSocialLogin(result.provider);
          break;
        case 'email':
          this.router.navigate(['/auth/login']);
          break;
        case 'email-link':
          this.router.navigate(['/auth/login'], { queryParams: { method: 'email-link' } });
          break;
        case 'phone':
          this.snackBar.open('Для входа через телефон сначала войдите через другой метод', 'Закрыть', { duration: 5000 });
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Ошибка входа';
      this.snackBar.open(message, 'Закрыть', { duration: 5000 });
    }
  }

  /**
   * Открывает диалог регистрации
   */
  async openRegisterDialog(): Promise<void> {
    const data: AuthMethodDialogData = {
      title: 'Создать аккаунт',
      subtitle: 'Выберите удобный способ регистрации',
      showEmail: true,
      showSocial: true,
      showPhone: false,
      mode: 'register',
      providers: ['google', 'apple']
    };

    const dialogRef = this.dialog.open(AuthMethodDialogComponent, {
      width: '400px',
      data
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result) return;

    try {
      switch (result.method) {
        case 'social':
          await this.handleSocialLogin(result.provider);
          break;
        case 'email':
          this.router.navigate(['/auth/login']);
          break;
        case 'email-link':
          this.router.navigate(['/auth/login'], { queryParams: { method: 'email-link' } });
          break;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Ошибка регистрации';
      this.snackBar.open(msg, 'Закрыть', { duration: 5000 });
    }
  }

  /**
   * Открывает диалог для связывания аккаунтов
   */
  async openLinkAccountDialog(): Promise<void> {
    if (!this.authService.isAuthenticated()) {
      this.snackBar.open('Для связывания аккаунтов необходимо войти в систему', 'Закрыть', { duration: 5000 });
      return;
    }
    
    const profile = this.authService.profile();
    const linkedAccounts = profile?.linkedAccounts || {};
    
    // Фильтруем провайдеры, с которыми еще не связан аккаунт
    const availableProviders = ['google', 'apple'].filter(
      p => !linkedAccounts[p as keyof typeof linkedAccounts]
    ) as ('google' | 'apple')[];
    
    if (availableProviders.length === 0) {
      this.snackBar.open('Ваш аккаунт уже связан со всеми доступными провайдерами', 'Закрыть', { duration: 5000 });
      return;
    }

    const data: AuthMethodDialogData = {
      title: 'Связать аккаунт',
      subtitle: 'Выберите сервис для связывания с вашим аккаунтом',
      showEmail: false,
      showSocial: true,
      showPhone: profile?.phoneVerified ? false : true,
      mode: 'link',
      providers: availableProviders as ('google' | 'apple')[]
    };

    const dialogRef = this.dialog.open(AuthMethodDialogComponent, {
      width: '400px',
      data
    });

    const result = await firstValueFrom(dialogRef.afterClosed());
    if (!result) return;

    try {
      switch (result.method) {
        case 'social':
          await this.authService.linkAccountWithProvider(result.provider);
          this.snackBar.open(`Аккаунт успешно связан с ${result.provider}`, 'Закрыть', { duration: 3000 });
          break;
        case 'phone':
          this.router.navigate(['/auth/complete-profile'], {
            queryParams: { returnUrl: this.router.url, forcePhone: '1' },
          });
          break;
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Ошибка связывания аккаунта';
      this.snackBar.open(msg, 'Закрыть', { duration: 5000 });
    }
  }

  /**
   * Обработка входа через социальные сети
   */
  private async handleSocialLogin(provider: 'google' | 'apple'): Promise<void> {
    switch (provider) {
      case 'google':
        await this.authService.signInWithGoogle();
        break;
      case 'apple':
        await this.authService.signInWithApple();
        break;
    }

    this.router.navigate(['/user-profile']);
  }
}
