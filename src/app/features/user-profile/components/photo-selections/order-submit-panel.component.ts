import {
  Component, input, output, signal, computed, inject, OnInit,
  ChangeDetectionStrategy, PLATFORM_ID
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { firstValueFrom } from 'rxjs';
import {
  PricingApiService, PricingCategory, PricingOptionGroup, PricingServiceOption
} from '../../../../core/services/pricing-api.service';
import { AuthService, UserProfile } from '../../../../core/services/auth.service';

type Step = 1 | 2 | 3 | 4;

type SelectedOptions = Record<string, string[]>;

@Component({
  selector: 'app-order-submit-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatSnackBarModule, MatProgressSpinnerModule, MatIconModule, DecimalPipe],
  template: `
    <div class="order-panel">

      <!-- Header -->
      <div class="op-header">
        <button class="btn-cancel" (click)="cancelled.emit()">← Назад</button>
        <div class="op-title-block">
          <span class="op-category-icon"><mat-icon>{{ category()?.icon || 'palette' }}</mat-icon></span>
          <h2 class="op-title">{{ category()?.name || 'Заказ обработки' }}</h2>
        </div>
        <!-- Step indicator -->
        <div class="step-indicator">
          @for (s of [1,2,3,4]; track s) {
            <div
              class="step-dot"
              [class.active]="step() === s"
              [class.done]="step() > s"
            >
              @if (step() > s) { ✓ } @else { {{ s }} }
            </div>
            @if (s < 4) { <div class="step-connector" [class.done]="step() > s"></div> }
          }
        </div>
      </div>

      <!-- Step content -->
      <div class="op-body">

        <!-- STEP 1: Options -->
        @if (step() === 1) {
          <div class="step-section" role="region" aria-label="Выбор опций">
            <h3 class="step-title">Выберите параметры</h3>

            @if (!category()) {
              <div class="step-empty">Услуга не выбрана</div>
            } @else if (category()!.optionGroups.length === 0) {
              <div class="step-empty">Услуга без дополнительных опций</div>
            } @else {
              @for (group of category()!.optionGroups; track group.id) {
                <div class="option-group">
                  <div class="og-label">
                    {{ group.name }}
                    @if (group.is_required) { <span class="og-required">обязательно</span> }
                  </div>
                  <div class="og-chips">
                    @for (opt of group.options; track opt.id) {
                      <button
                        class="chip"
                        [class.chip-selected]="isOptionSelected(group.slug, opt.slug)"
                        [class.chip-popular]="opt.popular"
                        (click)="toggleOption(group, opt)"
                      >
                        @if (opt.icon) { <span>{{ opt.icon }}</span> }
                        {{ opt.name }}
                        @if (opt.base_price > 0) {
                          <span class="chip-price">+{{ opt.base_price }} ₽</span>
                        }
                        @if (opt.popular) { <span class="chip-pop">★</span> }
                      </button>
                    }
                  </div>
                </div>
              }
            }

            <!-- Price preview -->
            @if (totalPrice() > 0) {
              <div class="price-preview">
                <span class="price-label">Итого:</span>
                <span class="price-value">{{ totalPrice() | number:'1.0-0' }} ₽</span>
              </div>
            }

            <div class="step-nav">
              <button class="btn-next" (click)="goStep(2)" [disabled]="!canProceedStep1()">
                Далее: загрузить фото →
              </button>
            </div>
          </div>
        }

        <!-- STEP 2: Upload photo -->
        @if (step() === 2) {
          <div class="step-section" role="region" aria-label="Загрузка фото">
            <h3 class="step-title">Загрузите фотографию</h3>
            <p class="step-sub">Загрузите фото, которое нужно обработать. Мы примем его и вернём результат сюда для согласования.</p>

            <div
              class="upload-zone"
              [class.has-file]="uploadedUrl()"
              [class.drag-over]="dragOver()"
              (dragover)="$event.preventDefault(); dragOver.set(true)"
              (dragleave)="dragOver.set(false)"
              (drop)="onDrop($event)"
              (click)="fileInput.click()"
              (keydown.enter)="fileInput.click()"
              tabindex="0"
            >
              @if (uploading()) {
                <div class="upload-progress">
                  <mat-spinner diameter="36" />
                  <span>Загружаем фото...</span>
                </div>
              } @else if (uploadedUrl()) {
                <div class="upload-preview">
                  <img [src]="uploadedUrl()!" alt="Загруженное фото" class="preview-img">
                  <div class="preview-overlay">
                    <span>Нажмите для замены</span>
                  </div>
                </div>
              } @else {
                <div class="upload-placeholder">
                  <div class="upload-icon"><mat-icon>cloud_upload</mat-icon></div>
                  <div class="upload-text">Перетащите фото или нажмите для выбора</div>
                  <div class="upload-hint">JPG, PNG, WebP, до 20 МБ</div>
                </div>
              }
              <input
                #fileInput
                type="file"
                accept="image/*"
                style="display:none"
                (change)="onFileChange($event)"
              >
            </div>

            <div class="step-nav step-nav-row">
              <button class="btn-back-step" (click)="goStep(1)">← Назад</button>
              <button class="btn-next" (click)="goStep(3)" [disabled]="!uploadedUrl()">
                Далее: контактные данные →
              </button>
            </div>
          </div>
        }

        <!-- STEP 3: Contact info -->
        @if (step() === 3) {
          <div class="step-section" role="region" aria-label="Контактные данные">
            <h3 class="step-title">Контактные данные</h3>
            <p class="step-sub">Для связи и уведомления о готовности</p>

            <div class="form-fields">
              <div class="field-group">
                <span class="field-label" aria-label="Имя">Имя *</span>
                <input class="field-input" [ngModel]="contactName()" (ngModelChange)="contactName.set($event)" placeholder="Ваше имя">
              </div>
              <div class="field-group">
                <span class="field-label" aria-label="Телефон">Телефон *</span>
                <input class="field-input" [ngModel]="contactPhone()" (ngModelChange)="contactPhone.set($event)" placeholder="+7 (___) ___-__-__" type="tel">
              </div>
              <div class="field-group">
                <span class="field-label" aria-label="Email">Email</span>
                <input class="field-input" [ngModel]="contactEmail()" (ngModelChange)="contactEmail.set($event)" placeholder="email@example.com" type="email">
              </div>
              <div class="field-group">
                <span class="field-label" aria-label="Пожелания">Пожелания (необязательно)</span>
                <textarea
                  class="field-textarea"
                  [ngModel]="contactComment()"
                  (ngModelChange)="contactComment.set($event)"
                  placeholder="Особые пожелания к обработке..."
                  rows="3"
                ></textarea>
              </div>
            </div>

            <div class="step-nav step-nav-row">
              <button class="btn-back-step" (click)="goStep(2)">← Назад</button>
              <button class="btn-next" (click)="goStep(4)" [disabled]="!canProceedStep3()">
                Далее: подтверждение →
              </button>
            </div>
          </div>
        }

        <!-- STEP 4: Confirm -->
        @if (step() === 4 && !submitted()) {
          <div class="step-section" role="region" aria-label="Подтверждение заказа">
            <h3 class="step-title">Подтверждение заказа</h3>

            <div class="confirm-card">
              <div class="cc-row">
                <span class="cc-label">Услуга</span>
                <span class="cc-val">{{ category()?.name }}</span>
              </div>
              @if (selectedOptionsDisplay().length > 0) {
                <div class="cc-row">
                  <span class="cc-label">Параметры</span>
                  <span class="cc-val cc-opts">{{ selectedOptionsDisplay().join(' · ') }}</span>
                </div>
              }
              @if (uploadedUrl()) {
                <div class="cc-row">
                  <span class="cc-label">Фото</span>
                  <img [src]="uploadedUrl()!" alt="Фото" class="cc-thumb">
                </div>
              }
              <div class="cc-row">
                <span class="cc-label">Клиент</span>
                <span class="cc-val">{{ contactName() }}, {{ contactPhone() }}</span>
              </div>
              @if (totalPrice() > 0) {
                <div class="cc-row cc-price-row">
                  <span class="cc-label">К оплате</span>
                  <span class="cc-price-val">{{ totalPrice() | number:'1.0-0' }} ₽</span>
                </div>
              }
            </div>

            <div class="confirm-note">
              После отправки заказа специалист приступит к обработке. Результат появится здесь для согласования.
            </div>

            <div class="step-nav step-nav-row">
              <button class="btn-back-step" (click)="goStep(3)">← Назад</button>
              <button
                class="btn-submit"
                (click)="submitOrder()"
                [disabled]="submitting()"
              >
                @if (submitting()) {
                  <mat-spinner diameter="18" /> Отправляем...
                } @else {
                  <mat-icon class="btn-inline-icon">check</mat-icon> Отправить заказ
                }
              </button>
            </div>
          </div>
        }

        <!-- SUCCESS state -->
        @if (submitted()) {
          <div class="success-block">
            <div class="success-icon"><mat-icon>check_circle</mat-icon></div>
            <h3 class="success-title">Заказ принят!</h3>
            <p class="success-desc">
              Специалист приступит к обработке вашей фотографии.
              Когда результат будет готов, он появится на этой странице для вашего согласования.
            </p>
            <button class="btn-done" (click)="cancelled.emit()">
              Вернуться к заявкам
            </button>
          </div>
        }

      </div>
    </div>
  `,
  styles: `
    :host { display: block; }

    .order-panel {
      display: flex;
      flex-direction: column;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 14px;
      overflow: hidden;
      max-width: 640px;
      margin: 0 auto;
    }

    /* ── Header ── */
    .op-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding: 14px 20px;
      background: var(--ed-surface-container-high, #222222);
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      flex-wrap: wrap;
    }

    .btn-cancel {
      background: none;
      border: none;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.82rem;
      cursor: pointer;
      font-family: inherit;
      padding: 4px 0;
      transition: color 0.2s;
    }

    .btn-cancel:hover { color: var(--ed-on-surface, #f5f5f5); }

    .op-title-block {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
    }

    .op-category-icon { display: flex; align-items: center; }
    .op-category-icon mat-icon { font-size: 1.4rem; width: 1.4rem; height: 1.4rem; color: #f59e0b; }

    .op-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1rem;
      font-weight: 500;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0;
    }

    /* Step indicator */
    .step-indicator {
      display: flex;
      align-items: center;
      gap: 0;
    }

    .step-dot {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--ed-surface, #0a0a0a);
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      color: var(--ed-on-surface-muted, #666);
      font-size: 0.7rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .step-dot.active {
      background: #f59e0b;
      border-color: #f59e0b;
      color: #0a0a0a;
      box-shadow: 0 0 10px rgba(245,158,11,0.4);
    }

    .step-dot.done {
      background: rgba(34,197,94,0.15);
      border-color: rgba(34,197,94,0.4);
      color: #22c55e;
    }

    .step-connector {
      width: 20px;
      height: 1px;
      background: var(--ed-outline, #3a3a3a);
      transition: background 0.2s;
    }

    .step-connector.done { background: rgba(34,197,94,0.4); }

    /* ── Body ── */
    .op-body {
      padding: 24px 24px 28px;
    }

    .step-section {
      animation: fade-in 0.3s ease both;
    }

    @keyframes fade-in {
      from { opacity: 0; transform: translateX(12px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    .step-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.05rem;
      font-weight: 500;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0 0 6px;
    }

    .step-sub {
      font-size: 0.83rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 20px;
      line-height: 1.5;
    }

    .step-empty {
      color: var(--ed-on-surface-muted, #666);
      font-size: 0.9rem;
      padding: 16px 0;
    }

    /* ── Option groups ── */
    .option-group {
      margin-bottom: 20px;
    }

    .og-label {
      font-size: 0.78rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .og-required {
      font-size: 0.65rem;
      background: rgba(245,158,11,0.12);
      color: #f59e0b;
      border-radius: 999px;
      padding: 2px 8px;
      text-transform: none;
      letter-spacing: 0;
      font-weight: 600;
    }

    .og-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .chip {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 7px 14px;
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 999px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.82rem;
      cursor: pointer;
      font-family: inherit;
      transition: all 0.18s;
    }

    .chip:hover {
      border-color: rgba(245,158,11,0.3);
      color: var(--ed-on-surface, #f5f5f5);
      background: rgba(245,158,11,0.05);
    }

    .chip.chip-selected {
      background: rgba(245,158,11,0.12);
      border-color: rgba(245,158,11,0.5);
      color: #f59e0b;
    }

    .chip-price {
      font-size: 0.72rem;
      opacity: 0.7;
    }

    .chip-pop {
      font-size: 0.65rem;
      color: #f59e0b;
    }

    /* Price preview */
    .price-preview {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin: 20px 0 0;
      padding: 12px 16px;
      background: rgba(245,158,11,0.06);
      border: 1px solid rgba(245,158,11,0.15);
      border-radius: 10px;
    }

    .price-label {
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .price-value {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.4rem;
      font-weight: 600;
      color: #f59e0b;
    }

    /* ── Upload zone ── */
    .upload-zone {
      border: 2px dashed var(--ed-outline, #3a3a3a);
      border-radius: 12px;
      background: var(--ed-surface, #0a0a0a);
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
      overflow: hidden;
      margin-bottom: 24px;
      min-height: 180px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .upload-zone:hover { border-color: rgba(245,158,11,0.4); }
    .upload-zone.drag-over { border-color: #f59e0b; background: rgba(245,158,11,0.04); }
    .upload-zone.has-file { border-style: solid; border-color: rgba(245,158,11,0.3); }

    .upload-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 32px;
    }

    .upload-icon { display: flex; justify-content: center; opacity: 0.5; }
    .upload-icon mat-icon { font-size: 2.5rem; width: 2.5rem; height: 2.5rem; color: #f59e0b; }

    .upload-text {
      font-size: 0.9rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .upload-hint {
      font-size: 0.75rem;
      color: var(--ed-on-surface-muted, #666);
    }

    .upload-progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.85rem;
      padding: 32px;
    }

    .upload-preview {
      position: relative;
      width: 100%;
      min-height: 180px;
    }

    .preview-img {
      width: 100%;
      max-height: 300px;
      object-fit: contain;
      display: block;
    }

    .preview-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0);
      color: transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.85rem;
      font-weight: 600;
      transition: background 0.2s, color 0.2s;
    }

    .upload-zone:hover .preview-overlay {
      background: rgba(0,0,0,0.5);
      color: #f5f5f5;
    }

    /* ── Form fields ── */
    .form-fields {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-bottom: 24px;
    }

    .field-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .field-label {
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .field-input, .field-textarea {
      background: rgba(255,255,255,0.04);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 8px;
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.88rem;
      padding: 10px 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
      width: 100%;
      box-sizing: border-box;
    }

    .field-input:focus, .field-textarea:focus {
      border-color: rgba(245,158,11,0.4);
    }

    .field-textarea { resize: vertical; }

    /* ── Confirm card ── */
    .confirm-card {
      background: var(--ed-surface, #0a0a0a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 16px;
    }

    .cc-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(255,255,255,0.04);
    }

    .cc-row:last-child { border-bottom: none; }

    .cc-label {
      font-size: 0.75rem;
      color: var(--ed-on-surface-muted, #666);
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      min-width: 80px;
      flex-shrink: 0;
    }

    .cc-val {
      font-size: 0.85rem;
      color: var(--ed-on-surface, #f5f5f5);
      flex: 1;
    }

    .cc-opts { color: var(--ed-on-surface-variant, #a0a0a0); }

    .cc-thumb {
      width: 60px;
      height: 60px;
      object-fit: cover;
      border-radius: 6px;
    }

    .cc-price-row { background: rgba(245,158,11,0.04); }

    .cc-price-val {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.2rem;
      font-weight: 600;
      color: #f59e0b;
    }

    .confirm-note {
      font-size: 0.8rem;
      color: var(--ed-on-surface-muted, #666);
      line-height: 1.5;
      margin-bottom: 20px;
      padding: 10px 14px;
      background: rgba(245,158,11,0.04);
      border-radius: 8px;
      border-left: 3px solid rgba(245,158,11,0.3);
    }

    /* ── Navigation ── */
    .step-nav {
      margin-top: 20px;
    }

    .step-nav-row {
      display: flex;
      gap: 10px;
      align-items: center;
    }

    .btn-next {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      padding: 12px 24px;
      background: #f59e0b;
      border: none;
      border-radius: 999px;
      color: #0a0a0a;
      font-size: 0.88rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s, opacity 0.2s;
      letter-spacing: 0.02em;
    }

    .btn-next:hover:not(:disabled) { background: #fbbf24; }
    .btn-next:disabled { opacity: 0.35; cursor: not-allowed; }

    .step-nav-row .btn-next { flex: 1; width: auto; }

    .btn-back-step {
      padding: 11px 18px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 999px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.82rem;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s, color 0.2s;
      white-space: nowrap;
    }

    .btn-back-step:hover { background: rgba(255,255,255,0.09); color: var(--ed-on-surface, #f5f5f5); }

    .btn-submit {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      justify-content: center;
      padding: 12px 24px;
      background: #22c55e;
      border: none;
      border-radius: 999px;
      color: #0a0a0a;
      font-size: 0.9rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s, opacity 0.2s;
    }

    .btn-submit:hover:not(:disabled) { background: #16a34a; }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    /* ── Success ── */
    .success-block {
      text-align: center;
      padding: 40px 24px;
      animation: fade-in 0.4s ease both;
    }

    .success-icon { display: flex; justify-content: center; margin-bottom: 16px; }
    .success-icon mat-icon { font-size: 3rem; width: 3rem; height: 3rem; color: #22c55e; }
    .btn-inline-icon { font-size: 16px; width: 16px; height: 16px; vertical-align: middle; }

    .success-title {
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.4rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      color: #22c55e;
      margin: 0 0 12px;
      text-transform: uppercase;
    }

    .success-desc {
      font-size: 0.88rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.6;
      max-width: 380px;
      margin: 0 auto 24px;
    }

    .btn-done {
      padding: 11px 28px;
      background: rgba(34,197,94,0.12);
      border: 1px solid rgba(34,197,94,0.3);
      border-radius: 999px;
      color: #22c55e;
      font-size: 0.85rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.2s;
    }

    .btn-done:hover { background: rgba(34,197,94,0.2); }

    @media (max-width: 540px) {
      .op-header { flex-direction: column; align-items: flex-start; }
      .op-body { padding: 18px 16px 22px; }
    }
  `
})
export class OrderSubmitPanelComponent implements OnInit {
  readonly category = input<PricingCategory | null>(null);

  readonly orderPlaced = output<void>();
  readonly cancelled = output<void>();

  private readonly pricing = inject(PricingApiService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);
  private readonly platformId = inject(PLATFORM_ID);

  // ── Steps ──
  readonly step = signal<Step>(1);
  readonly submitted = signal(false);

  // ── Step 1: Options ──
  private readonly _selectedOptions = signal<SelectedOptions>({});

  // ── Step 2: Upload ──
  readonly uploading = signal(false);
  readonly uploadedUrl = signal<string | null>(null);
  readonly dragOver = signal(false);

  // ── Step 3: Contact ──
  readonly contactName = signal('');
  readonly contactPhone = signal('');
  readonly contactEmail = signal('');
  readonly contactComment = signal('');

  // ── Step 4: Submit ──
  readonly submitting = signal(false);

  // ── Computed ──

  readonly totalPrice = computed(() => {
    const cat = this.category();
    if (!cat) return 0;
    const opts = this._selectedOptions();
    let total = 0;
    for (const group of cat.optionGroups) {
      const selected = opts[group.slug] ?? [];
      for (const optSlug of selected) {
        const opt = group.options.find(o => o.slug === optSlug);
        if (opt) total += opt.base_price;
      }
    }
    return total;
  });

  readonly selectedOptionsDisplay = computed(() => {
    const cat = this.category();
    if (!cat) return [];
    const opts = this._selectedOptions();
    const labels: string[] = [];
    for (const group of cat.optionGroups) {
      const selected = opts[group.slug] ?? [];
      for (const slug of selected) {
        const opt = group.options.find(o => o.slug === slug);
        if (opt) labels.push(opt.name);
      }
    }
    return labels;
  });

  readonly canProceedStep1 = computed(() => {
    const cat = this.category();
    if (!cat) return false;
    const required = cat.optionGroups.filter(g => g.is_required);
    const opts = this._selectedOptions();
    return required.every(g => (opts[g.slug]?.length ?? 0) > 0);
  });

  readonly canProceedStep3 = computed(() =>
    this.contactName().trim().length > 1 && this.contactPhone().trim().length > 5
  );

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const user: UserProfile | null = this.auth.currentUser();
      if (user) {
        this.contactName.set(user.display_name || user.displayName || user.first_name || '');
        this.contactPhone.set(user.phone || '');
        this.contactEmail.set(user.email || '');
      }
    }
  }

  goStep(s: Step) {
    this.step.set(s);
  }

  // ── Options ──

  isOptionSelected(groupSlug: string, optSlug: string): boolean {
    return (this._selectedOptions()[groupSlug] ?? []).includes(optSlug);
  }

  toggleOption(group: PricingOptionGroup, opt: PricingServiceOption) {
    const opts = { ...this._selectedOptions() };
    const current = opts[group.slug] ?? [];

    if (group.selection_type === 'single') {
      opts[group.slug] = current.includes(opt.slug) ? [] : [opt.slug];
    } else {
      opts[group.slug] = current.includes(opt.slug)
        ? current.filter(s => s !== opt.slug)
        : [...current, opt.slug];
    }
    this._selectedOptions.set(opts);
  }

  // ── Upload ──

  onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void this.uploadFile(file);
  }

  onDrop(e: DragEvent) {
    e.preventDefault();
    this.dragOver.set(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && file.type.startsWith('image/')) void this.uploadFile(file);
  }

  private async uploadFile(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      this.snackBar.open('Файл слишком большой (максимум 20 МБ)', 'OK', { duration: 4000 });
      return;
    }

    this.uploading.set(true);
    try {
      // 1) Get presigned URL from backend
      const presignRes = await firstValueFrom(
        this.http.post<{ success: boolean; data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] } }>(
          '/api/orders/photo-print/direct-upload/presign',
          { files: [{ fileName: file.name, contentType: file.type, fileSize: file.size }] },
        ),
      );
      const { s3Key, uploadUrl } = presignRes.data.uploads[0];

      // 2) Upload directly to S3
      await firstValueFrom(
        this.http.put(uploadUrl, file, {
          headers: { 'Content-Type': file.type },
        }),
      );

      // 3) Complete upload, get verified URL
      const completeRes = await firstValueFrom(
        this.http.post<{ success: boolean; data: { files: { url: string; s3Key: string; fileName: string }[] } }>(
          '/api/orders/photo-print/direct-upload/complete',
          { files: [{ s3Key, fileName: file.name, contentType: file.type, fileSize: file.size }] },
        ),
      );
      this.uploadedUrl.set(completeRes.data.files[0]?.url ?? null);
    } catch {
      this.snackBar.open('Ошибка загрузки фото. Попробуйте ещё раз.', 'OK', { duration: 4000 });
    } finally {
      this.uploading.set(false);
    }
  }

  // ── Submit ──

  async submitOrder() {
    if (this.submitting()) return;
    const cat = this.category();
    if (!cat) return;

    const payload = {
      items: [{
        name: cat.name,
        slug: cat.slug,
        quantity: 1,
        price: this.totalPrice() || 0,
        options: this.selectedOptionsDisplay(),
      }],
      contact: {
        name: this.contactName().trim(),
        phone: this.contactPhone().trim(),
        email: this.contactEmail().trim() || undefined,
      },
      totalAmount: this.totalPrice() || 1,
      comment: this.contactComment().trim() || undefined,
      categorySlug: cat.slug,
      selectedOptions: this._selectedOptions(),
      metadata: {
        categorySlug: cat.slug,
        categoryName: cat.name,
        uploadedPhotoUrl: this.uploadedUrl(),
        source: 'photo-selections-page',
      }
    };

    this.submitting.set(true);
    try {
      await firstValueFrom(this.http.post('/api/orders', payload));
      this.submitted.set(true);
      this.orderPlaced.emit();
    } catch {
      this.snackBar.open('Ошибка при отправке заказа. Попробуйте ещё раз.', 'OK', { duration: 4000 });
    } finally {
      this.submitting.set(false);
    }
  }
}
