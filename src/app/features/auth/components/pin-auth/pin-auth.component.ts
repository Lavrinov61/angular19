import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, OnInit, PLATFORM_ID, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { AuthService } from '../../../../core/services/auth.service';

type PinMode = 'setup' | 'unlock';

function readErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;

  const code = Reflect.get(error, 'code');
  if (typeof code === 'string') return code;

  const body = Reflect.get(error, 'error');
  if (typeof body === 'object' && body !== null) {
    const bodyCode = Reflect.get(body, 'code');
    if (typeof bodyCode === 'string') return bodyCode;
    const bodyError = Reflect.get(body, 'error');
    if (typeof bodyError === 'string') return bodyError;
  }
  if (typeof body === 'string') return body;

  return null;
}

function readErrorMessage(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'Ошибка PIN';

  const body = Reflect.get(error, 'error');
  if (typeof body === 'object' && body !== null) {
    const message = Reflect.get(body, 'message');
    if (typeof message === 'string') return message;
  }

  const message = Reflect.get(error, 'message');
  return typeof message === 'string' ? message : 'Ошибка PIN';
}

@Component({
  selector: 'app-pin-auth',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule],
  template: `
    <main class="pin-page">
      <section class="pin-card">
        <div class="pin-logo">
          <img src="/assets/static/logo-black.webp" alt="Своё Фото" width="132" height="42" class="logo-light" />
          <img src="/assets/static/logo-white.webp" alt="Своё Фото" width="132" height="42" class="logo-dark" />
        </div>

        <h1>{{ mode() === 'setup' ? 'Установите PIN' : 'Введите PIN' }}</h1>

        @if (errorMessage()) {
          <div class="pin-error">
            <mat-icon>error_outline</mat-icon>
            <span>{{ errorMessage() }}</span>
          </div>
        }

        <label class="pin-field">
          <span>PIN</span>
          <span class="pin-entry">
            <input
              #pinInput
              class="pin-native-input"
              type="password"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="4"
              aria-label="PIN"
              [value]="pin()"
              (input)="onPinInput($event)"
              (keydown.enter)="submit()"
            />
            <span class="pin-cells" aria-hidden="true">
              @for (digit of pinDigits(); track $index) {
                <span class="pin-cell" [class.is-filled]="digit.length > 0">
                  @if (digit) {
                    <span class="pin-dot"></span>
                  }
                </span>
              }
            </span>
          </span>
        </label>

        @if (mode() === 'setup') {
          <label class="pin-field">
            <span>Повторите PIN</span>
            <span class="pin-entry">
              <input
                class="pin-native-input"
                type="password"
                inputmode="numeric"
                autocomplete="one-time-code"
                maxlength="4"
                aria-label="Повторите PIN"
                [value]="pinConfirmation()"
                (input)="onPinConfirmationInput($event)"
                (keydown.enter)="submit()"
              />
              <span class="pin-cells" aria-hidden="true">
                @for (digit of pinConfirmationDigits(); track $index) {
                  <span class="pin-cell" [class.is-filled]="digit.length > 0">
                    @if (digit) {
                      <span class="pin-dot"></span>
                    }
                  </span>
                }
              </span>
            </span>
          </label>
        }

        <button
          mat-flat-button
          class="pin-submit"
          type="button"
          [disabled]="!canSubmit() || loading()"
          (click)="submit()"
        >
          @if (loading()) {
            <mat-spinner diameter="20" />
          } @else {
            {{ mode() === 'setup' ? 'Сохранить PIN' : 'Войти' }}
          }
        </button>

        <button class="full-login-button" type="button" (click)="useFullLogin()">
          Войти заново
        </button>
      </section>
    </main>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100vh;
      color: #f7f7f7;
      background: #050505;
    }

    .pin-page {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .pin-card {
      width: min(100%, 420px);
      display: grid;
      gap: 18px;
      padding: 32px;
      border: 1px solid #333;
      border-radius: 8px;
      background: #181818;
      box-shadow: 0 24px 80px rgb(0 0 0 / 36%);
    }

    .pin-logo {
      display: flex;
      justify-content: center;
      margin-bottom: 8px;
    }

    .logo-light {
      display: none;
    }

    .logo-dark {
      display: block;
      width: 132px;
      height: auto;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.15;
      text-align: center;
      font-weight: 800;
    }

    .pin-error {
      display: grid;
      grid-template-columns: 20px 1fr;
      align-items: center;
      gap: 10px;
      min-height: 44px;
      padding: 10px 12px;
      border: 1px solid #763033;
      border-radius: 8px;
      color: #ff5a5f;
      background: #3a1719;
      font-size: 14px;
    }

    .pin-error mat-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }

    .pin-field {
      display: grid;
      gap: 8px;
      color: #cfcfcf;
      font-size: 13px;
      font-weight: 600;
    }

    .pin-entry {
      position: relative;
      display: block;
      min-height: 58px;
    }

    .pin-native-input {
      position: absolute;
      inset: 0;
      z-index: 2;
      width: 100%;
      height: 100%;
      border: 0;
      padding: 0;
      color: transparent;
      caret-color: transparent;
      background: transparent;
      opacity: 0.02;
      outline: none;
    }

    .pin-cells {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
    }

    .pin-cell {
      display: grid;
      place-items: center;
      width: 100%;
      aspect-ratio: 1;
      min-height: 56px;
      box-sizing: border-box;
      border: 1px solid #4a4a4a;
      border-radius: 8px;
      color: #fff;
      background: #232323;
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
    }

    .pin-entry:focus-within .pin-cell {
      border-color: #ffa000;
      box-shadow: 0 0 0 3px rgb(255 160 0 / 18%);
    }

    .pin-cell.is-filled {
      border-color: #6b6b6b;
      background: #2b2b2b;
    }

    .pin-dot {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: currentColor;
    }

    .pin-submit {
      height: 50px;
      border-radius: 8px;
      background: #ffa000;
      color: #080808;
      font-weight: 800;
    }

    .pin-submit mat-spinner {
      margin: 0 auto;
    }

    .full-login-button {
      height: 42px;
      border: 0;
      color: #ffa000;
      background: transparent;
      font-weight: 700;
      cursor: pointer;
    }

    @media (prefers-color-scheme: light) {
      :host {
        color: #1f2028;
        background: #f6f6f7;
      }

      .pin-card {
        border-color: #e2e3e8;
        background: #fff;
        box-shadow: 0 18px 60px rgb(20 22 30 / 12%);
      }

      .logo-light {
        display: block;
        width: 132px;
        height: auto;
      }

      .logo-dark {
        display: none;
      }

      .pin-field {
        color: #5f6470;
      }

      .pin-cell {
        border-color: #d7d9df;
        color: #1f2028;
        background: #fff;
      }

      .pin-cell.is-filled {
        border-color: #c1c4cc;
        background: #f7f8fa;
      }

      .pin-error {
        color: #d93030;
        background: #fff0f0;
      }
    }

    @media (max-width: 480px) {
      .pin-page {
        align-items: start;
        padding: 72px 16px 24px;
      }

      .pin-card {
        padding: 28px 20px;
      }

      .pin-cells {
        gap: 8px;
      }

      .pin-cell {
        min-height: 64px;
      }
    }
  `],
})
export class PinAuthComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly pinInputRef = viewChild<ElementRef<HTMLInputElement>>('pinInput');

  readonly mode = signal<PinMode>('unlock');
  readonly pin = signal('');
  readonly pinConfirmation = signal('');
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly pinDigits = computed(() => this.toPinCells(this.pin()));
  readonly pinConfirmationDigits = computed(() => this.toPinCells(this.pinConfirmation()));
  readonly canSubmit = computed(() => {
    if (this.mode() === 'setup') {
      return this.pin().length === 4 && this.pinConfirmation().length === 4;
    }
    return this.pin().length === 4;
  });

  private returnUrl = '/';

  private toPinCells(value: string): string[] {
    return [0, 1, 2, 3].map((index) => value[index] ?? '');
  }

  ngOnInit(): void {
    this.returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') || '/';
    const requestedMode = this.route.snapshot.queryParamMap.get('mode');
    const user = this.authService.currentUser();

    if (user?.role && user.role !== 'client') {
      this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
      return;
    }

    if (requestedMode === 'setup' || user?.pin_enabled === false) {
      this.mode.set('setup');
    }

    if (isPlatformBrowser(this.platformId)) {
      requestAnimationFrame(() => this.pinInputRef()?.nativeElement.focus());
    }
  }

  onPinInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = digits;
    this.pin.set(digits);
    this.errorMessage.set(null);
  }

  onPinConfirmationInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    input.value = digits;
    this.pinConfirmation.set(digits);
    this.errorMessage.set(null);
  }

  submit(): void {
    if (!this.canSubmit() || this.loading()) return;

    if (this.mode() === 'setup' && this.pin() !== this.pinConfirmation()) {
      this.errorMessage.set('PIN не совпадает');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const onSuccess = (): void => {
      this.loading.set(false);
      this.router.navigateByUrl(this.authService.getPostAuthRedirectUrl(this.returnUrl));
    };
    const onError = (error: unknown): void => {
      this.loading.set(false);
      const code = readErrorCode(error);
      if (code === 'PIN_LOCKED') {
        this.errorMessage.set('PIN временно заблокирован');
        return;
      }
      if (code === 'PIN_INVALID') {
        this.errorMessage.set('Неверный PIN');
        return;
      }
      this.errorMessage.set(readErrorMessage(error));
    };

    if (this.mode() === 'setup') {
      this.authService.setupPin(this.pin()).subscribe({ next: onSuccess, error: onError });
      return;
    }

    this.authService.unlockWithPin(this.pin()).subscribe({ next: onSuccess, error: onError });
  }

  useFullLogin(): void {
    this.authService.clearLocalAuthState();
    this.router.navigate(['/auth/login'], { queryParams: { returnUrl: this.returnUrl } });
  }
}
