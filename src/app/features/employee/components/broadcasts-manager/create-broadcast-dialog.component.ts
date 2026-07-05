import {
  Component, inject, signal, computed, effect, input, output, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of, debounceTime, switchMap, catchError } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import {
  BroadcastApiService,
  BroadcastButton,
  BroadcastPayload,
  BroadcastEditData,
  CreateBroadcastInput,
  AudienceFilter,
  ServiceOption,
  ChannelOption,
} from '../../services/broadcast-api.service';

/** Дефолтный тест-контакт — flavrinov (см. briefing) */
const DEFAULT_TEST_CONTACT_ID = 'e7652775-493f-4162-a123-e42a92d43340';

/** Каналы, готовые к реальной отправке (диспатч): Telegram, MAX и ВКонтакте */
const DISPATCHABLE_CHANNELS = ['telegram', 'max', 'vk'] as const;

/** Канал по умолчанию при создании рассылки */
const DEFAULT_CHANNEL = 'telegram';

/** Опция давности последнего контакта */
interface RecencyOption {
  value: number | null;
  label: string;
}

/** Человеческие подписи каналов (fallback для неизвестных) */
const CHANNEL_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  max: 'MAX',
  vk: 'ВКонтакте',
  whatsapp: 'WhatsApp',
};

/** Редактируемый ряд url-кнопки в форме */
interface ButtonRow {
  text: string;
  url: string;
}

@Component({
  selector: 'app-create-broadcast-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatButtonModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatIconModule, MatSnackBarModule,
    MatProgressSpinnerModule, MatTooltipModule, MatSlideToggleModule,
  ],
  template: `
    <div class="panel-head">
      <h2 class="panel-title">Новая рассылка</h2>
      <button mat-icon-button type="button" matTooltip="Закрыть" (click)="cancelled.emit()">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <div class="composer">
      <!-- ── ЛЕВО: редактор ── -->
      <div class="composer-form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Название рассылки</mat-label>
          <input matInput [(ngModel)]="name" required placeholder="Видно только вам, в списке рассылок" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Текст сообщения</mat-label>
          <textarea matInput [ngModel]="text()" (ngModelChange)="text.set($event)" rows="5"
                    placeholder="Текст, который получат подписчики выбранного канала"></textarea>
        </mat-form-field>

        <!-- Изображение флаера -->
        <div class="full-width field-block">
          <span class="block-label">Изображение</span>
          @if (mediaUrl()) {
            <div class="media-preview">
              <img [src]="mediaUrl()" alt="Превью флаера" />
              <button mat-icon-button class="media-remove" type="button"
                      matTooltip="Удалить изображение" (click)="removeMedia()">
                <mat-icon>close</mat-icon>
              </button>
            </div>
          } @else {
            <button mat-stroked-button type="button"
                    [disabled]="uploading()" (click)="fileInput.click()">
              @if (uploading()) {
                <ng-container><mat-spinner diameter="18" /><span class="upload-pct">{{ uploadProgress() }}%</span></ng-container>
              } @else {
                <ng-container><mat-icon>image</mat-icon> Загрузить изображение</ng-container>
              }
            </button>
            <input #fileInput type="file" accept="image/jpeg,image/png,image/webp"
                   hidden (change)="onFileSelected($event)" />
            <span class="hint">JPEG, PNG или WebP, до 10 МБ</span>
          }
        </div>

        <!-- Аудитория -->
        <div class="full-width field-block audience-block">
          <span class="block-label">Аудитория</span>

          <div class="audience-filters">
            <mat-form-field appearance="outline" class="audience-channel">
              <mat-label>Канал</mat-label>
              <mat-select [value]="selectedChannel()"
                          (selectionChange)="selectedChannel.set($event.value)">
                @for (ch of channelOptions(); track ch.channel) {
                  <mat-option [value]="ch.channel">
                    {{ channelLabel(ch.channel) }}
                    @if (ch.count) {
                      <span class="option-count">({{ ch.count }})</span>
                    }
                  </mat-option>
                }
              </mat-select>
            </mat-form-field>

            <mat-form-field appearance="outline" class="audience-recency">
              <mat-label>Давность контакта</mat-label>
              <mat-select [value]="selectedRecencyDays()"
                          (selectionChange)="selectedRecencyDays.set($event.value)">
                @for (r of recencyOptions; track r.label) {
                  <mat-option [value]="r.value">{{ r.label }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          </div>

          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Услуги (что заказывали)</mat-label>
            <mat-select multiple
                        [value]="selectedServiceSlugs()"
                        (selectionChange)="selectedServiceSlugs.set($event.value)">
              @for (svc of serviceOptions(); track svc.slug) {
                <mat-option [value]="svc.slug">
                  {{ svc.label }} <span class="option-count">({{ svc.count }})</span>
                </mat-option>
              }
            </mat-select>
            <mat-hint>Ничего не выбрано: все услуги</mat-hint>
          </mat-form-field>

          <!-- Живой счётчик получателей -->
          <div class="audience-counter">
            <div class="counter-value">
              @if (audienceLoading()) {
                <mat-spinner diameter="22" />
              } @else {
                {{ audienceCount() === null ? '—' : audienceCount() }}
              }
            </div>
            <div class="counter-label">получателей в сегменте</div>
          </div>

          @if (!isDispatchableChannel()) {
            <span class="hint audience-soon">
              <mat-icon>schedule</mat-icon>
              Отправка в этот канал скоро. Сейчас доступен счётчик; реальная рассылка в Telegram, МАКС и ВКонтакте.
            </span>
          }
        </div>

        <!-- Url-кнопки -->
        <div class="full-width field-block">
          <span class="block-label">Кнопки-ссылки</span>
          <div class="preset-buttons">
            @for (p of buttonPresets; track p.url) {
              <button mat-stroked-button type="button" class="preset-chip"
                      [disabled]="hasButtonUrl(p.url)"
                      [matTooltip]="hasButtonUrl(p.url) ? 'Уже добавлена' : p.url"
                      (click)="addPreset(p)">
                <mat-icon>add</mat-icon> {{ p.text }}
              </button>
            }
          </div>
          @for (btn of buttonRows(); track $index) {
            <div class="button-row">
              <mat-form-field appearance="outline" class="btn-text">
                <mat-label>Текст</mat-label>
                <input matInput [ngModel]="btn.text"
                       (ngModelChange)="updateButton($index, 'text', $event)" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="btn-url">
                <mat-label>Ссылка</mat-label>
                <input matInput [ngModel]="btn.url"
                       (ngModelChange)="updateButton($index, 'url', $event)"
                       placeholder="https://svoefoto.ru/..." />
              </mat-form-field>
              <button mat-icon-button type="button" class="btn-remove"
                      matTooltip="Удалить кнопку" (click)="removeButton($index)">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          }
          <button mat-stroked-button type="button" class="add-button" (click)="addButton()">
            <mat-icon>add</mat-icon> Добавить кнопку
          </button>
          <div class="svc-buttons">
            <span class="block-label">Служебные кнопки</span>
            <span class="hint">Добавляются движком к сообщению. Видно в предпросмотре.</span>
            <mat-slide-toggle class="svc-toggle" [checked]="svcAddresses()"
                              (change)="svcAddresses.set($event.checked)">
              📍 Наши адреса
            </mat-slide-toggle>
            <mat-slide-toggle class="svc-toggle" [checked]="svcNotStudent()"
                              (change)="svcNotStudent.set($event.checked)">
              🙋 Я не студент
            </mat-slide-toggle>
            <mat-slide-toggle class="svc-toggle" [checked]="true" [disabled]="true"
                              matTooltip="Обязательна: антиспам и закон о рекламе">
              ❌ Отписаться (обязательна)
            </mat-slide-toggle>
          </div>
        </div>

        <!-- Тест-режим -->
        <div class="full-width field-block test-mode-block">
          <div class="test-mode-head">
            <mat-icon>science</mat-icon>
            <span class="block-label">Тест-режим</span>
          </div>
          <span class="hint">
            Рассылка создаётся в тест-режиме и уйдёт только выбранным тест-контактам.
            Массовая отправка: отдельное действие «Запустить на всех» в карточке рассылки.
          </span>
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Тест-контакты (UUID, через запятую/перенос строки)</mat-label>
            <textarea matInput [(ngModel)]="allowedContactIdsRaw" rows="2"></textarea>
          </mat-form-field>
        </div>
      </div>

      <!-- ── ПРАВО: предпросмотр (Telegram или MAX по выбранному каналу) ── -->
      <div class="composer-preview">
        @if (isMaxChannel()) {
          <span class="block-label">Предпросмотр в МАКС</span>
          <div class="mx-phone">
            <div class="mx-header">
              <div class="mx-avatar">СФ</div>
              <div class="mx-titles">
                <div class="mx-name">Своё Фото</div>
                <div class="mx-sub">бот</div>
              </div>
            </div>

            <div class="mx-chat">
              <div class="mx-bubble">
                @if (mediaUrl()) {
                  <img class="mx-media" [src]="mediaUrl()" alt="Изображение рассылки" />
                }
                @if (text().trim()) {
                  <div class="mx-text">{{ text() }}</div>
                } @else {
                  <div class="mx-text mx-placeholder">Текст сообщения появится здесь…</div>
                }
                <span class="mx-time">сейчас</span>
              </div>

              <!-- Инлайн-клавиатура: url-кнопки (по одной в ряд) + служебные callback -->
              <div class="mx-keyboard">
                @for (b of previewButtons(); track $index) {
                  <span class="mx-kb-btn">{{ b.text }}<span class="mx-kb-ext">↗</span></span>
                }
                @if (svcAddresses()) {
                  <span class="mx-kb-btn">📍 Наши адреса</span>
                }
                <div class="mx-kb-pair">
                  @if (svcNotStudent()) {
                    <span class="mx-kb-btn">🙋 Я не студент</span>
                  }
                  <span class="mx-kb-btn">❌ Отписаться</span>
                </div>
              </div>
            </div>
          </div>
          <span class="hint tg-note">Так сообщение увидят подписчики в МАКС. Служебные кнопки добавляются всегда.</span>
        } @else {
          <span class="block-label">Предпросмотр в Telegram</span>
          <div class="tg-phone">
            <div class="tg-header">
              <div class="tg-avatar">СФ</div>
              <div class="tg-titles">
                <div class="tg-name">Своё Фото</div>
                <div class="tg-sub">бот · &#64;FmagnusBot</div>
              </div>
            </div>

            <div class="tg-chat">
              <div class="tg-bubble">
                @if (mediaUrl()) {
                  <img class="tg-media" [src]="mediaUrl()" alt="Изображение рассылки" />
                }
                @if (text().trim()) {
                  <div class="tg-text">{{ text() }}</div>
                } @else {
                  <div class="tg-text tg-placeholder">Текст сообщения появится здесь…</div>
                }
                <span class="tg-time">сейчас</span>
              </div>

              <!-- Инлайн-клавиатура: url-кнопки (по одной в ряд) + служебные callback -->
              <div class="tg-keyboard">
                @for (b of previewButtons(); track $index) {
                  <span class="tg-kb-btn">{{ b.text }}<span class="tg-kb-ext">↗</span></span>
                }
                @if (svcAddresses()) {
                  <span class="tg-kb-btn">📍 Наши адреса</span>
                }
                <div class="tg-kb-pair">
                  @if (svcNotStudent()) {
                    <span class="tg-kb-btn">🙋 Я не студент</span>
                  }
                  <span class="tg-kb-btn">❌ Отписаться</span>
                </div>
              </div>
            </div>
          </div>
          <span class="hint tg-note">Так сообщение увидят подписчики. Служебные кнопки добавляются всегда.</span>
        }
      </div>
    </div>

    <div class="panel-actions">
      <button mat-button type="button" (click)="cancelled.emit()">Отмена</button>
      <button mat-flat-button color="primary"
              [disabled]="!name.trim() || saving() || uploading()"
              (click)="save()">
        @if (saving()) {
          <ng-container><mat-spinner diameter="18" /></ng-container>
        } @else if (isEdit()) {
          <ng-container><mat-icon>save</mat-icon> Сохранить</ng-container>
        } @else {
          <ng-container><mat-icon>add</mat-icon> Создать</ng-container>
        }
      </button>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: 100%;
      width: 100%;
    }

    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
    }

    .panel-title {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
    }

    /* Двухколоночный композер: редактор + предпросмотр */
    .composer {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 320px;
      gap: 28px;
      align-items: start;
      padding: 4px 2px;
    }

    .composer-form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 12px;
      align-content: start;
    }

    .composer-preview {
      position: sticky;
      top: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .full-width {
      grid-column: 1 / -1;
    }

    .panel-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding-top: 14px;
      margin-top: 8px;
      border-top: 1px solid var(--crm-border, rgba(255, 255, 255, 0.08));
    }

    .preset-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .preset-chip {
      --mdc-outlined-button-container-height: 32px;
      font-size: 12px;
    }

    .field-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 0;
    }

    .svc-buttons {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 10px;
      padding: 10px 12px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
    }
    .svc-toggle { font-size: 13px; }

    .block-label {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--crm-text-secondary, #a0a0a0);
    }

    .hint {
      font-size: 11px;
      color: var(--crm-text-muted, #888);
      line-height: 1.4;
    }

    .upload-pct {
      margin-left: 6px;
    }

    .media-preview {
      position: relative;
      display: inline-block;
      max-width: 220px;

      img {
        width: 100%;
        border-radius: 8px;
        display: block;
      }
    }

    .media-remove {
      position: absolute;
      top: 4px;
      right: 4px;
      background: rgba(0, 0, 0, 0.6);
      color: #fff;
    }

    .button-row {
      display: flex;
      align-items: center;
      gap: 8px;

      .btn-text { flex: 0 0 40%; }
      .btn-url { flex: 1; }
      .btn-remove { flex-shrink: 0; }
    }

    .add-button {
      align-self: flex-start;
    }

    .test-mode-block {
      border: 1px solid var(--crm-status-warning-muted, rgba(245, 158, 11, 0.2));
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(245, 158, 11, 0.04);
    }

    .test-mode-head {
      display: flex;
      align-items: center;
      gap: 6px;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
        color: var(--crm-status-warning, #f59e0b);
      }
    }

    .audience-block {
      border: 1px solid var(--crm-status-info-muted, rgba(59, 130, 246, 0.2));
      border-radius: 8px;
      padding: 10px 12px;
      background: rgba(59, 130, 246, 0.04);
    }

    .audience-filters {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;

      .audience-channel { flex: 1 1 160px; }
      .audience-recency { flex: 1 1 160px; }
    }

    .option-count {
      color: var(--crm-text-muted, #888);
      font-size: 12px;
    }

    .audience-counter {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 12px;
      margin-top: 4px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.03);
      text-align: center;
    }

    .counter-value {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 32px;
      font-size: 28px;
      font-weight: 700;
      font-family: var(--crm-font-display, inherit);
      color: var(--crm-status-success, #22c55e);
    }

    .counter-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      font-weight: 600;
      color: var(--crm-text-muted, #888);
    }

    .audience-soon {
      display: flex;
      align-items: center;
      gap: 6px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-status-info, #3b82f6);
      }
    }

    /* ── Телеграм-предпросмотр (тёмная тема TG) ── */
    .tg-phone {
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #0e1621;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    }

    .tg-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #17212b;
      border-bottom: 1px solid rgba(0, 0, 0, 0.25);
    }

    .tg-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, #f59e0b, #ea7a0b);
      flex-shrink: 0;
    }

    .tg-name {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }

    .tg-sub {
      font-size: 12px;
      color: #6d7f8f;
    }

    .tg-chat {
      padding: 14px 12px 16px;
      background:
        radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.02), transparent 40%),
        #0e1621;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .tg-bubble {
      position: relative;
      align-self: flex-start;
      max-width: 92%;
      background: #182533;
      border-radius: 12px 12px 12px 4px;
      padding: 6px 8px 18px;
      color: #e9edf0;
    }

    .tg-media {
      width: 100%;
      border-radius: 8px;
      display: block;
      margin-bottom: 6px;
    }

    .tg-text {
      font-size: 13px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .tg-placeholder {
      color: #6d7f8f;
      font-style: italic;
    }

    .tg-time {
      position: absolute;
      right: 8px;
      bottom: 4px;
      font-size: 10px;
      color: #6d7f8f;
    }

    .tg-keyboard {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 2px;
    }

    .tg-kb-pair {
      display: flex;
      gap: 4px;

      .tg-kb-btn { flex: 1; }
    }

    .tg-kb-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.08);
      color: #dfe7ee;
      font-size: 12.5px;
      font-weight: 500;
      text-align: center;
      line-height: 1.2;
    }

    .tg-kb-ext {
      font-size: 11px;
      opacity: 0.6;
    }

    .tg-note {
      text-align: center;
    }

    /* ── МАКС-предпросмотр (фирменная сине-фиолетовая гамма) ── */
    .mx-phone {
      border-radius: 16px;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.1);
      background: #14121f;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
    }

    .mx-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      background: #1d1830;
      border-bottom: 1px solid rgba(0, 0, 0, 0.25);
    }

    .mx-avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, #7c5cff, #4d3bff);
      flex-shrink: 0;
    }

    .mx-name {
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }

    .mx-sub {
      font-size: 12px;
      color: #8a82a8;
    }

    .mx-chat {
      padding: 14px 12px 16px;
      background:
        radial-gradient(circle at 20% 20%, rgba(124, 92, 255, 0.05), transparent 40%),
        #14121f;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .mx-bubble {
      position: relative;
      align-self: flex-start;
      max-width: 92%;
      background: #241d3a;
      border-radius: 12px 12px 12px 4px;
      padding: 6px 8px 18px;
      color: #ececf5;
    }

    .mx-media {
      width: 100%;
      border-radius: 8px;
      display: block;
      margin-bottom: 6px;
    }

    .mx-text {
      font-size: 13px;
      line-height: 1.4;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .mx-placeholder {
      color: #8a82a8;
      font-style: italic;
    }

    .mx-time {
      position: absolute;
      right: 8px;
      bottom: 4px;
      font-size: 10px;
      color: #8a82a8;
    }

    .mx-keyboard {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 2px;
    }

    .mx-kb-pair {
      display: flex;
      gap: 4px;

      .mx-kb-btn { flex: 1; }
    }

    .mx-kb-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(124, 92, 255, 0.16);
      color: #e6e2ff;
      font-size: 12.5px;
      font-weight: 500;
      text-align: center;
      line-height: 1.2;
    }

    .mx-kb-ext {
      font-size: 11px;
      opacity: 0.6;
    }

    /* Узкие экраны — превью под формой */
    @media (max-width: 1100px) {
      .composer {
        grid-template-columns: 1fr;
      }
      .composer-preview {
        position: static;
        max-width: 340px;
      }
    }
  `],
})
export class CreateBroadcastDialogComponent {
  private readonly api = inject(BroadcastApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);

  /** Рассылка успешно создана/обновлена — родитель закрывает панель и обновляет список. */
  readonly created = output<void>();
  /** Отмена/закрытие панели без сохранения. */
  readonly cancelled = output<void>();

  /** Если задан — режим редактирования ЧЕРНОВИКА: форма предзаполняется, save → update. */
  readonly editId = input<string | null>(null);
  /** true в режиме редактирования (меняет надписи/ветку сохранения). */
  readonly isEdit = computed(() => !!this.editId());

  /** Пресет-кнопки: клик добавляет редактируемую URL-кнопку (служебные callback движок шлёт сам). */
  readonly buttonPresets: ButtonRow[] = [
    { text: '📚 Студенческий аккаунт', url: 'https://svoefoto.ru/education' },
    { text: '🖨 Печать фото', url: 'https://svoefoto.ru/pechat-foto' },
    { text: '📍 Контакты', url: 'https://svoefoto.ru/contacts' },
  ];

  name = '';
  readonly text = signal('');
  allowedContactIdsRaw = DEFAULT_TEST_CONTACT_ID;

  readonly mediaUrl = signal<string | null>(null);
  readonly buttonRows = signal<ButtonRow[]>([]);

  // Служебные callback-кнопки (переключатели). «❌ Отписаться» всегда вкл (не переключается).
  readonly svcAddresses = signal(true);
  readonly svcNotStudent = signal(true);
  readonly uploading = signal(false);
  readonly uploadProgress = signal(0);
  readonly saving = signal(false);

  // ── Аудитория (сегмент) ──
  readonly selectedChannel = signal<string>(DEFAULT_CHANNEL);
  readonly selectedServiceSlugs = signal<string[]>([]);
  readonly selectedRecencyDays = signal<number | null>(null);
  readonly serviceOptions = signal<ServiceOption[]>([]);
  readonly channelOptions = signal<ChannelOption[]>([{ channel: DEFAULT_CHANNEL, count: 0 }]);
  readonly audienceCount = signal<number | null>(null);
  readonly audienceLoading = signal(false);

  readonly recencyOptions: RecencyOption[] = [
    { value: null, label: 'Любая давность' },
    { value: 7, label: 'До 7 дней' },
    { value: 30, label: 'До 30 дней' },
    { value: 90, label: 'До 90 дней' },
  ];

  /** Выбран ли MAX (для MAX-ветки предпросмотра и авто utm_source=max) */
  readonly isMaxChannel = computed(() => this.selectedChannel() === 'max');

  /** Канал готов к реальной отправке (Telegram, MAX или ВКонтакте) */
  readonly isDispatchableChannel = computed(
    () => (DISPATCHABLE_CHANNELS as readonly string[]).includes(this.selectedChannel()),
  );

  /** Заполненные url-кнопки для предпросмотра (зеркалит реальную отправку: по одной в ряд). */
  readonly previewButtons = computed(() =>
    this.buttonRows()
      .map(b => ({ text: b.text.trim(), url: b.url.trim() }))
      .filter(b => b.text.length > 0 && b.url.length > 0),
  );

  /** Триггер пересчёта счётчика — debounce, чтобы не дёргать API на каждый клик */
  private readonly previewTrigger$ = new Subject<void>();

  constructor() {
    // Загрузка вариантов сегментации (услуги + каналы)
    this.api.segmentsOptions().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: opts => {
        this.serviceOptions.set(opts.services ?? []);
        if (opts.channels?.length) {
          this.channelOptions.set(opts.channels);
        }
      },
      error: () => {
        // молча — сегментация остаётся с дефолтным каналом telegram
      },
    });

    // Режим редактирования: при заданном editId один раз загружаем черновик и предзаполняем форму.
    effect(() => {
      const id = this.editId();
      if (id) this.loadForEdit(id);
    });

    // Живой счётчик получателей: при изменении любого фильтра → debounce → audience-preview
    effect(() => {
      // подписка на сигналы-фильтры для перезапуска счётчика
      this.selectedChannel();
      this.selectedServiceSlugs();
      this.selectedRecencyDays();
      this.previewTrigger$.next();
    });

    this.previewTrigger$.pipe(
      debounceTime(400),
      switchMap(() => {
        this.audienceLoading.set(true);
        return this.api.audiencePreview(this.buildAudienceFilter()).pipe(
          catchError(() => {
            this.audienceLoading.set(false);
            return of<{ count: number } | null>(null);
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(res => {
      this.audienceLoading.set(false);
      this.audienceCount.set(res ? res.count : null);
    });
  }

  addButton(): void {
    this.buttonRows.update(rows => [...rows, { text: '', url: '' }]);
  }

  /** Добавить пресет-кнопку (редактируемую) — если такой URL ещё не добавлен. */
  addPreset(preset: ButtonRow): void {
    if (this.hasButtonUrl(preset.url)) return;
    this.buttonRows.update(rows => [...rows, { ...preset }]);
  }

  /** Уже есть кнопка с таким URL? (для дизейбла чипа-пресета) */
  hasButtonUrl(url: string): boolean {
    return this.buttonRows().some(b => b.url.trim() === url);
  }

  updateButton(index: number, field: keyof ButtonRow, value: string): void {
    this.buttonRows.update(rows =>
      rows.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
  }

  removeButton(index: number): void {
    this.buttonRows.update(rows => rows.filter((_, i) => i !== index));
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    // Сброс input, чтобы повторный выбор того же файла сработал
    input.value = '';
    this.uploading.set(true);
    this.uploadProgress.set(0);
    this.api.uploadFlyer(file, pct => this.uploadProgress.set(pct)).subscribe({
      next: ({ url }) => {
        this.mediaUrl.set(url);
        this.uploading.set(false);
      },
      error: () => {
        this.snack.open('Ошибка загрузки изображения', 'OK', { duration: 3000 });
        this.uploading.set(false);
      },
    });
  }

  removeMedia(): void {
    this.mediaUrl.set(null);
  }

  save(): void {
    if (!this.name.trim()) return;
    this.saving.set(true);

    const payload: BroadcastPayload = {};
    const textValue = this.text().trim();
    if (textValue) payload.text = textValue;
    const media = this.mediaUrl();
    if (media) payload.mediaUrl = media;

    const buttons = this.collectButtons();
    // Каждая url-кнопка отдельным рядом (как в предпросмотре и в Telegram).
    if (buttons.length > 0) payload.buttons = buttons.map(b => [b]);
    // Служебные кнопки-переключатели («Отписаться» всегда добавляет движок).
    payload.serviceButtons = { addresses: this.svcAddresses(), notStudent: this.svcNotStudent() };

    const input: CreateBroadcastInput = {
      name: this.name.trim(),
      payload,
      audienceFilter: this.buildAudienceFilter(),
    };
    const allowed = this.parseAllowedIds();
    if (allowed.length > 0) input.allowedContactIds = allowed;
    // MAX-кампания: атрибуция кликов идёт по utm_source=max (Telegram-ветку не трогаем)
    if (this.isMaxChannel()) input.utm = { source: 'max' };

    const editId = this.editId();
    const req$ = editId ? this.api.update(editId, input) : this.api.create(input);
    req$.subscribe({
      next: () => {
        this.snack.open(editId ? 'Черновик обновлён' : 'Рассылка создана (тест-режим)', 'OK', { duration: 2000 });
        this.created.emit();
      },
      error: () => {
        this.snack.open(editId ? 'Ошибка сохранения изменений' : 'Ошибка создания рассылки', 'OK', { duration: 3000 });
        this.saving.set(false);
      },
    });
  }

  /** Предзаполнить форму данными редактируемого черновика (режим editId). */
  private loadForEdit(id: string): void {
    this.api.getCampaign(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: data => {
        this.name = data.name ?? '';
        const p = data.broadcast_payload ?? {};
        this.text.set(p.text ?? '');
        this.mediaUrl.set(p.mediaUrl ?? null);
        const rows = Array.isArray(p.buttons)
          ? p.buttons.flat().map(b => ({ text: b.text, url: b.url }))
          : [];
        this.buttonRows.set(rows);
        const sb = p.serviceButtons;
        this.svcAddresses.set(sb?.addresses ?? true);
        this.svcNotStudent.set(sb?.notStudent ?? true);
        const af = data.audience_filter;
        this.selectedChannel.set(data.channel ?? af?.channel ?? DEFAULT_CHANNEL);
        this.selectedServiceSlugs.set(af?.serviceSlugs ?? []);
        this.selectedRecencyDays.set(af?.recencyDays ?? null);
        const allowed = data.allowed_contact_ids;
        if (allowed && allowed.length > 0) this.allowedContactIdsRaw = allowed.join(', ');
      },
      error: () => {
        this.snack.open('Не удалось загрузить кампанию для редактирования', 'OK', { duration: 3000 });
      },
    });
  }

  /** Человеческая подпись канала (fallback — сам идентификатор) */
  channelLabel(channel: string): string {
    return CHANNEL_LABELS[channel] ?? channel;
  }

  /** Собрать фильтр сегмента из текущих значений (пустые услуги опускаем) */
  private buildAudienceFilter(): AudienceFilter {
    const filter: AudienceFilter = { channel: this.selectedChannel() };
    const slugs = this.selectedServiceSlugs();
    if (slugs.length > 0) filter.serviceSlugs = slugs;
    const recency = this.selectedRecencyDays();
    if (recency !== null) filter.recencyDays = recency;
    return filter;
  }

  /** Собрать заполненные url-кнопки (оба поля непустые) */
  private collectButtons(): BroadcastButton[] {
    return this.buttonRows()
      .map(row => ({ text: row.text.trim(), url: row.url.trim() }))
      .filter(row => row.text.length > 0 && row.url.length > 0);
  }

  /** Разобрать UUID тест-контактов из textarea (разделители — запятая/пробел/перенос) */
  private parseAllowedIds(): string[] {
    return this.allowedContactIdsRaw
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  }
}
