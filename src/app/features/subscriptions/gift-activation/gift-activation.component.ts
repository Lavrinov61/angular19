import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../../core/services/auth.service';
import { STUDIO_PHONE, STUDIO_PHONE_HREF } from '../../../core/data/address.data';
import { CodeCellsInputComponent } from '../../../shared/code-cells-input/code-cells-input.component';
import {
  GiftActivationService,
  type GiftStartResponse,
  type GiftFinalizeResponse,
} from './gift-activation.service';

/**
 * Версия политики конфиденциальности. Синхронизирована с
 * AuthService.PRIVACY_POLICY_VERSION (auth.service.ts), там она приватна,
 * поэтому дублируем здесь как локальную константу. При обновлении политики
 * менять в обоих местах.
 */
const POLICY_VERSION = '2026-05-16';

// Маска телефона: (XXX) XXX-XX-XX, копия логики из phone-login.component.ts
const PHONE_MASK = '(___) ___-__-__';
function applyPhoneMask(digits: string): string {
  let result = '';
  const d = digits.slice(0, 10);
  let di = 0;
  for (let i = 0; i < PHONE_MASK.length; i++) {
    if (PHONE_MASK[i] === '_') {
      result += di < d.length ? d[di++] : '_';
    } else {
      if (i === 0 && d.length === 0) break;
      if (i === 5 && d.length < 3) break;
      if (i === 5 && d.length === 3) { result += ')'; break; }
      if (i === 9 && d.length < 6) break;
      if (i === 12 && d.length < 8) break;
      result += PHONE_MASK[i];
    }
  }
  return result;
}
function phoneCursorPos(masked: string, digitCount: number): number {
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

type Step = 'form' | 'verify' | 'success';
const CODE_LENGTH = 4;

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const body = Reflect.get(error, 'error');
  if (typeof body === 'object' && body !== null) {
    const code = Reflect.get(body, 'code');
    if (typeof code === 'string') return code;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
}

function readRetryAfter(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const body = Reflect.get(error, 'error');
  const src = (typeof body === 'object' && body !== null) ? body : error;
  const v = Reflect.get(src, 'retryAfterSec');
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

@Component({
  selector: 'app-gift-activation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    CodeCellsInputComponent,
  ],
  template: `
    <div class="auth-page">
      <header class="auth-topbar">
        <a class="brand-link" routerLink="/" aria-label="Своё Фото">
          <img src="/assets/static/logo-black.webp" alt="Своё Фото" width="128" height="40" />
        </a>
      </header>

      <div class="auth-card">

        <!-- ═══ ШАГ 1: Форма данных получателя ═══ -->
        @if (step() === 'form') {
          <div class="step">
            <div class="step-header">
              <h1 class="auth-title">Активируйте<br>подарок</h1>
              @if (giftPlanName()) {
                <p class="auth-subtitle">{{ giftPlanName() }}, на 1 месяц</p>
              } @else {
                <p class="auth-subtitle">Заполните данные, чтобы получить подписку</p>
              }
            </div>

            @if (errorMessage()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <form [formGroup]="form" (ngSubmit)="onStart()" class="gift-form">
              <label class="field">
                <span class="field-label">Фамилия Имя Отчество</span>
                <input #fullNameInput formControlName="fullName" type="text"
                       name="name" autocomplete="name" maxlength="120"
                       placeholder="Иванов Иван Иванович">
              </label>
              @if (form.controls.fullName.touched && form.controls.fullName.hasError('required')) {
                <span class="field-error">Введите ФИО</span>
              } @else if (form.controls.fullName.hasError('minlength')) {
                <span class="field-error">Минимум 2 символа</span>
              }

              <label class="field">
                <span class="field-label">Дата рождения (по желанию)</span>
                <input formControlName="dateOfBirth" type="date" name="bday" autocomplete="bday">
              </label>

              <div class="field phone-field" [class.focused]="phoneFocused()">
                <span class="phone-code">+7</span>
                <label class="phone-control">
                  <span class="field-label">Номер телефона</span>
                  <input #phoneInput class="phone-native" type="tel" inputmode="numeric"
                         autocomplete="tel-national" placeholder="(___) ___-__-__"
                         [value]="maskedPhone()"
                         (input)="onPhoneInput($event)"
                         (keydown)="onPhoneKeydown($event)"
                         (focus)="phoneFocused.set(true)"
                         (blur)="phoneFocused.set(false)">
                </label>
              </div>
              @if (phoneTouched() && !phoneValid()) {
                <span class="field-error">Введите 10 цифр номера</span>
              }

              <label class="field">
                <span class="field-label">Email</span>
                <input formControlName="email" type="email" name="email"
                       autocomplete="email" placeholder="example@mail.com">
              </label>
              @if (form.controls.email.touched && form.controls.email.hasError('required')) {
                <span class="field-error">Введите email</span>
              } @else if (form.controls.email.hasError('email')) {
                <span class="field-error">Некорректный email</span>
              }

              <label class="consent-row">
                <input type="checkbox" formControlName="consent">
                <span class="consent-text">
                  Я согласен на обработку персональных данных в соответствии с
                  <a href="/privacy" target="_blank" rel="noopener">политикой конфиденциальности</a>
                  (152-ФЗ).
                </span>
              </label>

              <button mat-flat-button type="submit" class="auth-submit"
                      [disabled]="!canSubmitForm() || loading()">
                @if (loading()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Получить код
                }
              </button>
            </form>
          </div>
        }

        <!-- ═══ ШАГ 2: Подтверждение кодами ═══ -->
        @if (step() === 'verify') {
          <div class="step">
            <button class="back-btn" type="button" (click)="backToForm()">
              <mat-icon>arrow_back</mat-icon>
              <span>Изменить данные</span>
            </button>

            <div class="step-header">
              <h1 class="auth-title">Подтвердите<br>контакты</h1>
            </div>

            @if (phoneSkipped()) {
              <div class="auth-warning">
                <mat-icon>phone_disabled</mat-icon>
                <span>Звонок недоступен. Подтвердите активацию по email.</span>
              </div>
            }

            @if (errorMessage()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ errorMessage() }}</span>
              </div>
            }

            <!-- Email-код (обязателен) -->
            <div class="code-block">
              <p class="code-label">
                <span>Код из письма на <b>{{ maskedEmail() }}</b></span>
              </p>
              <app-code-cells-input
                [(value)]="emailCode"
                [length]="codeLength"
                [disabled]="verifying()"
                [error]="emailCodeError()"
                [blocked]="emailBlocked()"
                ariaLabel="Код из email"
                (enter)="onVerify()" />
              <div class="resend-row">
                @if (emailBlocked()) {
                  <span class="locked-text">Код заблокирован. Запросите новый.</span>
                  <button class="resend-btn" type="button"
                          [disabled]="emailCooldown() > 0 || resending()"
                          (click)="onResend('email')">
                    Запросить новый код
                  </button>
                } @else if (emailCooldown() > 0) {
                  <span class="countdown-text">Отправить ещё раз через <span class="countdown-num">{{ emailCooldown() }}</span> сек</span>
                } @else {
                  <button class="resend-btn" type="button" [disabled]="resending()" (click)="onResend('email')">
                    <mat-icon>refresh</mat-icon> Отправить письмо ещё раз
                  </button>
                }
              </div>
            </div>

            <!-- Voice-код (если звонок состоялся) -->
            @if (!phoneSkipped()) {
              <div class="code-block">
                <p class="code-label">
                  <span>Код из звонка на <b>{{ maskedPhone() }}</b></span>
                </p>
                <app-code-cells-input
                  [(value)]="voiceCode"
                  [length]="codeLength"
                  [disabled]="verifying()"
                  [error]="voiceCodeError()"
                  [blocked]="voiceBlocked()"
                  ariaLabel="Код из звонка"
                  (enter)="onVerify()" />
                <div class="resend-row">
                  @if (voiceBlocked()) {
                    <span class="locked-text">Код заблокирован. Запросите новый звонок.</span>
                    <button class="resend-btn" type="button"
                            [disabled]="voiceCooldown() > 0 || resending()"
                            (click)="onResend('voice')">
                      Позвонить ещё раз
                    </button>
                  } @else if (voiceCooldown() > 0) {
                    <span class="countdown-text">Повторный звонок через <span class="countdown-num">{{ voiceCooldown() }}</span> сек</span>
                  } @else {
                    <button class="resend-btn" type="button" [disabled]="resending()" (click)="onResend('voice')">
                      <mat-icon>refresh</mat-icon> Позвонить ещё раз
                    </button>
                  }
                </div>
              </div>
            }

            <button mat-flat-button type="button" class="auth-submit"
                    [disabled]="!canVerify() || verifying()"
                    (click)="onVerify()">
              @if (verifying()) {
                <mat-spinner diameter="20" />
              } @else {
                Завершить активацию
              }
            </button>

            @if (!phoneSkipped()) {
              <button class="auth-mode-link" type="button"
                      [disabled]="emailCode().length !== codeLength || verifying()"
                      (click)="onVerify(true)">
                Не дозвонились? Завершить только по email
              </button>
            }
          </div>
        }

        <!-- ═══ ШАГ 3: Успех ═══ -->
        @if (step() === 'success') {
          <div class="step success-step">
            <div class="success-check">
              <mat-icon>check_circle</mat-icon>
            </div>
            <h1 class="auth-title success-title">{{ successTitle() }}</h1>
            <p class="auth-subtitle success-sub">{{ successSubtitle() }}</p>
            @if (requiresPhoneLogin()) {
              <button mat-flat-button type="button" class="auth-submit" (click)="goToLogin()">
                Войти по телефону
              </button>
            } @else {
              <button mat-flat-button type="button" class="auth-submit" (click)="goToSubscription()">
                Перейти к подписке
              </button>
            }
          </div>
        }

      </div>
    </div>
  `,
  styles: [`
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
    }

    .brand-link img {
      display: block;
      width: 128px;
      height: auto;
      object-fit: contain;
    }

    .auth-card {
      width: min(100%, 488px);
      max-width: 488px;
      margin: clamp(120px, 18vh, 200px) auto 0;
    }

    .step { width: 100%; animation: stepIn 0.2s ease-out both; }
    @keyframes stepIn {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .step-header { margin-bottom: 26px; }

    .auth-title {
      margin: 0;
      color: var(--auth-text);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 32px;
      font-weight: 760;
      line-height: 1.25;
      letter-spacing: 0;
      text-align: left;
    }

    .auth-subtitle {
      margin: 12px 0 0;
      color: var(--auth-muted);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 15px;
      text-align: left;
    }

    .gift-form {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .field {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      justify-content: center;
      gap: 5px;
      width: 100%;
      min-height: 64px;
      padding: 10px 16px;
      border: 0;
      border-radius: 12px;
      background: var(--auth-field);
      box-sizing: border-box;
      cursor: text;
      transition: background 0.16s ease, box-shadow 0.16s ease;
    }

    .field:hover { background: var(--auth-field-hover); }
    .field:focus-within { box-shadow: 0 0 0 3px rgba(239, 49, 36, 0.12); }

    .field-label {
      display: block;
      color: var(--auth-muted);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      font-weight: 500;
      line-height: 1.2;
    }

    .field input {
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
      caret-color: var(--auth-red);
      padding: 0;
    }

    .field input::placeholder { color: #969aa3; opacity: 1; }

    .phone-field {
      flex-direction: row;
      align-items: center;
      gap: 10px;
    }
    .phone-field.focused { box-shadow: 0 0 0 3px rgba(239, 49, 36, 0.12); }

    .phone-code {
      color: var(--auth-text);
      font-size: 16px;
      font-weight: 600;
      flex: 0 0 auto;
    }

    .phone-control {
      display: flex;
      flex: 1;
      min-width: 0;
      flex-direction: column;
      justify-content: center;
      gap: 5px;
      cursor: text;
    }

    .phone-native { font-size: 16px; }

    .field-error {
      display: block;
      margin: -8px 0 0 16px;
      color: var(--auth-red);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 12px;
      line-height: 1.25;
    }

    .consent-row {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 4px 0 4px;
      cursor: pointer;
    }

    .consent-row input[type="checkbox"] {
      flex: 0 0 auto;
      width: 20px;
      height: 20px;
      margin: 2px 0 0;
      accent-color: var(--auth-red);
      cursor: pointer;
    }

    .consent-text {
      color: var(--auth-muted);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      line-height: 1.4;
    }

    .consent-text a {
      color: var(--auth-text);
      text-decoration: underline;
    }
    .consent-text a:hover { color: var(--auth-red); }

    .auth-submit {
      width: 100%;
      height: 56px;
      margin: 8px 0 0;
      border-radius: 10px !important;
      background: var(--auth-dark) !important;
      color: #ffffff !important;
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 16px;
      font-weight: 700;
    }
    .auth-submit:hover:not(:disabled) { background: #111216 !important; }
    .auth-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    .auth-mode-link {
      display: block;
      width: fit-content;
      margin: 18px auto 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--auth-text);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      text-align: center;
    }
    .auth-mode-link:hover:not(:disabled) { color: var(--auth-red); }
    .auth-mode-link:disabled { opacity: 0.45; cursor: not-allowed; }

    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 20px;
      padding: 2px 4px 2px 0;
      border: 0;
      background: none;
      color: #6f737c;
      cursor: pointer;
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      font-weight: 600;
    }
    .back-btn mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
    .back-btn:hover { color: var(--auth-red); }

    .code-block { margin: 0 0 22px; }

    .code-label {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 0 0 12px;
      color: var(--auth-muted);
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 14px;
      line-height: 1.4;
    }
    .code-label b { color: var(--auth-text); font-weight: 700; }

    .resend-row { margin-top: 12px; text-align: center; }

    .countdown-text {
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 13px;
      color: var(--auth-muted);
    }
    .countdown-num { font-weight: 700; color: var(--auth-red); }

    .resend-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 0;
      background: none;
      color: var(--auth-red);
      cursor: pointer;
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 14px;
      font-weight: 600;
      padding: 0;
    }
    .resend-btn mat-icon { font-size: 1rem; width: 1rem; height: 1rem; }
    .resend-btn:hover:not(:disabled) { opacity: 0.75; }
    .resend-btn:disabled { opacity: 0.45; cursor: not-allowed; }

    .locked-text {
      display: block;
      margin-bottom: 6px;
      color: var(--auth-red);
      font-size: 13px;
    }

    .auth-error,
    .auth-warning {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin: 0 0 18px;
      padding: 12px 16px;
      border-radius: 12px;
      font-family: var(--ed-font-body, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
      font-size: 14px;
    }
    .auth-error { background: #fff1f0; color: #c4261a; }
    .auth-warning { background: #fff7e8; color: #9a5a00; }
    .auth-error mat-icon,
    .auth-warning mat-icon { flex-shrink: 0; }

    .success-step { text-align: center; }

    .success-check {
      display: grid;
      place-items: center;
      margin: 0 auto 20px;
    }
    .success-check mat-icon {
      width: 72px;
      height: 72px;
      font-size: 72px;
      color: #22c55e;
    }

    .success-title { text-align: center; }
    .success-sub { text-align: center; }
    .success-step .auth-submit { margin-top: 28px; }

    @media (max-width: 767px) {
      .auth-page { padding: 0 18px 40px; }
      .auth-topbar { top: 22px; left: 18px; right: 18px; }
      .brand-link img { width: 108px; }
      .auth-card { margin-top: 110px; }
      .auth-title { font-size: 29px; }
    }
  `],
})
export class GiftActivationComponent implements OnInit, OnDestroy {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly zone = inject(NgZone);
  private readonly authService = inject(AuthService);
  private readonly giftService = inject(GiftActivationService);

  private readonly fullNameInputRef = viewChild<ElementRef<HTMLInputElement>>('fullNameInput');
  private readonly phoneInputRef = viewChild<ElementRef<HTMLInputElement>>('phoneInput');

  protected readonly codeLength = CODE_LENGTH;
  protected readonly supportPhone = STUDIO_PHONE;
  protected readonly supportPhoneHref = STUDIO_PHONE_HREF;

  readonly step = signal<Step>('form');
  readonly loading = signal(false);
  readonly resending = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // Промокод из ?promo и распознанный план
  private promoCode = '';
  readonly giftPlanName = signal('');

  // Телефон (вне formGroup, отдельная маска)
  readonly phoneDigits = signal('');
  readonly phoneFocused = signal(false);
  readonly phoneTouched = signal(false);
  readonly maskedPhone = signal('');        // маскированный из /start, не путать с локальной маской ввода
  readonly maskedEmail = signal('');
  readonly maskedPhoneInput = computed(() => applyPhoneMask(this.phoneDigits()));
  readonly phoneValid = computed(() => this.phoneDigits().length === 10);

  // Шаг verify
  readonly phoneSkipped = signal(false);
  readonly emailCode = signal('');
  readonly voiceCode = signal('');
  readonly emailCodeError = signal(false);
  readonly voiceCodeError = signal(false);
  readonly emailBlocked = signal(false);
  readonly voiceBlocked = signal(false);
  readonly emailCooldown = signal(0);
  readonly voiceCooldown = signal(0);

  // Идёт единый verify-запрос
  readonly verifying = signal(false);

  // Success
  readonly successTitle = signal('');
  readonly successSubtitle = signal('');
  /** Ветка «только по email»: телефон не подтверждён → вход отдельно по телефону. */
  readonly requiresPhoneLogin = signal(false);

  private emailTimer: ReturnType<typeof setInterval> | null = null;
  private voiceTimer: ReturnType<typeof setInterval> | null = null;

  readonly form = this.fb.group({
    fullName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(120)]],
    dateOfBirth: [''],
    email: ['', [Validators.required, Validators.email]],
    consent: [false, [Validators.requiredTrue]],
  });

  readonly canSubmitForm = computed(() =>
    this.form.valid && this.phoneValid(),
  );

  /** «Завершить» активно по локальному условию: email-код полон И (недозвон ИЛИ voice-код полон). */
  readonly canVerify = computed(() => {
    if (this.emailCode().length !== CODE_LENGTH || this.emailBlocked()) return false;
    if (this.phoneSkipped()) return true;
    return this.voiceCode().length === CODE_LENGTH && !this.voiceBlocked();
  });

  ngOnInit(): void {
    this.promoCode = (this.route.snapshot.queryParamMap.get('promo') || '').toUpperCase().trim();
    const planName = this.route.snapshot.queryParamMap.get('plan');
    if (planName) this.giftPlanName.set(planName);

    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => this.fullNameInputRef()?.nativeElement?.focus(), 120);
    }
  }

  ngOnDestroy(): void {
    this.stopTimer('email');
    this.stopTimer('voice');
  }

  // ── Телефонная маска (как в phone-login) ──────────────────────────────
  onPhoneInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const selStart = input.selectionStart ?? input.value.length;
    let digits = input.value.replace(/\D/g, '');
    if (digits.startsWith('7') || digits.startsWith('8')) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    this.phoneDigits.set(digits);
    this.phoneTouched.set(true);
    this.errorMessage.set(null);

    const rawBefore = input.value.slice(0, selStart).replace(/\D/g, '');
    let digitsBeforeCursor = rawBefore.length;
    if (rawBefore.startsWith('7') || rawBefore.startsWith('8')) digitsBeforeCursor--;
    digitsBeforeCursor = Math.min(Math.max(digitsBeforeCursor, 0), digits.length);

    requestAnimationFrame(() => {
      const masked = this.maskedPhoneInput();
      input.value = masked;
      const pos = phoneCursorPos(masked, digitsBeforeCursor);
      input.setSelectionRange(pos, pos);
    });
  }

  onPhoneKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Backspace') return;
    const input = event.target as HTMLInputElement;
    const pos = input.selectionStart ?? 0;
    if (pos === 0 || input.selectionStart !== input.selectionEnd) return;
    const charBefore = input.value[pos - 1];
    if (charBefore && /\D/.test(charBefore)) {
      event.preventDefault();
      let newPos = pos - 1;
      while (newPos > 0 && /\D/.test(input.value[newPos - 1])) newPos--;
      if (newPos > 0) {
        const digits = this.phoneDigits();
        let digitIndex = 0;
        for (let i = 0; i < newPos; i++) {
          if (/\d/.test(input.value[i])) digitIndex++;
        }
        this.phoneDigits.set(digits.slice(0, digitIndex - 1) + digits.slice(digitIndex));
        requestAnimationFrame(() => {
          const masked = this.maskedPhoneInput();
          input.value = masked;
          const p = phoneCursorPos(masked, Math.max(0, digitIndex - 1));
          input.setSelectionRange(p, p);
        });
      }
    }
  }

  // ── Шаг 1 → /start ────────────────────────────────────────────────────
  onStart(): void {
    this.phoneTouched.set(true);
    if (!this.canSubmitForm() || this.loading()) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.promoCode) {
      this.errorMessage.set('Не указан промокод подарка. Откройте ссылку из приглашения заново.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);
    const raw = this.form.getRawValue();
    const dob = raw.dateOfBirth.trim();

    this.giftService.start({
      promo_code: this.promoCode,
      full_name: raw.fullName.trim(),
      ...(dob ? { date_of_birth: dob } : {}),
      phone: `7${this.phoneDigits()}`,
      email: raw.email.trim(),
      consent: true,
      policy_version: POLICY_VERSION,
    }).subscribe({
      next: (res) => this.onStarted(res),
      error: (err) => this.onStartError(err),
    });
  }

  private onStarted(res: GiftStartResponse): void {
    this.loading.set(false);
    this.maskedPhone.set(res.maskedPhone);
    this.maskedEmail.set(res.maskedEmail);
    this.phoneSkipped.set(!res.voiceSent);
    this.emailCode.set('');
    this.voiceCode.set('');
    this.emailCodeError.set(false);
    this.voiceCodeError.set(false);
    this.step.set('verify');
    this.startTimer('email', res.resendCooldownSec);
    if (res.voiceSent) this.startTimer('voice', res.resendCooldownSec);
  }

  private onStartError(err: unknown): void {
    this.loading.set(false);
    const code = readErrorCode(err);
    switch (code) {
      case 'GIFT_PROMO_INVALID':
        this.errorMessage.set('Подарок не найден или уже использован.');
        break;
      case 'PHONE_INVALID':
        this.errorMessage.set('Некорректный номер телефона.');
        break;
      case 'ACTIVATION_RATE_LIMITED': {
        const retry = readRetryAfter(err);
        this.errorMessage.set(retry
          ? `Слишком много попыток. Повторите через ${retry} сек.`
          : 'Слишком много попыток. Повторите позже.');
        break;
      }
      case 'VALIDATION_ERROR':
        this.errorMessage.set('Проверьте правильность заполнения полей.');
        break;
      default:
        this.errorMessage.set(this.fallbackMessage(err));
    }
  }

  // ── Шаг 2: verify-email → verify-phone → finalize ─────────────────────
  onVerify(viaEmailOnly = false): void {
    if (this.verifying()) return;
    const emailOnly = viaEmailOnly || this.phoneSkipped();
    // Локальный гард: email-код полон + (email-only ИЛИ voice-код полон).
    if (this.emailCode().length !== CODE_LENGTH || this.emailBlocked()) return;
    if (!emailOnly && (this.voiceCode().length !== CODE_LENGTH || this.voiceBlocked())) return;

    this.verifying.set(true);
    this.errorMessage.set(null);
    this.emailCodeError.set(false);
    this.voiceCodeError.set(false);

    // email подтверждается ВСЕГДА → затем телефон (если не email-only) → finalize.
    this.giftService.verifyEmail(this.emailCode()).subscribe({
      next: () => {
        if (emailOnly) {
          this.doFinalize(true);
        } else {
          this.giftService.verifyPhone(this.voiceCode()).subscribe({
            next: () => this.doFinalize(false),
            error: (err) => this.onVerifyError(err),
          });
        }
      },
      error: (err) => this.onVerifyError(err),
    });
  }

  private doFinalize(viaEmailOnly: boolean): void {
    this.giftService.finalize({ viaEmailOnly }).subscribe({
      next: (res) => this.onFinalized(res),
      error: (err) => this.onVerifyError(err),
    });
  }

  private onFinalized(res: GiftFinalizeResponse): void {
    // Ветка «только по email»: телефон не подтверждён → бэк НЕ выдал токены,
    // показываем успех с просьбой войти по телефону (подписка уже активна).
    if (res.requiresPhoneLogin || !res.accessToken || !res.refreshToken) {
      this.showSuccess(res, true);
      return;
    }
    // Телефон подтверждён → бэк поставил cookie + вернул токены → логин.
    this.authService.handleAuthCallback(res.accessToken, res.refreshToken).subscribe({
      next: () => this.showSuccess(res, false),
      // Даже если профиль не догрузился, активация прошла, показываем успех.
      error: () => this.showSuccess(res, false),
    });
  }

  private showSuccess(res: GiftFinalizeResponse, requiresPhoneLogin: boolean): void {
    this.verifying.set(false);
    this.stopTimer('email');
    this.stopTimer('voice');
    this.requiresPhoneLogin.set(requiresPhoneLogin);

    const sub = res.subscription;
    const extended = sub.mode === 'extended';
    const endDate = sub.current_period_end
      ? new Date(sub.current_period_end).toLocaleDateString('ru-RU')
      : '';

    this.successTitle.set(extended ? 'Подписка продлена!' : 'Подписка активирована!');

    const parts: string[] = [sub.plan_name];
    if (extended && endDate) {
      parts.push(`продлена до ${endDate}`);
    } else if (endDate) {
      parts.push(`активна до ${endDate}`);
    }
    if (res.account.already_existed) {
      parts.push('добавлена в ваш аккаунт');
    }
    if (requiresPhoneLogin) {
      parts.push('войдите по номеру телефона, чтобы пользоваться');
    }
    this.successSubtitle.set(parts.join(' · '));

    this.clearPromoQuery();
    this.step.set('success');
  }

  private onVerifyError(err: unknown): void {
    this.verifying.set(false);
    const code = readErrorCode(err);
    switch (code) {
      case 'EMAIL_CODE_INVALID':
        this.emailCodeError.set(true);
        this.emailCode.set('');
        this.errorMessage.set('Неверный код из письма.');
        break;
      case 'EMAIL_CODE_EXPIRED':
        this.emailCode.set('');
        this.errorMessage.set('Код из письма истёк. Запросите новый.');
        break;
      case 'PHONE_CODE_INVALID':
        this.voiceCodeError.set(true);
        this.voiceCode.set('');
        this.errorMessage.set('Неверный код из звонка.');
        break;
      case 'PHONE_CODE_EXPIRED':
        this.voiceCode.set('');
        this.errorMessage.set('Код из звонка истёк. Закажите новый звонок.');
        break;
      case 'ACTIVATION_CODE_LOCKED':
        // Бэк не различает, какой код заблокирован, блокируем оба, подсказываем resend.
        this.emailBlocked.set(true);
        if (!this.phoneSkipped()) this.voiceBlocked.set(true);
        this.errorMessage.set('Код заблокирован после нескольких попыток. Запросите новый.');
        break;
      case 'GIFT_PROMO_INVALID':
        // Промокод стал недействителен (уже использован), назад на форму.
        this.errorMessage.set('Подарок уже использован или недоступен.');
        this.step.set('form');
        break;
      case 'ACTIVATION_NOT_VERIFIED':
        // Сессия потеряла подтверждение кода (редко), просим ввести заново.
        this.errorMessage.set('Подтвердите коды заново.');
        this.emailCode.set('');
        this.voiceCode.set('');
        break;
      case 'ACTIVATION_SESSION_INVALID':
        this.onSessionInvalid();
        break;
      default:
        this.errorMessage.set(this.fallbackMessage(err));
    }
  }

  private onSessionInvalid(): void {
    this.errorMessage.set('Сессия активации истекла. Начните заново.');
    this.emailCode.set('');
    this.voiceCode.set('');
    this.emailBlocked.set(false);
    this.voiceBlocked.set(false);
    this.step.set('form');
  }

  // ── Resend / patch email ──────────────────────────────────────────────
  onResend(channel: 'voice' | 'email'): void {
    if (this.resending() || this.verifying()) return;
    if (channel === 'email' && this.emailCooldown() > 0 && !this.emailBlocked()) return;
    if (channel === 'voice' && this.voiceCooldown() > 0 && !this.voiceBlocked()) return;

    this.resending.set(true);
    this.errorMessage.set(null);

    this.giftService.resend({ channel }).subscribe({
      next: (res) => {
        this.resending.set(false);
        if (channel === 'email') {
          this.emailBlocked.set(false);
          this.emailCodeError.set(false);
          this.emailCode.set('');
          if (res.maskedEmail) this.maskedEmail.set(res.maskedEmail);
        } else {
          this.voiceBlocked.set(false);
          this.voiceCodeError.set(false);
          this.voiceCode.set('');
        }
        this.startTimer(channel, res.resendCooldownSec);
      },
      error: (err) => {
        this.resending.set(false);
        const code = readErrorCode(err);
        if (code === 'ACTIVATION_RATE_LIMITED') {
          const retry = readRetryAfter(err);
          if (retry) this.startTimer(channel, retry);
          this.errorMessage.set(retry
            ? `Слишком часто. Повторите через ${retry} сек.`
            : 'Слишком часто. Повторите позже.');
          return;
        }
        if (code === 'ACTIVATION_SESSION_INVALID') {
          this.onSessionInvalid();
          return;
        }
        this.errorMessage.set(this.fallbackMessage(err));
      },
    });
  }

  // ── Навигация ─────────────────────────────────────────────────────────
  backToForm(): void {
    if (this.loading()) return;
    this.step.set('form');
    this.errorMessage.set(null);
  }

  goToSubscription(): void {
    this.router.navigate(['/profile/subscription']);
  }

  goToLogin(): void {
    this.router.navigate(['/auth/login']);
  }

  private clearPromoQuery(): void {
    if (!this.route.snapshot.queryParamMap.has('promo')) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { promo: null, plan: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  // ── Таймеры кулдауна (runOutsideAngular) ──────────────────────────────
  private startTimer(channel: 'voice' | 'email', seconds: number): void {
    this.stopTimer(channel);
    const sig = channel === 'email' ? this.emailCooldown : this.voiceCooldown;
    sig.set(Math.max(0, Math.floor(seconds)));
    if (!isPlatformBrowser(this.platformId) || sig() <= 0) return;

    this.zone.runOutsideAngular(() => {
      const handle = setInterval(() => {
        this.zone.run(() => {
          sig.update((v) => {
            if (v <= 1) { this.stopTimer(channel); return 0; }
            return v - 1;
          });
        });
      }, 1000);
      if (channel === 'email') this.emailTimer = handle;
      else this.voiceTimer = handle;
    });
  }

  private stopTimer(channel: 'voice' | 'email'): void {
    if (channel === 'email' && this.emailTimer) {
      clearInterval(this.emailTimer);
      this.emailTimer = null;
    } else if (channel === 'voice' && this.voiceTimer) {
      clearInterval(this.voiceTimer);
      this.voiceTimer = null;
    }
  }

  private fallbackMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (typeof body === 'string') return body;
      if (body && typeof body === 'object') {
        const msg = Reflect.get(body, 'message');
        if (typeof msg === 'string') return msg;
        const e = Reflect.get(body, 'error');
        if (typeof e === 'string') return e;
      }
    }
    return 'Что-то пошло не так. Попробуйте ещё раз.';
  }
}
