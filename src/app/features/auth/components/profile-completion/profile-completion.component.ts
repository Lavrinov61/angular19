import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize } from 'rxjs';

import { AuthService } from '../../../../core/services/auth.service';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

const PHONE_MASK = '(___) ___-__-__';
const PHONE_LOCAL_LENGTH = 10;
const PHONE_CODE_LENGTH = 4;

function applyPhoneMask(digits: string): string {
  let result = '';
  const localDigits = digits.slice(0, PHONE_LOCAL_LENGTH);
  let digitIndex = 0;

  for (let i = 0; i < PHONE_MASK.length; i++) {
    if (PHONE_MASK[i] === '_') {
      result += digitIndex < localDigits.length ? localDigits[digitIndex++] : '_';
      continue;
    }

    if (i === 0 && localDigits.length === 0) break;
    if (i === 5 && localDigits.length < 3) break;
    if (i === 5 && localDigits.length === 3) {
      result += ')';
      break;
    }
    if (i === 9 && localDigits.length < 6) break;
    if (i === 12 && localDigits.length < 8) break;
    result += PHONE_MASK[i];
  }

  return result;
}

function cursorAfterDigits(masked: string, digitCount: number): number {
  if (digitCount <= 0) {
    return 0;
  }

  let count = 0;
  for (let i = 0; i < masked.length; i++) {
    if (/\d/.test(masked[i])) {
      count++;
      if (count === digitCount) {
        return i + 1;
      }
    }
  }
  return masked.length;
}

function localDigitCountBeforeCursor(value: string, cursor: number, normalizedLength: number): number {
  const digits = value.replace(/\D/g, '');
  const digitsBeforeCursor = value.slice(0, cursor).replace(/\D/g, '');
  let count = digitsBeforeCursor.length;

  if (digits.length > PHONE_LOCAL_LENGTH && (digits.startsWith('7') || digits.startsWith('8')) && count > 0) {
    count--;
  }

  return Math.min(Math.max(count, 0), normalizedLength);
}

function toLocalPhoneDigits(value: string | null | undefined): string {
  let digits = value?.replace(/\D/g, '') ?? '';
  if (digits.length > PHONE_LOCAL_LENGTH && (digits.startsWith('7') || digits.startsWith('8'))) {
    digits = digits.slice(1);
  }
  return digits.slice(0, PHONE_LOCAL_LENGTH);
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error !== 'object' || error === null) {
    return fallback;
  }

  const directError = Reflect.get(error, 'error');
  if (typeof directError === 'string') {
    return directError;
  }
  if (typeof directError === 'object' && directError !== null) {
    const nestedError = Reflect.get(directError, 'error');
    if (typeof nestedError === 'string') {
      return nestedError;
    }

    const nestedMessage = Reflect.get(directError, 'message');
    if (typeof nestedMessage === 'string') {
      return nestedMessage;
    }
  }

  const message = Reflect.get(error, 'message');
  if (typeof message === 'string') {
    return message;
  }

  return fallback;
}

@Component({
  selector: 'app-profile-completion',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="auth-page">
      <div class="auth-card profile-card">
        <div class="auth-logo">
          <img src="/assets/static/logo-black.webp" alt="Своё Фото" width="140" height="44" class="logo-light" />
          <img src="/assets/static/logo-white.webp" alt="Своё Фото" width="140" height="44" class="logo-dark" />
        </div>

        @if (step() === 'name') {
          <div class="step">
            <div class="step-header">
              <h1 class="auth-title">Ваше имя</h1>
              <p class="auth-subtitle">Понадобится для заказов и уведомлений.</p>
            </div>

            @if (error()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ error() }}</span>
              </div>
            }

            <form [formGroup]="nameForm" class="auth-form" (ngSubmit)="saveName()">
              <mat-form-field appearance="outline">
                <mat-label>Имя</mat-label>
                <input
                  #nameInput
                  matInput
                  formControlName="displayName"
                  type="text"
                  name="given-name"
                  autocomplete="given-name"
                  maxlength="100">
                @if (nameForm.controls.displayName.hasError('required') && nameForm.controls.displayName.touched) {
                  <mat-error>Введите имя</mat-error>
                }
                @if (nameForm.controls.displayName.hasError('minlength')) {
                  <mat-error>Минимум 2 символа</mat-error>
                }
              </mat-form-field>

              <button mat-flat-button type="submit" class="auth-submit" [disabled]="nameForm.invalid || savingName()">
                @if (savingName()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Далее
                }
              </button>
            </form>
          </div>
        }

        @if (step() === 'phone') {
          <div class="step">
            <div class="step-header">
              <h1 class="auth-title">Ваш телефон</h1>
              <p class="auth-subtitle">Подтвердим номер кодом из звонка.</p>
            </div>

            <div class="auth-info">
              <mat-icon>info_outline</mat-icon>
              <span>Телефон нужен, чтобы связать профиль с вашими заказами, записями и уведомлениями о готовности фото.</span>
            </div>

            @if (error()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ error() }}</span>
              </div>
            }

            <form class="auth-form" (submit)="requestVoiceCode($event)">
              <mat-form-field appearance="outline">
                <mat-label>Телефон</mat-label>
                <input
                  #phoneInput
                  matInput
                  [value]="maskedPhone()"
                  type="tel"
                  name="tel"
                  autocomplete="tel"
                  inputmode="tel"
                  placeholder="(___) ___-__-__"
                  (input)="onPhoneInput($event)"
                  (keydown)="onPhoneKeydown($event)"
                  (paste)="onPhonePaste($event)">
                <span matTextPrefix>+7&nbsp;</span>
              </mat-form-field>

              <button mat-flat-button type="submit" class="auth-submit" [disabled]="!phoneValid() || sendingCode() || skippingPhone()">
                @if (sendingCode()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Получить код звонком
                }
              </button>

              @if (canSkipPhoneRequirement()) {
                <button mat-button type="button" class="auth-skip" (click)="skipPhoneRequirement()" [disabled]="skippingPhone()">
                  @if (skippingPhone()) {
                    <mat-spinner diameter="18" />
                  } @else {
                    Мне не приходит звонок
                  }
                </button>
              }
            </form>
          </div>
        }

        @if (step() === 'code') {
          <div class="step">
            <button class="back-btn" type="button" (click)="backToPhone()">
              <mat-icon>arrow_back</mat-icon>
              <span>Изменить номер</span>
            </button>

            <div class="step-header">
              <h1 class="auth-title">Код из звонка</h1>
              <p class="auth-subtitle">+7 {{ maskedPhone() }}</p>
            </div>

            @if (error()) {
              <div class="auth-error">
                <mat-icon>error_outline</mat-icon>
                <span>{{ error() }}</span>
              </div>
            }

            <form class="auth-form" (submit)="verifyPhoneCode($event)">
              <mat-form-field appearance="outline">
                <mat-label>Код подтверждения</mat-label>
                <input
                  #codeInput
                  matInput
                  [value]="phoneCode()"
                  type="text"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="4"
                  placeholder="0000"
                  (input)="onCodeInput($event)">
              </mat-form-field>

              <button mat-flat-button type="submit" class="auth-submit" [disabled]="phoneCode().length !== codeLength || verifyingCode() || skippingPhone()">
                @if (verifyingCode()) {
                  <mat-spinner diameter="20" />
                } @else {
                  Подтвердить
                }
              </button>
            </form>

            @if (countdown() > 0) {
              <p class="auth-countdown">Повторный звонок через {{ countdown() }} сек</p>
            } @else {
              <button mat-button type="button" class="auth-resend" (click)="requestVoiceCode()" [disabled]="sendingCode()">
                Получить код ещё раз
              </button>
            }

            @if (canSkipPhoneRequirement()) {
              <button mat-button type="button" class="auth-skip" (click)="skipPhoneRequirement()" [disabled]="skippingPhone()">
                @if (skippingPhone()) {
                  <mat-spinner diameter="18" />
                } @else {
                  Мне не приходит звонок
                }
              </button>
            }
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    @use '../auth-shared';

    .profile-card {
      max-width: 380px;
      padding: 34px 32px 32px;
    }

    .step-header {
      margin-bottom: 20px;
    }

    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0;
      margin: 0 0 18px;
      border: none;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      cursor: pointer;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .auth-info {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 14px;
      border: 1px solid rgba(245, 158, 11, 0.28);
      border-radius: var(--ed-border-radius-md, 8px);
      background: rgba(245, 158, 11, 0.1);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.8125rem;
      line-height: 1.45;

      mat-icon {
        width: 18px;
        height: 18px;
        flex-shrink: 0;
        margin-top: 1px;
        color: var(--ed-accent, #f59e0b);
        font-size: 18px;
      }
    }

    .auth-countdown {
      margin: 14px 0 0;
      text-align: center;
      font-size: 0.8125rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .auth-resend {
      display: block;
      margin: 12px auto 0;
      color: var(--ed-accent, #f59e0b) !important;
    }

    .auth-skip {
      display: block;
      width: 100%;
      min-height: 36px;
      margin-top: 8px;
      color: var(--ed-on-surface-variant, #a0a0a0) !important;

      mat-spinner {
        margin: 0 auto;
      }
    }
  `],
})
export class ProfileCompletionComponent implements OnInit, OnDestroy {
  private readonly nameInputRef = viewChild<ElementRef<HTMLInputElement>>('nameInput');
  private readonly phoneInputRef = viewChild<ElementRef<HTMLInputElement>>('phoneInput');
  private readonly codeInputRef = viewChild<ElementRef<HTMLInputElement>>('codeInput');
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly platformId = inject(PLATFORM_ID);

  protected readonly step = signal<'name' | 'phone' | 'code'>('name');
  protected readonly error = signal<string | null>(null);
  protected readonly savingName = signal(false);
  protected readonly sendingCode = signal(false);
  protected readonly verifyingCode = signal(false);
  protected readonly skippingPhone = signal(false);
  protected readonly rawDigits = signal('');
  protected readonly phoneCode = signal('');
  protected readonly countdown = signal(0);
  protected readonly codeLength = PHONE_CODE_LENGTH;
  protected readonly maskedPhone = computed(() => applyPhoneMask(this.rawDigits()));
  protected readonly phoneValid = computed(() => this.rawDigits().length === PHONE_LOCAL_LENGTH);
  protected readonly canSkipPhoneRequirement = computed(() => this.authService.canSkipPhoneRequirement());
  protected readonly nameForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
  });

  private returnUrl = '/';
  private forcePhone = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
    this.forcePhone = this.route.snapshot.queryParamMap.get('forcePhone') === '1';
    const user = this.authService.currentUser();
    if (!user) {
      this.router.navigate(['/auth/login'], { queryParams: { returnUrl: this.returnUrl } });
      return;
    }

    const displayName = user.display_name || user.displayName || '';
    if (displayName) {
      this.nameForm.controls.displayName.setValue(displayName);
    }
    this.prefillPhoneFromUser();
    this.syncStep();
  }

  ngOnDestroy(): void {
    this.stopCountdown();
  }

  protected saveName(): void {
    if (this.nameForm.invalid || this.savingName()) {
      this.nameForm.markAllAsTouched();
      return;
    }

    this.error.set(null);
    this.savingName.set(true);
    const displayName = this.nameForm.controls.displayName.value.trim();

    this.authService.updateUserProfile({ displayName }).pipe(
      finalize(() => this.savingName.set(false)),
    ).subscribe({
      next: () => this.syncStep(),
      error: (err: unknown) => this.error.set(errorMessage(err, 'Не удалось сохранить имя')),
    });
  }

  protected requestVoiceCode(event?: Event): void {
    event?.preventDefault();

    if (!this.phoneValid() || this.sendingCode()) {
      return;
    }

    this.error.set(null);
    this.sendingCode.set(true);

    this.authService.requestPhoneCode(this.fullPhone).pipe(
      finalize(() => this.sendingCode.set(false)),
    ).subscribe({
      next: () => {
        this.phoneCode.set('');
        this.step.set('code');
        this.startCountdown();
        this.focusLater(() => this.codeInputRef());
      },
      error: (err: unknown) => {
        this.error.set(errorMessage(err, 'Не удалось запустить звонок'));
      },
    });
  }

  protected verifyPhoneCode(event?: Event): void {
    event?.preventDefault();

    if (this.phoneCode().length !== PHONE_CODE_LENGTH || this.verifyingCode()) {
      return;
    }

    this.error.set(null);
    this.verifyingCode.set(true);
    this.authService.verifyProfilePhoneCode(this.fullPhone, this.phoneCode()).pipe(
      finalize(() => this.verifyingCode.set(false)),
    ).subscribe({
      next: () => {
        this.stopCountdown();
        this.syncStep();
      },
      error: (err: unknown) => this.error.set(errorMessage(err, 'Неверный код')),
    });
  }

  protected backToPhone(): void {
    this.error.set(null);
    this.phoneCode.set('');
    this.step.set('phone');
    this.focusLater(() => this.phoneInputRef());
  }

  protected skipPhoneRequirement(): void {
    if (this.skippingPhone()) {
      return;
    }

    this.error.set(null);
    this.stopCountdown();

    this.skippingPhone.set(true);
    this.authService.skipPhoneRequirement(this.phoneValid() ? this.fullPhone : undefined).pipe(
      finalize(() => this.skippingPhone.set(false)),
    ).subscribe({
      next: skipped => {
        if (skipped) {
          this.router.navigateByUrl(this.returnUrl);
          return;
        }
        this.syncStep();
      },
      error: (err: unknown) => this.error.set(errorMessage(err, 'Не удалось продолжить без телефона')),
    });
  }

  protected onPhoneInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    const input = event.target;
    const selectionStart = input.selectionStart ?? input.value.length;
    const digits = toLocalPhoneDigits(input.value);
    const digitsBeforeCursor = localDigitCountBeforeCursor(input.value, selectionStart, digits.length);

    this.rawDigits.set(digits);
    this.error.set(null);

    this.runInBrowserFrame(() => {
      const masked = this.maskedPhone();
      input.value = masked;
      const position = cursorAfterDigits(masked, digitsBeforeCursor);
      input.setSelectionRange(position, position);
    });
  }

  protected onPhoneKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Backspace' || !(event.target instanceof HTMLInputElement)) {
      return;
    }

    const input = event.target;
    const selectionStart = input.selectionStart ?? 0;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    if (selectionStart !== selectionEnd) {
      return;
    }

    event.preventDefault();

    const digitIndex = localDigitCountBeforeCursor(input.value, selectionStart, this.rawDigits().length) - 1;
    if (digitIndex < 0) {
      return;
    }

    const current = this.rawDigits();
    const nextDigits = current.slice(0, digitIndex) + current.slice(digitIndex + 1);
    this.rawDigits.set(nextDigits);
    this.error.set(null);

    this.runInBrowserFrame(() => {
      const masked = this.maskedPhone();
      input.value = masked;
      const position = cursorAfterDigits(masked, digitIndex);
      input.setSelectionRange(position, position);
    });
  }

  protected onPhonePaste(event: ClipboardEvent): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    event.preventDefault();
    const input = event.target;
    const pasted = event.clipboardData?.getData('text') ?? '';
    const pastedDigits = toLocalPhoneDigits(pasted);
    const selectionStart = localDigitCountBeforeCursor(
      input.value,
      input.selectionStart ?? input.value.length,
      this.rawDigits().length,
    );
    const selectionEnd = localDigitCountBeforeCursor(
      input.value,
      input.selectionEnd ?? input.selectionStart ?? input.value.length,
      this.rawDigits().length,
    );
    const replacesWholePhone = pastedDigits.length >= PHONE_LOCAL_LENGTH;
    const nextDigits = replacesWholePhone
      ? pastedDigits
      : `${this.rawDigits().slice(0, selectionStart)}${pastedDigits}${this.rawDigits().slice(selectionEnd)}`.slice(0, PHONE_LOCAL_LENGTH);
    const cursorDigitCount = replacesWholePhone
      ? nextDigits.length
      : Math.min(selectionStart + pastedDigits.length, nextDigits.length);

    this.rawDigits.set(nextDigits);
    this.error.set(null);
    this.runInBrowserFrame(() => {
      const masked = this.maskedPhone();
      input.value = masked;
      const position = cursorAfterDigits(masked, cursorDigitCount);
      input.setSelectionRange(position, position);
    });
  }

  protected onCodeInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }
    const digits = event.target.value.replace(/\D/g, '').slice(0, PHONE_CODE_LENGTH);
    this.phoneCode.set(digits);
    event.target.value = digits;
    this.error.set(null);
  }

  private get fullPhone(): string {
    return `7${this.rawDigits()}`;
  }

  private syncStep(): void {
    const fields = this.authService.getRequiredProfileFields(undefined, { forcePhone: this.forcePhone });
    if (fields.displayName) {
      this.step.set('name');
      this.focusLater(() => this.nameInputRef());
      return;
    }

    if (fields.phone) {
      this.prefillPhoneFromUser();
      this.step.set('phone');
      this.focusLater(() => this.phoneInputRef());
      return;
    }

    this.router.navigateByUrl(this.returnUrl);
  }

  private prefillPhoneFromUser(): void {
    if (this.rawDigits()) {
      return;
    }
    this.rawDigits.set(toLocalPhoneDigits(this.authService.currentUser()?.phone));
  }

  private startCountdown(): void {
    this.stopCountdown();
    this.countdown.set(60);
    this.countdownTimer = setInterval(() => {
      this.countdown.update(value => {
        if (value <= 1) {
          this.stopCountdown();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
  }

  private stopCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private focusLater(ref: () => ElementRef<HTMLInputElement> | undefined): void {
    this.runInBrowserFrame(() => ref()?.nativeElement?.focus());
  }

  private runInBrowserFrame(callback: () => void): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    requestAnimationFrame(callback);
  }
}
