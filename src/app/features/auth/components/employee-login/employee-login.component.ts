import { Component, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router, RouterLink, ActivatedRoute } from '@angular/router';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../../core/services/auth.service';
import { SeoService } from '../../../../core/services/seo.service';

const PHONE_OTP_LENGTH = 4;

@Component({
  selector: 'app-employee-login',
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

        <h1 class="auth-title">Вход для сотрудников</h1>
        <p class="auth-subtitle">Доступ к панели управления</p>

        <!-- Mode toggle -->
        <div class="auth-mode-toggle">
          <button class="auth-mode-btn" [class.active]="loginMode() === 'email'"
                  (click)="switchMode('email')">
            <mat-icon>mail</mat-icon> Email
          </button>
          <button class="auth-mode-btn" [class.active]="loginMode() === 'phone'"
                  (click)="switchMode('phone')">
            <mat-icon>phone</mat-icon> Телефон
          </button>
        </div>

        <!-- Error -->
        @if (errorMessage()) {
          <div class="auth-error">
            <mat-icon>error_outline</mat-icon>
            <span>{{ errorMessage() }}</span>
          </div>
        }

        <!-- Email login form -->
        @if (loginMode() === 'email') {
          <form [formGroup]="loginForm" (ngSubmit)="onSubmit()" class="auth-form">
            <mat-form-field appearance="outline">
              <mat-label>Email</mat-label>
              <input matInput formControlName="email" type="email"
                     name="email" autocomplete="email" placeholder="work@svoefoto.ru">
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
                     name="current-password" autocomplete="current-password">
              <mat-icon matPrefix>lock</mat-icon>
              <button mat-icon-button matSuffix type="button" tabindex="-1"
                      (click)="hidePassword.set(!hidePassword())">
                <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (loginForm.get('password')?.hasError('required') && loginForm.get('password')?.touched) {
                <mat-error>Введите пароль</mat-error>
              }
            </mat-form-field>

            <button mat-flat-button type="submit" class="auth-submit"
                    [disabled]="loginForm.invalid || isLoading()">
              @if (isLoading()) {
                <mat-spinner diameter="20" />
              } @else {
                Войти
              }
            </button>
          </form>
        }

        <!-- Phone login form -->
        @if (loginMode() === 'phone') {
          <div class="auth-form">
            @if (phoneStep() === 'enter') {
              <!-- Step 1: Enter phone -->
              <mat-form-field appearance="outline">
                <mat-label>Номер телефона</mat-label>
                <input matInput [value]="phoneNumber()"
                       (input)="onPhoneNumberInput($event)"
                       type="tel" inputmode="tel" autocomplete="tel"
                       placeholder="+7 (XXX) XXX-XX-XX"
                       (keydown.enter)="requestCode()">
                <mat-icon matPrefix>phone</mat-icon>
              </mat-form-field>

              <button mat-flat-button class="auth-submit"
                      [disabled]="!phoneNumber() || phoneNumber().length < 10 || isLoading()"
                      (click)="requestCode()">
                @if (isLoading()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Получить код звонком
                }
              </button>
            } @else if (phoneStep() === 'code') {
              <!-- Step 2: Enter OTP code -->
              <div class="auth-phone-info">
                <mat-icon>phone</mat-icon>
                <span>Звонок с кодом на <strong>{{ phoneNumber() }}</strong></span>
                <button mat-icon-button (click)="phoneStep.set('enter')">
                  <mat-icon>edit</mat-icon>
                </button>
              </div>

              <mat-form-field appearance="outline">
                <mat-label>Код подтверждения</mat-label>
                <input matInput [value]="otpCode()"
                       (input)="onOtpCodeInput($event)"
                       type="text" inputmode="numeric" autocomplete="one-time-code"
                       maxlength="4" placeholder="0000"
                       (keydown.enter)="verifyCode()">
                <mat-icon matPrefix>pin</mat-icon>
                <mat-hint>
                  Введите код, который продиктует робот в звонке.
                </mat-hint>
              </mat-form-field>

              <button mat-flat-button class="auth-submit"
                      [disabled]="otpCode().length !== otpLength || isLoading()"
                      (click)="verifyCode()">
                @if (isLoading()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Войти
                }
              </button>

              @if (countdown() > 0) {
                <p class="auth-countdown">Повторный звонок через {{ countdown() }} сек</p>
              } @else {
                <button mat-button class="auth-resend" (click)="requestCode()">
                  Получить код ещё раз
                </button>
              }
            } @else {
              <form [formGroup]="profileForm" (ngSubmit)="completePhoneProfile()" class="employee-profile-form">
                <mat-form-field appearance="outline">
                  <mat-label>Имя</mat-label>
                  <input matInput formControlName="displayName" type="text" autocomplete="given-name" maxlength="100">
                  @if (profileForm.get('displayName')?.hasError('required') && profileForm.get('displayName')?.touched) {
                    <mat-error>Введите имя</mat-error>
                  }
                  @if (profileForm.get('displayName')?.hasError('minlength')) {
                    <mat-error>Минимум 2 символа</mat-error>
                  }
                </mat-form-field>

                <button mat-flat-button type="submit" class="auth-submit"
                        [disabled]="profileForm.invalid || isLoading()">
                  @if (isLoading()) {
                    <mat-spinner diameter="20" />
                  } @else {
                    Завершить вход
                  }
                </button>
              </form>
            }
          </div>
        }

        <!-- Client login link -->
        <p class="auth-footer-text">
          <a routerLink="/auth/login" class="auth-link">Вход для клиентов</a>
        </p>

      </div>
    </div>
  `,
  styles: [`
    @use '../auth-shared';

    .auth-mode-toggle {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
      padding: 4px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .auth-mode-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      border: none;
      border-radius: 10px;
      background: transparent;
      color: rgba(255, 255, 255, 0.5);
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover { color: rgba(255, 255, 255, 0.7); }

      &.active {
        background: rgba(245, 158, 11, 0.15);
        color: #f59e0b;
        box-shadow: 0 1px 4px rgba(245, 158, 11, 0.1);
      }
    }

    .auth-phone-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      margin-bottom: 12px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.08);
      border: 1px solid rgba(245, 158, 11, 0.15);
      font-size: 13px;
      color: rgba(255, 255, 255, 0.8);

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: #f59e0b; }
      button { margin-left: auto; }
    }

    .auth-countdown {
      text-align: center;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.4);
      margin: 8px 0 0;
    }

    .auth-resend {
      display: block;
      margin: 8px auto 0;
      font-size: 13px;
      color: #f59e0b;
    }
  `]
})
export class EmployeeLoginComponent implements OnInit, OnDestroy {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly seoService = inject(SeoService);
  private returnUrl = '/employee';

  errorMessage = signal<string | null>(null);
  isLoading = signal(false);
  hidePassword = signal(true);

  // Login mode
  loginMode = signal<'email' | 'phone'>('phone');
  phoneStep = signal<'enter' | 'code' | 'profile'>('enter');
  phoneNumber = signal('');
  otpCode = signal('');
  countdown = signal(0);
  protected readonly otpLength = PHONE_OTP_LENGTH;
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  readonly loginForm: FormGroup = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  readonly profileForm: FormGroup = this.fb.group({
    displayName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
  });

  ngOnInit(): void {
    this.seoService.setRobotsMeta('noindex, nofollow');
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/employee';
    this.authService.loadAvailableProviders().subscribe();
  }

  ngOnDestroy(): void {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
  }

  switchMode(mode: 'email' | 'phone'): void {
    this.loginMode.set(mode);
    this.errorMessage.set(null);
    this.phoneStep.set('enter');
    this.otpCode.set('');
    this.profileForm.reset();
  }

  // Email login
  onSubmit(): void {
    if (this.loginForm.invalid) return;
    const { email, password } = this.loginForm.value;
    this.errorMessage.set(null);
    this.isLoading.set(true);

    this.authService.employeeLogin(email, password).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
      },
      error: (err: { error?: string; message?: string }) => {
        this.isLoading.set(false);
        this.errorMessage.set(err.error || err.message || 'Неверный email или пароль');
      },
    });
  }

  // Phone login - Step 1: Request OTP
  requestCode(): void {
    const phone = this.phoneNumber().trim();
    if (!phone || phone.length < 10) return;

    this.errorMessage.set(null);
    this.isLoading.set(true);

    this.authService.requestPhoneCode(phone).subscribe({
      next: () => {
        this.isLoading.set(false);
        this.phoneStep.set('code');
        this.otpCode.set('');
        this.startCountdown(60);
      },
      error: (err: { error?: string; message?: string }) => {
        this.isLoading.set(false);
        this.errorMessage.set(err.error || err.message || 'Не удалось запустить звонок');
      },
    });
  }

  // Phone login - Step 2: Verify OTP
  verifyCode(): void {
    const phone = this.phoneNumber().trim();
    const code = this.otpCode().trim();
    if (code.length !== PHONE_OTP_LENGTH) return;

    this.errorMessage.set(null);
    this.isLoading.set(true);

    this.authService.verifyPhoneCode(phone, code, true).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.requiresProfile) {
          this.phoneStep.set('profile');
          return;
        }
        this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
      },
      error: (err: { error?: { message?: string } | string; message?: string }) => {
        this.isLoading.set(false);
        const msg = typeof err.error === 'object' ? err.error?.message : err.error;
        this.errorMessage.set(msg || err.message || 'Неверный код');
      },
    });
  }

  completePhoneProfile(): void {
    if (this.profileForm.invalid || this.isLoading()) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const phone = this.phoneNumber().trim();
    const code = this.otpCode().trim();
    const displayName = String(this.profileForm.get('displayName')?.value ?? '').trim();

    this.errorMessage.set(null);
    this.isLoading.set(true);
    this.authService.verifyPhoneCode(phone, code, true, { displayName }).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        if (res.requiresProfile) {
          this.errorMessage.set('Введите имя, чтобы завершить вход.');
          return;
        }
        this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
      },
      error: (err: { error?: { message?: string } | string; message?: string }) => {
        this.isLoading.set(false);
        const msg = typeof err.error === 'object' ? err.error?.message : err.error;
        this.errorMessage.set(msg || err.message || 'Не удалось завершить вход');
      },
    });
  }

  onPhoneNumberInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    this.phoneNumber.set(input.value);
    this.errorMessage.set(null);
  }

  onOtpCodeInput(event: Event): void {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const digits = input.value.replace(/\D/g, '').slice(0, PHONE_OTP_LENGTH);
    input.value = digits;
    this.otpCode.set(digits);
    this.errorMessage.set(null);
  }

  private startCountdown(seconds: number): void {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdown.set(seconds);
    this.countdownInterval = setInterval(() => {
      const val = this.countdown() - 1;
      this.countdown.set(val);
      if (val <= 0 && this.countdownInterval) {
        clearInterval(this.countdownInterval);
        this.countdownInterval = null;
      }
    }, 1000);
  }

}
