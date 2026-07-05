import {
  Component, inject, signal, computed,
  PLATFORM_ID, OnInit, OnDestroy, ChangeDetectionStrategy, NgZone, ElementRef, viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { DomSanitizer } from '@angular/platform-browser';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { ReactiveFormsModule, NonNullableFormBuilder, Validators } from '@angular/forms';
import { AuthService, type PhoneAuthProfileInput } from '../../../../core/services/auth.service';
import { AuthChatService } from '../../../../core/services/auth-chat.service';
import { OAUTH_BUTTONS } from '../oauth-providers.data';
import { STUDIO_PHONE, STUDIO_PHONE_HREF } from '../../../../core/data/address.data';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

// Формат маски: (XXX) XXX-XX-XX
// Позиции символов маски: ( - d d d ) sp d d d - d d - d d
//                          0   1 2 3 4 5  6 7 8 9  10 11 12 13
const MASK = '(___) ___-__-__';
const OTP_LENGTH = 4;
type AuthMode = 'phone' | 'email';

function applyMask(digits: string): string {
  let result = '';
  const d = digits.slice(0, 10);
  let di = 0;
  for (let i = 0; i < MASK.length; i++) {
    if (MASK[i] === '_') {
      result += di < d.length ? d[di++] : '_';
    } else {
      // Добавляем разделитель только если уже есть хоть одна цифра в этой группе
      if (i === 0 && d.length === 0) break; // пустое поле, ничего не показываем
      if (i === 5 && d.length < 3) break;   // ) только после 3 цифр
      if (i === 5 && d.length === 3) { result += ')'; break; } // стоп после ) если ровно 3
      if (i === 9 && d.length < 6) break;   // - только после 6 цифр
      if (i === 12 && d.length < 8) break;  // - только после 8 цифр
      result += MASK[i];
    }
  }
  return result;
}

// Позиция курсора в отформатированной строке после N введённых цифр
function cursorAfterDigits(masked: string, digitCount: number): number {
  if (digitCount === 0) return 0;
  let count = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i])) {
      count++;
      if (count === digitCount) return i + 1;
    }
  }
  return masked.length;
}

@Component({
  selector: 'app-phone-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="auth-page">
      <header class="auth-topbar">
        <a class="brand-link" routerLink="/" aria-label="Своё Фото">
          <img src="/assets/static/logo-black.webp" alt="Своё Фото" width="128" height="40" />
        </a>
        <a class="client-link" routerLink="/start-client">
          <mat-icon aria-hidden="true">rocket_launch</mat-icon>
          <span>Стать клиентом</span>
        </a>
      </header>

      <div class="auth-card">
        <!-- ═══ ШАГ 1: Выбор способа входа ═══ -->
        @if (step() === 1) {
          <div class="step auth-entry">

            <div class="step-header auth-entry-header">
              <h1 class="auth-title">
                @if (authMode() === 'phone') {
                  Привет! Войдите<br>в Своё Фото
                } @else {
                  Войдите<br>по email
                }
              </h1>
            </div>

            @if (errorMessage()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            @if (authMode() === 'phone') {
              <!-- Поле телефона -->
              <div class="phone-field" [class.focused]="phoneFocused()" [class.has-value]="rawDigits().length > 0">
                <button class="phone-country-btn" type="button" aria-label="Код страны Россия">
                  <span class="phone-flag" aria-hidden="true"></span>
                  <mat-icon aria-hidden="true">expand_more</mat-icon>
                </button>

                <label class="phone-control">
                  <span class="auth-field-label">Номер телефона</span>
                  <span class="phone-input-line">
                    <span class="phone-code">+7</span>
                    <input
                      #phoneInput
                      class="phone-native"
                      type="tel"
                      inputmode="numeric"
                      autocomplete="tel-national"
                      aria-label="Номер телефона"
                      placeholder="(___) ___-__-__"
                      [value]="maskedPhone()"
                      (input)="onPhoneInput($event)"
                      (keydown)="onPhoneKeydown($event)"
                      (paste)="onPhonePaste($event)"
                      (focus)="onPhoneFocus()"
                      (blur)="phoneFocused.set(false)"
                      (keydown.enter)="onRequestCode()"
                    />
                  </span>
                </label>

                @if (rawDigits().length > 0) {
                  <button class="phone-clear-btn" type="button" tabindex="-1" (click)="clearPhone()" aria-label="Очистить">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                }
              </div>

              <button mat-flat-button class="auth-submit"
                      [disabled]="!phoneValid() || requesting()"
                      (click)="onRequestCode()"
                      type="button">
                @if (requesting()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Вперёд
                }
              </button>

              <button class="auth-mode-link" type="button" (click)="setAuthMode('email')">
                Войти по email и паролю
              </button>

              @if (availableButtons().length > 0) {
                <div class="oauth-block" aria-label="Вход через соцсети">
                  <span class="oauth-label">или через соцсети</span>
                  <div class="oauth-icon-row">
                    @for (btn of availableButtons(); track btn.id) {
                      <button class="oauth-icon-btn {{ btn.cssClass }}"
                              (click)="onOAuthSignIn(btn.id)"
                              [disabled]="requesting() || isLoading()"
                              [attr.aria-label]="btn.label"
                              [title]="btn.label"
                              type="button">
                        <span class="oauth-icon" [innerHTML]="btn.safeSvg"></span>
                      </button>
                    }
                  </div>
                </div>
              }
            } @else {
              @if (verifiedSuccess()) {
                <div class="auth-success">
                  <mat-icon>check_circle_outline</mat-icon>
                  <span>Email подтверждён. Теперь вы можете войти.</span>
                </div>
              }

              @if (emailNotVerified()) {
                <div class="auth-warning">
                  <mat-icon>mark_email_unread</mat-icon>
                  <div class="warning-content">
                    <span>Email не подтверждён. Проверьте почту и перейдите по ссылке.</span>
                    @if (resendDone()) {
                      <span class="resend-done-inline">Письмо отправлено</span>
                    } @else {
                      <button class="resend-link" type="button" (click)="onResendVerification()" [disabled]="resendLoading()">
                        {{ resendLoading() ? 'Отправляем...' : 'Отправить письмо повторно' }}
                      </button>
                    }
                  </div>
                </div>
              }

              <form [formGroup]="emailLoginForm" (ngSubmit)="onEmailSubmit()" class="auth-form email-form">
                <label class="email-field">
                  <span class="auth-field-label">Email</span>
                  <input formControlName="email" type="email" name="email" autocomplete="email" placeholder="example@mail.com">
                </label>
                @if (emailLoginForm.get('email')?.hasError('required') && emailLoginForm.get('email')?.touched) {
                  <span class="field-error">Введите email</span>
                }
                @if (emailLoginForm.get('email')?.hasError('email')) {
                  <span class="field-error">Некорректный email</span>
                }

                <label class="email-field password-field">
                  <span class="auth-field-label">Пароль</span>
                  <span class="password-input-row">
                    <input
                      #passwordInput
                      formControlName="password"
                      [type]="hidePassword() ? 'password' : 'text'"
                      name="current-password"
                      autocomplete="current-password"
                      placeholder="Введите пароль"
                    >
                    <button class="password-toggle" type="button" tabindex="-1"
                            (click)="hidePassword.set(!hidePassword())"
                            [attr.aria-label]="hidePassword() ? 'Показать пароль' : 'Скрыть пароль'">
                      <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                    </button>
                  </span>
                </label>
                @if (emailLoginForm.get('password')?.hasError('required') && emailLoginForm.get('password')?.touched) {
                  <span class="field-error">Введите пароль</span>
                }

                <div class="form-actions-row">
                  <a class="forgot-link" routerLink="/auth/forgot-password">Забыли пароль?</a>
                </div>

                <button mat-flat-button type="submit" class="auth-submit"
                        [disabled]="emailLoginForm.invalid || isLoading()">
                  @if (isLoading()) {
                    <mat-spinner diameter="20" />
                  } @else {
                    Вперёд
                  }
                </button>
              </form>

              <button class="auth-mode-link" type="button" (click)="setAuthMode('phone')">
                Войти по номеру телефона
              </button>

              @if (availableButtons().length > 0) {
                <div class="oauth-block" aria-label="Вход через соцсети">
                  <span class="oauth-label">или через соцсети</span>
                  <div class="oauth-icon-row">
                    @for (btn of availableButtons(); track btn.id) {
                      <button class="oauth-icon-btn {{ btn.cssClass }}"
                              (click)="onOAuthSignIn(btn.id)"
                              [disabled]="isLoading()"
                              [attr.aria-label]="btn.label"
                              [title]="btn.label"
                              type="button">
                        <span class="oauth-icon" [innerHTML]="btn.safeSvg"></span>
                      </button>
                    }
                  </div>
                </div>
              }
            }

            <a class="support-phone" [href]="supportPhoneHref">
              <mat-icon aria-hidden="true">call</mat-icon>
              <span>По России и за границей: <b>{{ supportPhone }}</b></span>
            </a>

          </div>
        }
        <!-- ═══ ШАГ 2: Ввод кода ═══ -->
        @if (step() === 2) {
          <div class="step">

            <button class="back-btn" (click)="goBack()" type="button">
              <mat-icon>arrow_back</mat-icon>
              <span>Изменить номер</span>
            </button>

            <div class="step-header">
              <h1 class="auth-title">Код из звонка</h1>
              <p class="auth-subtitle code-subtitle">
                Ответьте на звонок и введите код, который продиктует робот на {{ formattedPhone() }}.
              </p>
            </div>

            @if (errorMessage()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <!-- OTP поле -->
            <div class="otp-box" [class.complete]="code().length === otpLength">
              <input
                class="otp-input"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="4"
                autocomplete="one-time-code"
                placeholder="────"
                [value]="code()"
                (input)="onCodeInput($event)"
                (keydown.enter)="onVerify()"
              />
              <div class="otp-progress">
                @for (i of otpDigits; track i) {
                  <div class="otp-dot" [class.active]="code().length > i"></div>
                }
              </div>
            </div>

            <button mat-flat-button class="auth-submit"
                    [disabled]="code().length !== otpLength || isLoading()"
                    (click)="onVerify()"
                    type="button">
              @if (isLoading()) {
                <mat-spinner diameter="20" />
              } @else {
                Подтвердить
              }
            </button>

            <div class="resend-row">
              @if (countdown() > 0) {
                <span class="countdown-text">
                  Повторный звонок через
                  <span class="countdown-num">{{ countdown() }}</span> сек
                </span>
              } @else {
                <button class="resend-btn" (click)="onResend()" type="button">
                  <mat-icon>refresh</mat-icon>
                  Получить код ещё раз
                </button>
              }
            </div>

          </div>
        }

        <!-- ═══ ШАГ 3: Данные нового клиента ═══ -->
        @if (step() === 3) {
          <div class="step">

            <button class="back-btn" (click)="backToCode()" type="button">
              <mat-icon>arrow_back</mat-icon>
              <span>Назад к коду</span>
            </button>

            <div class="step-header">
              <h1 class="auth-title">Ваше имя</h1>
              <p class="auth-subtitle code-subtitle">
                {{ formattedPhone() }}
              </p>
            </div>

            @if (errorMessage()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <form [formGroup]="profileForm" (ngSubmit)="onCompletePhoneRegistration()" class="auth-form profile-completion-form">
              <mat-form-field appearance="outline">
                <mat-label>Имя</mat-label>
                <input
                       #profileNameInput
                       matInput formControlName="displayName"
                       type="text"
                       name="given-name"
                       autocomplete="given-name"
                       maxlength="100">
                @if (profileForm.controls.displayName.hasError('required') && profileForm.controls.displayName.touched) {
                  <mat-error>Введите имя</mat-error>
                }
                @if (profileForm.controls.displayName.hasError('minlength')) {
                  <mat-error>Минимум 2 символа</mat-error>
                }
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Дата рождения (по желанию)</mat-label>
                <input matInput formControlName="dateOfBirth"
                       type="date"
                       name="bday"
                       autocomplete="bday">
              </mat-form-field>

              <button mat-flat-button type="submit" class="auth-submit"
                      [disabled]="profileForm.invalid || isLoading()">
                @if (isLoading()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Далее
                }
              </button>
            </form>

          </div>
        }

      </div>
    </div>
  `,
  styles: [`
    @use '../auth-shared';

    .auth-card {
      max-width: 380px;
      padding: 34px 32px 32px;
    }

    @media (max-width: 767px) {
      .auth-page {
        align-items: flex-start;
        padding: 24px 16px 104px;
      }

      .auth-card {
        padding: 30px 20px 32px;
      }
    }

    /* ── Step animation ──────────────────────────────── */
    .step {
      animation: stepIn 0.2s ease-out both;
    }
    @keyframes stepIn {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .step-header { margin-bottom: 20px; }

    .auth-entry-header {
      margin-bottom: 0;
    }

    .student-offer-note {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 16px 0;
      padding: 12px 14px;
      border: 1px solid rgba(245, 158, 11, 0.28);
      border-radius: var(--ed-border-radius-md, 8px);
      background: rgba(245, 158, 11, 0.10);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.8125rem;
      line-height: 1.45;
      text-align: left;

      mat-icon {
        flex: 0 0 auto;
        width: 20px;
        height: 20px;
        font-size: 20px;
        color: var(--ed-accent, #f59e0b);
      }
    }

    .email-form {
      margin-top: 0;
    }

    .profile-completion-form {
      margin-top: 18px;
    }

    .form-actions-row {
      display: flex;
      justify-content: flex-end;
      margin-top: -6px;
    }

    .forgot-link {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--ed-accent, #f59e0b);
      text-decoration: none;

      &:hover {
        text-decoration: underline;
      }
    }

    .identity-back-btn {
      display: inline-flex;
      align-items: center;
      max-width: 100%;
      gap: 8px;
      margin: 0 0 12px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }

      span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      &:hover mat-icon {
        color: var(--ed-accent, #f59e0b);
      }
    }

    .auth-secondary-action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 48px;
      gap: 10px;
      margin-top: 10px;
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: var(--ed-border-radius-md, 8px);
      background: transparent;
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.9375rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;

      mat-icon {
        width: 22px;
        height: 22px;
        font-size: 22px;
        color: var(--ed-accent, #f59e0b);
      }

      &:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.04);
        border-color: var(--ed-accent, #f59e0b);
      }

      &:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    }

    .auth-success {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      margin-bottom: 16px;
      background: rgba(76, 175, 80, 0.12);
      border: 1px solid rgba(76, 175, 80, 0.3);
      border-radius: var(--ed-border-radius-md, 8px);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      color: #4caf50;

      mat-icon {
        flex-shrink: 0;
      }
    }

    .auth-warning {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 16px;
      margin-bottom: 16px;
      background: rgba(255, 152, 0, 0.10);
      border: 1px solid rgba(255, 152, 0, 0.3);
      border-radius: var(--ed-border-radius-md, 8px);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      color: #ff9800;

      mat-icon {
        flex-shrink: 0;
        margin-top: 2px;
      }

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

        &:hover {
          opacity: 0.8;
        }

        &:disabled {
          opacity: 0.5;
          cursor: default;
        }
      }

      .resend-done-inline {
        font-size: 0.8125rem;
        color: #4caf50;
      }
    }

    /* ── Phone field ─────────────────────────────────── */
    .phone-field {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 13px 16px;
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      border-radius: var(--ed-border-radius-md, 8px);
      background: rgba(255, 255, 255, 0.03);
      transition: border-color 0.18s ease, box-shadow 0.18s ease;
      margin-bottom: 16px;
      position: relative;

      &.focused {
        border-color: var(--ed-accent, #f59e0b);
        box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
      }
    }

    .phone-flag {
      display: inline-block;
      width: 22px;
      height: 16px;
      border-radius: 2px;
      background: linear-gradient(to bottom, #ffffff 0 33.333%, #1d4ed8 33.333% 66.666%, #dc2626 66.666% 100%);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16), 0 0 0 1px rgba(0, 0, 0, 0.35);
      flex-shrink: 0;
    }

    .phone-code {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 1rem;
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
      flex-shrink: 0;
      letter-spacing: 0;
    }

    /* ── Mask layer (ghost text behind input) ─────────── */
    .phone-mask-layer {
      position: absolute;
      left: calc(16px + 22px + 8px + 2ch + 8px); /* flag + gap + "+7" + gap */
      top: 50%;
      transform: translateY(-50%);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 1rem;
      font-weight: 500;
      letter-spacing: 0;
      pointer-events: none;
      white-space: nowrap;
    }

    .phone-mask-typed {
      color: transparent; /* скрываем, под ним, реальный input */
    }

    .phone-mask-hint {
      color: rgba(160, 160, 160, 0.28);
    }

    /* ── Native input (transparent, on top of mask) ───── */
    .phone-native {
      position: relative;
      z-index: 1;
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      background: transparent;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 1rem;
      font-weight: 500;
      color: var(--ed-on-surface, #f5f5f5);
      caret-color: var(--ed-accent, #f59e0b);
      letter-spacing: 0;

      &::placeholder { opacity: 0; } /* placeholder скрыт, маска делает его работу */
    }

    /* ── Clear button ──────────────────────────────────── */
    .phone-clear-btn {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: none;
      background: rgba(160, 160, 160, 0.15);
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
      padding: 0;

      &:hover {
        background: rgba(245, 158, 11, 0.15);
        color: var(--ed-accent, #f59e0b);
      }
    }

    /* ── Back button ─────────────────────────────────── */
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: none;
      background: none;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.8125rem;
      font-weight: 600;
      padding: 2px 4px 2px 0;
      margin-bottom: 20px;
      transition: color 0.15s;

      mat-icon {
        font-size: 1rem;
        width: 1rem;
        height: 1rem;
        vertical-align: middle;
      }

      &:hover { color: var(--ed-accent, #f59e0b); }
    }

    .auth-divider.compact {
      margin: 20px 0 14px;
    }

    .step > .auth-footer-text {
      margin-top: 18px;
    }

    /* ── Telegram badge ──────────────────────────────── */
    .code-subtitle {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      justify-content: center;
    }

    .tg-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.7rem;
      font-weight: 700;
      letter-spacing: 0;
      padding: 3px 8px;
      border-radius: 100px;
      background: rgba(41, 182, 246, 0.14);
      color: #29b6f6;
      border: 1px solid rgba(41, 182, 246, 0.2);
      text-transform: uppercase;
    }

    /* ── OTP Input ───────────────────────────────────── */
    .otp-box {
      margin: 8px 0 20px;
      position: relative;
    }

    .otp-input {
      display: block;
      width: 100%;
      box-sizing: border-box;
      font-size: 2.4rem;
      font-weight: 700;
      letter-spacing: 0;
      text-align: center;
      padding: 16px 12px 20px;
      border: none;
      border-bottom: 2px solid var(--ed-outline, #3a3a3a);
      background: transparent;
      color: var(--ed-on-surface, #f5f5f5);
      font-family: 'Courier New', 'Courier', monospace;
      outline: none;
      caret-color: var(--ed-accent, #f59e0b);
      transition: border-color 0.18s;

      &::placeholder {
        color: rgba(160, 160, 160, 0.2);
        letter-spacing: 0;
      }

      &:focus { border-color: var(--ed-accent, #f59e0b); }
    }

    .otp-box.complete .otp-input {
      border-color: #22c55e;
      color: #22c55e;
    }

    .otp-progress {
      display: flex;
      justify-content: center;
      gap: 6px;
      margin-top: 10px;
    }

    .otp-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ed-outline, #3a3a3a);
      transition: background 0.15s, transform 0.15s;

      &.active {
        background: var(--ed-accent, #f59e0b);
        transform: scale(1.15);
      }
    }

    .otp-box.complete .otp-dot.active { background: #22c55e; }

    /* ── Resend row ──────────────────────────────────── */
    .resend-row {
      margin-top: 16px;
      text-align: center;
    }

    .countdown-text {
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .countdown-num {
      font-weight: 700;
      color: var(--ed-accent, #f59e0b);
      min-width: 2ch;
      display: inline-block;
      text-align: center;
    }

    .resend-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: none;
      background: none;
      color: var(--ed-accent, #f59e0b);
      cursor: pointer;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      font-weight: 600;
      padding: 0;
      transition: opacity 0.15s;

      mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }

      &:hover { opacity: 0.75; }
    }

    /* ── Alfa-like auth surface ─────────────────────── */
    :host {
      display: block;
      --auth-red: #ef3124;
      --auth-text: #2b2d33;
      --auth-muted: #7d818a;
      --auth-field: #e6e7eb;
      --auth-field-hover: #dedfe4;
      --auth-dark: #202126;
    }

    .auth-page {
      position: relative;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      min-height: 100vh;
      min-height: 100dvh;
      padding: 0 28px 56px;
      background: #ffffff;
      color: var(--auth-text);
      box-sizing: border-box;
    }

    .auth-topbar {
      position: absolute;
      top: 56px;
      left: 58px;
      right: 48px;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      pointer-events: none;
    }

    .brand-link,
    .client-link {
      pointer-events: auto;
    }

    .brand-link {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      text-decoration: none;

      img {
        display: block;
        width: 128px;
        height: auto;
        object-fit: contain;
      }
    }

    .client-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 32px;
      padding: 0 16px;
      border-radius: 999px;
      background: #f1f2f4;
      color: #202126;
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 14px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0;
      text-decoration: none;
      transition: background 0.16s ease, transform 0.16s ease;

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
        color: var(--auth-red);
      }

      &:hover {
        background: #e8e9ed;
      }

      &:active {
        transform: translateY(1px);
      }
    }

    .auth-card {
      width: min(100%, 488px);
      max-width: 488px;
      margin: clamp(132px, 21vh, 218px) auto 0;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
    }

    .step {
      width: 100%;
    }

    .auth-entry-header {
      margin-bottom: 32px;
    }

    .step-header {
      margin-bottom: 26px;
    }

    .auth-title {
      margin: 0;
      color: var(--auth-text);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 32px;
      font-weight: 760;
      line-height: 1.25;
      letter-spacing: 0;
      text-align: left;
      text-transform: none;
    }

    .auth-subtitle {
      color: var(--auth-muted);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 15px;
      letter-spacing: 0;
      text-align: left;
    }

    .phone-field,
    .email-field {
      display: flex;
      align-items: center;
      width: 100%;
      min-height: 72px;
      border: 0;
      border-radius: 12px;
      background: var(--auth-field);
      box-sizing: border-box;
      transition: background 0.16s ease, box-shadow 0.16s ease;
    }

    .phone-field {
      gap: 12px;
      padding: 9px 16px;
      margin: 0 0 24px;
    }

    .phone-field:hover,
    .email-field:hover {
      background: var(--auth-field-hover);
    }

    .phone-field.focused,
    .email-field:focus-within {
      border: 0;
      box-shadow: 0 0 0 3px rgba(239, 49, 36, 0.12);
    }

    .phone-country-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 54px;
      height: 44px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #6f737c;
      cursor: pointer;
      flex: 0 0 auto;

      mat-icon {
        width: 18px;
        height: 18px;
        font-size: 18px;
      }
    }

    .phone-flag {
      width: 24px;
      height: 16px;
      border-radius: 2px;
      background: linear-gradient(to bottom, #ffffff 0 33.333%, #2f68d8 33.333% 66.666%, #e03232 66.666% 100%);
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    }

    .phone-control {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      justify-content: center;
      gap: 3px;
      cursor: text;
    }

    .auth-field-label {
      display: block;
      color: var(--auth-muted);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      font-weight: 500;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .phone-input-line,
    .password-input-row {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 6px;
    }

    .phone-code {
      color: var(--auth-text);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 16px;
      font-weight: 500;
      line-height: 1.2;
      letter-spacing: 0;
      flex: 0 0 auto;
    }

    .phone-native,
    .email-field input {
      width: 100%;
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--auth-text);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 16px;
      font-weight: 500;
      line-height: 1.2;
      letter-spacing: 0;
      caret-color: var(--auth-red);
      padding: 0;

      &::placeholder {
        color: #969aa3;
        opacity: 1;
      }
    }

    .phone-clear-btn {
      width: 22px;
      height: 22px;
      background: #a7abb3;
      color: #ffffff;
      flex: 0 0 auto;

      &:hover {
        background: #8f949d;
        color: #ffffff;
      }
    }

    .auth-submit {
      width: 100%;
      height: 56px;
      margin: 0;
      border-radius: 10px !important;
      background: var(--auth-dark) !important;
      color: #ffffff !important;
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 16px;
      font-weight: 700;
      letter-spacing: 0;

      &:hover:not(:disabled) {
        background: #111216 !important;
      }

      &:disabled {
        opacity: 1;
        cursor: not-allowed;
      }
    }

    .auth-mode-link {
      display: block;
      width: fit-content;
      margin: 24px auto 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--auth-text);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 16px;
      font-weight: 500;
      line-height: 1.35;
      letter-spacing: 0;
      cursor: pointer;
      text-align: center;

      &:hover {
        color: var(--auth-red);
      }
    }

    .oauth-block {
      margin-top: 24px;
      text-align: center;
    }

    .oauth-label {
      display: block;
      color: var(--auth-muted);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0;
      line-height: 1.3;
    }

    .oauth-icon-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin: 12px 0 0;
      flex-wrap: wrap;
    }

    .oauth-icon-btn {
      width: 44px;
      height: 44px;
      border: 0;
      border-radius: 50%;
      background: #f1f2f4;
      box-shadow: none;

      &:hover:not(:disabled) {
        border-color: transparent;
        filter: none;
        transform: translateY(-1px);
        background: #e8e9ed;
      }
    }

    .email-form {
      gap: 10px;
      margin-top: 0;
    }

    .email-field {
      flex-direction: column;
      align-items: stretch;
      justify-content: center;
      gap: 5px;
      padding: 10px 16px;
      cursor: text;
    }

    .password-input-row {
      gap: 10px;
    }

    .password-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: #777b84;
      cursor: pointer;
      flex: 0 0 auto;

      mat-icon {
        width: 20px;
        height: 20px;
        font-size: 20px;
      }

      &:hover {
        background: rgba(32, 33, 38, 0.06);
        color: var(--auth-text);
      }
    }

    .field-error {
      display: block;
      margin: -4px 0 2px 16px;
      color: var(--auth-red);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 12px;
      line-height: 1.25;
      letter-spacing: 0;
    }

    .form-actions-row {
      justify-content: flex-end;
      margin: 0 0 2px;
    }

    .forgot-link {
      color: var(--auth-text);
      font-size: 14px;
      font-weight: 500;

      &:hover {
        color: var(--auth-red);
      }
    }

    .support-phone {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-top: 28px;
      color: var(--auth-text);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 15px;
      font-weight: 400;
      line-height: 1.4;
      letter-spacing: 0;
      text-align: center;
      text-decoration: none;

      mat-icon {
        width: 22px;
        height: 22px;
        font-size: 22px;
        color: var(--auth-text);
        flex: 0 0 auto;
      }

      b {
        font-weight: 700;
      }

      &:hover b {
        color: var(--auth-red);
      }
    }

    .auth-error,
    .auth-warning,
    .auth-success {
      margin: 0 0 18px;
      border-radius: 12px;
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      letter-spacing: 0;
    }

    .auth-error {
      background: #fff1f0;
      border-color: rgba(239, 49, 36, 0.2);
      color: #c4261a;
    }

    .auth-warning {
      background: #fff7e8;
      border-color: rgba(245, 158, 11, 0.24);
      color: #9a5a00;
    }

    .auth-success {
      background: #ecfdf3;
      border-color: rgba(34, 197, 94, 0.22);
      color: #087443;
    }

    .back-btn {
      color: #6f737c;

      &:hover {
        color: var(--auth-red);
      }
    }

    .otp-input {
      color: var(--auth-text);
      border-bottom-color: #d2d4da;

      &:focus {
        border-color: var(--auth-red);
      }
    }

    .otp-dot {
      background: #d2d4da;

      &.active {
        background: var(--auth-red);
      }
    }

    .countdown-text {
      color: var(--auth-muted);
    }

    .countdown-num,
    .resend-btn {
      color: var(--auth-red);
    }

    .profile-completion-form mat-form-field {
      --mdc-outlined-text-field-outline-color: #d2d4da;
      --mdc-outlined-text-field-hover-outline-color: #b9bdc6;
      --mdc-outlined-text-field-focus-outline-color: var(--auth-red);
      --mdc-outlined-text-field-label-text-color: var(--auth-muted);
      --mdc-outlined-text-field-focus-label-text-color: var(--auth-red);
      --mdc-outlined-text-field-input-text-color: var(--auth-text);
      --mdc-outlined-text-field-caret-color: var(--auth-red);
    }

    @media (max-width: 767px) {
      .auth-page {
        min-height: 100vh;
        min-height: 100dvh;
        padding: 0 18px 40px;
      }

      .auth-topbar {
        top: 22px;
        left: 18px;
        right: 18px;
        gap: 14px;
      }

      .brand-link img {
        width: 108px;
      }

      .client-link {
        min-height: 30px;
        padding: 0 12px;
        font-size: 13px;

        mat-icon {
          width: 16px;
          height: 16px;
          font-size: 16px;
        }
      }

      .auth-card {
        width: 100%;
        margin-top: 118px;
        padding: 0;
      }

      .auth-title {
        font-size: 29px;
      }

      .phone-field,
      .email-field {
        min-height: 68px;
        border-radius: 11px;
      }

      .support-phone {
        align-items: flex-start;
        font-size: 14px;
      }
    }

    @media (max-width: 390px) {
      .auth-page {
        padding-inline: 14px;
      }

      .brand-link img {
        width: 96px;
      }

      .client-link {
        padding: 0 10px;
        font-size: 12px;
      }

      .auth-title {
        font-size: 27px;
      }

      .phone-field {
        gap: 8px;
        padding-inline: 12px;
      }

      .phone-country-btn {
        width: 48px;
      }
    }
  `],
})
export class PhoneLoginComponent implements OnInit, OnDestroy {
  private readonly phoneInputRef = viewChild<ElementRef<HTMLInputElement>>('phoneInput');
  private readonly passwordInputRef = viewChild<ElementRef<HTMLInputElement>>('passwordInput');
  private readonly profileNameInputRef = viewChild<ElementRef<HTMLInputElement>>('profileNameInput');

  private readonly fb = inject(NonNullableFormBuilder);
  protected authService = inject(AuthService);
  private visitorChatService = inject(AuthChatService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private platformId = inject(PLATFORM_ID);
  private zone = inject(NgZone);
  private sanitizer = inject(DomSanitizer);

  step = signal<1 | 2 | 3>(1);
  authMode = signal<AuthMode>('phone');
  emailStep = signal<'identifier' | 'password'>('identifier');
  rawDigits = signal('');
  code = signal('');
  provider = signal('voice_call');
  phoneFocused = signal(false);
  requesting = signal(false);
  isLoading = this.authService.isLoading;
  hidePassword = signal(true);
  errorMessage = signal<string | null>(null);
  emailNotVerified = signal<string | null>(null);
  resendLoading = signal(false);
  resendDone = signal(false);
  verifiedSuccess = signal(false);
  countdown = signal(0);

  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  protected returnUrl = '/';
  protected readonly supportPhone = STUDIO_PHONE;
  protected readonly supportPhoneHref = STUDIO_PHONE_HREF;
  protected readonly otpLength = OTP_LENGTH;
  protected readonly otpDigits = [0, 1, 2, 3] as const;

  phoneValid = computed(() => this.rawDigits().length === 10);
  availableButtons = computed(() =>
    OAUTH_BUTTONS
      .filter(btn => this.authService.availableProviders().some(p => p.id === btn.id))
      .map(btn => ({ ...btn, safeSvg: this.sanitizer.bypassSecurityTrustHtml(btn.svgIcon) }))
  );
  protected readonly emailLoginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  protected readonly profileForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    dateOfBirth: [''],
  });

  /** Отформатированная маска в input */
  maskedPhone = computed(() => applyMask(this.rawDigits()));

  /** Введённая часть (для overlay, прозрачная) */
  maskedPhoneTyped = computed(() => {
    const masked = this.maskedPhone();
    // Подсчитываем позицию последнего введённого символа
    const d = this.rawDigits();
    if (!d.length) return '';
    return masked; // вся набранная часть
  });

  /** Оставшаяся часть маски (серая подсказка) */
  maskedPhoneHint = computed(() => {
    const d = this.rawDigits();
    if (d.length >= 10) return '';
    // Полная маска с подчёркиваниями: (___) ___-__-__
    const full = '(•••) •••-••-••';
    const typed = this.maskedPhone();
    // Показываем оставшуюся часть шаблона после набранного
    return full.slice(typed.length);
  });

  /** Красивый формат для subtitle на шаге 2 */
  formattedPhone = computed(() => {
    const d = this.rawDigits();
    if (d.length < 10) return `+7 ${d}`;
    return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
  });

  get fullPhone(): string {
    return `7${this.rawDigits()}`;
  }

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
    const routeMode = this.route.snapshot.data['authMode'];
    const queryMode = this.route.snapshot.queryParamMap.get('method');
    if (routeMode === 'email' || queryMode === 'email') {
      this.authMode.set('email');
    }
    this.authService.loadAvailableProviders().subscribe();
    if (isPlatformBrowser(this.platformId)) {
      const verified = this.route.snapshot.queryParamMap.get('verified');
      if (verified === 'true') {
        this.verifiedSuccess.set(true);
        this.authMode.set('email');
        const savedUrl = localStorage.getItem('auth_return_url');
        if (savedUrl) {
          this.returnUrl = savedUrl;
          localStorage.removeItem('auth_return_url');
        }
      }
    }
    if (isPlatformBrowser(this.platformId)) {
      // Autofocus с небольшой задержкой после анимации
      setTimeout(() => {
        if (this.authMode() === 'phone') {
          this.phoneInputRef()?.nativeElement?.focus();
        }
      }, 120);
    }
  }

  ngOnDestroy(): void {
    this.stopCountdown();
  }

  setAuthMode(mode: AuthMode): void {
    if (this.authMode() === mode) return;
    this.authMode.set(mode);
    this.errorMessage.set(null);
    this.emailNotVerified.set(null);
    this.resendDone.set(false);
    if (mode === 'phone') {
      requestAnimationFrame(() => this.phoneInputRef()?.nativeElement?.focus());
    } else {
      this.emailStep.set('identifier');
      this.emailLoginForm.controls.password.reset('');
    }
  }

  onEmailContinue(): void {
    const emailControl = this.emailLoginForm.controls.email;
    emailControl.markAsTouched();
    if (emailControl.invalid || this.isLoading()) return;
    this.errorMessage.set(null);
    this.emailNotVerified.set(null);
    this.emailStep.set('password');
    requestAnimationFrame(() => this.passwordInputRef()?.nativeElement?.focus());
  }

  resetEmailStep(): void {
    this.errorMessage.set(null);
    this.emailNotVerified.set(null);
    this.emailStep.set('identifier');
    this.emailLoginForm.controls.password.reset('');
  }

  onPhoneFocus(): void {
    this.phoneFocused.set(true);
  }

  /** Обработка обычного ввода (кроме backspace) */
  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selStart = input.selectionStart ?? input.value.length;

    let digits = input.value.replace(/\D/g, '');
    // Убираем ведущий 7 или 8
    if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    this.rawDigits.set(digits);
    this.errorMessage.set(null);

    // Восстановление позиции курсора
    const rawBefore = input.value.slice(0, selStart).replace(/\D/g, '');
    let digitsBeforeCursor = rawBefore.length;
    if (rawBefore.startsWith('7') || rawBefore.startsWith('8')) digitsBeforeCursor--;
    digitsBeforeCursor = Math.min(Math.max(digitsBeforeCursor, 0), digits.length);

    requestAnimationFrame(() => {
      const masked = this.maskedPhone();
      input.value = masked;
      input.setSelectionRange(
        cursorAfterDigits(masked, digitsBeforeCursor),
        cursorAfterDigits(masked, digitsBeforeCursor),
      );
    });
  }

  /** Корректный backspace, удаляет цифру, пропуская разделители маски */
  onPhoneKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Backspace') return;
    const input = event.target as HTMLInputElement;
    const pos = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? pos;

    // Если есть выделение, дать браузеру удалить, input-событие разберётся
    if (pos !== end) return;

    event.preventDefault();
    const val = input.value;

    // Найти последнюю цифру перед курсором
    let digitIdx = -1;
    let digitPosInRaw = -1;
    let digitCount = 0;
    for (let i = 0; i < pos; i++) {
      if (/\d/.test(val[i])) { digitIdx = i; digitPosInRaw = digitCount; digitCount++; }
    }

    if (digitIdx === -1) return; // нечего удалять

    const d = this.rawDigits();
    const newDigits = d.slice(0, digitPosInRaw) + d.slice(digitPosInRaw + 1);
    this.rawDigits.set(newDigits);

    requestAnimationFrame(() => {
      const masked = this.maskedPhone();
      input.value = masked;
      const newPos = cursorAfterDigits(masked, digitPosInRaw);
      input.setSelectionRange(newPos, newPos);
    });
  }

  /** Вставка из буфера, извлекаем цифры, форматируем */
  onPhonePaste(event: ClipboardEvent): void {
    event.preventDefault();
    const text = event.clipboardData?.getData('text') || '';
    let digits = text.replace(/\D/g, '');
    if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    this.rawDigits.set(digits);
    this.errorMessage.set(null);

    requestAnimationFrame(() => {
      const input = event.target as HTMLInputElement;
      const masked = this.maskedPhone();
      input.value = masked;
      const pos = cursorAfterDigits(masked, digits.length);
      input.setSelectionRange(pos, pos);
    });
  }

  clearPhone(): void {
    this.rawDigits.set('');
    this.errorMessage.set(null);
    requestAnimationFrame(() => this.phoneInputRef()?.nativeElement?.focus());
  }

  onCodeInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    input.value = digits;
    this.code.set(digits);
    this.errorMessage.set(null);
  }

  onRequestCode(): void {
    if (!this.phoneValid() || this.requesting()) return;
    this.errorMessage.set(null);
    this.requesting.set(true);

    this.authService.requestPhoneCode(this.fullPhone).subscribe({
      next: (res) => {
        this.requesting.set(false);
        this.provider.set(res.provider);
        this.step.set(2);
        this.startCountdown();
      },
      error: (err) => {
        this.requesting.set(false);
        const msg = err?.error || err?.message || 'Не удалось запустить звонок. Попробуйте позже.';
        this.errorMessage.set(typeof msg === 'string' ? msg : 'Не удалось запустить звонок. Попробуйте позже.');
      },
    });
  }

  onVerify(): void {
    if (this.code().length !== OTP_LENGTH || this.isLoading()) return;
    this.errorMessage.set(null);

    this.authService.verifyPhoneCode(this.fullPhone, this.code()).subscribe({
      next: (res) => {
        if (res.requiresProfile) {
          this.step.set(3);
          this.stopCountdown();
          requestAnimationFrame(() => this.profileNameInputRef()?.nativeElement?.focus());
          return;
        }

        this.visitorChatService.linkUserAfterAuth();
        this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
      },
      error: (err) => {
        const msg = err?.error || err?.message || 'Неверный код. Попробуйте ещё раз.';
        this.errorMessage.set(typeof msg === 'string' ? msg : 'Неверный код.');
      },
    });
  }

  onCompletePhoneRegistration(): void {
    if (this.profileForm.invalid || this.isLoading()) {
      this.profileForm.markAllAsTouched();
      return;
    }

    const raw = this.profileForm.getRawValue();
    const displayName = raw.displayName.trim();
    const dateOfBirth = raw.dateOfBirth.trim();
    const profile: PhoneAuthProfileInput = {
      displayName,
      ...(dateOfBirth ? { dateOfBirth } : {}),
    };

    this.errorMessage.set(null);
    this.authService.verifyPhoneCode(this.fullPhone, this.code(), false, profile).subscribe({
      next: (res) => {
        if (res.requiresProfile) {
          this.errorMessage.set('Введите имя, чтобы завершить вход.');
          return;
        }
        this.visitorChatService.linkUserAfterAuth();
        this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
      },
      error: (err) => {
        const msg = err?.error || err?.message || 'Не удалось завершить вход. Запросите код ещё раз.';
        this.errorMessage.set(typeof msg === 'string' ? msg : 'Не удалось завершить вход.');
      },
    });
  }

  onQrLogin(): void {
    this.errorMessage.set('QR-вход подключается к мобильному подтверждению. Пока используйте телефон или почту.');
  }

  onEmailSubmit(): void {
    if (this.emailLoginForm.invalid || this.isLoading()) {
      this.emailLoginForm.markAllAsTouched();
      return;
    }

    const { email, password } = this.emailLoginForm.getRawValue();
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
          return;
        }

        const msg = err?.error || err?.message || 'Неверный email или пароль';
        this.errorMessage.set(typeof msg === 'string' ? msg : 'Неверный email или пароль');
      },
    });
  }

  onResendVerification(): void {
    const email = this.emailNotVerified();
    if (!email || this.resendLoading()) return;
    this.resendLoading.set(true);
    this.resendDone.set(false);

    this.authService.resendVerificationEmail(email).subscribe({
      next: () => {
        this.resendLoading.set(false);
        this.resendDone.set(true);
      },
      error: () => {
        this.resendLoading.set(false);
        this.resendDone.set(true);
      },
    });
  }

  onOAuthSignIn(providerId: string): void {
    this.authService.signInWithProvider(providerId, this.returnUrl).subscribe();
  }

  onResend(): void {
    this.step.set(1);
    this.code.set('');
    this.profileForm.reset();
    this.errorMessage.set(null);
    this.stopCountdown();
    setTimeout(() => this.phoneInputRef()?.nativeElement?.focus(), 120);
  }

  goBack(): void {
    this.step.set(1);
    this.code.set('');
    this.profileForm.reset();
    this.errorMessage.set(null);
    this.stopCountdown();
    setTimeout(() => this.phoneInputRef()?.nativeElement?.focus(), 120);
  }

  backToCode(): void {
    this.step.set(2);
    this.errorMessage.set(null);
  }

  startCountdown(): void {
    this.stopCountdown();
    this.countdown.set(60);
    if (!isPlatformBrowser(this.platformId)) return;

    this.zone.runOutsideAngular(() => {
      this.countdownTimer = setInterval(() => {
        this.zone.run(() => {
          this.countdown.update(v => {
            if (v <= 1) { this.stopCountdown(); return 0; }
            return v - 1;
          });
        });
      }, 1000);
    });
  }

  stopCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }
}
