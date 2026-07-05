import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { OrderSelectedEvent } from '../pricing-configurator/pricing-configurator.component';
import { resizeImages } from '../../utils/image-resizer';

interface UploadPreview {
  id: string;
  file: File;
  url: string;
}

export interface DocumentOption {
  id: string;
  label: string;
  value: string;
}

export interface PhotoUploadSubmittedEvent {
  config: OrderSelectedEvent;
  files: File[];
  selectedDoc?: string;
  selectedDocId?: string;
  selectedDocs?: string[];
  customerNote?: string;
}

@Component({
  selector: 'app-photo-upload-overlay',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  template: `
    @if (isOpen()) {
      <div class="puo-backdrop" (click)="onBackdropClick($event)" (keydown.enter)="onBackdropClick($event)" tabindex="0">
        <section class="puo-panel" role="dialog" aria-modal="true" aria-label="Загрузка фото для заказа">

          @switch (phase()) {
            <!-- ═══ UPLOAD PHASE ═══ -->
            @case ('upload') {
              <header class="puo-header">
                <div class="puo-header-text">
                  <h2>Загрузите фото</h2>
                  <p>Мы подберем лучший кадр и подготовим заказ к оплате</p>
                </div>
                <button type="button" class="puo-close" (click)="close()" aria-label="Закрыть">
                  <mat-icon>close</mat-icon>
                </button>
              </header>

              <div class="puo-body">
                @if (previews().length === 0) {
                  <div class="puo-guide">
                    <h3>Как сделать селфи лучше</h3>
                    <ul>
                      <li><mat-icon>wb_sunny</mat-icon><span>Равномерный свет, без теней на лице</span></li>
                      <li><mat-icon>wallpaper</mat-icon><span>Однотонный светлый фон</span></li>
                      <li><mat-icon>center_focus_strong</mat-icon><span>Камера на уровне глаз, лицо по центру</span></li>
                      <li><mat-icon>sentiment_neutral</mat-icon><span>Нейтральное выражение лица</span></li>
                      <li><mat-icon>visibility</mat-icon><span>Без головных уборов и темных очков</span></li>
                      <li><mat-icon>photo_library</mat-icon><span>Загрузите от 1 фото, мы выберем лучшее</span></li>
                    </ul>
                  </div>
                } @else {
                  <div class="puo-summary">
                    <h3>Проверьте фото перед отправкой</h3>
                    <p>{{ orderSummaryText() }}</p>
                  </div>
                }

                <div class="puo-document">
                  @if (isMultiDocument()) {
                    <span [attr.aria-label]="multiSelectLabel()">{{ multiSelectLabel() }}</span>
                    <div class="puo-doc-chips">
                      @for (doc of resolvedDocumentOptions(); track doc.id) {
                        <button
                          type="button"
                          class="puo-doc-chip"
                          [class.puo-doc-chip--active]="isMultiDocumentSelected(doc.value)"
                          (click)="toggleMultiDocument(doc.value)"
                        >
                          {{ doc.label }}
                        </button>
                      }
                    </div>
                    <p>{{ multiSelectHint() }}</p>
                  } @else {
                    <label for="puo-document-select">{{ singleSelectLabel() }}</label>
                    <select
                      id="puo-document-select"
                      [value]="selectedDocumentId() || ''"
                      (change)="onDocumentChanged($event)"
                    >
                      <option value="" disabled>{{ selectPlaceholder() }}</option>
                      @for (doc of resolvedDocumentOptions(); track doc.id) {
                        <option [value]="doc.id">{{ doc.label }}</option>
                      }
                    </select>
                    <p>{{ singleSelectHint() }}</p>
                  }
                </div>

                <div class="puo-note">
                  <label for="puo-customer-note">Пожелания к заказу</label>
                  <textarea
                    id="puo-customer-note"
                    [value]="customerNote()"
                    (input)="onCustomerNoteChanged($event)"
                    rows="3"
                    placeholder="Укажите нужные размеры, тип формы и особые требования"
                  ></textarea>
                  <p>Например: 9×12 в личное дело, форма полиции, формат 3×4.5.</p>
                </div>

                <div
                  class="puo-dropzone"
                  [class.puo-dropzone--dragover]="isDragOver()"
                  (dragover)="onDragOver($event)"
                  (dragleave)="onDragLeave($event)"
                  (drop)="onDrop($event)"
                  (click)="fileInput.click()"
                  (keydown.enter)="fileInput.click()"
                  tabindex="0"
                >
                  <mat-icon>cloud_upload</mat-icon>
                  <p>Перетащите фото сюда или нажмите для выбора</p>
                  <span>Поддерживаются JPG, PNG, HEIC</span>
                  <input
                    #fileInput
                    type="file"
                    accept="image/*,.heic,.heif"
                    multiple
                    hidden
                    (change)="onFilesSelected($event)"
                  />
                </div>

                @if (previews().length > 0) {
                  <div class="puo-grid">
                    @for (preview of previews(); track preview.id) {
                      <article class="puo-thumb">
                        <img [src]="preview.url" [alt]="preview.file.name" loading="lazy" />
                        <button type="button" class="puo-remove" (click)="removePreview(preview.id); $event.stopPropagation()" aria-label="Удалить фото">
                          <mat-icon>close</mat-icon>
                        </button>
                      </article>
                    }
                  </div>
                }
              </div>

              @if (submitError()) {
                <div class="puo-error" role="alert">{{ submitError() }}</div>
              }

              <footer class="puo-footer">
                <button mat-stroked-button type="button" (click)="close()" [disabled]="isSubmitting()">Отмена</button>
                <button
                  mat-flat-button
                  type="button"
                  class="puo-submit"
                  [disabled]="isSubmitting() || previews().length === 0 || !orderConfig() || !canSubmitDocumentInfo()"
                  (click)="submit()"
                >
                  @if (isSubmitting()) {
                    Отправляем...
                  } @else {
                    Отправить
                  }
                </button>
              </footer>
            }

            <!-- ═══ PAYMENT PHASE ═══ -->
            @case ('payment') {
              <header class="puo-header">
                <div class="puo-header-text">
                  <h2>Заказ создан</h2>
                  <p>Осталось только оплатить</p>
                </div>
              </header>

              <div class="puo-body puo-body--centered">
                <div class="puo-pay-icon">
                  <mat-icon>check_circle</mat-icon>
                </div>

                @if (previews().length > 0) {
                  <div class="puo-pay-thumbs">
                    @for (preview of previews().slice(0, 4); track preview.id) {
                      <img [src]="preview.url" [alt]="preview.file.name" class="puo-pay-thumb" />
                    }
                    @if (previews().length > 4) {
                      <span class="puo-pay-more">+{{ previews().length - 4 }}</span>
                    }
                  </div>
                }

                <div class="puo-pay-details">
                  <span class="puo-pay-service">{{ paymentSummary()?.description }}</span>
                  <span class="puo-pay-photos">{{ paymentSummary()?.photoCount }} фото</span>
                </div>

                <div class="puo-pay-divider"></div>

                <div class="puo-pay-total-row">
                  <span class="puo-pay-total-label">К оплате:</span>
                  <span class="puo-pay-total-amount">{{ paymentSummary()?.total }} &#8381;</span>
                </div>

                @if (submitError()) {
                  <div class="puo-error" role="alert">{{ submitError() }}</div>
                }

                <button
                  mat-flat-button
                  type="button"
                  class="puo-pay-btn"
                  [disabled]="paymentLoading()"
                  (click)="payClicked.emit()"
                >
                  @if (paymentLoading()) {
                    Обработка...
                  } @else {
                    Оплатить {{ paymentSummary()?.total }} &#8381;
                  }
                </button>

                <p class="puo-pay-hint">
                  После оплаты вы сможете обсудить все детали заказа с нами в чате.
                </p>

                <button type="button" class="puo-text-link" [disabled]="paymentLoading()" (click)="payLater.emit()">
                  Оплатить позже
                </button>
              </div>
            }

            <!-- ═══ SUCCESS PHASE ═══ -->
            @case ('success') {
              <div class="puo-body puo-body--centered puo-body--success">
                <div class="puo-success-icon">
                  <mat-icon>check_circle</mat-icon>
                </div>

                <h2 class="puo-success-title">Оплата прошла успешно!</h2>

                <div class="puo-success-details">
                  <span>Заказ {{ paymentSummary()?.orderId }}</span>
                  <span>Сумма: {{ paymentSummary()?.total }} &#8381;</span>
                </div>

                <p class="puo-success-text">
                  Мы уже приступили к работе.
                  Переходите в чат, чтобы обсудить детали и пожелания.
                </p>

                <button
                  mat-flat-button
                  type="button"
                  class="puo-chat-btn"
                  (click)="goToChat.emit()"
                >
                  <mat-icon>chat</mat-icon>
                  Перейти в чат
                </button>
              </div>
            }
          }

        </section>
      </div>
    }
  `,
  styles: [`
    :host {
      display: block;
      font-family: var(--ed-font-body, 'Plus Jakarta Sans', sans-serif);
    }

    .puo-backdrop {
      position: fixed;
      inset: 0;
      z-index: 1700;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
    }

    .puo-panel {
      width: min(100%, 520px);
      max-height: min(86vh, 860px);
      display: flex;
      flex-direction: column;
      background: var(--ed-surface-dim, #111111);
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 24px;
      overflow: hidden;
      animation: puo-scale-in 240ms cubic-bezier(0.16, 1, 0.3, 1);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .puo-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      padding: 20px 20px 12px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .puo-header-text h2 {
      margin: 0;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.5rem;
      letter-spacing: -0.02em;
      text-transform: uppercase;
    }

    .puo-header-text p {
      margin: 8px 0 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.9rem;
      line-height: 1.45;
    }

    .puo-close {
      border: 0;
      background: transparent;
      color: var(--ed-on-surface-variant, #a0a0a0);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 50%;
    }

    .puo-close:hover {
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
    }

    .puo-body {
      flex: 1;
      overflow: auto;
      padding: 18px 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .puo-guide,
    .puo-summary {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 16px;
      padding: 14px;
    }

    .puo-guide h3,
    .puo-summary h3 {
      margin: 0 0 10px;
      font-size: 1rem;
    }

    .puo-guide ul {
      margin: 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }

    .puo-guide li {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.88rem;
      line-height: 1.3;
    }

    .puo-guide mat-icon {
      color: var(--ed-accent, #f59e0b);
      font-size: 18px;
      width: 18px;
      height: 18px;
      flex: 0 0 auto;
    }

    .puo-summary p {
      margin: 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.9rem;
    }

    .puo-document {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 16px;
      padding: 12px 14px;
      display: grid;
      gap: 6px;
    }

    .puo-document label {
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .puo-document select {
      width: 100%;
      border: 1px solid var(--ed-outline, #3a3a3a);
      background: #101010;
      color: var(--ed-on-surface, #f5f5f5);
      border-radius: 12px;
      padding: 10px 12px;
      font: inherit;
      outline: none;
      transition: border-color 160ms ease;
    }

    .puo-document select:focus {
      border-color: var(--ed-accent, #f59e0b);
    }

    .puo-document p {
      margin: 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .puo-doc-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .puo-doc-chip {
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: 999px;
      padding: 7px 12px;
      background: #101010;
      color: var(--ed-on-surface, #f5f5f5);
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
      transition: border-color 160ms ease, background-color 160ms ease;
    }

    .puo-doc-chip--active {
      border-color: var(--ed-accent, #f59e0b);
      background: rgba(245, 158, 11, 0.16);
    }

    .puo-note {
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      border-radius: 16px;
      padding: 12px 14px;
      display: grid;
      gap: 6px;
    }

    .puo-note label {
      font-size: 0.82rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .puo-note textarea {
      width: 100%;
      border: 1px solid var(--ed-outline, #3a3a3a);
      background: #101010;
      color: var(--ed-on-surface, #f5f5f5);
      border-radius: 12px;
      padding: 10px 12px;
      font: inherit;
      resize: vertical;
      min-height: 76px;
      outline: none;
      transition: border-color 160ms ease;
    }

    .puo-note textarea:focus {
      border-color: var(--ed-accent, #f59e0b);
    }

    .puo-note p {
      margin: 0;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-size: 0.78rem;
      line-height: 1.35;
    }

    .puo-dropzone {
      border: 2px dashed var(--ed-outline, #3a3a3a);
      border-radius: 16px;
      padding: 24px 16px;
      text-align: center;
      cursor: pointer;
      transition: border-color 180ms ease, background-color 180ms ease;
      background: rgba(255, 255, 255, 0.01);
    }

    .puo-dropzone--dragover {
      border-color: var(--ed-accent, #f59e0b);
      background: rgba(245, 158, 11, 0.08);
    }

    .puo-dropzone mat-icon {
      font-size: 30px;
      width: 30px;
      height: 30px;
      color: var(--ed-accent, #f59e0b);
      margin-bottom: 6px;
    }

    .puo-dropzone p {
      margin: 0;
      font-weight: 600;
      font-size: 0.94rem;
    }

    .puo-dropzone span {
      display: block;
      margin-top: 6px;
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .puo-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
      gap: 10px;
    }

    .puo-thumb {
      position: relative;
      aspect-ratio: 1;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: #000;
    }

    .puo-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .puo-remove {
      position: absolute;
      right: 6px;
      top: 6px;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      border: 0;
      background: rgba(0, 0, 0, 0.72);
      color: #fff;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .puo-remove mat-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .puo-error {
      margin: 0 20px;
      padding: 10px 14px;
      background: rgba(220, 38, 38, 0.12);
      border: 1px solid rgba(220, 38, 38, 0.4);
      border-radius: 8px;
      color: #fca5a5;
      font-size: 0.85rem;
      line-height: 1.4;
    }

    .puo-footer {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
      padding: 14px 20px 20px;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .puo-submit {
      --mat-button-filled-container-color: var(--ed-accent, #f59e0b);
      --mat-button-filled-label-text-color: #101010;
      font-weight: 700;
    }

    /* ── Payment phase ── */
    .puo-body--centered {
      align-items: center;
      text-align: center;
      padding: 28px 24px;
    }

    .puo-pay-icon mat-icon {
      font-size: 48px;
      width: 48px;
      height: 48px;
      color: #4ade80;
    }

    .puo-pay-thumbs {
      display: flex;
      gap: 8px;
      align-items: center;
      justify-content: center;
      margin-top: 16px;
    }

    .puo-pay-thumb {
      width: 56px;
      height: 56px;
      border-radius: 10px;
      object-fit: cover;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    .puo-pay-more {
      width: 56px;
      height: 56px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .puo-pay-details {
      margin-top: 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .puo-pay-service {
      font-size: 1rem;
      font-weight: 600;
    }

    .puo-pay-photos {
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .puo-pay-divider {
      width: 80%;
      height: 1px;
      background: var(--ed-outline-variant, #2a2a2a);
      margin: 16px 0;
    }

    .puo-pay-total-row {
      display: flex;
      align-items: baseline;
      gap: 12px;
    }

    .puo-pay-total-label {
      font-size: 0.9rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .puo-pay-total-amount {
      font-size: 1.75rem;
      font-weight: 800;
      color: var(--ed-accent, #f59e0b);
    }

    .puo-pay-btn {
      margin-top: 20px;
      width: 100%;
      max-width: 320px;
      --mat-button-filled-container-color: var(--ed-accent, #f59e0b);
      --mat-button-filled-label-text-color: #101010;
      font-weight: 700;
      font-size: 1rem;
      min-height: 48px;
    }

    .puo-pay-hint {
      margin: 12px 0 0;
      font-size: 0.82rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.4;
      max-width: 300px;
    }

    .puo-text-link {
      margin-top: 8px;
      background: none;
      border: none;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font: inherit;
      font-size: 0.85rem;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
      padding: 8px 16px;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
    }

    .puo-text-link:hover {
      color: var(--ed-on-surface, #f5f5f5);
    }

    /* ── Success phase ── */
    .puo-body--success {
      padding: 48px 24px 36px;
    }

    .puo-success-icon mat-icon {
      font-size: 64px;
      width: 64px;
      height: 64px;
      color: #4ade80;
    }

    .puo-success-title {
      margin: 16px 0 0;
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      font-size: 1.5rem;
      letter-spacing: -0.02em;
      text-transform: uppercase;
    }

    .puo-success-details {
      margin-top: 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 0.9rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .puo-success-text {
      margin: 20px 0 0;
      font-size: 0.9rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      line-height: 1.5;
      max-width: 300px;
    }

    .puo-chat-btn {
      margin-top: 24px;
      width: 100%;
      max-width: 320px;
      --mat-button-filled-container-color: var(--ed-accent, #f59e0b);
      --mat-button-filled-label-text-color: #101010;
      font-weight: 700;
      font-size: 1rem;
      min-height: 48px;
    }

    .puo-chat-btn mat-icon {
      margin-right: 6px;
    }

    @media (max-width: 599px) {
      .puo-backdrop {
        padding: 0;
      }

      .puo-panel {
        width: 100%;
        height: 100%;
        max-height: none;
        border-radius: 0;
        animation: puo-slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1);
      }

      .puo-header {
        padding-top: 14px;
      }

      .puo-footer {
        padding-bottom: 18px;
      }

      .puo-footer button {
        min-height: 48px;
      }

      .puo-dropzone {
        order: -1;
      }
    }

    @keyframes puo-scale-in {
      from {
        opacity: 0;
        transform: scale(0.94) translateY(14px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    @keyframes puo-slide-up {
      from {
        opacity: 0;
        transform: translateY(28px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `],
})
export class PhotoUploadOverlayComponent implements OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private bodyOverflowBeforeLock = '';
  private isBodyLocked = false;

  private readonly defaultDocumentOptions: DocumentOption[] = [
    { id: 'passport_rf', label: 'Паспорт РФ', value: 'Паспорт РФ' },
    { id: 'zagran', label: 'Загранпаспорт', value: 'Загранпаспорт' },
    { id: 'visa', label: 'Виза', value: 'Виза' },
    { id: 'driver', label: 'Водительские права', value: 'Водительские права' },
    { id: 'military', label: 'Военный билет', value: 'Военный билет' },
    { id: 'other', label: 'Другое', value: 'Другой документ' },
  ];

  readonly isOpen = input<boolean>(false);
  readonly submitError = input<string | null>(null);
  readonly orderConfig = input<OrderSelectedEvent | null>(null);
  readonly isMultiDocument = input(false);
  readonly documentOptions = input<DocumentOption[] | null>(null);
  readonly singleSelectLabel = input('Документ');
  readonly multiSelectLabel = input('Документы (до 4)');
  readonly selectPlaceholder = input('Выберите тип документа');
  readonly singleSelectHint = input('Если документа нет в списке, укажите его в поле пожеланий ниже.');
  readonly multiSelectHint = input('Выберите основные документы, а детали укажите ниже в пожеланиях.');

  readonly phase = input<'upload' | 'payment' | 'success'>('upload');
  readonly paymentSummary = input<{ orderId: string; total: number; description: string; photoCount: number } | null>(null);
  readonly paymentLoading = input(false);

  readonly closed = output<void>();
  readonly submitted = output<PhotoUploadSubmittedEvent>();
  readonly payClicked = output<void>();
  readonly goToChat = output<void>();
  readonly payLater = output<void>();

  protected readonly previews = signal<UploadPreview[]>([]);
  protected readonly isDragOver = signal(false);
  protected readonly selectedDocumentId = signal<string | null>(null);
  protected readonly selectedDocumentValue = signal<string | null>(null);
  protected readonly selectedDocuments = signal<string[]>([]);
  protected readonly customerNote = signal('');
  protected readonly isSubmitting = signal(false);
  protected readonly resolvedDocumentOptions = computed(() => this.documentOptions() ?? this.defaultDocumentOptions);

  protected readonly canSubmitDocumentInfo = computed(() => {
    const hasNote = this.customerNote().trim().length > 0;
    if (this.isMultiDocument()) {
      return this.selectedDocuments().length > 0 || hasNote;
    }
    return !!this.selectedDocumentId() || hasNote;
  });

  protected readonly orderSummaryText = computed(() => {
    const config = this.orderConfig();
    if (!config) return '';
    return `Услуга: ${config.displayName}`;
  });

  constructor() {
    effect(() => {
      if (!isPlatformBrowser(this.platformId)) return;
      const open = this.isOpen();
      this.setBodyScrollLock(open);
      if (!open && this.phase() === 'upload') this.resetForm();
    });

    effect(() => {
      if (this.submitError()) this.isSubmitting.set(false);
    });
  }

  ngOnDestroy(): void {
    this.setBodyScrollLock(false);
    this.clearPreviews();
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (!this.isOpen() || this.isSubmitting()) return;
    if (this.phase() !== 'upload') return;
    this.close();
  }

  protected onBackdropClick(event: Event): void {
    if (event.target !== event.currentTarget || this.isSubmitting()) return;
    if (this.phase() !== 'upload') return;
    this.close();
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);

    const list = event.dataTransfer?.files;
    if (!list?.length) return;
    this.addFiles(Array.from(list));
  }

  protected onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    this.addFiles(Array.from(input.files));
    input.value = '';
  }

  protected onDocumentChanged(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const selectedId = select.value || null;
    this.selectedDocumentId.set(selectedId);
    const selected = this.resolvedDocumentOptions().find(doc => doc.id === selectedId) || null;
    this.selectedDocumentValue.set(selected?.value || null);
  }

  protected onCustomerNoteChanged(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.customerNote.set(target.value);
  }

  protected isMultiDocumentSelected(value: string): boolean {
    return this.selectedDocuments().includes(value);
  }

  protected toggleMultiDocument(value: string): void {
    this.selectedDocuments.update(items => {
      if (items.includes(value)) {
        return items.filter(item => item !== value);
      }
      if (items.length >= 4) {
        return items;
      }
      return [...items, value];
    });
  }

  protected removePreview(id: string): void {
    const target = this.previews().find(item => item.id === id);
    if (target) {
      URL.revokeObjectURL(target.url);
    }
    this.previews.update(items => items.filter(item => item.id !== id));
  }

  protected close(): void {
    if (this.isSubmitting()) return;
    this.closed.emit();
  }

  protected submit(): void {
    if (this.isSubmitting()) return;

    const config = this.orderConfig();
    if (!config || this.previews().length === 0) return;

    this.isSubmitting.set(true);

    const selectedDocs = this.selectedDocuments();
    const note = this.customerNote().trim();

    this.submitted.emit({
      config,
      files: this.previews().map(item => item.file),
      selectedDoc: this.selectedDocumentValue() || undefined,
      selectedDocId: this.selectedDocumentId() || undefined,
      selectedDocs: selectedDocs.length > 0 ? selectedDocs : undefined,
      customerNote: note || undefined,
    });
  }

  private async addFiles(files: File[]): Promise<void> {
    const valid = files.filter(file => file.type.startsWith('image/'));
    if (valid.length === 0) return;

    // Client-side resize: reduce large photos before preview/upload
    const resized = await resizeImages(valid);

    const additions = resized.map(file => ({
      id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      file,
      url: URL.createObjectURL(file),
    }));

    this.previews.update(items => [...items, ...additions]);
  }

  private clearPreviews(): void {
    for (const item of this.previews()) {
      URL.revokeObjectURL(item.url);
    }
    this.previews.set([]);
  }

  private resetForm(): void {
    this.clearPreviews();
    this.selectedDocumentId.set(null);
    this.selectedDocumentValue.set(null);
    this.selectedDocuments.set([]);
    this.customerNote.set('');
    this.isSubmitting.set(false);
  }

  private setBodyScrollLock(shouldLock: boolean): void {
    if (!isPlatformBrowser(this.platformId)) return;

    if (shouldLock && !this.isBodyLocked) {
      this.bodyOverflowBeforeLock = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      this.isBodyLocked = true;
      return;
    }

    if (!shouldLock && this.isBodyLocked) {
      document.body.style.overflow = this.bodyOverflowBeforeLock;
      this.bodyOverflowBeforeLock = '';
      this.isBodyLocked = false;
    }
  }
}
