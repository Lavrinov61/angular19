import {
  Component, inject, input, output, signal, computed,
  OnChanges, SimpleChanges, ChangeDetectionStrategy, ElementRef, viewChild
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../../../../core/services/toast.service';
import { CRM_MAIL_ACCOUNTS, CRM_MAIL_ACCOUNT_ADDRESS, CRM_MAIL_ACCOUNT_ALIASES, EmailDetail, EmailTemplate, EmailAttachment } from '../../models/email.model';

interface EmailAttachmentPresignResponse {
  success: boolean;
  data: {
    upload_url: string;
    s3_key: string;
  };
}

interface EmailAttachmentCompleteResponse {
  success: boolean;
  data: EmailAttachment;
}

interface DraftSaveResponse {
  success: boolean;
  data: {
    id: number | null;
  };
}

@Component({
  selector: 'app-email-detail-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    DatePipe,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <div class="edv">

      @if (loading()) {
        <div class="edv-skeleton">
          <div class="edv-skeleton__header"></div>
          <div class="edv-skeleton__meta"></div>
          <div class="edv-skeleton__body"></div>
        </div>
      } @else if (email()) {
        <!-- Toolbar -->
        <div class="edv-toolbar">
          <button class="edv-back-btn" (click)="back.emit()">
            <mat-icon>arrow_back</mat-icon>
            <span>Пульт</span>
          </button>

          <div class="edv-toolbar__spacer"></div>

          @if (email()!.direction === 'inbound') {
            <button class="edv-action-pill" (click)="openReply()" matTooltip="Ответить">
              <mat-icon>reply</mat-icon>
              <span>Ответить</span>
            </button>
            @if (email()!.cc_addresses?.length) {
              <button class="edv-action-pill edv-action-pill--ghost" (click)="openReplyAll()" matTooltip="Ответить всем">
                <mat-icon>reply_all</mat-icon>
                <span>Всем</span>
              </button>
            }
          }
          @if (email()!.status === 'failed') {
            <button class="edv-action-pill edv-action-pill--warn" (click)="retryEmail()" matTooltip="Повторить">
              <mat-icon>refresh</mat-icon>
              <span>Повторить</span>
            </button>
          }
          <button class="edv-action-pill edv-action-pill--ghost" (click)="openForward()" matTooltip="Переслать">
            <mat-icon>forward</mat-icon>
            <span>Переслать</span>
          </button>
          <button class="edv-action-pill edv-action-pill--ghost"
                  (click)="openCompose()" matTooltip="Новое письмо">
            <mat-icon>edit</mat-icon>
          </button>
          <button class="edv-action-pill edv-action-pill--ghost"
                  (click)="archiveEmail()" matTooltip="В архив">
            <mat-icon>archive</mat-icon>
          </button>
        </div>

        <!-- Subject -->
        <div class="edv-subject-block">
          <div class="edv-direction-pill"
               [class.edv-direction-pill--in]="email()!.direction === 'inbound'"
               [class.edv-direction-pill--out]="email()!.direction === 'outbound'">
            <mat-icon>{{ email()!.direction === 'inbound' ? 'call_received' : 'call_made' }}</mat-icon>
            {{ email()!.direction === 'inbound' ? 'Входящее' : 'Исходящее' }}
          </div>
          <h2 class="edv-subject">{{ email()!.subject || '(без темы)' }}</h2>
          <div class="edv-status-row">
            @if (email()!.status === 'received') {
              <span class="edv-status edv-status--new">● Новое</span>
            }
            @if (email()!.status === 'read') {
              <span class="edv-status edv-status--read">● Прочитано</span>
            }
            @if (email()!.status === 'replied') {
              <span class="edv-status edv-status--replied">↩ Отвечено</span>
            }
            @if (email()!.status === 'failed') {
              <span class="edv-status edv-status--failed">✗ Ошибка</span>
            }
            @if (email()!.has_attachments) {
              <span class="edv-attach-badge">
                <mat-icon>attach_file</mat-icon> Вложения
              </span>
            }
          </div>
        </div>

        <!-- Metadata -->
        <div class="edv-meta">
          <div class="edv-meta__row">
            <span class="edv-meta__label">От</span>
            <span class="edv-meta__value">{{ email()!.from_address }}</span>
          </div>
          <div class="edv-meta__row">
            <span class="edv-meta__label">Кому</span>
            <span class="edv-meta__value">{{ email()!.to_address }}</span>
          </div>
          @if (email()!.mailbox_address) {
            <div class="edv-meta__row">
              <span class="edv-meta__label">Ящик</span>
              <span class="edv-meta__value">{{ mailboxLabel(email()!.mailbox_address) }} · {{ email()!.mailbox_address }}</span>
            </div>
          }
          @if (email()!.cc_addresses?.length) {
            <div class="edv-meta__row">
              <span class="edv-meta__label">Копия</span>
              <span class="edv-meta__value">{{ email()!.cc_addresses!.join(', ') }}</span>
            </div>
          }
          @if (email()!.customer_phone) {
            <div class="edv-meta__row">
              <span class="edv-meta__label">Телефон</span>
              <span class="edv-meta__value edv-meta__value--phone">{{ email()!.customer_phone }}</span>
            </div>
          }
          <div class="edv-meta__row">
            <span class="edv-meta__label">Дата</span>
            <span class="edv-meta__value edv-meta__value--date">
              {{ email()!.created_at | date:'dd MMMM yyyy, HH:mm':'':'ru' }}
            </span>
          </div>
        </div>

        <div class="edv-content">
          <!-- Body -->
          <div class="edv-body-wrap">
            @if (hasBody()) {
              <div class="edv-body-shell" [class.edv-body-shell--html]="email()!.body_html">
                @if (email()!.body_html) {
                  <iframe
                    class="edv-body-iframe"
                    [srcdoc]="safeBodyHtml()"
                    sandbox=""
                    referrerpolicy="no-referrer"
                    title="Содержимое письма"
                    (load)="onIframeLoad($event)"
                  ></iframe>
                } @else {
                  <pre class="edv-body edv-body--text">{{ email()!.body_text }}</pre>
                }
              </div>
            } @else {
              <div class="edv-body-empty">
                <mat-icon>mail_outline</mat-icon>
                <span>В письме нет текста</span>
              </div>
            }
          </div>

          <!-- Attachments -->
          @if (email()!.attachments?.length) {
            <div class="edv-attachments">
              <h4><mat-icon>attach_file</mat-icon> Вложения ({{ email()!.attachments!.length }})</h4>
              @for (att of email()!.attachments!; track att.id) {
                <button type="button"
                   class="edv-attachment-item"
                   [class.edv-attachment-item--disabled]="!attachmentHref(att) || downloadingAttachmentIds().has(att.id)"
                   [disabled]="!attachmentHref(att) || downloadingAttachmentIds().has(att.id)"
                   (click)="downloadAttachment(att)">
                  <mat-icon>{{ getAttachmentIcon(att.mime_type) }}</mat-icon>
                  <span>{{ attachmentName(att) }}</span>
                  <span class="edv-att-size">{{ formatFileSize(att.size_bytes) }}</span>
                  <mat-icon class="edv-att-download">{{ downloadingAttachmentIds().has(att.id) ? 'hourglass_empty' : 'download' }}</mat-icon>
                </button>
              }
            </div>
          } @else if (email()!.has_attachments) {
            <div class="edv-attachments edv-attachments--empty">
              <h4><mat-icon>attach_file</mat-icon> Вложения</h4>
              <div class="edv-attachment-note">Файлы ещё не доступны для скачивания</div>
            </div>
          }
        </div>

        <!-- Thread -->
        @if (email()!.thread.length > 0) {
          <div class="edv-thread">
            <button class="edv-thread__toggle" (click)="threadOpen.set(!threadOpen())">
              <mat-icon class="edv-thread__icon" [class.edv-thread__icon--open]="threadOpen()">
                expand_more
              </mat-icon>
              <span>В цепочке ({{ email()!.thread.length }})</span>
            </button>
            @if (threadOpen()) {
              <div class="edv-thread__list">
                @for (t of email()!.thread; track t.id) {
                  <div class="edv-thread__item" (click)="loadEmailById(t.id)" (keydown.enter)="loadEmailById(t.id)" tabindex="0">
                    <mat-icon class="edv-thread__dir-icon"
                              [class.edv-thread__dir-icon--in]="t.direction === 'inbound'">
                      {{ t.direction === 'inbound' ? 'call_received' : 'call_made' }}
                    </mat-icon>
                    <span class="edv-thread__subject">{{ t.subject || '(без темы)' }}</span>
                    <span class="edv-thread__date">{{ t.created_at | date:'dd.MM HH:mm' }}</span>
                    <mat-icon class="edv-thread__arrow">chevron_right</mat-icon>
                  </div>
                }
              </div>
            }
          </div>
        }

      } @else if (!loading()) {
        <!-- Empty state -->
        <div class="edv-empty">
          <div class="edv-empty__icon-wrap">
            <mat-icon>mail_outline</mat-icon>
          </div>
          <div class="edv-empty__title">Выберите письмо</div>
          <div class="edv-empty__sub">Кликните на письмо в списке слева, чтобы открыть его здесь</div>
        </div>
      }

    </div>

    <!-- Compose overlay -->
    @if (composeOpen()) {
      <div class="edv-compose">
        <div class="edv-compose__panel">
          <div class="edv-compose__header">
            <span class="edv-compose__title">
              {{ composeMode === 'reply' ? 'Ответить' : composeMode === 'forward' ? 'Переслать' : 'Новое письмо' }}
            </span>
            <button mat-icon-button class="edv-compose__close" (click)="closeCompose()">
              <mat-icon>close</mat-icon>
            </button>
          </div>

          <div class="edv-compose__form">
            <div class="edv-compose__from-line">
              <span>От</span>
              <select [(ngModel)]="composeFrom"
                      (ngModelChange)="onComposeFromChange($event)"
                      class="edv-compose__select edv-compose__select--from">
                @for (account of mailAccounts; track account.address) {
                  <option [value]="account.address">{{ account.address }}</option>
                }
              </select>
            </div>
            <div class="edv-compose__field">
              <span class="edv-compose__label" aria-label="Кому">Кому *</span>
              <input type="email" [(ngModel)]="composeTo"
                     placeholder="email@example.com"
                     class="edv-compose__input">
            </div>
            <div class="edv-compose__field">
              <span class="edv-compose__label" aria-label="Тема">Тема *</span>
              <input type="text" [(ngModel)]="composeSubject"
                     placeholder="Тема письма"
                     class="edv-compose__input">
            </div>

            @if (!showCcBcc()) {
              <button mat-button (click)="showCcBcc.set(true)" class="edv-cc-toggle">CC / BCC</button>
            }
            @if (showCcBcc()) {
              <div class="edv-compose__field">
                <span class="edv-compose__label" aria-label="CC">CC</span>
                <input type="email" [(ngModel)]="composeCC" placeholder="cc@example.com" class="edv-compose__input">
              </div>
              <div class="edv-compose__field">
                <span class="edv-compose__label" aria-label="BCC">BCC</span>
                <input type="email" [(ngModel)]="composeBCC" placeholder="bcc@example.com" class="edv-compose__input">
              </div>
            }

            @if (!replyToEmail() && templates().length) {
              <div class="edv-compose__field">
                <span class="edv-compose__label" aria-label="Шаблон">Шаблон</span>
                <select [(ngModel)]="selectedTemplate"
                        (ngModelChange)="applyTemplate($event)"
                        class="edv-compose__select">
                  <option value="">Без шаблона</option>
                  @for (t of templates(); track t.id) {
                    <option [value]="t.slug">{{ t.name }}</option>
                  }
                </select>
              </div>
            }

            <div class="edv-compose__field edv-compose__field--grow">
              <span class="edv-compose__label" aria-label="Текст">Текст *</span>
              <div class="edv-compose-dropzone"
                (dragover)="onDragOver($event)"
                (dragleave)="onDragLeave($event)"
                (drop)="onDrop($event)"
                [class.dragging]="isDragging()">
                <div class="edv-compose-toolbar">
                  <button mat-icon-button (click)="execCmd('bold')" matTooltip="Жирный"><mat-icon>format_bold</mat-icon></button>
                  <button mat-icon-button (click)="execCmd('italic')" matTooltip="Курсив"><mat-icon>format_italic</mat-icon></button>
                  <button mat-icon-button (click)="execCmd('underline')" matTooltip="Подчёркнутый"><mat-icon>format_underlined</mat-icon></button>
                  <span class="edv-toolbar-divider"></span>
                  <button mat-icon-button (click)="execCmd('insertUnorderedList')" matTooltip="Список"><mat-icon>format_list_bulleted</mat-icon></button>
                  <button mat-icon-button (click)="execCmd('insertOrderedList')" matTooltip="Нумерация"><mat-icon>format_list_numbered</mat-icon></button>
                  <span class="edv-toolbar-divider"></span>
                  <button mat-icon-button (click)="insertLink()" matTooltip="Ссылка"><mat-icon>link</mat-icon></button>
                </div>
                <div class="edv-compose-editor"
                  contenteditable="true"
                  #composeEditor
                  (input)="onEditorInput()"
                ></div>
              </div>
            </div>

            <div class="edv-compose-attachments">
              <input type="file" #fileInput (change)="onFileSelect($event)" multiple hidden />
              <button mat-button (click)="fileInput.click()">
                <mat-icon>attach_file</mat-icon> Прикрепить
              </button>
              @for (file of composeAttachments(); track file.id) {
                <div class="edv-compose-att-item">
                  <mat-icon>{{ getAttachmentIcon(file.mime_type) }}</mat-icon>
                  <span>{{ attachmentName(file) }}</span>
                  <span class="edv-att-size">{{ formatFileSize(file.size_bytes) }}</span>
                  <button mat-icon-button (click)="removeAttachment(file.id)"><mat-icon>close</mat-icon></button>
                </div>
              }
            </div>
          </div>

          <div class="edv-compose__footer">
            <button class="edv-send-btn"
                    [class.edv-send-btn--loading]="sending()"
                    [disabled]="sending()"
                    (click)="sendEmail()">
              @if (sending()) {
                <mat-progress-spinner diameter="15" mode="indeterminate" />
              } @else {
                <mat-icon>send</mat-icon>
              }
              <span>{{ sending() ? 'Отправка...' : 'Отправить' }}</span>
            </button>
            <button class="edv-cancel-btn" (click)="closeCompose()">Отмена</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    @keyframes edvFadeIn {
      from { opacity: 0; transform: translateX(8px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @keyframes edvComposeSlideUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }

    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      position: relative;
      overflow: hidden;
    }

    /* ── Main container ── */
    .edv {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      animation: edvFadeIn var(--crm-transition-panel);
    }

    /* ── Toolbar ── */
    .edv-toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .edv-back-btn {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px 5px 6px;
      border: none;
      background: none;
      border-radius: var(--crm-radius-md);
      color: var(--crm-accent);
      font-size: 13px;
      font-weight: 500;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: background var(--crm-transition-fast);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover { background: var(--crm-accent-muted); }
    }

    .edv-toolbar__spacer { flex: 1; }

    .edv-action-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 12px;
      border: 1px solid var(--crm-glass-border);
      border-radius: 14px;
      background: var(--crm-accent);
      color: var(--crm-on-accent);
      font-size: 12px;
      font-weight: 600;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: background var(--crm-transition-fast), transform var(--crm-transition-fast);

      mat-icon { font-size: 14px; width: 14px; height: 14px; }

      &:hover { background: var(--crm-accent-hover); transform: translateY(-1px); }
      &:active { transform: scale(0.97); }

      &--ghost {
        background: var(--crm-glass-bg);
        color: var(--crm-text-secondary);
        border-color: var(--crm-border);
        padding: 5px 8px;

        &:hover { background: var(--crm-surface-hover); color: var(--crm-text-primary); }
      }

      &--warn {
        background: var(--crm-status-error);
        color: #fff;
        border-color: var(--crm-status-error);

        &:hover { opacity: 0.85; }
      }
    }

    /* ── Subject block ── */
    .edv-subject-block {
      padding: 20px 24px 16px;
      border-bottom: 1px solid var(--crm-border);
      background: var(--crm-surface-base);
      flex-shrink: 0;
    }

    .edv-direction-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 2px 8px;
      border-radius: 10px;
      margin-bottom: 10px;

      mat-icon { font-size: 11px; width: 11px; height: 11px; }

      &--in {
        background: var(--crm-status-info-muted);
        color: var(--crm-status-info);
      }
      &--out {
        background: var(--crm-status-success-muted);
        color: var(--crm-status-success);
      }
    }

    .edv-subject {
      margin: 0 0 10px;
      font-family: var(--crm-font-display);
      font-size: 20px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      color: var(--crm-text-primary);
      line-height: 1.25;
    }

    .edv-status-row {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .edv-status {
      font-size: 11px;
      font-weight: 600;
      font-family: var(--crm-font-sans);

      &--new { color: var(--crm-accent); }
      &--read { color: var(--crm-text-muted); }
      &--replied { color: var(--crm-status-success); }
      &--failed { color: var(--crm-status-error); }
    }

    .edv-attach-badge {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      font-size: 11px;
      color: var(--crm-text-secondary);
      font-family: var(--crm-font-sans);

      mat-icon { font-size: 12px; width: 12px; height: 12px; }
    }

    /* ── Metadata ── */
    .edv-meta {
      padding: 14px 24px;
      background: var(--crm-surface-raised);
      border-bottom: 1px solid var(--crm-border);
      border-left: 3px solid var(--crm-accent);
      flex-shrink: 0;
    }

    .edv-meta__row {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 3px 0;
    }

    .edv-meta__label {
      font-size: 11px;
      color: var(--crm-text-muted);
      font-family: var(--crm-font-sans);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      min-width: 52px;
      flex-shrink: 0;
    }

    .edv-meta__value {
      font-size: 12px;
      color: var(--crm-text-primary);
      font-family: var(--crm-font-sans);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;

      &--phone { color: var(--crm-accent); }
      &--date { color: var(--crm-text-secondary); }
    }

    /* ── Body ── */
    .edv-content {
      flex: 1;
      padding: 24px;
      background: var(--crm-bg, var(--crm-surface-base));
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .edv-body-wrap {
      flex: 0 0 auto;
    }

    .edv-body-shell {
      width: 100%;
      min-height: 260px;
      background: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.10);
      border-radius: var(--crm-radius-md);
      box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
      overflow: hidden;
      color: #111827;
    }

    .edv-body-iframe {
      display: block;
      width: 100%;
      border: none;
      min-height: 260px;
      background: #ffffff;
    }

    .edv-body {
      &--text {
        font-size: 13px;
        color: #111827;
        line-height: 1.7;
        white-space: pre-wrap;
        font-family: var(--crm-font-sans);
        margin: 0;
        padding: 20px;
        background: #ffffff;
      }
    }

    .edv-body-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      min-height: 180px;
      color: var(--crm-text-muted);
      border: 1px dashed var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      font-size: 13px;
      font-family: var(--crm-font-sans);

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    /* ── Thread ── */
    .edv-thread {
      border-top: 1px solid var(--crm-border);
      background: var(--crm-surface-raised);
      flex-shrink: 0;
    }

    .edv-thread__toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      padding: 10px 20px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary);
      font-family: var(--crm-font-sans);
      text-align: left;
      transition: color var(--crm-transition-fast), background var(--crm-transition-fast);

      &:hover { color: var(--crm-text-primary); background: var(--crm-surface-hover); }
    }

    .edv-thread__icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      transition: transform var(--crm-transition-normal);

      &--open { transform: rotate(180deg); }
    }

    .edv-thread__list {
      border-top: 1px solid var(--crm-border-subtle);
    }

    .edv-thread__item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 20px;
      cursor: pointer;
      transition: background var(--crm-transition-fast);
      border-bottom: 1px solid var(--crm-border-subtle);

      &:hover { background: var(--crm-surface-hover); }
      &:last-child { border-bottom: none; }
    }

    .edv-thread__dir-icon {
      font-size: 13px;
      width: 13px;
      height: 13px;
      color: var(--crm-status-success);

      &--in { color: var(--crm-status-info); }
    }

    .edv-thread__subject {
      flex: 1;
      font-size: 12px;
      color: var(--crm-text-primary);
      font-family: var(--crm-font-sans);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .edv-thread__date {
      font-size: 11px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }

    .edv-thread__arrow {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-text-muted);
    }

    /* ── Skeleton ── */
    @keyframes shimmer {
      from { background-position: -400px 0; }
      to { background-position: 400px 0; }
    }

    .edv-skeleton {
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .edv-skeleton__header,
    .edv-skeleton__meta,
    .edv-skeleton__body {
      border-radius: var(--crm-radius-md);
      background: linear-gradient(
        90deg,
        var(--crm-skeleton-base) 25%,
        var(--crm-skeleton-shine) 50%,
        var(--crm-skeleton-base) 75%
      );
      background-size: 800px 100%;
      animation: shimmer 1.6s infinite linear;
    }

    .edv-skeleton__header { height: 48px; width: 60%; }
    .edv-skeleton__meta { height: 80px; }
    .edv-skeleton__body { height: 200px; }

    /* ── Empty state ── */
    .edv-empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 60px 40px;
      text-align: center;
      color: var(--crm-text-secondary);
      height: 100%;
    }

    .edv-empty__icon-wrap {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: var(--crm-surface-raised);
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--crm-border);

      mat-icon {
        font-size: 36px;
        width: 36px;
        height: 36px;
        color: var(--crm-text-muted);
      }
    }

    .edv-empty__title {
      font-family: var(--crm-font-display);
      font-size: 18px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--crm-text-secondary);
    }

    .edv-empty__sub {
      font-size: 13px;
      color: var(--crm-text-muted);
      max-width: 280px;
      line-height: 1.6;
      font-family: var(--crm-font-sans);
    }

    /* ── Attachments ── */
    .edv-attachments {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-raised);
      flex-shrink: 0;
    }

    .edv-attachments h4 {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 8px;
      font-size: 13px;
      color: var(--crm-text-muted);
      font-family: var(--crm-font-sans);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .edv-attachment-item {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto 18px;
      align-items: center;
      gap: 8px;
      width: 100%;
      min-height: 34px;
      padding: 7px 10px;
      border: none;
      border-radius: 6px;
      background: transparent;
      color: var(--crm-text-primary);
      text-decoration: none;
      text-align: left;
      font-size: 13px;
      font-family: var(--crm-font-sans);
      cursor: pointer;

      span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-secondary);
      }
    }

    .edv-attachment-item:hover { background: var(--crm-surface-hover); }
    .edv-attachment-item--disabled { opacity: 0.65; cursor: default; }
    .edv-attachment-item:disabled:hover { background: transparent; }
    .edv-att-size { color: var(--crm-text-muted); font-size: 11px; margin-left: auto; }
    .edv-att-download { color: var(--crm-accent) !important; }
    .edv-attachment-note { color: var(--crm-text-muted); font-size: 12px; font-family: var(--crm-font-sans); }
    .edv-cc-toggle { font-size: 12px; color: var(--crm-text-muted); align-self: flex-start; }

    /* ── Compose overlay ── */
    .edv-compose {
      position: absolute;
      inset: 0;
      z-index: 20;
      background: rgba(12, 11, 9, 0.75);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: flex-end;
      padding: 16px;
    }

    .edv-compose__panel {
      width: 100%;
      max-height: 85vh;
      background: var(--crm-surface-overlay);
      border: 1px solid var(--crm-glass-border);
      border-radius: var(--crm-radius-xl);
      display: flex;
      flex-direction: column;
      animation: edvComposeSlideUp var(--crm-transition-normal);
      box-shadow: var(--crm-shadow-lg);
      overflow: hidden;
    }

    .edv-compose__header {
      display: flex;
      align-items: center;
      padding: 14px 18px 14px 20px;
      border-bottom: 1px solid var(--crm-border);
      flex-shrink: 0;
    }

    .edv-compose__title {
      font-family: var(--crm-font-display);
      font-size: 15px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--crm-text-primary);
      flex: 1;
    }

    .edv-compose__close {
      width: 28px !important;
      height: 28px !important;
      color: var(--crm-text-secondary);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .edv-compose__form {
      flex: 1;
      overflow-y: auto;
      padding: 16px 20px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .edv-compose__field {
      display: flex;
      flex-direction: column;
      gap: 4px;

      &--grow { flex: 1; }
    }

    .edv-compose__from-line {
      display: grid;
      grid-template-columns: 56px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      background: var(--crm-surface-hover);
      color: var(--crm-text-secondary);
      font-family: var(--crm-font-sans);
      font-size: 12px;

      span {
        color: var(--crm-text-muted);
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.06em;
      }

      .edv-compose__select--from {
        min-width: 0;
        padding: 5px 28px 5px 9px;
        background: var(--crm-surface-base);
        font-weight: 600;
      }
    }

    .edv-compose__label {
      font-size: 11px;
      color: var(--crm-text-muted);
      font-family: var(--crm-font-sans);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .edv-compose__input,
    .edv-compose__select,
    .edv-compose__textarea {
      background: var(--crm-surface-hover);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      padding: 8px 12px;
      font-size: 13px;
      color: var(--crm-text-primary);
      outline: none;
      font-family: var(--crm-font-sans);
      transition: border-color var(--crm-transition-fast);
      width: 100%;
      box-sizing: border-box;

      &::placeholder { color: var(--crm-text-muted); }
      &:focus { border-color: var(--crm-border-focus); }
    }

    .edv-compose__textarea {
      resize: vertical;
      min-height: 120px;
    }

    .edv-compose__footer {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 20px;
      border-top: 1px solid var(--crm-border);
      flex-shrink: 0;
    }

    .edv-send-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 9px 20px;
      border: none;
      border-radius: 14px;
      background: var(--crm-accent);
      color: var(--crm-on-accent);
      font-size: 13px;
      font-weight: 700;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: background var(--crm-transition-fast), transform var(--crm-transition-fast);
      flex: 1;
      justify-content: center;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover:not(:disabled) { background: var(--crm-accent-hover); transform: translateY(-1px); }
      &:active:not(:disabled) { transform: scale(0.97); }
      &:disabled { opacity: 0.6; cursor: default; }

      &--loading { opacity: 0.7; }
    }

    .edv-cancel-btn {
      padding: 9px 16px;
      border: 1px solid var(--crm-border);
      border-radius: 14px;
      background: none;
      color: var(--crm-text-secondary);
      font-size: 13px;
      font-family: var(--crm-font-sans);
      cursor: pointer;
      transition: background var(--crm-transition-fast), color var(--crm-transition-fast);

      &:hover { background: var(--crm-surface-hover); color: var(--crm-text-primary); }
    }

    /* ── Drag & drop zone ── */
    .edv-compose-dropzone {
      display: flex;
      flex-direction: column;
      flex: 1;
      border-radius: var(--crm-radius-md);
      transition: border-color 0.2s, background 0.2s;

      &.dragging {
        border: 2px dashed #f59e0b;
        background: rgba(245, 158, 11, 0.05);
      }
    }

    /* ── Compose toolbar (WYSIWYG) ── */
    .edv-compose-toolbar {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 4px 8px;
      border: 1px solid var(--crm-border);
      border-bottom: none;
      border-radius: var(--crm-radius-md) var(--crm-radius-md) 0 0;
      background: var(--crm-surface-hover);

      button {
        width: 32px !important;
        height: 32px !important;
        line-height: 32px !important;
        color: var(--crm-text-secondary);

        mat-icon { font-size: 16px; width: 16px; height: 16px; }

        &:hover { color: var(--crm-text-primary); }
      }
    }

    .edv-toolbar-divider {
      width: 1px;
      height: 20px;
      background: var(--crm-border);
      margin: 0 4px;
    }

    .edv-compose-editor {
      min-height: 200px;
      max-height: 400px;
      overflow-y: auto;
      padding: 12px;
      color: var(--crm-text-primary);
      font-size: 13px;
      line-height: 1.6;
      font-family: var(--crm-font-sans);
      outline: none;
      border: 1px solid var(--crm-border);
      border-radius: 0 0 var(--crm-radius-md) var(--crm-radius-md);
      background: var(--crm-surface-hover);
      transition: border-color var(--crm-transition-fast);

      &:focus { border-color: var(--crm-border-focus); background: var(--crm-surface-base); }

      a { color: var(--crm-accent); }
    }

    /* ── Compose attachments ── */
    .edv-compose-attachments {
      padding: 8px 0;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;

      button { font-size: 12px; color: var(--crm-text-secondary); mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; } }
    }

    .edv-compose-att-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--crm-surface-raised);
      border: 1px solid var(--crm-border);
      border-radius: var(--crm-radius-md);
      font-size: 12px;
      color: var(--crm-text-primary);
      font-family: var(--crm-font-sans);

      mat-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-text-secondary); }

      button {
        width: 20px !important;
        height: 20px !important;
        line-height: 20px !important;
        color: var(--crm-text-muted);

        mat-icon { font-size: 14px; width: 14px; height: 14px; }
      }
    }
  `],
})
export class EmailDetailViewComponent implements OnChanges {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly sanitizer = inject(DomSanitizer);

  emailId = input<number | null>(null);

  back = output<void>();
  clientPhoneResolved = output<string | null>();
  emailArchived = output<number>();
  emailReplied = output<number>();
  composeClosed = output<void>();

  email = signal<EmailDetail | null>(null);
  loading = signal(false);
  threadOpen = signal(false);
  templates = signal<EmailTemplate[]>([]);

  readonly hasBody = computed(() => {
    const em = this.email();
    return Boolean(em?.body_html?.trim() || em?.body_text?.trim());
  });

  readonly safeBodyHtml = computed<SafeHtml | null>(() => {
    const em = this.email();
    if (!em?.body_html) return null;
    return this.sanitizer.bypassSecurityTrustHtml(this.buildReadableEmailDocument(em.body_html));
  });

  composeOpen = signal(false);
  replyToEmail = signal<EmailDetail | null>(null);
  sending = signal(false);
  showCcBcc = signal(false);
  composeTo = '';
  composeSubject = '';
  composeBody = '';
  composeCC = '';
  composeBCC = '';
  composeFrom: string = CRM_MAIL_ACCOUNT_ADDRESS;
  composeMode: 'new' | 'reply' | 'forward' = 'new';
  selectedTemplate = '';

  // WYSIWYG editor
  private readonly composeEditorRef = viewChild<ElementRef<HTMLDivElement>>('composeEditor');
  composeHtmlContent = signal('');
  composeHtmlBody = signal('');

  // Drag & drop
  isDragging = signal(false);

  // Auto-save drafts
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  draftId = signal<number | null>(null);

  // Attachments
  composeAttachments = signal<EmailAttachment[]>([]);
  downloadingAttachmentIds = signal<ReadonlySet<number>>(new Set<number>());

  protected readonly mailAccounts = CRM_MAIL_ACCOUNTS;
  private readonly ownAddresses = new Set(CRM_MAIL_ACCOUNT_ALIASES.map(address => this.normalizeMailAddress(address)));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['emailId']) {
      const id = this.emailId();
      this.email.set(null);
      this.threadOpen.set(false);
      this.composeOpen.set(false);
      if (id !== null) {
        this.loadEmail(id);
        if (!this.templates().length) {
          this.loadTemplates();
        }
      }
    }
  }

  loadEmail(id: number): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: EmailDetail }>(`/api/crm/email/${id}`).subscribe({
      next: r => {
        this.email.set(r.data);
        this.loading.set(false);
        if (r.data.customer_phone) {
          this.clientPhoneResolved.emit(r.data.customer_phone);
        }
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить письмо');
      },
    });
  }

  loadEmailById(id: number): void {
    this.loading.set(true);
    this.http.get<{ success: boolean; data: EmailDetail }>(`/api/crm/email/${id}`).subscribe({
      next: r => {
        this.email.set(r.data);
        this.loading.set(false);
        this.threadOpen.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить письмо');
      },
    });
  }

  loadTemplates(): void {
    this.http.get<{ success: boolean; data: EmailTemplate[] }>('/api/crm/email/templates').subscribe({
      next: r => this.templates.set(r.data),
      error: () => undefined,
    });
  }

  openReply(): void {
    const em = this.email();
    if (!em) return;
    this.replyToEmail.set(em);
    this.composeTo = em.from_address;
    const baseSubject = em.subject || '(без темы)';
    this.composeSubject = baseSubject.startsWith('Re:') ? baseSubject : `Re: ${baseSubject}`;

    const date = new Date(em.created_at).toLocaleString('ru-RU');
    const quotedHeader = `${this.escapeHtml(date)}, ${this.escapeHtml(em.from_address)}:`;
    const originalText = em.body_text || '';
    const quoted = originalText.split('\n').map((line: string) => `&gt; ${this.escapeHtml(line)}`).join('<br>');

    this.composeMode = 'reply';
    this.composeFrom = this.mailboxForEmail(em);
    this.selectedTemplate = '';
    this.composeAttachments.set([]);
    this.resetCcBcc();
    this.composeOpen.set(true);
    this.setComposeHtml(`<br>${this.htmlSignature(this.composeFrom)}<br><br><p>${quotedHeader}</p><blockquote>${quoted}</blockquote>`);
    this.startAutoSave();
  }

  openCompose(): void {
    if (!this.templates().length) {
      this.loadTemplates();
    }
    this.replyToEmail.set(null);
    this.composeTo = '';
    this.composeSubject = '';
    this.composeFrom = this.mailboxForEmail(this.email());
    this.composeMode = 'new';
    this.selectedTemplate = '';
    this.composeAttachments.set([]);
    this.resetCcBcc();
    this.composeOpen.set(true);
    this.setComposeHtml(this.htmlSignature(this.composeFrom));
    this.startAutoSave();
  }

  openForward(): void {
    const em = this.email();
    if (!em) return;
    this.replyToEmail.set(em);
    this.composeTo = '';
    const baseSubject = em.subject || '(без темы)';
    this.composeSubject = baseSubject.startsWith('Fwd:') ? baseSubject : `Fwd: ${baseSubject}`;
    this.composeFrom = this.mailboxForEmail(em);
    this.composeMode = 'forward';
    this.selectedTemplate = '';
    this.composeAttachments.set([]);
    this.resetCcBcc();
    this.composeOpen.set(true);
    this.setComposeHtml(this.htmlSignature(this.composeFrom));
    this.startAutoSave();
  }

  closeCompose(): void {
    this.stopAutoSave();
    this.draftId.set(null);
    this.composeOpen.set(false);
    this.replyToEmail.set(null);
    this.composeAttachments.set([]);
    this.composeClosed.emit();
  }

  onComposeFromChange(address: string): void {
    this.composeFrom = this.resolveMailAccountAddress(address) || CRM_MAIL_ACCOUNT_ADDRESS;
  }

  mailboxLabel(address: string | null | undefined): string {
    if (!address) return 'Почта';
    return this.mailAccounts.find(account => account.address === address)?.label || address;
  }

  private mailboxForEmail(email: EmailDetail | null): string {
    if (!email) return CRM_MAIL_ACCOUNT_ADDRESS;
    return this.resolveMailAccountAddress(email.mailbox_address)
      || (email.direction === 'outbound'
        ? this.resolveMailAccountAddress(email.from_address)
        : this.resolveMailAccountAddress(email.to_address) || this.resolveMailAccountAddress(email.cc_addresses?.join(', ')))
      || CRM_MAIL_ACCOUNT_ADDRESS;
  }

  private resolveMailAccountAddress(address: string | null | undefined): string | null {
    if (!address) return null;
    const candidates = this.extractMailAddresses(address);
    for (const candidate of candidates) {
      const exact = this.mailAccounts.find(account => account.address === candidate)?.address || null;
      if (exact) return exact;
    }

    for (const candidate of candidates) {
      const domain = candidate.split('@')[1];
      if (!domain) continue;
      const domainMatches = this.mailAccounts.filter(account => account.address.endsWith(`@${domain}`));
      if (domainMatches.length === 1) return domainMatches[0].address;
    }

    return null;
  }

  private extractMailAddresses(value: string): string[] {
    const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [value];
    return matches.map(match => this.normalizeMailAddress(match)).filter(Boolean);
  }

  private htmlSignature(address: string): string {
    const sender = this.resolveMailAccountAddress(address) || CRM_MAIL_ACCOUNT_ADDRESS;
    const label = this.mailboxLabel(sender);
    const site = sender.split('@')[1] || 'svoefoto.ru';
    return `<br><br><div class="signature">--<br>С уважением,<br>${this.escapeHtml(label)}<br>${this.escapeHtml(sender)}<br>${this.escapeHtml(site)}</div>`;
  }

  // WYSIWYG methods
  execCmd(command: string): void {
    document.execCommand(command, false);
    this.composeEditorRef()?.nativeElement.focus();
  }

  insertLink(): void {
    const url = prompt('URL ссылки:');
    if (url) document.execCommand('createLink', false, url);
  }

  onEditorInput(): void {
    this.composeHtmlBody.set(this.composeEditorRef()?.nativeElement.innerHTML ?? '');
  }

  // Attachment methods
  async onFileSelect(event: Event): Promise<void> {
    const files = (event.target as HTMLInputElement).files;
    if (!files) return;
    await this.uploadFiles(Array.from(files));
    (event.target as HTMLInputElement).value = '';
  }

  async uploadFiles(files: File[]): Promise<void> {
    for (const file of files) {
      const mimeType = file.type || 'application/octet-stream';
      try {
        const presign = await firstValueFrom(
          this.http.post<EmailAttachmentPresignResponse>('/api/crm/email/upload-attachment/presign', {
            filename: file.name,
            mime_type: mimeType,
            size_bytes: file.size,
          })
        );

        await firstValueFrom(
          this.http.put(presign.data.upload_url, file, {
            headers: { 'Content-Type': mimeType },
            responseType: 'text',
          })
        );

        const completed = await firstValueFrom(
          this.http.post<EmailAttachmentCompleteResponse>('/api/crm/email/upload-attachment/complete', {
            s3_key: presign.data.s3_key,
            filename: file.name,
            mime_type: mimeType,
            size_bytes: file.size,
          })
        );
        if (completed.data) {
          this.composeAttachments.update(prev => [...prev, completed.data]);
        }
      } catch {
        this.toast.error('Ошибка загрузки файла');
      }
    }
  }

  // Drag & drop
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragging.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragging.set(false);
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    await this.uploadFiles(Array.from(files));
  }

  // Auto-save drafts
  startAutoSave(): void {
    this.stopAutoSave();
    this.autoSaveTimer = setInterval(() => this.saveDraft(), 30000);
  }

  stopAutoSave(): void {
    if (this.autoSaveTimer) { clearInterval(this.autoSaveTimer); this.autoSaveTimer = null; }
  }

  async saveDraft(): Promise<void> {
    const to = this.composeTo;
    const subject = this.composeSubject;
    const body = this.composeHtmlBody() || this.composeBody;
    const bodyText = this.htmlToText(body);
    if (!to && !subject && !body) return;
    try {
      if (this.draftId()) {
        await firstValueFrom(this.http.put(`/api/crm/email/draft/${this.draftId()}`, {
          from: this.composeFrom, to, subject, body_html: body, body_text: bodyText,
          attachment_ids: this.composeAttachments().map(a => a.id),
        }));
      } else {
        const res = await firstValueFrom(this.http.post<DraftSaveResponse>('/api/crm/email/draft', {
          from: this.composeFrom, to, subject, body_html: body, body_text: bodyText,
          attachment_ids: this.composeAttachments().map(a => a.id),
        }));
        this.draftId.set(res.data.id);
      }
      this.toast.info('Черновик сохранён');
    } catch { /* silent */ }
  }

  // Reply All
  openReplyAll(): void {
    const em = this.email()!;
    this.openReply();
    const fromAddress = this.normalizeMailAddress(em.from_address);
    const seen = new Set<string>();
    const allCC = (em.cc_addresses || [])
      .concat([em.to_address])
      .filter(addr => {
        const normalized = this.normalizeMailAddress(addr);
        if (!normalized || this.ownAddresses.has(normalized) || normalized === fromAddress || seen.has(normalized)) {
          return false;
        }
        seen.add(normalized);
        return true;
      });
    this.composeCC = allCC.join(', ');
    this.showCcBcc.set(true);
  }

  private normalizeMailAddress(address: string): string {
    const match = address.match(/<([^>]+)>/);
    return (match ? match[1] : address).trim().toLowerCase();
  }

  // Retry failed email
  async retryEmail(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`/api/crm/email/${this.email()!.id}/retry`, {}));
      this.toast.success('Письмо отправлено повторно');
      this.loadEmailById(this.email()!.id);
    } catch {
      this.toast.error('Ошибка повторной отправки');
    }
  }

  removeAttachment(id: number): void {
    this.composeAttachments.update(prev => prev.filter(a => a.id !== id));
  }

  applyTemplate(slug: string): void {
    if (!slug) return;
    const tmpl = this.templates().find(t => t.slug === slug);
    if (!tmpl) return;
    this.composeSubject = tmpl.subject_template;
    const htmlContent = tmpl.body_template + this.htmlSignature(this.composeFrom);
    this.setComposeHtml(htmlContent);
  }

  sendEmail(): void {
    const htmlBody = this.composeHtmlBody().trim();
    const textBody = this.htmlToText(htmlBody);
    if (!this.composeTo.trim() || !this.composeSubject.trim() || !textBody) {
      this.toast.error('Заполните все обязательные поля');
      return;
    }

    this.sending.set(true);
    const replyMsg = this.replyToEmail();
    const attachmentIds = this.composeAttachments().map(a => a.id);

    const payload: Record<string, unknown> = {
      from: this.composeFrom,
      to: this.composeTo.trim(),
      subject: this.composeSubject.trim(),
      body_text: textBody,
      body_html: htmlBody,
      ...(attachmentIds.length ? { attachment_ids: attachmentIds } : {}),
      ...(this.composeMode === 'reply' && replyMsg ? { reply_to_id: replyMsg.id } : {}),
      ...(this.composeMode === 'forward' && replyMsg ? { forward_from_id: replyMsg.id } : {}),
      ...(this.composeCC.trim() ? { cc: this.composeCC.trim() } : {}),
      ...(this.composeBCC.trim() ? { bcc: this.composeBCC.trim() } : {}),
      ...(this.draftId() ? { draft_id: this.draftId() } : {}),
    };

    this.http.post('/api/crm/email/send', payload).subscribe({
      next: () => {
        this.sending.set(false);
        this.stopAutoSave();
        this.draftId.set(null);
        this.closeCompose();
        this.toast.success('Письмо отправлено');
        if (replyMsg) {
          this.emailReplied.emit(replyMsg.id);
          this.email.update(e => e ? { ...e, status: 'replied' as const } : e);
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.sending.set(false);
        this.toast.error(err?.error?.message || 'Ошибка отправки');
      },
    });
  }

  onIframeLoad(event: Event): void {
    const iframe = event.target as HTMLIFrameElement;
    try {
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (doc?.body) {
        const measuredHeight = Math.max(doc.body.scrollHeight, doc.documentElement.scrollHeight);
        iframe.style.height = `${Math.max(220, Math.min(measuredHeight + 8, 2400))}px`;
      }
    } catch {
      iframe.style.height = '400px';
    }
  }

  private buildReadableEmailDocument(bodyHtml: string): string {
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <base target="_blank">
  <style>
    :root { color-scheme: light; }
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 13px;
      line-height: 1.65;
      word-wrap: break-word;
    }
    body { padding: 20px; box-sizing: border-box; }
    .email-content, .email-content :where(p, div, span, li, td, th) { color: inherit; }
    a { color: #b45309; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    blockquote {
      border-left: 3px solid #d1d5db;
      margin: 12px 0;
      padding: 8px 14px;
      color: #4b5563;
      background: #f9fafb;
    }
    pre { white-space: pre-wrap; }
  </style>
</head>
<body><main class="email-content">${bodyHtml}</main></body>
</html>`;
  }

  private setComposeHtml(html: string): void {
    this.composeHtmlContent.set(html);
    this.composeHtmlBody.set(html);
    const writeEditor = (): boolean => {
      const editor = this.composeEditorRef()?.nativeElement;
      if (!editor) return false;
      editor.innerHTML = html;
      return true;
    };
    queueMicrotask(() => {
      if (!writeEditor()) {
        setTimeout(writeEditor, 0);
      }
    });
  }

  private htmlToText(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  getAttachmentIcon(mimeType: string | null | undefined): string {
    const type = mimeType ?? '';
    if (type.startsWith('image/')) return 'image';
    if (type.includes('pdf')) return 'picture_as_pdf';
    if (type.includes('word') || type.includes('document')) return 'description';
    if (type.includes('sheet') || type.includes('excel')) return 'table_chart';
    return 'insert_drive_file';
  }

  formatFileSize(bytes: number | string | null | undefined): string {
    const value = typeof bytes === 'string' ? Number(bytes) : bytes ?? 0;
    if (!Number.isFinite(value) || value <= 0) return '0 Б';
    if (value < 1024) return `${value} Б`;
    if (value < 1048576) return `${(value / 1024).toFixed(1)} КБ`;
    return `${(value / 1048576).toFixed(1)} МБ`;
  }

  attachmentName(attachment: EmailAttachment): string {
    return attachment.original_name || attachment.filename || 'Вложение';
  }

  attachmentHref(attachment: EmailAttachment): string | null {
    return attachment.download_url || attachment.storage_url || null;
  }

  async downloadAttachment(attachment: EmailAttachment): Promise<void> {
    const url = this.attachmentHref(attachment);
    if (!url) return;

    this.downloadingAttachmentIds.update(ids => {
      const next = new Set(ids);
      next.add(attachment.id);
      return next;
    });

    try {
      const response = await firstValueFrom(this.http.get(url, {
        observe: 'response',
        responseType: 'blob',
      }));
      const blob = response.body;
      if (!blob) throw new Error('Empty attachment response');

      const filename = this.filenameFromContentDisposition(response.headers.get('Content-Disposition'))
        || this.attachmentName(attachment);
      this.saveBlob(blob, filename);
    } catch {
      this.toast.error('Не удалось скачать вложение');
    } finally {
      this.downloadingAttachmentIds.update(ids => {
        const next = new Set(ids);
        next.delete(attachment.id);
        return next;
      });
    }
  }

  private filenameFromContentDisposition(disposition: string | null): string | null {
    if (!disposition) return null;

    const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
    if (encoded) {
      try {
        return decodeURIComponent(encoded.replace(/^"|"$/g, ''));
      } catch {
        return encoded;
      }
    }

    const plain = disposition.match(/filename="([^"]+)"/i)?.[1]
      || disposition.match(/filename=([^;]+)/i)?.[1];
    return plain?.trim() || null;
  }

  private saveBlob(blob: Blob, filename: string): void {
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  private resetCcBcc(): void {
    this.composeCC = '';
    this.composeBCC = '';
    this.showCcBcc.set(false);
  }

  archiveEmail(): void {
    const em = this.email();
    if (!em) return;
    this.http.patch(`/api/crm/email/${em.id}`, { status: 'archived' }).subscribe({
      next: () => {
        this.emailArchived.emit(em.id);
        this.toast.success('Перемещено в архив');
        this.back.emit();
      },
      error: () => this.toast.error('Ошибка архивации'),
    });
  }
}
