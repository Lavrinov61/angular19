import { Component, inject, signal, computed, OnInit, PLATFORM_ID, ChangeDetectionStrategy } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { AuthChatService } from '../../../../core/services/auth-chat.service';
import { OAUTH_BUTTONS } from '../oauth-providers.data';

import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

@Component({
  selector: 'app-login-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="auth-page">
      <div class="auth-card">

        <!-- Logo -->
        <div class="auth-logo">
          <img src="/assets/static/logo-black.webp" alt="Своё Фото" width="140" height="44"
               class="logo-light" />
          <img src="/assets/static/logo-white.webp" alt="Своё Фото" width="140" height="44"
               class="logo-dark" />
        </div>

        <h1 class="auth-title">Вход по email</h1>
        @if (returnUrl.includes('/partners')) {
          <p class="auth-subtitle">Войдите, чтобы стать партнёром</p>
        } @else {
          <p class="auth-subtitle">Резервный способ входа для аккаунтов с паролем</p>
        }

        <!-- OAuth buttons are secondary account shortcuts. -->
        @if (availableButtons().length > 0) {
          <div class="auth-divider compact">
            <span>или через аккаунт</span>
          </div>

          <div class="oauth-buttons">
            @for (btn of availableButtons(); track btn.id) {
              <button [class]="'oauth-btn ' + btn.cssClass"
                      (click)="onOAuthSignIn(btn.id)"
                      [disabled]="isLoading()"
                      type="button">
                <span class="oauth-icon" [innerHTML]="btn.safeSvg"></span>
                <span>{{ btn.label }}</span>
              </button>
            }
          </div>
        }

        <div class="auth-divider">
          <span>email и пароль</span>
        </div>

        <!-- Email confirmed success -->
        @if (verifiedSuccess()) {
          <div class="auth-success">
            <mat-icon>check_circle_outline</mat-icon>
            <span>Email подтверждён! Теперь вы можете войти.</span>
          </div>
        }

        <!-- Error -->
        @if (errorMessage()) {
          <div class="auth-error">
            <mat-icon>error_outline</mat-icon>
            <span>{{ errorMessage() }}</span>
          </div>
        }

        <!-- Email not verified -->
        @if (emailNotVerified()) {
          <div class="auth-warning">
            <mat-icon>mark_email_unread</mat-icon>
            <div class="warning-content">
              <span>Email не подтверждён. Проверьте почту и перейдите по ссылке.</span>
              @if (resendDone()) {
                <span class="resend-done-inline">Письмо отправлено</span>
              } @else {
                <button class="resend-link" (click)="onResendVerification()" [disabled]="resendLoading()">
                  {{ resendLoading() ? 'Отправляем...' : 'Отправить письмо повторно' }}
                </button>
              }
            </div>
          </div>
        }

        <!-- Email/Password form -->
        <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="auth-form" style="margin-top: 0">
          <mat-form-field appearance="outline">
            <mat-label>Email</mat-label>
            <input matInput formControlName="email" type="email"
                   name="email" autocomplete="email" placeholder="example@mail.com">
            <mat-icon matPrefix>mail</mat-icon>
            @if (loginForm.get('email')?.hasError('required') && loginForm.get('email')?.touched) {
              <mat-error>Введите email</mat-error>
            }
            @if (loginForm.get('email')?.hasError('email')) {
              <mat-error>Некорректный email</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>Пароль</mat-label>
            <input matInput formControlName="password"
                   [type]="hidePassword() ? 'password' : 'text'"
                   name="current-password" autocomplete="current-password" placeholder="Введите пароль">
            <mat-icon matPrefix>lock</mat-icon>
            <button mat-icon-button matSuffix type="button" tabindex="-1"
                    (click)="hidePassword.set(!hidePassword())"
                    [attr.aria-label]="hidePassword() ? 'Показать пароль' : 'Скрыть пароль'">
              <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            @if (loginForm.get('password')?.hasError('required') && loginForm.get('password')?.touched) {
              <mat-error>Введите пароль</mat-error>
            }
          </mat-form-field>

          <div class="form-actions-row">
            <a class="forgot-link" routerLink="/auth/forgot-password">Забыли пароль?</a>
          </div>

          <button mat-flat-button type="submit" class="auth-submit"
                  [disabled]="loginForm.invalid || isLoading()">
            @if (isLoading()) {
              <mat-spinner diameter="20" />
            } @else {
              Войти
            }
          </button>
        </form>

        <!-- Register link -->
        <p class="auth-footer-text">
          Нет аккаунта?
          <a routerLink="/auth/register" [queryParams]="returnUrl !== '/' ? {returnUrl} : {}" class="auth-link">Зарегистрироваться</a>
        </p>

      </div>
    </div>
  `,
  styles: [`
    @use '../auth-shared';

    .form-actions-row {
      display: flex;
      justify-content: flex-end;
      margin-top: -8px;
    }

    .forgot-link {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--ed-accent, #f59e0b);
      text-decoration: none;
      &:hover { text-decoration: underline; }
    }

    .auth-success {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      background: rgba(76, 175, 80, 0.12);
      border: 1px solid rgba(76, 175, 80, 0.3);
      border-radius: var(--ed-border-radius-md, 8px);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      color: #4caf50;
      mat-icon { flex-shrink: 0; }
    }

    .auth-warning {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 16px;
      background: rgba(255, 152, 0, 0.10);
      border: 1px solid rgba(255, 152, 0, 0.3);
      border-radius: var(--ed-border-radius-md, 8px);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      color: #ff9800;
      mat-icon { flex-shrink: 0; margin-top: 2px; }

      .warning-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .resend-link {
        background: none;
        border: none;
        padding: 0;
        font-family: inherit;
        font-size: 0.8125rem;
        color: var(--ed-accent, #f59e0b);
        cursor: pointer;
        text-align: left;
        text-decoration: underline;
        &:hover { opacity: 0.8; }
        &:disabled { opacity: 0.5; cursor: default; }
      }

      .resend-done-inline {
        font-size: 0.8125rem;
        color: #4caf50;
      }
    }

    .auth-divider.compact {
      margin: 24px 0 14px;
    }
  `]
})
export class LoginFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  protected authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private platformId = inject(PLATFORM_ID);
  private visitorChatService = inject(AuthChatService);
  private sanitizer = inject(DomSanitizer);

  errorMessage = signal<string | null>(null);
  isLoading = this.authService.isLoading;
  hidePassword = signal(true);
  emailNotVerified = signal<string | null>(null); // email для которого нужна верификация
  resendLoading = signal(false);
  resendDone = signal(false);
  verifiedSuccess = signal(false); // пришли с ?verified=true

  /** Кнопки провайдеров, которые реально настроены на бэкенде */
  availableButtons = computed(() =>
    OAUTH_BUTTONS
      .filter(btn => this.authService.availableProviders().some(p => p.id === btn.id))
      .map(btn => ({ ...btn, safeSvg: this.sanitizer.bypassSecurityTrustHtml(btn.svgIcon) }))
  );

  protected returnUrl = '/';
  loginForm: FormGroup;

  constructor() {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]]
    });
  }

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
    if (isPlatformBrowser(this.platformId)) {
      this.authService.loadAvailableProviders().subscribe();
      const verified = this.route.snapshot.queryParamMap.get('verified');
      if (verified === 'true') {
        this.verifiedSuccess.set(true);
        // Restore returnUrl saved during registration (e.g., /partners)
        const savedUrl = localStorage.getItem('auth_return_url');
        if (savedUrl) {
          this.returnUrl = savedUrl;
          localStorage.removeItem('auth_return_url');
        }
      }
    }
  }

  onSubmit(): void {
    if (this.loginForm.invalid) return;
    const { email, password } = this.loginForm.value;
    this.errorMessage.set(null);
    this.emailNotVerified.set(null);
    this.authService.login(email, password).subscribe({
      next: () => {
        this.visitorChatService.linkUserAfterAuth();
        this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
      },
      error: (err) => {
        if (err.error === 'EMAIL_NOT_VERIFIED') {
          this.emailNotVerified.set(email);
        } else {
          this.errorMessage.set(err.error || err.message || 'Неверный email или пароль');
        }
      },
    });
  }

  onResendVerification(): void {
    const email = this.emailNotVerified();
    if (!email || this.resendLoading()) return;
    this.resendLoading.set(true);
    this.resendDone.set(false);
    this.authService.resendVerificationEmail(email).subscribe({
      next: () => { this.resendLoading.set(false); this.resendDone.set(true); },
      error: () => { this.resendLoading.set(false); this.resendDone.set(true); },
    });
  }

  onOAuthSignIn(providerId: string): void {
    this.authService.signInWithProvider(providerId, this.returnUrl).subscribe();
  }
}
