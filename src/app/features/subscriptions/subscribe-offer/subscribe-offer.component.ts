import {
  Component, ChangeDetectionStrategy, inject, signal, computed,
  OnInit, PLATFORM_ID, DestroyRef,
} from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';

import { AuthService } from '../../../core/services/auth.service';
import { CloudPaymentsService } from '../../../core/services/cloud-payments.service';
import { OAUTH_BUTTONS } from '../../auth/components/oauth-providers.data';

interface OfferPlanItem {
  product_id: string;
  product_name: string;
  included_quantity: number;
}

interface OfferData {
  plan: {
    id: string;
    name: string;
    description: string | null;
    base_price: number;
    billing_period: string;
    subscriber_discount_percent: number;
    credits_rollover_months: number;
    features: string[];
    items: OfferPlanItem[];
  };
  monthly_price: number;
  expires_at: string;
  employee_name: string | null;
}

@Component({
  selector: 'app-subscribe-offer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe, RouterLink, ReactiveFormsModule,
    MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatFormFieldModule, MatInputModule, MatSnackBarModule,
  ],
  template: `
    <div class="offer-page">

      @if (loading()) {
        <div class="loading-center">
          <mat-spinner diameter="40" />
          <p class="loading-text">Загрузка предложения...</p>
        </div>
      } @else if (error()) {
        <div class="offer-card error-card">
          <div class="error-icon">
            <mat-icon>link_off</mat-icon>
          </div>
          <h1 class="card-title">Предложение недоступно</h1>
          <p class="card-subtitle">{{ error() }}</p>
          <a routerLink="/subscriptions" class="browse-link">
            <mat-icon>arrow_forward</mat-icon>
            Посмотреть все подписки
          </a>
        </div>
      } @else if (offer()) {
        <div class="offer-card">

          <!-- Plan header -->
          <div class="plan-header">
            @if (offer()!.employee_name) {
              <p class="employee-note">Персональное предложение от {{ offer()!.employee_name }}</p>
            }
            <h1 class="card-title">Подписка &laquo;{{ offer()!.plan.name }}&raquo;</h1>
            <div class="price-block">
              <span class="price">{{ offer()!.monthly_price | number:'1.0-0' }}</span>
              <span class="price-suffix">&#8381;/мес</span>
            </div>
          </div>

          <!-- What's cheaper -->
          <div class="plan-items">
            @if (offer()!.plan.items.length > 0) {
              <h3 class="section-label">Что дешевле по подписке</h3>
              @for (item of offer()!.plan.items; track item.product_id) {
                <div class="item-row">
                  <mat-icon>check_circle</mat-icon>
                  <span>{{ item.product_name }}</span>
                </div>
              }
            } @else if (offer()!.plan.features.length > 0) {
              <h3 class="section-label">Что включает подписка</h3>
              @for (feature of offer()!.plan.features; track feature) {
                <div class="item-row">
                  <mat-icon>check_circle</mat-icon>
                  <span>{{ feature }}</span>
                </div>
              }
            }
          </div>

          <!-- Benefits -->
          @if (offer()!.plan.items.length > 0 || offer()!.plan.features.length > 0 || +offer()!.plan.subscriber_discount_percent > 0) {
            <div class="plan-benefits">
              @for (item of offer()!.plan.items; track item.product_id) {
                <div class="benefit-row">
                  <mat-icon>check_circle</mat-icon>
                  <span>{{ item.product_name }} дешевле при оплате объёма</span>
                </div>
              }
              @if (+offer()!.plan.subscriber_discount_percent > 0) {
                <div class="benefit-row">
                  <mat-icon>loyalty</mat-icon>
                  <span>Скидка {{ +offer()!.plan.subscriber_discount_percent }}% на объёмную печать</span>
                </div>
              }
              <div class="benefit-row">
                <mat-icon>receipt_long</mat-icon>
                <span>Без фиксированных кредитов: платите за фактический объём дешевле</span>
              </div>
            </div>
          }

          <!-- Expiry notice -->
          <div class="expiry-note">
            <mat-icon>schedule</mat-icon>
            <span>Предложение действует до {{ formatExpiry(offer()!.expires_at) }}</span>
          </div>

          <!-- Action area: auth-wall or accept button -->
          @if (isAuthenticated()) {
            <!-- Authenticated: show accept button -->
            <button class="accept-btn" (click)="acceptOffer()" [disabled]="accepting()">
              @if (accepting()) {
                <mat-icon class="spin">autorenew</mat-icon>
                Оформление...
              } @else {
                <mat-icon>credit_card</mat-icon>
                Оформить подписку
              }
            </button>
          } @else {
            <!-- Not authenticated: inline auth-wall -->
            <div class="auth-wall">
              <h3 class="section-label">Войдите для оформления</h3>

              <!-- OAuth buttons -->
              @if (availableOAuthButtons().length > 0) {
                <div class="oauth-buttons">
                  @for (btn of availableOAuthButtons(); track btn.id) {
                    <button [class]="'oauth-btn ' + btn.cssClass"
                            (click)="onOAuthSignIn(btn.id)"
                            [disabled]="authLoading()"
                            type="button">
                      <span class="oauth-icon" [innerHTML]="btn.safeSvg"></span>
                      <span>{{ btn.label }}</span>
                    </button>
                  }
                </div>
              }

              <div class="auth-divider">
                <span>или по email</span>
              </div>

              <!-- Email/Password login form -->
              @if (authError()) {
                <div class="auth-error">
                  <mat-icon>error_outline</mat-icon>
                  <span>{{ authError() }}</span>
                </div>
              }

              @if (!showRegister()) {
                <form [formGroup]="loginForm" (ngSubmit)="signInWithEmail()" class="auth-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Email</mat-label>
                    <input matInput formControlName="email" type="email"
                           autocomplete="email" placeholder="email&#64;example.com">
                    <mat-icon matPrefix>mail</mat-icon>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Пароль</mat-label>
                    <input matInput formControlName="password"
                           [type]="hidePassword() ? 'password' : 'text'"
                           autocomplete="current-password">
                    <mat-icon matPrefix>lock</mat-icon>
                    <button mat-icon-button matSuffix type="button" tabindex="-1"
                            (click)="hidePassword.set(!hidePassword())">
                      <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                    </button>
                  </mat-form-field>

                  <button mat-flat-button type="submit" class="auth-submit"
                          [disabled]="loginForm.invalid || authLoading()">
                    @if (authLoading()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      Войти
                    }
                  </button>
                </form>

                <p class="auth-footer-text">
                  Нет аккаунта?
                  <a class="auth-link" tabindex="0" role="button"
                     (click)="showRegister.set(true)"
                     (keydown.enter)="showRegister.set(true)">Зарегистрироваться</a>
                </p>
              } @else {
                <!-- Register form -->
                <form [formGroup]="registerForm" (ngSubmit)="registerWithEmail()" class="auth-form">
                  <mat-form-field appearance="outline">
                    <mat-label>Имя</mat-label>
                    <input matInput formControlName="name" type="text"
                           autocomplete="name" placeholder="Ваше имя">
                    <mat-icon matPrefix>person</mat-icon>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Email</mat-label>
                    <input matInput formControlName="email" type="email"
                           autocomplete="email" placeholder="email&#64;example.com">
                    <mat-icon matPrefix>mail</mat-icon>
                  </mat-form-field>

                  <mat-form-field appearance="outline">
                    <mat-label>Пароль</mat-label>
                    <input matInput formControlName="password"
                           [type]="hidePassword() ? 'password' : 'text'"
                           autocomplete="new-password">
                    <mat-icon matPrefix>lock</mat-icon>
                  </mat-form-field>

                  <button mat-flat-button type="submit" class="auth-submit"
                          [disabled]="registerForm.invalid || authLoading()">
                    @if (authLoading()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      Зарегистрироваться
                    }
                  </button>
                </form>

                <p class="auth-footer-text">
                  Уже есть аккаунт?
                  <a class="auth-link" tabindex="0" role="button"
                     (click)="showRegister.set(false)"
                     (keydown.enter)="showRegister.set(false)">Войти</a>
                </p>
              }
            </div>
          }

          <!-- Success state -->
          @if (successMessage()) {
            <div class="success-banner">
              <mat-icon>check_circle</mat-icon>
              <span>{{ successMessage() }}</span>
            </div>
          }

        </div>
      }

    </div>
  `,
  styles: [`
    :host {
      display: block;
      --mdc-outlined-text-field-outline-color: var(--ed-outline, #3a3a3a);
      --mdc-outlined-text-field-hover-outline-color: var(--ed-on-surface-variant, #a0a0a0);
      --mdc-outlined-text-field-focus-outline-color: var(--ed-accent, #f59e0b);
      --mdc-outlined-text-field-label-text-color: var(--ed-on-surface-variant, #a0a0a0);
      --mdc-outlined-text-field-focus-label-text-color: var(--ed-accent, #f59e0b);
      --mdc-outlined-text-field-input-text-color: var(--ed-on-surface, #f5f5f5);
      --mdc-outlined-text-field-caret-color: var(--ed-accent, #f59e0b);
      --mat-form-field-container-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-icon-button-state-layer-color: var(--ed-accent, #f59e0b);
      --mat-icon-button-icon-color: var(--ed-on-surface, #f5f5f5);
      --mat-button-filled-container-color: var(--ed-accent, #f59e0b);
      --mat-button-filled-label-text-color: var(--ed-on-accent, #0a0a0a);
      --mdc-circular-progress-active-indicator-color: var(--ed-accent, #f59e0b);
    }

    .offer-page {
      min-height: 100dvh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      background: var(--ed-surface, #0a0a0a);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .loading-center {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }

    .loading-text {
      font-size: 0.95rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    /* Card */
    .offer-card {
      width: 100%;
      max-width: 480px;
      background: var(--ed-surface-container, #1a1a1a);
      border-radius: 20px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding: 32px 28px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);

      @media (max-width: 479px) {
        padding: 28px 20px;
        border-radius: 16px;
      }
    }

    .error-card {
      text-align: center;
    }

    .error-icon {
      display: flex;
      justify-content: center;
      margin-bottom: 16px;

      mat-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .card-title {
      margin: 0;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.5rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .card-subtitle {
      margin: 8px 0 0;
      font-size: 0.9rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.5;
    }

    .browse-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-top: 20px;
      color: var(--ed-accent, #f59e0b);
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      transition: opacity 0.2s;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }

      &:hover { opacity: 0.8; }
    }

    /* Plan header */
    .plan-header {
      text-align: center;
      margin-bottom: 24px;
    }

    .employee-note {
      margin: 0 0 12px;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--ed-accent, #f59e0b);
      letter-spacing: 0.02em;
    }

    .price-block {
      margin-top: 12px;
    }

    .price {
      font-size: 2.5rem;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
    }

    .price-suffix {
      font-size: 1rem;
      font-weight: 400;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    /* Items */
    .plan-items {
      margin-bottom: 16px;
    }

    .section-label {
      margin: 0 0 12px;
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--ed-on-surface-variant, #a0a0a0);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .item-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 0;
      font-size: 0.95rem;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--ed-success, #22c55e);
        flex-shrink: 0;
      }
    }

    /* Benefits */
    .plan-benefits {
      padding: 12px 0;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      margin-bottom: 12px;
    }

    .benefit-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      font-size: 0.88rem;
      color: var(--ed-accent, #f59e0b);

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
    }

    /* Expiry */
    .expiry-note {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      background: var(--ed-surface, #0a0a0a);
      border-radius: 10px;
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 24px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }
    }

    /* Accept button */
    .accept-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 14px;
      background: var(--ed-accent, #f59e0b);
      color: var(--ed-on-accent, #0a0a0a);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;

      mat-icon { font-size: 22px; width: 22px; height: 22px; }

      &:hover:not(:disabled) {
        filter: brightness(1.1);
        box-shadow: 0 4px 16px rgba(245, 158, 11, 0.25);
      }

      &:active:not(:disabled) { transform: scale(0.98); }
      &:disabled { opacity: 0.7; cursor: not-allowed; }
    }

    /* Auth wall */
    .auth-wall {
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding-top: 20px;
    }

    .oauth-buttons {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 0;
    }

    .oauth-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      height: 44px;
      border-radius: 8px;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;

      .oauth-icon {
        display: flex;
        align-items: center;
        flex-shrink: 0;
        svg { display: block; }
      }

      &:hover:not(:disabled) {
        background: var(--ed-surface-container-high, #222222);
        border-color: var(--ed-outline, #3a3a3a);
      }

      &:active:not(:disabled) { transform: scale(0.98); }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }

    .oauth-yandex {
      background: #fc3f1d; color: #fff; border-color: #fc3f1d;
      &:hover:not(:disabled) { background: #e03515; border-color: #e03515; }
    }

    .oauth-vk {
      background: #0077ff; color: #fff; border-color: #0077ff;
      &:hover:not(:disabled) { background: #0066dd; border-color: #0066dd; }
    }

    .oauth-google {
      background: var(--ed-surface-container-high, #222222);
      border-color: var(--ed-outline, #3a3a3a);
      &:hover:not(:disabled) {
        background: var(--ed-outline-variant, #2a2a2a);
        border-color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .oauth-sber {
      background: #21a038; color: #fff; border-color: #21a038;
      &:hover:not(:disabled) { background: #1a8a2e; border-color: #1a8a2e; }
    }

    .oauth-mts {
      background: #e30611; color: #fff; border-color: #e30611;
      &:hover:not(:disabled) { background: #c8050f; border-color: #c8050f; }
    }

    .oauth-apple {
      background: var(--ed-surface-container-high, #222222);
      border-color: var(--ed-outline, #3a3a3a);
      &:hover:not(:disabled) {
        background: var(--ed-outline-variant, #2a2a2a);
        border-color: var(--ed-on-surface-variant, #a0a0a0);
      }
    }

    .auth-divider {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 20px 0;

      &::before, &::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--ed-outline, #3a3a3a);
      }

      span {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--ed-on-surface-variant, #a0a0a0);
        white-space: nowrap;
      }
    }

    .auth-error {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px 16px;
      margin-bottom: 16px;
      background: rgba(239, 68, 68, 0.12);
      color: var(--ed-error, #ef4444);
      border: 1px solid rgba(239, 68, 68, 0.25);
      border-radius: 8px;
      font-size: 0.8125rem;
      line-height: 1.5;

      mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; }
    }

    .auth-form {
      display: flex;
      flex-direction: column;
      gap: 4px;

      mat-form-field { width: 100%; }
    }

    .auth-submit {
      width: 100%;
      height: 48px;
      font-size: 15px;
      font-weight: 600;
      margin-top: 8px;
      border-radius: 8px !important;
      background: var(--ed-accent, #f59e0b) !important;
      color: var(--ed-on-accent, #0a0a0a) !important;

      &:hover:not(:disabled) { background: var(--ed-accent-hover, #fbbf24) !important; }
      &:disabled { opacity: 0.5; }
      mat-spinner { display: inline-block; }
    }

    .auth-footer-text {
      text-align: center;
      margin: 16px 0 0;
      font-size: 0.875rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .auth-link {
      color: var(--ed-accent, #f59e0b);
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      &:hover { text-decoration: underline; }
    }

    /* Success */
    .success-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 20px;
      padding: 14px 16px;
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.3);
      border-radius: 10px;
      color: var(--ed-success, #22c55e);
      font-size: 0.9rem;
      font-weight: 600;

      mat-icon { font-size: 22px; width: 22px; height: 22px; flex-shrink: 0; }
    }

    .spin { animation: spin 1s linear infinite; }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `],
})
export class SubscribeOfferComponent implements OnInit {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly authService = inject(AuthService);
  private readonly cloudPayments = inject(CloudPaymentsService);

  // State
  readonly loading = signal(true);
  readonly offer = signal<OfferData | null>(null);
  readonly error = signal<string | null>(null);
  readonly accepting = signal(false);
  readonly successMessage = signal<string | null>(null);

  // Auth state
  readonly isAuthenticated = computed(() => this.authService.isAuthenticated());
  readonly authLoading = this.authService.isLoading;
  readonly authError = signal<string | null>(null);
  readonly showRegister = signal(false);
  readonly hidePassword = signal(true);

  // OAuth buttons
  readonly availableOAuthButtons = computed(() =>
    OAUTH_BUTTONS
      .filter(btn => this.authService.availableProviders().some(p => p.id === btn.id))
      .map(btn => ({ ...btn, safeSvg: this.sanitizer.bypassSecurityTrustHtml(btn.svgIcon) as SafeHtml }))
  );

  // Forms
  readonly loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly registerForm = this.fb.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
  });

  private token = '';

  ngOnInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.authService.loadAvailableProviders().subscribe();
    }

    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.token = params.get('token') || '';
      if (this.token) {
        this.loadOffer();
      } else {
        this.loading.set(false);
        this.error.set('Ссылка не содержит токен предложения.');
      }
    });
  }

  onOAuthSignIn(providerId: string): void {
    this.authService.signInWithProvider(providerId, `/subscribe/${this.token}`).subscribe();
  }

  signInWithEmail(): void {
    if (this.loginForm.invalid) return;
    const { email, password } = this.loginForm.value;
    this.authError.set(null);

    this.authService.login(email!, password!).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      error: (err: { error?: string; message?: string }) => {
        this.authError.set(err.error || err.message || 'Неверный email или пароль');
      },
    });
  }

  registerWithEmail(): void {
    if (this.registerForm.invalid) return;
    const { name, email, password } = this.registerForm.value;
    this.authError.set(null);

    this.authService.register(email!, password!, name || undefined).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        if (res.requiresVerification) {
          this.authError.set('Проверьте email и перейдите по ссылке для подтверждения, затем войдите.');
          this.showRegister.set(false);
        } else {
          // Auto-login after registration
          this.authService.login(email!, password!).pipe(
            takeUntilDestroyed(this.destroyRef),
          ).subscribe();
        }
      },
      error: (err: { error?: string; message?: string }) => {
        this.authError.set(err.error || err.message || 'Ошибка регистрации');
      },
    });
  }

  async acceptOffer(): Promise<void> {
    this.accepting.set(true);
    this.error.set(null);

    try {
      const result = await firstValueFrom(
        this.http.post<{
          subscription_id: string;
          monthly_price: number;
          plan_name: string;
        }>(`/api/subscriptions/offer/${this.token}/accept`, {})
      );

      const paymentResult = await this.cloudPayments.subscribe({
        subscriptionId: result.subscription_id,
        planName: result.plan_name,
        amount: result.monthly_price,
        billingPeriod: this.offer()?.plan.billing_period || 'monthly',
        email: this.authService.currentUser()?.email,
        phone: this.authService.currentUser()?.phone || undefined,
      });

      this.accepting.set(false);

      if (paymentResult.success) {
        this.successMessage.set('Подписка оформлена! Цена подписчика применится после подтверждения оплаты.');
        this.snackBar.open('Подписка оформлена!', 'OK', { duration: 5000 });
        setTimeout(() => {
          this.router.navigate(['/profile/subscription']);
        }, 2000);
      } else if (paymentResult.error && paymentResult.error !== 'Оплата отменена') {
        this.snackBar.open(`Ошибка: ${paymentResult.error}`, 'OK', { duration: 5000 });
      }
    } catch (err) {
      this.accepting.set(false);
      const message = err instanceof Error ? err.message : 'Не удалось оформить подписку';
      this.snackBar.open(`Ошибка: ${message}`, 'OK', { duration: 5000 });
    }
  }

  formatExpiry(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  private loadOffer(): void {
    this.loading.set(true);
    this.http.get<{
      success: boolean;
      offer?: OfferData;
      error?: string;
    }>(`/api/subscriptions/offer/${this.token}`).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        if (res.success && res.offer) {
          this.offer.set(res.offer);
        } else {
          this.error.set(res.error || 'Предложение не найдено.');
        }
        this.loading.set(false);
      },
      error: (err) => {
        if (err.status === 404 || err.status === 410) {
          this.error.set('Ссылка истекла или уже была использована.');
        } else {
          this.error.set('Не удалось загрузить предложение. Попробуйте позже.');
        }
        this.loading.set(false);
      },
    });
  }
}
