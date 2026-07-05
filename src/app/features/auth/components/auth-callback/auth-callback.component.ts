import { Component, OnInit, inject, signal, ChangeDetectionStrategy, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';

import { ActivatedRoute, Router } from '@angular/router';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { AuthService } from '../../../../core/services/auth.service';
import { AuthChatService } from '../../../../core/services/auth-chat.service';
import { PhotoApprovalService } from '../../../../core/services/photo-approval.service';

function authCallbackErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error !== 'object' || error === null) {
    return 'Ошибка при обработке авторизации';
  }

  const nestedError = Reflect.get(error, 'error');
  if (typeof nestedError === 'object' && nestedError !== null) {
    const nestedMessage = Reflect.get(nestedError, 'message');
    if (typeof nestedMessage === 'string') {
      return nestedMessage;
    }
  }

  const message = Reflect.get(error, 'message');
  return typeof message === 'string' ? message : 'Ошибка при обработке авторизации';
}

@Component({
  selector: 'app-auth-callback',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatProgressSpinnerModule,
    MatCardModule,
    MatButtonModule
],
  template: `
    <div class="callback-container">
      <mat-card class="callback-card">
        <mat-card-content>
          <div class="callback-content">
            @if (isLoading()) {
              <div class="loading">
                <mat-spinner diameter="40" />
                <p>Обработка авторизации...</p>
              </div>
            } @else if (error()) {
              <div class="error">
                <h2>Ошибка авторизации</h2>
                <p>{{ error() }}</p>
                <button mat-raised-button color="primary" (click)="goToLogin()">
                  Вернуться на страницу входа
                </button>
              </div>
            } @else {
              <div class="success">
                <h2>Авторизация успешна!</h2>
                <p>Перенаправление...</p>
              </div>
            }
          </div>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: [`
    .callback-container {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      padding: 20px;
    }

    .callback-card {
      max-width: 400px;
      width: 100%;
    }

    .callback-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 20px;
      padding: 20px;
      text-align: center;
    }

    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .error {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .error h2 {
      color: #f44336;
      margin: 0;
    }

    .success {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .success h2 {
      color: #4caf50;
      margin: 0;
    }
  `]
})
export class AuthCallbackComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private destroyRef = inject(DestroyRef);
  private authChatService = inject(AuthChatService);
  private approvalService = inject(PhotoApprovalService);

  isLoading = signal<boolean>(true);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.route.queryParams.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const accessToken = params['accessToken'];
      const refreshToken = params['refreshToken'];

      if (accessToken && refreshToken) {
        // Legacy: tokens from query params (mobile deep links)
        this.processTokens(accessToken, refreshToken, params['returnUrl']);
      } else {
        // New: exchange httpOnly cookies for tokens
        this.exchangeOAuthCookies(params['returnUrl']);
      }
    });
  }

  private exchangeOAuthCookies(returnUrl?: string): void {
    this.http.post<{ success: boolean; data: { accessToken: string; refreshToken: string } }>(
      '/api/auth/exchange-oauth-cookies', {},
      { withCredentials: true }
    ).subscribe({
      next: (resp) => {
        if (resp?.data?.accessToken && resp?.data?.refreshToken) {
          this.processTokens(resp.data.accessToken, resp.data.refreshToken, returnUrl);
        } else {
          this.error.set('Токены авторизации не получены');
          this.isLoading.set(false);
        }
      },
      error: () => {
        this.error.set('Токены авторизации не получены');
        this.isLoading.set(false);
      }
    });
  }

  private processTokens(accessToken: string, refreshToken: string, returnUrl?: string): void {
    this.authService.handleAuthCallback(accessToken, refreshToken).subscribe({
      next: () => {
        this.authChatService.linkUserAfterAuth();
        this.approvalService.linkPendingTokens();
        // Check localStorage for OAuth return URL (set by signInWithProvider)
        const savedReturnUrl = localStorage.getItem('oauth_return_url');
        if (savedReturnUrl) localStorage.removeItem('oauth_return_url');
        const target = this.authService.getPostAuthRedirectUrl(returnUrl || savedReturnUrl || '/');
        this.isLoading.set(false);
        setTimeout(() => {
          this.router.navigateByUrl(target);
        }, 1000);
      },
      error: (err: unknown) => {
        this.error.set(authCallbackErrorMessage(err));
        this.isLoading.set(false);
      }
    });
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }
}
