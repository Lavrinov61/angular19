import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  OnInit,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ToastService } from '../../../../core/services/toast.service';
import type { SyncCartItem } from '../../../../shared/interfaces/cart-sync.interface';
import {
  getFileCategory,
  getFileIcon,
  humanFileName,
  type FileCategory,
} from '../../../../shared/utils/file-helpers';
import {
  BatchPrintDialogComponent,
  type BatchPrintDialogData,
  type BatchPrintDialogResult,
} from '../batch-print-dialog/batch-print-dialog.component';
import type {
  PaymentCartDetails,
  PaymentDialogData,
  PaymentDialogPrefillService,
  PaymentDialogResult,
} from '../payment-dialog/models/payment-dialog.models';
import {
  OperatorChatService,
  type OperatorChatMessage,
  type OperatorChatSession,
} from '../../services/operator-chat.service';
import {
  DocumentSetHandoffService,
  type DocumentSetHandoff,
} from '../../services/document-set-handoff.service';
import {
  parseChatPhotoOrderHint,
  type ChatPhotoOrderHint,
} from '../../utils/chat-photo-order-hint.util';
import {
  PrintApiService,
  type PrintPreparationStatus as ApiPrintPreparationStatus,
  type PrintUploadedFile,
} from '../../services/print-api.service';

type SourceMode = 'chat' | 'local';
type PrintMode = 'cart' | 'direct' | 'single';
type UploadStatus = 'queued' | 'uploading' | 'ready' | 'failed';
type PrintFileKind = 'image' | 'document';
type BatchFileType = 'image' | 'file';
type FastPrintPipeline = 'document' | 'photo';
type FilePreparationStatus = ApiPrintPreparationStatus | 'not_registered';

interface PrintCenterItem {
  readonly id: string;
  readonly file: File;
  readonly fileName: string;
  readonly fileSize: number;
  readonly status: UploadStatus;
  readonly progress: number;
  readonly kind: PrintFileKind;
  readonly uploaded: PrintUploadedFile | null;
  readonly error: string | null;
}

interface ReadyPrintCenterItem extends PrintCenterItem {
  readonly status: 'ready';
  readonly uploaded: PrintUploadedFile;
}

interface PrintCenterFile {
  readonly id: string;
  readonly source: SourceMode;
  readonly chatMessageId: string | null;
  readonly msgId: string;
  readonly url: string;
  readonly name: string;
  readonly type: BatchFileType;
  readonly kind: PrintFileKind;
  readonly icon: string;
  readonly label: string;
  readonly meta: string;
  readonly createdAt: string | null;
  readonly pipeline: FastPrintPipeline;
  readonly recommendedFormat: string;
  readonly printerTarget: string;
  readonly coverageRequired: boolean;
  readonly speedNote: string;
  readonly assetId: string | null;
  readonly preparationStatus: FilePreparationStatus;
  readonly preparationLabel: string;
  readonly preparationDetail: string;
}

interface FastPrintProfile {
  readonly pipeline: FastPrintPipeline;
  readonly recommendedFormat: string;
  readonly printerTarget: string;
  readonly coverageRequired: boolean;
  readonly speedNote: string;
}

interface ChatAttachment {
  readonly url: string;
  readonly fileName: string | null;
  readonly mimeType: string | null;
}

@Component({
  selector: 'app-print-center',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    BatchPrintDialogComponent,
  ],
  template: `
    <div class="print-center-page">
      <header class="page-header">
        <div class="header-title">
          <div class="title-icon"><mat-icon>print</mat-icon></div>
          <div>
            <h1>Единый сервис печати</h1>
            <div class="subtitle">
              Чат, флешка, документы, фото, пакетная печать и оплата в одном месте
            </div>
          </div>
        </div>

        <div class="header-metrics" aria-label="Статус печатного центра">
          <span class="metric-pill">
            <mat-icon>task_alt</mat-icon>
            {{ fastReadyCount() }} готово
          </span>
          <span class="metric-pill pending">
            <mat-icon>sync</mat-icon>
            {{ fastPreparingCount() }} готовится
          </span>
          <span class="metric-pill error">
            <mat-icon>error_outline</mat-icon>
            {{ fastErrorCount() }} ошибок
          </span>
          <span class="metric-pill accent">
            <mat-icon>done_all</mat-icon>
            {{ selectedFiles().length }} выбрано
          </span>
        </div>
      </header>

      <main class="print-layout">
        <section class="source-panel" aria-label="Источник файлов">
          <div class="panel-heading">
            <span>Источник</span>
            <button
              mat-stroked-button
              type="button"
              class="refresh-button"
              matTooltip="Обновить список чатов"
              (click)="refreshChats()"
            >
              <mat-icon>refresh</mat-icon>
              Обновить
            </button>
          </div>

          <mat-button-toggle-group
            class="source-toggle"
            [value]="sourceMode()"
            aria-label="Источник печати"
            (change)="setSourceMode($event.value)"
          >
            <mat-button-toggle value="chat">
              <span class="source-option">
                <mat-icon>forum</mat-icon>
                Из чата
              </span>
            </mat-button-toggle>
            <mat-button-toggle value="local">
              <span class="source-option">
                <mat-icon>upload_file</mat-icon>
                С компьютера
              </span>
            </mat-button-toggle>
          </mat-button-toggle-group>

          @if (sourceMode() === 'chat') {
            <div class="search-box">
              <mat-icon>search</mat-icon>
              <input
                type="search"
                placeholder="Имя, телефон, канал"
                [value]="sessionQuery()"
                (input)="setSessionQuery($event)"
              >
            </div>

            <div class="chat-list">
              @if (chatLoading()) {
                <div class="loading-line">
                  <mat-spinner diameter="18" />
                  <span>Загружаем чаты</span>
                </div>
              }

              @for (session of filteredSessions(); track session.id) {
                <button
                  type="button"
                  class="chat-row"
                  [class.active]="session.id === selectedChatId()"
                  (click)="selectChat(session)"
                >
                  <span class="chat-avatar">{{ sessionInitials(session) }}</span>
                  <span class="chat-main">
                    <span class="chat-title">{{ sessionTitle(session) }}</span>
                    <span class="chat-meta">{{ sessionMeta(session) }}</span>
                    @if (session.id === selectedChatId()) {
                      <span class="chat-selected">Выбран для печати</span>
                    }
                    @if (session.last_message) {
                      <span class="chat-last">{{ session.last_message }}</span>
                    }
                  </span>
                </button>
              } @empty {
                <div class="empty-source">
                  <mat-icon>forum</mat-icon>
                  <span>Чаты не найдены</span>
                </div>
              }
            </div>
          } @else {
            <div
              class="upload-dropzone"
              [class.drag-active]="dragActive()"
              (dragover)="onDragOver($event)"
              (dragleave)="onDragLeave($event)"
              (drop)="onDrop($event)"
            >
              <input
                #fileInput
                class="file-input"
                type="file"
                multiple
                [attr.accept]="acceptedTypes"
                (change)="onFileInputChange($event)"
              >

              <mat-icon>drive_folder_upload</mat-icon>
              <strong>Файлы с компьютера или флешки</strong>
              <span>Фото, PDF, DOC/DOCX, RTF, XLS/XLSX, ODT/ODS, PPT/PPTX, TXT/CSV до 200 МБ</span>
              <button mat-flat-button type="button" color="primary" (click)="fileInput.click()">
                <mat-icon>folder_open</mat-icon>
                Выбрать файлы
              </button>
            </div>

            <div class="upload-status">
              <span>{{ uploadingCount() }} загружается</span>
              <span>{{ failedCount() }} ошибок</span>
              <button
                mat-button
                type="button"
                [disabled]="items().length === 0"
                (click)="clearLocalList()"
              >
                Очистить список
              </button>
            </div>
          }
        </section>

        <section class="files-panel" aria-label="Файлы к печати">
          <div class="files-toolbar">
            <div>
              <h2>{{ filesPanelTitle() }}</h2>
              <p>{{ filesPanelSubtitle() }}</p>
            </div>

            <div class="files-actions">
              <button
                mat-stroked-button
                type="button"
                [disabled]="sourceFiles().length === 0"
                (click)="setCurrentSelection(true)"
              >
                <mat-icon>select_all</mat-icon>
                Выбрать все
              </button>
              <button
                mat-stroked-button
                type="button"
                [disabled]="selectedFiles().length === 0"
                (click)="setCurrentSelection(false)"
              >
                <mat-icon>playlist_remove</mat-icon>
                Снять
              </button>
            </div>
          </div>

          @if (sourceMode() === 'chat' && selectedChat() && messagesLoading()) {
            <div class="messages-loading">
              <mat-spinner diameter="20" />
              <span>Загружаем файлы выбранного чата</span>
            </div>
          }

          <div class="file-list">
            @for (file of sourceFiles(); track file.id) {
              <article class="file-row" [class.selected]="isSelected(file.id)">
                <mat-checkbox
                  [checked]="isSelected(file.id)"
                  (change)="setFileSelected(file.id, $event.checked)"
                  [attr.aria-label]="'Выбрать ' + file.name"
                />

                <div class="file-kind">
                  <mat-icon>{{ file.icon }}</mat-icon>
                </div>

                <div class="file-main">
                  <div class="file-title">{{ file.name }}</div>
                  <div class="file-meta">
                    <span>{{ file.label }}</span>
                    <span>{{ file.meta }}</span>
                    @if (file.createdAt) {
                      <span>{{ formatDate(file.createdAt) }}</span>
                    }
                  </div>
                  <div class="file-fast-profile">
                    <span
                      class="fast-badge"
                      [class.photo]="file.pipeline === 'photo'"
                      [class.document]="file.pipeline === 'document'"
                    >
                      <mat-icon>{{ file.pipeline === 'photo' ? 'photo_size_select_large' : 'description' }}</mat-icon>
                      {{ file.pipeline === 'photo' ? 'Фото до A4' : 'Документ до A3' }}
                    </span>
                    <span>{{ file.recommendedFormat }}</span>
                    <span>{{ file.printerTarget }}</span>
                    <span [class.coverage-required]="file.coverageRequired">{{ file.speedNote }}</span>
                    <span
                      class="preparation-badge"
                      [class.ready]="file.preparationStatus === 'ready'"
                      [class.pending]="file.preparationStatus === 'queued' || file.preparationStatus === 'processing'"
                      [class.failed]="file.preparationStatus === 'failed'"
                      [class.local-only]="file.preparationStatus === 'not_registered'"
                      [matTooltip]="file.preparationDetail"
                    >
                      <mat-icon>{{ preparationIcon(file.preparationStatus) }}</mat-icon>
                      {{ file.preparationLabel }}
                    </span>
                  </div>
                </div>

                <div class="file-actions">
                  <button
                    mat-stroked-button
                    type="button"
                    class="row-print-button"
                    matTooltip="Открыть настройки только этого файла на этой странице"
                    (click)="selectOnlyFile(file)"
                  >
                    <mat-icon>print</mat-icon>
                    Открыть настройки
                  </button>

                  @if (file.source === 'local') {
                    <button mat-icon-button type="button" matTooltip="Убрать" (click)="removeItem(file.id)">
                      <mat-icon>close</mat-icon>
                    </button>
                  }
                </div>
              </article>
            } @empty {
              <div class="empty-files">
                <mat-icon>{{ sourceMode() === 'chat' ? 'attach_file' : 'folder_open' }}</mat-icon>
                <strong>{{ emptyFilesTitle() }}</strong>
                <span>{{ emptyFilesHint() }}</span>
              </div>
            }

            @if (sourceMode() === 'local') {
              @for (item of pendingLocalItems(); track item.id) {
                <article
                  class="file-row upload-row"
                  [class.failed]="item.status === 'failed'"
                  [class.uploading]="item.status === 'uploading'"
                >
                  <mat-checkbox disabled />
                  <div class="file-kind"><mat-icon>{{ kindIcon(item) }}</mat-icon></div>
                  <div class="file-main">
                    <div class="file-title">{{ item.fileName }}</div>
                    <div class="file-meta">
                      <span>{{ formatSize(item.fileSize) }}</span>
                      <span>{{ statusLabel(item) }}</span>
                    </div>
                    <div class="file-fast-profile muted">
                      <span
                        class="fast-badge"
                        [class.photo]="item.kind === 'image'"
                        [class.document]="item.kind === 'document'"
                      >
                        <mat-icon>{{ item.kind === 'image' ? 'photo_size_select_large' : 'description' }}</mat-icon>
                        {{ item.kind === 'image' ? 'Фото до A4' : 'Документ до A3' }}
                      </span>
                      <span>{{ item.kind === 'image' ? 'заливка при лазере' : 'заливка после загрузки' }}</span>
                    </div>
                    @if (item.status === 'uploading') {
                      <mat-progress-bar mode="determinate" [value]="item.progress" />
                    }
                    @if (item.error) {
                      <div class="file-error">{{ item.error }}</div>
                    }
                  </div>
                  <div class="file-actions">
                    <button
                      mat-icon-button
                      type="button"
                      matTooltip="Повторить загрузку"
                      [disabled]="item.status !== 'failed'"
                      (click)="retryUpload(item)"
                    >
                      <mat-icon>refresh</mat-icon>
                    </button>
                    <button mat-icon-button type="button" matTooltip="Убрать" (click)="removeItem(item.id)">
                      <mat-icon>close</mat-icon>
                    </button>
                  </div>
                </article>
              }
            }
          </div>
        </section>

        <aside class="workflow-panel" aria-label="Действия печати">
          <div class="panel-heading compact">
            <span>Быстрые действия</span>
          </div>

          <div class="fast-flow-panel">
            <div>
              <div class="fast-flow-title">{{ activeActionLabel() }}</div>
              <div class="fast-flow-caption">{{ fastFlowHint() }}</div>
            </div>

            <div class="fast-action-list">
              <button
                type="button"
                class="fast-action-button primary"
                [disabled]="fastActionDisabled()"
                [matTooltip]="fastActionDisabledReason()"
                (click)="openCartFlow()"
              >
                <mat-icon>shopping_cart</mat-icon>
                <span class="action-copy">
                  <strong>Выставить оплату</strong>
                  <small>Настроить печать и отправить сумму клиенту</small>
                </span>
              </button>

              <button
                type="button"
                class="fast-action-button"
                [disabled]="fastActionDisabled()"
                [matTooltip]="fastActionDisabledReason()"
                (click)="openDirectPrintFlow()"
              >
                <mat-icon>local_printshop</mat-icon>
                <span class="action-copy">
                  <strong>Напечатать сразу</strong>
                  <small>Настроить и отправить выбранные файлы на принтер</small>
                </span>
              </button>

              <button
                type="button"
                class="fast-action-button"
                [disabled]="singleActionDisabled()"
                [matTooltip]="singleActionDisabledReason()"
                (click)="openSingleFileFlow()"
              >
                <mat-icon>looks_one</mat-icon>
                <span class="action-copy">
                  <strong>Открыть один файл</strong>
                  <small>Для точной настройки только одного выбранного файла</small>
                </span>
              </button>
            </div>
          </div>

          <div class="workflow-summary">
            <div class="summary-line">
              <span>Источник</span>
              <strong>{{ sourceSummary() }}</strong>
            </div>
            <div class="summary-line">
              <span>Файлы</span>
              <strong>{{ selectedFiles().length }} из {{ sourceFiles().length }}</strong>
            </div>
            <div class="summary-line">
              <span>Типы</span>
              <strong>{{ selectedKindsLabel() }}</strong>
            </div>
            <div class="summary-line">
              <span>Поток</span>
              <strong>{{ selectedPipelineLabel() }}</strong>
            </div>
            <div class="summary-line">
              <span>Готовность</span>
              <strong>{{ selectedReadinessLabel() }}</strong>
            </div>
            <div class="summary-line">
              <span>Заливка</span>
              <strong>{{ selectedCoverageLabel() }}</strong>
            </div>
            <div class="summary-line selected-action">
              <span>Действие</span>
              <strong>{{ activeActionLabel() }}</strong>
            </div>
          </div>

          <div class="notice-box">
            <mat-icon>invert_colors</mat-icon>
            <span>
              Быстрый контур: документы печатаются до A3, фотографии до A4.
              Заливка считается для любого файла, если выбран лазерный A4/A3 принтер.
            </span>
          </div>

          @if (lastCartItems().length > 0) {
            <div class="last-cart">
              <div class="last-cart-title">
                <mat-icon>receipt_long</mat-icon>
                Последняя корзина
              </div>
              <div class="summary-line">
                <span>{{ lastCartItems().length }} позиций</span>
                <strong>{{ cartTotal(lastCartItems()) }} ₽</strong>
              </div>
              <button mat-stroked-button type="button" (click)="openPaymentForCart(lastCartItems())">
                <mat-icon>payments</mat-icon>
                Открыть оплату
              </button>
            </div>
          }
        </aside>
      </main>

      @if (printWorkspaceData(); as workspaceData) {
        <section #workspaceSection class="inline-print-workspace" aria-label="Рабочая область печати">
          <app-batch-print-dialog
            [inlineData]="workspaceData"
            (inlineResult)="handleInlinePrintResult($event)"
          />
        </section>
      } @else {
        <section #workspaceSection class="workspace-empty" aria-label="Рабочая область печати">
          <mat-icon>print_disabled</mat-icon>
          <strong>Выберите файлы, чтобы открыть настройки печати</strong>
          <span>Здесь будут документы, фотографии, визитки, пакетная печать, заливка и отправка в оплату.</span>
        </section>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      min-height: 100%;
      background:
        linear-gradient(180deg, rgba(239, 49, 36, 0.06), transparent 220px),
        #f4f6f8;
      color: #171b24;
      --mat-button-outlined-outline-color: #c7d0dc;
      --mat-button-outlined-label-text-color: #253244;
      --mat-button-outlined-state-layer-color: #ef3124;
      --mat-button-outlined-disabled-outline-color: #dfe4ea;
      --mat-button-outlined-disabled-label-text-color: #7a8492;
      --mat-button-text-label-text-color: #c3261c;
      --mat-button-text-disabled-label-text-color: #7a8492;
      --mat-button-filled-container-color: #ef3124;
      --mat-button-filled-label-text-color: #ffffff;
      --mat-button-filled-disabled-container-color: #eef1f5;
      --mat-button-filled-disabled-label-text-color: #7a8492;
      --mat-icon-button-icon-color: #3b4654;
      --mat-icon-button-disabled-icon-color: #9aa6b5;
    }

    .print-center-page {
      width: min(1700px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 22px 0 40px;
    }

    .page-header,
    .source-panel,
    .files-panel,
    .workflow-panel,
    .inline-print-workspace,
    .workspace-empty {
      border: 1px solid #dfe4ea;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(21, 27, 36, 0.06);
    }

    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 20px;
      padding: 18px 20px;
      border-top: 3px solid #ef3124;
    }

    .header-title,
    .header-metrics,
    .panel-heading,
    .files-toolbar,
    .files-actions,
    .file-row,
    .file-meta,
    .file-actions,
    .summary-line,
    .last-cart-title,
    .notice-box,
    .upload-status,
    .loading-line,
    .messages-loading {
      display: flex;
      align-items: center;
    }

    :host ::ng-deep .print-center-page .mat-mdc-outlined-button,
    :host ::ng-deep .print-center-page .mat-mdc-button,
    :host ::ng-deep .print-center-page .mat-mdc-icon-button {
      color: #253244;
      opacity: 1;
    }

    :host ::ng-deep .print-center-page .mat-mdc-outlined-button {
      border-color: #c7d0dc;
      background: #fff;
      font-weight: 800;
    }

    :host ::ng-deep .print-center-page .mat-mdc-outlined-button:not(:disabled):hover,
    :host ::ng-deep .print-center-page .mat-mdc-button:not(:disabled):hover {
      background: #fff4f2;
      color: #c3261c;
    }

    :host ::ng-deep .print-center-page .mat-mdc-unelevated-button.mat-primary {
      background: #ef3124;
      color: #fff;
      opacity: 1;
    }

    :host ::ng-deep .print-center-page .mat-mdc-outlined-button:disabled,
    :host ::ng-deep .print-center-page .mat-mdc-button:disabled,
    :host ::ng-deep .print-center-page .mat-mdc-icon-button:disabled,
    :host ::ng-deep .print-center-page .mat-mdc-unelevated-button:disabled {
      border-color: #e0e5ec;
      background: #f5f7fa;
      color: #7a8492;
      opacity: 1;
    }

    .header-title {
      gap: 14px;
      min-width: 0;
    }

    .title-icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: 8px;
      background: #171b24;
      color: #fff;
      flex: 0 0 auto;
    }

    h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
      font-weight: 800;
      letter-spacing: 0;
    }

    .subtitle {
      margin-top: 5px;
      color: #5c6673;
      font-size: 14px;
      line-height: 1.35;
    }

    .header-metrics {
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .metric-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 4px 10px;
      border-radius: 999px;
      background: #f2f4f7;
      color: #394352;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }

    .metric-pill mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .metric-pill.accent {
      background: #fff1ef;
      color: #c3261c;
    }

    .metric-pill.pending {
      background: #eef6ff;
      color: #235f9a;
    }

    .metric-pill.error {
      background: #fff1ef;
      color: #c3261c;
    }

    .print-layout {
      display: grid;
      grid-template-columns: minmax(280px, 330px) minmax(0, 1fr) minmax(300px, 350px);
      gap: 14px;
      margin-top: 14px;
      align-items: start;
    }

    .source-panel,
    .files-panel,
    .workflow-panel {
      min-height: 640px;
      padding: 14px;
    }

    .panel-heading {
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 12px;
      font-size: 12px;
      font-weight: 800;
      color: #687384;
      text-transform: uppercase;
    }

    .panel-heading.compact {
      min-height: 40px;
    }

    .source-toggle,
    .fast-action-list {
      display: grid;
      width: 100%;
      border-radius: 8px;
      overflow: hidden;
    }

    .source-toggle {
      grid-template-columns: 1fr 1fr;
    }

    :host ::ng-deep .source-toggle .mat-button-toggle {
      border: 1px solid #dfe4ea;
      color: #394352;
      background: #fff;
      font-weight: 700;
    }

    :host ::ng-deep .source-toggle .mat-button-toggle-checked {
      border-color: #ef3124;
      background: #fff1ef;
      color: #c3261c;
    }

    :host ::ng-deep .source-toggle .mat-pseudo-checkbox {
      display: none;
    }

    :host ::ng-deep .source-toggle .mat-button-toggle-label-content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 38px;
      line-height: 1.2;
      white-space: nowrap;
    }

    .source-option {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-width: 0;
    }

    .refresh-button {
      min-height: 32px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 700;
    }

    .refresh-button mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }

    .search-box {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      margin-top: 12px;
      padding: 0 10px;
      height: 42px;
      border: 1px solid #dfe4ea;
      border-radius: 8px;
      background: #f8fafc;
    }

    .search-box mat-icon {
      color: #7a8492;
    }

    .search-box input {
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      font: inherit;
      color: #171b24;
    }

    .chat-list {
      display: grid;
      gap: 8px;
      max-height: 520px;
      margin-top: 12px;
      overflow: auto;
      padding-right: 2px;
    }

    .chat-row {
      display: grid;
      grid-template-columns: 38px minmax(0, 1fr);
      gap: 10px;
      width: 100%;
      min-height: 78px;
      border: 1px solid #e1e6ed;
      border-radius: 8px;
      background: #fff;
      padding: 10px;
      color: inherit;
      text-align: left;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease;
    }

    .chat-row:hover,
    .chat-row.active {
      border-color: #ef3124;
      background: #fff8f7;
    }

    .chat-avatar {
      display: grid;
      place-items: center;
      width: 38px;
      height: 38px;
      border-radius: 8px;
      background: #171b24;
      color: #fff;
      font-size: 13px;
      font-weight: 800;
    }

    .chat-main {
      min-width: 0;
      display: grid;
      gap: 3px;
    }

    .chat-title,
    .chat-last,
    .file-title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chat-title {
      font-weight: 800;
      line-height: 1.25;
    }

    .chat-meta,
    .chat-last {
      color: #667486;
      font-size: 12px;
      line-height: 1.25;
    }

    .chat-selected {
      width: fit-content;
      max-width: 100%;
      padding: 2px 7px;
      border-radius: 999px;
      background: #fff1ef;
      color: #c3261c;
      font-size: 11px;
      font-weight: 800;
      line-height: 1.25;
    }

    .upload-dropzone {
      display: grid;
      place-items: center;
      gap: 9px;
      min-height: 290px;
      margin-top: 12px;
      padding: 20px;
      border: 1px dashed #bdc6d2;
      border-radius: 8px;
      background: #fafbfc;
      text-align: center;
      transition: border-color 160ms ease, background 160ms ease;
    }

    .upload-dropzone.drag-active {
      border-color: #ef3124;
      background: #fff4f2;
    }

    .upload-dropzone > mat-icon {
      width: 56px;
      height: 56px;
      font-size: 56px;
      color: #ef3124;
    }

    .upload-dropzone strong {
      font-size: 17px;
      line-height: 1.25;
    }

    .upload-dropzone span,
    .upload-status {
      color: #667486;
      font-size: 13px;
      line-height: 1.35;
    }

    .file-input {
      display: none;
    }

    .upload-status {
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
    }

    .files-panel {
      padding: 0;
      overflow: hidden;
    }

    .files-toolbar {
      justify-content: space-between;
      gap: 16px;
      min-height: 82px;
      padding: 16px;
      border-bottom: 1px solid #e6ebf1;
    }

    .files-toolbar h2 {
      margin: 0;
      font-size: 20px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0;
    }

    .files-toolbar p {
      margin: 5px 0 0;
      color: #667486;
      font-size: 13px;
      line-height: 1.35;
    }

    .files-actions,
    .file-actions,
    .fast-action-list {
      gap: 8px;
    }

    .messages-loading,
    .loading-line {
      gap: 8px;
      color: #667486;
      font-size: 13px;
    }

    .messages-loading {
      padding: 12px 16px;
      border-bottom: 1px solid #e6ebf1;
      background: #f8fafc;
    }

    .file-list {
      display: grid;
      gap: 8px;
      max-height: 688px;
      overflow: auto;
      padding: 12px;
    }

    .file-row {
      display: grid;
      grid-template-columns: auto 42px minmax(0, 1fr) auto;
      gap: 12px;
      min-height: 72px;
      border: 1px solid #e1e6ed;
      border-radius: 8px;
      background: #fff;
      padding: 10px;
      transition: border-color 140ms ease, background 140ms ease;
    }

    .file-row.selected {
      border-color: #ef3124;
      background: #fff8f7;
    }

    .file-row.uploading {
      border-color: #8dbcf0;
    }

    .file-row.failed {
      border-color: #f0a29b;
      background: #fff7f6;
    }

    .file-kind {
      display: grid;
      place-items: center;
      width: 42px;
      height: 42px;
      border-radius: 8px;
      background: #f1f4f7;
      color: #3b4654;
    }

    .file-main {
      min-width: 0;
    }

    .file-title {
      font-weight: 800;
      line-height: 1.3;
    }

    .file-meta {
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 4px;
      color: #667486;
      font-size: 12px;
      line-height: 1.35;
    }

    .file-fast-profile {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 7px;
      color: #526070;
      font-size: 12px;
      line-height: 1.3;
    }

    .file-fast-profile.muted {
      color: #7a8492;
    }

    .fast-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      font-weight: 800;
    }

    .fast-badge mat-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }

    .fast-badge.document {
      background: #eef6ff;
      color: #24598f;
    }

    .fast-badge.photo {
      background: #eef8f3;
      color: #176249;
    }

    .preparation-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      min-height: 24px;
      padding: 2px 8px;
      border-radius: 999px;
      background: #f2f4f7;
      color: #526070;
      font-weight: 800;
    }

    .preparation-badge mat-icon {
      width: 15px;
      height: 15px;
      font-size: 15px;
    }

    .preparation-badge.ready {
      background: #eef8f3;
      color: #176249;
    }

    .preparation-badge.pending {
      background: #eef6ff;
      color: #235f9a;
    }

    .preparation-badge.failed {
      background: #fff1ef;
      color: #c3261c;
    }

    .preparation-badge.local-only {
      background: #fff8df;
      color: #7a5200;
    }

    .coverage-required {
      color: #9a4d00;
      font-weight: 800;
    }

    .file-error {
      margin-top: 7px;
      color: #c3261c;
      font-size: 13px;
      line-height: 1.35;
    }

    .row-print-button {
      min-width: 178px;
      min-height: 36px;
      font-size: 12px;
      font-weight: 700;
    }

    .row-print-button mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      margin-right: 4px;
    }

    mat-progress-bar {
      margin-top: 9px;
      border-radius: 999px;
      overflow: hidden;
    }

    .empty-files,
    .empty-source {
      display: grid;
      place-items: center;
      gap: 8px;
      min-height: 230px;
      border: 1px dashed #cbd3df;
      border-radius: 8px;
      background: #fafbfc;
      color: #667486;
      text-align: center;
      padding: 18px;
    }

    .empty-source {
      min-height: 150px;
    }

    .empty-files mat-icon,
    .empty-source mat-icon {
      width: 44px;
      height: 44px;
      font-size: 44px;
      color: #9aa6b5;
    }

    .empty-files strong {
      color: #3b4654;
      font-size: 16px;
    }

    .workflow-panel {
      position: sticky;
      top: 12px;
      display: grid;
      gap: 14px;
      align-content: start;
    }

    .workflow-summary,
    .fast-flow-panel,
    .notice-box,
    .last-cart {
      border: 1px solid #e1e6ed;
      border-radius: 8px;
      background: #fafbfc;
      padding: 12px;
    }

    .fast-flow-panel {
      display: grid;
      gap: 12px;
      background: #fff;
    }

    .fast-flow-title {
      color: #171b24;
      font-size: 16px;
      font-weight: 800;
      line-height: 1.25;
    }

    .fast-flow-caption {
      margin-top: 4px;
      color: #667486;
      font-size: 12px;
      font-weight: 600;
      line-height: 1.35;
    }

    .fast-action-list {
      grid-template-columns: 1fr;
      overflow: visible;
    }

    .fast-action-button {
      appearance: none;
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 66px;
      padding: 10px 12px;
      border: 1px solid #c7d0dc;
      border-radius: 8px;
      background: #fff;
      color: #253244;
      font: inherit;
      font-weight: 700;
      text-align: left;
      cursor: pointer;
      transition: border-color 140ms ease, background 140ms ease, color 140ms ease;
    }

    .fast-action-button:hover:not(:disabled) {
      border-color: #ef3124;
      background: #fff4f2;
      color: #c3261c;
    }

    .fast-action-button.primary {
      border-color: #ef3124;
      background: #ef3124;
      color: #fff;
    }

    .fast-action-button.primary:hover:not(:disabled) {
      border-color: #d42b20;
      background: #d42b20;
      color: #fff;
    }

    .fast-action-button:disabled {
      border-color: #e0e5ec;
      background: #f5f7fa;
      color: #7a8492;
      cursor: not-allowed;
    }

    .fast-action-button mat-icon {
      margin: 0;
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .action-copy {
      display: grid;
      gap: 2px;
      min-width: 0;
      line-height: 1.2;
    }

    .action-copy strong,
    .action-copy small {
      min-width: 0;
      white-space: normal;
      word-break: normal;
      overflow-wrap: break-word;
    }

    .action-copy strong {
      font-size: 14px;
      font-weight: 800;
    }

    .action-copy small {
      color: #667486;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.25;
    }

    .fast-action-button.primary .action-copy small {
      color: rgba(255, 255, 255, 0.88);
    }

    .fast-action-button:disabled .action-copy small {
      color: #7a8492;
    }

    .workflow-summary {
      display: grid;
      gap: 10px;
    }

    .summary-line {
      display: grid;
      grid-template-columns: minmax(92px, auto) minmax(0, 1fr);
      align-items: start;
      gap: 10px;
      color: #667486;
      font-size: 13px;
      line-height: 1.3;
    }

    .summary-line span {
      min-width: 0;
      white-space: nowrap;
    }

    .summary-line strong {
      min-width: 0;
      color: #171b24;
      text-align: right;
      word-break: normal;
      overflow-wrap: break-word;
    }

    .summary-line.selected-action {
      padding-top: 10px;
      border-top: 1px solid #e1e6ed;
    }

    .summary-line.selected-action strong {
      color: #c3261c;
    }

    .notice-box {
      align-items: flex-start;
      gap: 10px;
      background: #fff8df;
      border-color: #f2d678;
      color: #5c4a12;
      font-size: 13px;
      line-height: 1.35;
    }

    .notice-box mat-icon {
      color: #c3261c;
      flex: 0 0 auto;
    }

    .last-cart {
      display: grid;
      gap: 10px;
      background: #f6fbf8;
      border-color: #b9dfc9;
    }

    .last-cart-title {
      gap: 8px;
      font-weight: 800;
      color: #176249;
    }

    .inline-print-workspace {
      margin-top: 14px;
      overflow: hidden;
    }

    .workspace-empty {
      display: grid;
      place-items: center;
      gap: 8px;
      min-height: 240px;
      margin-top: 14px;
      padding: 24px;
      color: #667486;
      text-align: center;
    }

    .workspace-empty mat-icon {
      width: 48px;
      height: 48px;
      font-size: 48px;
      color: #9aa6b5;
    }

    .workspace-empty strong {
      color: #3b4654;
      font-size: 17px;
      line-height: 1.3;
    }

    .workspace-empty span {
      max-width: 680px;
      font-size: 13px;
      line-height: 1.4;
    }

    @media (max-width: 1180px) {
      .print-layout {
        grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
      }

      .workflow-panel {
        grid-column: 1 / -1;
        position: static;
        min-height: 0;
      }
    }

    @media (max-width: 820px) {
      .print-center-page {
        width: min(100% - 16px, 1700px);
        padding-top: 12px;
      }

      .page-header,
      .files-toolbar {
        align-items: stretch;
        flex-direction: column;
      }

      .header-metrics,
      .files-actions {
        justify-content: flex-start;
      }

      .print-layout {
        grid-template-columns: 1fr;
      }

      .source-panel,
      .files-panel,
      .workflow-panel {
        min-height: 0;
      }

      .file-row {
        grid-template-columns: auto 42px minmax(0, 1fr);
      }

      .file-actions {
        grid-column: 1 / -1;
        justify-content: flex-end;
      }
    }
  `],
})
export class PrintCenterComponent implements OnInit {
  private readonly printApi = inject(PrintApiService);
  private readonly chat = inject(OperatorChatService);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly documentSetHandoff = inject(DocumentSetHandoffService);
  private readonly platformId = inject(PLATFORM_ID);
  private nextId = 1;
  private readonly localSessionId = `local-print-${Date.now()}`;
  protected readonly workspaceSection = viewChild<ElementRef<HTMLElement>>('workspaceSection');

  private readonly printableCategories = new Set<FileCategory>([
    'pdf',
    'word',
    'excel',
    'presentation',
    'text',
    'csv',
    'image',
  ]);

  protected readonly acceptedTypes = [
    '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff',
    '.pdf',
    '.doc', '.docx', '.docm', '.dot', '.dotx', '.dotm', '.rtf', '.odt', '.ott',
    '.xls', '.xlsx', '.xlsm', '.xlsb', '.xlt', '.xltx', '.xltm', '.ods', '.ots',
    '.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.ppsm', '.pot', '.potx', '.potm', '.odp', '.otp',
    '.txt', '.log', '.csv', '.tsv',
  ].join(',');
  protected readonly items = signal<PrintCenterItem[]>([]);
  protected readonly selectedIds = signal<ReadonlySet<string>>(new Set<string>());
  protected readonly sourceMode = signal<SourceMode>('chat');
  protected readonly printMode = signal<PrintMode>('cart');
  protected readonly sessionQuery = signal('');
  protected readonly dragActive = signal(false);
  protected readonly lastCartItems = signal<readonly SyncCartItem[]>([]);
  private readonly requestedMessageIds = signal<ReadonlySet<string> | null>(null);
  private readonly requestedChatId = signal<string | null>(null);
  private readonly autoSelectedSelectionKey = signal<string | null>(null);
  /** mode=document-set из URL: открыть «Комплект на документы» с готовыми настройками. */
  private readonly documentSetMode = signal(false);
  private documentSetShownKey: string | null = null;
  /** true, когда диалог комплекта уже открыт (через handoff из чата или fallback-effect) — чтобы не открыть дважды. */
  private documentSetHandled = false;

  protected readonly sessions = this.chat.sessions;
  protected readonly activeSessionId = this.chat.activeSessionId;
  private readonly selectedSession = signal<OperatorChatSession | null>(null);
  protected readonly selectedChat = computed(() => {
    const selected = this.selectedSession();
    if (!selected) return null;
    return this.sessions().find(session => session.id === selected.id) ?? selected;
  });
  protected readonly selectedChatId = computed(() => this.selectedChat()?.id ?? null);
  protected readonly messages = this.chat.messages;
  protected readonly chatLoading = this.chat.loading;
  protected readonly messagesLoading = this.chat.messagesLoading;

  protected readonly filteredSessions = computed(() => {
    const query = this.normalizeSearch(this.sessionQuery());
    const selected = this.selectedChat();
    const sessions = this.sortedSessions(this.sessions());
    const matching = query
      ? sessions.filter(session => this.sessionSearchText(session).includes(query))
      : sessions;
    const limited = matching.slice(0, 60);

    if (
      selected
      && (!query || this.sessionSearchText(selected).includes(query))
      && !limited.some(session => session.id === selected.id)
    ) {
      return [selected, ...limited.slice(0, 59)];
    }

    return limited;
  });

  protected readonly readyItems = computed(() =>
    this.items().filter((item): item is ReadyPrintCenterItem => this.isReadyItem(item)),
  );
  protected readonly pendingLocalItems = computed(() =>
    this.items().filter(item => item.status !== 'ready'),
  );
  protected readonly localFiles = computed<PrintCenterFile[]>(() =>
    this.readyItems().map(item => this.localItemToFile(item)),
  );
  protected readonly chatFiles = computed<PrintCenterFile[]>(() => {
    const chat = this.selectedChat();
    if (!chat || this.activeSessionId() !== chat.id) return [];
    return this.messagesToFiles(this.messages());
  });
  protected readonly sourceFiles = computed(() =>
    this.sourceMode() === 'chat' ? this.chatFiles() : this.localFiles(),
  );
  protected readonly selectedFiles = computed(() => {
    const selected = this.selectedIds();
    return this.sourceFiles().filter(file => selected.has(file.id));
  });
  private readonly activeChatSelectionEffect = effect(() => {
    const activeId = this.activeSessionId();
    const sourceMode = this.sourceMode();
    const selected = this.selectedSession();
    const sessions = this.sessions();
    if (sourceMode !== 'chat' || selected || !activeId) return;

    const active = sessions.find(session => session.id === activeId);
    if (!active) return;

    untracked(() => {
      this.selectedSession.set(active);
      this.autoSelectedSelectionKey.set(null);
    });
  });
  private readonly requestedChatSelectionEffect = effect(() => {
    const requestedId = this.requestedChatId();
    if (!requestedId) return;

    const selected = this.selectedSession();
    if (selected?.id === requestedId) return;

    const requested = this.sessions().find(session => session.id === requestedId);
    if (!requested) return;

    untracked(() => {
      this.sourceMode.set('chat');
      this.selectedSession.set(requested);
      this.autoSelectedSelectionKey.set(null);
    });
  });
  private readonly chatAutoSelectionEffect = effect(() => {
    const chatId = this.selectedChatId();
    const files = this.chatFiles();
    if (this.sourceMode() !== 'chat' || !chatId || files.length === 0 || this.messagesLoading()) {
      return;
    }

    const requestedIds = this.requestedMessageIds();
    const selectionKey = `${chatId}:${requestedIds ? Array.from(requestedIds).sort().join(',') : 'all'}`;
    if (this.autoSelectedSelectionKey() === selectionKey) return;

    const selectedFiles = requestedIds
      ? files.filter(file => file.chatMessageId ? requestedIds.has(file.chatMessageId) : false)
      : files;
    if (selectedFiles.length === 0) return;

    untracked(() => {
      this.selectedIds.set(new Set(selectedFiles.map(file => file.id)));
      this.printMode.set('cart');
      this.autoSelectedSelectionKey.set(selectionKey);
    });
  });
  /**
   * mode=document-set: как только нужное фото из чата подгрузилось — открываем
   * диалог «Комплект на документы» с готовыми настройками (10×15, матовая, высокое
   * качество, струйник по студии, N×фото + подвал). Один раз на каждое фото.
   */
  private readonly documentSetDialogEffect = effect(() => {
    // Fallback на случай прямого захода по URL без handoff (без клика из чата).
    // Если фото уже передано явно — handoff уже открыл диалог (documentSetHandled).
    if (!this.documentSetMode() || this.documentSetHandled || this.sourceMode() !== 'chat') return;
    const chatId = this.selectedChatId();
    const files = this.chatFiles();
    const requestedIds = this.requestedMessageIds();
    if (!chatId || this.messagesLoading() || files.length === 0 || !requestedIds) return;

    const target = files.find(file =>
      file.kind === 'image' && file.chatMessageId ? requestedIds.has(file.chatMessageId) : false,
    ) ?? files.find(file => file.chatMessageId ? requestedIds.has(file.chatMessageId) : false);
    if (!target) return;

    const key = `${chatId}:${target.id}`;
    if (this.documentSetShownKey === key) return;
    this.documentSetShownKey = key;
    this.documentSetHandled = true;

    untracked(() => void this.showDocumentSetDialog(target.url, target.name));
  });
  protected readonly printWorkspaceData = computed<BatchPrintDialogData | null>(() => {
    const files = this.selectedFiles();
    if (files.length === 0) return null;
    if (this.sourceMode() === 'chat' && !this.selectedChat()) return null;
    if (this.printMode() === 'single' && files.length !== 1) return null;

    const photoOrderHint = this.sourceMode() === 'chat'
      ? this.photoOrderHintForSelectedFiles(files, this.messages())
      : null;

    return {
      sessionId: this.selectedChat()?.id ?? this.localSessionId,
      action: this.printMode() === 'direct' ? 'print' : 'cart',
      orderType: this.sourceMode() === 'chat' ? 'chat-print' : 'local-upload',
      files: files.map(file => ({
        msgId: file.msgId,
        url: file.url,
        name: file.name,
        type: file.type,
      })),
      ...(photoOrderHint ? { photoOrderHint } : {}),
    };
  });
  protected readonly uploadingCount = computed(() =>
    this.items().filter(item => item.status === 'uploading').length,
  );
  protected readonly failedCount = computed(() =>
    this.items().filter(item => item.status === 'failed').length,
  );
  protected readonly fastReadyCount = computed(() =>
    this.sourceFiles().filter(file =>
      file.preparationStatus === 'ready' || file.preparationStatus === 'not_registered',
    ).length,
  );
  protected readonly fastPreparingCount = computed(() => {
    const localPreparing = this.items().filter(item => item.status === 'queued' || item.status === 'uploading').length;
    const chatPreparing = this.sourceMode() === 'chat' && this.selectedChat() && this.messagesLoading() ? 1 : 0;
    const serverPreparing = this.sourceFiles().filter(file =>
      file.preparationStatus === 'queued' || file.preparationStatus === 'processing',
    ).length;
    return localPreparing + chatPreparing + serverPreparing;
  });
  protected readonly fastErrorCount = computed(() =>
    this.failedCount() + this.sourceFiles().filter(file => file.preparationStatus === 'failed').length,
  );
  protected readonly selectedDocumentsCount = computed(() =>
    this.selectedFiles().filter(file => file.pipeline === 'document').length,
  );
  protected readonly selectedPhotosCount = computed(() =>
    this.selectedFiles().filter(file => file.pipeline === 'photo').length,
  );
  protected readonly selectedCoverageRequiredCount = computed(() =>
    this.selectedFiles().filter(file => file.coverageRequired).length,
  );
  protected readonly selectedPipelineLabel = computed(() => {
    const docs = this.selectedDocumentsCount();
    const photos = this.selectedPhotosCount();
    if (docs === 0 && photos === 0) return 'Нет';
    return [
      docs > 0 ? `${docs} док. до A3` : '',
      photos > 0 ? `${photos} фото до A4` : '',
    ].filter(Boolean).join(' · ');
  });
  protected readonly selectedCoverageLabel = computed(() => {
    const count = this.selectedCoverageRequiredCount();
    return count > 0 ? `${count} ${this.fileWord(count)} при лазере` : 'Не нужна';
  });
  protected readonly selectedReadinessLabel = computed(() => {
    const selected = this.selectedFiles();
    if (selected.length === 0) return 'Нет файлов';
    if (selected.some(file => file.preparationStatus === 'failed')) return 'Есть ошибки';
    if (selected.some(file => file.preparationStatus === 'queued' || file.preparationStatus === 'processing')) {
      return 'Готовится';
    }
    if (selected.some(file => file.preparationStatus === 'not_registered')) return 'По ссылкам';
    return 'Готово';
  });
  protected readonly fastActionDisabledReason = computed(() => {
    const selectedCount = this.selectedFiles().length;
    if (this.sourceMode() === 'chat' && !this.selectedChat()) {
      return 'Выберите чат';
    }
    if (selectedCount === 0) return 'Выберите файлы для печати';
    return '';
  });
  protected readonly fastActionDisabled = computed(() => this.fastActionDisabledReason().length > 0);
  protected readonly singleActionDisabledReason = computed(() => {
    const reason = this.fastActionDisabledReason();
    if (reason) return reason;
    return this.selectedFiles().length === 1 ? '' : 'Для одного файла выберите ровно один файл';
  });
  protected readonly singleActionDisabled = computed(() => this.singleActionDisabledReason().length > 0);
  protected readonly activeActionLabel = computed(() => {
    switch (this.printMode()) {
      case 'cart':
        return 'Выставить оплату';
      case 'direct':
        return 'Напечатать сразу';
      case 'single':
        return 'Открыть один файл';
    }
  });
  protected readonly fastFlowHint = computed(() => {
    const reason = this.fastActionDisabledReason();
    if (reason) return reason;

    const count = this.selectedFiles().length;
    switch (this.printMode()) {
      case 'cart':
        return `${count} ${this.fileWord(count)} выбрано: настройте параметры ниже и добавьте в корзину.`;
      case 'direct':
        return `${count} ${this.fileWord(count)} выбрано: настройте параметры ниже и отправьте на принтер.`;
      case 'single':
        return 'Один файл открыт для точной настройки ниже.';
    }
  });

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    this.chat.init();
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => {
        const chatId = params.get('chat') ?? params.get('chatId') ?? params.get('sessionId');
        this.requestedMessageIds.set(this.parseRequestedMessageIds([
          params.get('messages'),
          params.get('messageIds'),
          params.get('message'),
          params.get('messageId'),
          params.get('msg'),
        ]));
        const docSet = (params.get('mode') ?? '') === 'document-set';
        this.documentSetMode.set(docSet);
        if (!docSet) {
          this.documentSetShownKey = null;
          this.documentSetHandled = false;
        } else if (!this.documentSetHandled) {
          // Фото передано явно из чата — открываем диалог комплекта СРАЗУ, не дожидаясь
          // загрузки сессии/chatFiles (устраняет «В чате нет печатных файлов»).
          const handoff = this.documentSetHandoff.consume();
          if (handoff) {
            this.documentSetHandled = true;
            void this.showDocumentSetDialog(handoff.url, handoff.name, handoff.faceValidation);
          }
        }
        if (chatId?.trim()) {
          this.selectChatById(chatId.trim());
        }
      });
    if (!this.chatLoading()) {
      this.refreshChats();
    }
  }

  protected setSourceMode(mode: SourceMode): void {
    if (mode === this.sourceMode()) return;
    this.sourceMode.set(mode);
    this.selectedIds.set(new Set<string>());
    this.autoSelectedSelectionKey.set(null);
    if (mode === 'chat' && this.sessions().length === 0) {
      this.refreshChats();
    }
  }

  protected setSessionQuery(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    this.sessionQuery.set(input?.value ?? '');
  }

  protected refreshChats(): void {
    this.chat.loadSessions('open', 'all');
  }

  protected selectChat(session: OperatorChatSession): void {
    this.sourceMode.set('chat');
    this.selectedSession.set(session);
    this.selectedIds.set(new Set<string>());
    this.requestedChatId.set(session.id);
    this.requestedMessageIds.set(null);
    this.autoSelectedSelectionKey.set(null);
    this.chat.selectSession(session.id);
  }

  private selectChatById(chatId: string): void {
    this.sourceMode.set('chat');
    this.requestedChatId.set(chatId);
    this.selectedSession.set(this.sessions().find(session => session.id === chatId) ?? null);
    this.selectedIds.set(new Set<string>());
    this.autoSelectedSelectionKey.set(null);
    this.chat.selectSession(chatId);
  }

  private parseRequestedMessageIds(values: readonly (string | null)[]): ReadonlySet<string> | null {
    const ids = values
      .flatMap(value => (value ?? '').split(','))
      .map(value => value.trim())
      .filter(value => value.length > 0);
    return ids.length > 0 ? new Set(ids) : null;
  }

  protected onFileInputChange(event: Event): void {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    if (!input?.files?.length) return;

    this.setSourceMode('local');
    this.queueFiles(input.files);
    input.value = '';
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.setSourceMode('local');
    this.dragActive.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.dragActive.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.setSourceMode('local');
    this.dragActive.set(false);
    if (event.dataTransfer?.files?.length) {
      this.queueFiles(event.dataTransfer.files);
    }
  }

  protected setCurrentSelection(selected: boolean): void {
    const next = new Set(this.selectedIds());
    for (const file of this.sourceFiles()) {
      if (selected) {
        next.add(file.id);
      } else {
        next.delete(file.id);
      }
    }
    this.selectedIds.set(next);
  }

  protected setFileSelected(id: string, selected: boolean): void {
    this.selectedIds.update(current => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  protected isSelected(id: string): boolean {
    return this.selectedIds().has(id);
  }

  protected retryUpload(item: PrintCenterItem): void {
    this.updateItem(item.id, current => ({
      ...current,
      status: 'queued',
      progress: 0,
      error: null,
      uploaded: null,
    }));
    this.setFileSelected(item.id, false);
    this.startUpload(item.id, item.file);
  }

  protected removeItem(id: string): void {
    this.items.update(items => items.filter(item => item.id !== id));
    this.setFileSelected(id, false);
  }

  protected clearLocalList(): void {
    const removedIds = new Set(
      this.items()
        .filter(item => item.status !== 'uploading' && item.status !== 'queued')
        .map(item => item.id),
    );
    this.items.update(items => items.filter(item => item.status === 'uploading' || item.status === 'queued'));
    this.selectedIds.update(current => {
      const next = new Set(current);
      for (const id of removedIds) next.delete(id);
      return next;
    });
  }

  protected selectOnlyFile(file: PrintCenterFile): void {
    this.selectedIds.set(new Set([file.id]));
    this.printMode.set('single');
    this.focusPrintWorkspace();
  }

  protected openCartFlow(): void {
    this.openFastFlow('cart');
  }

  protected openDirectPrintFlow(): void {
    this.openFastFlow('direct');
  }

  protected openSingleFileFlow(): void {
    const reason = this.singleActionDisabledReason();
    if (reason) {
      this.toast.warning(reason);
      return;
    }

    this.printMode.set('single');
    this.focusPrintWorkspace();
  }

  /**
   * «Комплект на документы»: измеряем фото, считаем раскладку и открываем диалог печати
   * с готовыми настройками. Принтер выбирается по студии сотрудника внутри диалога
   * (Соборный → L8050 правый, Баррикадная → L8050). Источник фото — handoff из чата
   * (надёжно) либо файл из chatFiles (fallback при прямом заходе по URL).
   */
  private async showDocumentSetDialog(
    fileUrl: string,
    fileName: string,
    faceValidation?: DocumentSetHandoff['faceValidation'],
  ): Promise<void> {
    try {
      const { buildDocumentSetDialogData, measureImageSize } = await import('../../utils/document-set-dialog');
      const { width, height } = await measureImageSize(fileUrl);
      const data = await buildDocumentSetDialogData({
        fileUrl,
        fileName,
        naturalWidth: width,
        naturalHeight: height,
        faceValidation,
      });
      const [{ PrintDialogComponent }, { documentSetPrintDialogConfig }] = await Promise.all([
        import('../print-dialog/print-dialog.component'),
        import('../../utils/print-dialog-config'),
      ]);
      this.dialog.open(PrintDialogComponent, documentSetPrintDialogConfig(data))
        .afterClosed()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((result?: { printed?: boolean }) => {
          if (result?.printed) {
            this.toast.success('Комплект на документы отправлен в печать');
          }
        });
    } catch {
      this.documentSetShownKey = null;
      this.documentSetHandled = false;
      this.toast.error('Не удалось открыть комплект на документы');
    }
  }

  private openFastFlow(mode: 'cart' | 'direct'): void {
    const reason = this.fastActionDisabledReason();
    if (reason) {
      this.toast.warning(reason);
      return;
    }

    this.printMode.set(mode);
    this.focusPrintWorkspace();
  }

  protected focusPrintWorkspace(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    queueMicrotask(() => {
      this.workspaceSection()?.nativeElement.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  protected handleInlinePrintResult(result: BatchPrintDialogResult): void {
    if (result.cartItems?.length) {
      this.handleCartItems(result.cartItems);
      return;
    }
    if (result.printed) {
      this.toast.success(`Отправлено в печать: ${result.printedCount ?? result.queuedCount ?? 0}`);
      return;
    }
    if (result.minimized) {
      this.toast.info('Рабочая область печати уже находится на этой странице');
    }
  }

  protected openPaymentForCart(items: readonly SyncCartItem[]): void {
    if (items.length === 0) return;
    this.openPaymentDialog(items);
  }

  protected filesPanelTitle(): string {
    if (this.sourceMode() === 'chat') {
      return this.selectedChat()
        ? `Файлы: ${this.sessionTitle(this.selectedChat())}`
        : 'Файлы из чата';
    }
    return 'Файлы с компьютера';
  }

  protected filesPanelSubtitle(): string {
    if (this.sourceMode() === 'chat') {
      return this.selectedChat()
        ? 'Документы готовятся до A3, фотографии до A4; заливка включается при выборе лазера'
        : 'Выберите чат слева, чтобы подтянуть вложения клиента в быстрый контур';
    }
    return 'Загрузите файлы клиента с компьютера или флешки, затем сразу печатайте или выставляйте оплату';
  }

  protected emptyFilesTitle(): string {
    if (this.sourceMode() === 'chat') {
      return this.selectedChat() ? 'В чате нет печатных файлов' : 'Чат не выбран';
    }
    return 'Файлы не загружены';
  }

  protected emptyFilesHint(): string {
    if (this.sourceMode() === 'chat') {
      return this.selectedChat()
        ? 'Поддерживаются фото, PDF, Office, RTF, OpenDocument, TXT, CSV и TSV'
        : 'Выберите активный чат или переключитесь на загрузку без чата';
    }
    return 'Перетащите файлы сюда или выберите их вручную';
  }

  protected sourceSummary(): string {
    if (this.sourceMode() === 'local') return 'С компьютера';
    const chat = this.selectedChat();
    return chat ? this.sessionTitle(chat) : 'Чат не выбран';
  }

  protected selectedKindsLabel(): string {
    const selected = this.selectedFiles();
    if (selected.length === 0) return 'Нет';
    const images = this.selectedPhotosCount();
    const docs = this.selectedDocumentsCount();
    return [
      images > 0 ? `${images} фото` : '',
      docs > 0 ? `${docs} документов` : '',
    ].filter(Boolean).join(' · ');
  }

  protected sessionTitle(session: OperatorChatSession | null): string {
    if (!session) return 'Чат';
    return session.client_name
      ?? session.visitor_name
      ?? session.client_phone
      ?? session.visitor_phone
      ?? 'Клиент';
  }

  protected sessionMeta(session: OperatorChatSession): string {
    const parts = [
      this.channelLabel(session.channel),
      session.client_phone ?? session.visitor_phone ?? '',
      this.formatDate(session.last_message_at ?? session.created_at),
    ].filter(part => part.length > 0);
    return parts.join(' · ');
  }

  protected sessionInitials(session: OperatorChatSession): string {
    const title = this.sessionTitle(session).trim();
    const words = title.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0] ?? ''}${words[1][0] ?? ''}`.toUpperCase();
    }
    return title.slice(0, 2).toUpperCase() || 'Ч';
  }

  protected formatDate(value: string | null): string {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  protected formatSize(size: number): string {
    if (size < 1024) return `${size} Б`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} КБ`;
    return `${(size / 1024 / 1024).toFixed(1)} МБ`;
  }

  protected kindIcon(item: PrintCenterItem): string {
    return item.kind === 'image' ? 'image' : 'description';
  }

  protected statusLabel(item: PrintCenterItem): string {
    switch (item.status) {
      case 'queued':
        return 'В очереди';
      case 'uploading':
        return `Загрузка ${item.progress}%`;
      case 'ready':
        return 'Готово';
      case 'failed':
        return 'Ошибка';
    }
  }

  protected cartTotal(items: readonly SyncCartItem[]): number {
    return this.roundCartAmount(items.reduce((sum, item) => sum + this.cartItemTotal(item), 0));
  }

  private queueFiles(fileList: FileList): void {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const newItems = files.map(file => this.createItem(file));
    this.items.update(items => [...newItems, ...items]);
    for (const item of newItems) {
      this.startUpload(item.id, item.file);
    }
  }

  private createItem(file: File): PrintCenterItem {
    return {
      id: `print-upload-${Date.now()}-${this.nextId++}`,
      file,
      fileName: file.name || 'print-upload',
      fileSize: file.size,
      status: 'queued',
      progress: 0,
      kind: this.detectKind(file),
      uploaded: null,
      error: null,
    };
  }

  private startUpload(id: string, file: File): void {
    this.updateItem(id, item => ({ ...item, status: 'uploading', progress: 0, error: null }));

    this.printApi.uploadPrintFile(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: event => {
          if (event.type === 'progress') {
            this.updateItem(id, item => ({ ...item, progress: event.progress }));
            return;
          }

          this.updateItem(id, item => ({
            ...item,
            status: 'ready',
            progress: 100,
            kind: event.file.kind,
            uploaded: event.file,
            error: null,
          }));
          this.setFileSelected(id, true);
        },
        error: (error: unknown) => {
          const message = this.extractErrorMessage(error);
          this.updateItem(id, item => ({
            ...item,
            status: 'failed',
            progress: 0,
            uploaded: null,
            error: message,
          }));
          this.setFileSelected(id, false);
          this.toast.error(message);
        },
      });
  }

  private updateItem(id: string, update: (item: PrintCenterItem) => PrintCenterItem): void {
    this.items.update(items => items.map(item => item.id === id ? update(item) : item));
  }

  private isReadyItem(item: PrintCenterItem): item is ReadyPrintCenterItem {
    return item.status === 'ready' && item.uploaded !== null;
  }

  private detectKind(file: File): PrintFileKind {
    if (file.type.startsWith('image/')) return 'image';

    const lowerName = file.name.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|bmp|tif|tiff)$/.test(lowerName)) {
      return 'image';
    }

    return 'document';
  }

  private localItemToFile(item: ReadyPrintCenterItem): PrintCenterFile {
    const category = getFileCategory(item.uploaded.file_name, item.uploaded.content_type);
    const preparation = this.uploadedPreparation(item.uploaded);
    return {
      id: item.id,
      source: 'local',
      chatMessageId: null,
      msgId: item.id,
      url: item.uploaded.url,
      name: item.uploaded.file_name,
      type: item.uploaded.kind === 'image' ? 'image' : 'file',
      kind: item.uploaded.kind,
      icon: getFileIcon(item.uploaded.file_name, item.uploaded.content_type),
      label: this.categoryLabel(category, item.uploaded.kind),
      meta: this.formatSize(item.uploaded.size_bytes),
      createdAt: null,
      assetId: item.uploaded.asset_id ?? item.uploaded.asset?.id ?? item.uploaded.preparation?.asset_id ?? null,
      preparationStatus: preparation.status,
      preparationLabel: preparation.label,
      preparationDetail: preparation.detail,
      ...this.uploadedFastProfile(item.uploaded),
    };
  }

  private messagesToFiles(messages: readonly OperatorChatMessage[]): PrintCenterFile[] {
    const files: PrintCenterFile[] = [];
    for (const message of messages) {
      const attachments = this.messageAttachments(message);
      attachments.forEach((attachment, index) => {
        const name = this.attachmentName(message, attachment);
        const category = getFileCategory(name || attachment.fileName || attachment.url, attachment.mimeType);
        if (!this.printableCategories.has(category)) return;

        const kind: PrintFileKind = category === 'image' ? 'image' : 'document';
        const id = `chat:${message.id}:${index}:${attachment.url}`;
        const preparation = this.chatPreparation();
        files.push({
          id,
          source: 'chat',
          chatMessageId: message.id,
          msgId: id,
          url: attachment.url,
          name,
          type: kind === 'image' ? 'image' : 'file',
          kind,
          icon: getFileIcon(name || attachment.url, attachment.mimeType),
          label: this.categoryLabel(category, kind),
          meta: this.channelLabel(message.sender_type),
          createdAt: message.created_at,
          assetId: null,
          preparationStatus: preparation.status,
          preparationLabel: preparation.label,
          preparationDetail: preparation.detail,
          ...this.fastProfile(kind),
        });
      });
    }
    return files.reverse();
  }

  private photoOrderHintForSelectedFiles(
    files: readonly PrintCenterFile[],
    messages: readonly OperatorChatMessage[],
  ): ChatPhotoOrderHint | null {
    const selectedMessageIds = new Set(
      files
        .map(file => file.chatMessageId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    );
    if (selectedMessageIds.size === 0 || messages.length === 0) return null;

    const selectedIndices = messages
      .map((message, index) => selectedMessageIds.has(message.id) ? index : -1)
      .filter(index => index >= 0);
    if (selectedIndices.length === 0) return null;

    const selectedTexts = selectedIndices
      .map(index => messages[index]?.content?.trim() ?? '')
      .filter(content => content.length > 0);
    const selectedHint = this.firstPhotoOrderHint(selectedTexts);
    if (selectedHint) return selectedHint;

    const firstIndex = Math.min(...selectedIndices);
    const lastIndex = Math.max(...selectedIndices);
    const firstTime = this.messageTimeMs(messages[firstIndex]);
    const lastTime = this.messageTimeMs(messages[lastIndex]);
    const windowStart = Math.max(0, firstIndex - 3);
    const windowEnd = Math.min(messages.length - 1, lastIndex + 6);
    const nearbyTexts: string[] = [];

    for (let index = lastIndex + 1; index <= windowEnd; index++) {
      this.pushPhotoOrderCandidateText(nearbyTexts, messages[index], firstTime, lastTime);
    }
    for (let index = firstIndex - 1; index >= windowStart; index--) {
      this.pushPhotoOrderCandidateText(nearbyTexts, messages[index], firstTime, lastTime);
    }

    return this.firstPhotoOrderHint(nearbyTexts);
  }

  private firstPhotoOrderHint(texts: readonly string[]): ChatPhotoOrderHint | null {
    for (const text of texts) {
      const hint = parseChatPhotoOrderHint(text);
      if (hint) return hint;
    }
    return null;
  }

  private pushPhotoOrderCandidateText(
    texts: string[],
    message: OperatorChatMessage | undefined,
    firstTime: number,
    lastTime: number,
  ): void {
    if (!message || this.messageAttachments(message).length > 0) return;
    const content = message.content?.trim();
    if (!content || !this.messageIsNearTimeWindow(message, firstTime, lastTime)) return;
    if (!parseChatPhotoOrderHint(content)) return;
    texts.push(content);
  }

  private messageIsNearTimeWindow(message: OperatorChatMessage, firstTime: number, lastTime: number): boolean {
    const time = this.messageTimeMs(message);
    if (!time || !firstTime || !lastTime) return false;
    return time >= firstTime - 10 * 60_000 && time <= lastTime + 10 * 60_000;
  }

  private messageTimeMs(message: OperatorChatMessage | undefined): number {
    if (!message) return 0;
    const time = new Date(message.created_at).getTime();
    return Number.isFinite(time) ? time : 0;
  }

  protected preparationIcon(status: FilePreparationStatus): string {
    switch (status) {
      case 'queued':
        return 'schedule';
      case 'processing':
        return 'sync';
      case 'ready':
        return 'cloud_done';
      case 'failed':
        return 'error_outline';
      case 'not_registered':
        return 'link';
    }
  }

  private uploadedPreparation(uploaded: PrintUploadedFile): {
    readonly status: FilePreparationStatus;
    readonly label: string;
    readonly detail: string;
  } {
    const status = uploaded.preparation?.status ?? 'ready';
    const assetId = uploaded.asset_id ?? uploaded.asset?.id ?? uploaded.preparation?.asset_id ?? null;
    const sha = uploaded.sha256 ?? uploaded.asset?.sha256 ?? null;
    const shortSha = sha ? sha.slice(0, 12) : null;

    switch (status) {
      case 'queued':
        return {
          status,
          label: 'В очереди',
          detail: this.assetDetail('Сервер принял файл и поставил подготовку в очередь', assetId, shortSha),
        };
      case 'processing':
        return {
          status,
          label: 'Готовится',
          detail: this.assetDetail('Сервер готовит файл к печати', assetId, shortSha),
        };
      case 'ready':
        return {
          status,
          label: 'Сервер готов',
          detail: this.assetDetail('Файл загружен на сервер и готов к настройке печати', assetId, shortSha),
        };
      case 'failed':
        return {
          status,
          label: 'Ошибка подготовки',
          detail: uploaded.preparation?.error ?? 'Сервер не смог подготовить файл к печати',
        };
    }
  }

  private chatPreparation(): {
    readonly status: FilePreparationStatus;
    readonly label: string;
    readonly detail: string;
  } {
    return {
      status: 'not_registered',
      label: 'Из чата',
      detail: 'Файл будет открыт по ссылке чата. Серверный asset подключим для кэша подготовки.',
    };
  }

  private assetDetail(prefix: string, assetId: string | null, shortSha: string | null): string {
    return [
      prefix,
      assetId ? `asset ${assetId}` : '',
      shortSha ? `sha256 ${shortSha}` : '',
    ].filter(Boolean).join(' · ');
  }

  private uploadedFastProfile(uploaded: PrintUploadedFile): FastPrintProfile {
    const profile = uploaded.fast_profile;
    if (!profile) return this.fastProfile(uploaded.kind);
    const recommendedFormat = profile.pipeline === 'photo'
      ? `Авто до ${profile.max_format}`
      : `до ${profile.max_format}`;
    const coverageOnLaser = profile.coverage_required_on_laser ?? profile.coverage_required;

    return {
      pipeline: profile.pipeline,
      recommendedFormat,
      printerTarget: profile.recommended_printer_kind === 'laser' ? 'Лазер' : 'Фото/лазер',
      coverageRequired: coverageOnLaser,
      speedNote: coverageOnLaser ? 'заливка при лазере' : 'без заливки',
    };
  }

  private fastProfile(kind: PrintFileKind): FastPrintProfile {
    if (kind === 'image') {
      return {
        pipeline: 'photo',
        recommendedFormat: 'Авто до A4',
        printerTarget: 'Фото/лазер',
        coverageRequired: true,
        speedNote: 'заливка при лазере',
      };
    }

    return {
      pipeline: 'document',
      recommendedFormat: 'A4/A3',
      printerTarget: 'Лазер',
      coverageRequired: true,
      speedNote: 'заливка при лазере',
    };
  }

  private messageAttachments(message: OperatorChatMessage): ChatAttachment[] {
    const media = message.all_media
      ?.filter(item => item.url?.trim().length > 0)
      .map(item => ({
        url: item.url,
        fileName: item.file_name,
        mimeType: item.mime_type,
      })) ?? [];

    if (media.length > 0) return media;
    if (!message.attachment_url) return [];

    return [{
      url: message.attachment_url,
      fileName: message.original_file_name ?? null,
      mimeType: message.original_mime_type ?? null,
    }];
  }

  private attachmentName(message: OperatorChatMessage, attachment: ChatAttachment): string {
    const fileName = attachment.fileName?.trim();
    if (fileName) return humanFileName(fileName, attachment.url, attachment.mimeType ?? undefined);
    return humanFileName(message.content, attachment.url, attachment.mimeType ?? undefined);
  }

  private categoryLabel(category: FileCategory, kind: PrintFileKind): string {
    if (kind === 'image') return 'Изображение';
    switch (category) {
      case 'pdf':
        return 'PDF';
      case 'word':
        return 'Word';
      case 'excel':
        return 'Excel';
      case 'presentation':
        return 'PowerPoint';
      case 'text':
        return 'Текст';
      case 'csv':
        return 'CSV';
      default:
        return 'Файл';
    }
  }

  private fileWord(count: number): string {
    const normalized = Math.abs(count) % 100;
    const last = normalized % 10;
    if (normalized > 10 && normalized < 20) return 'файлов';
    if (last === 1) return 'файл';
    if (last >= 2 && last <= 4) return 'файла';
    return 'файлов';
  }

  private channelLabel(value: string | null): string {
    switch ((value ?? '').toLowerCase()) {
      case 'telegram':
        return 'Telegram';
      case 'whatsapp':
        return 'WhatsApp';
      case 'web':
        return 'Сайт';
      case 'visitor':
        return 'Клиент';
      case 'operator':
        return 'Оператор';
      case 'bot':
        return 'Бот';
      default:
        return value || '';
    }
  }

  private normalizeSearch(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  private sortedSessions(sessions: readonly OperatorChatSession[]): OperatorChatSession[] {
    return [...sessions].sort((left, right) => this.sessionTimestamp(right) - this.sessionTimestamp(left));
  }

  private sessionTimestamp(session: OperatorChatSession): number {
    const raw = session.last_message_at ?? session.created_at;
    const timestamp = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private sessionSearchText(session: OperatorChatSession): string {
    return this.normalizeSearch([
      session.client_name,
      session.visitor_name,
      session.client_phone,
      session.visitor_phone,
      session.channel,
      session.last_message,
    ].filter((value): value is string => typeof value === 'string' && value.length > 0).join(' '));
  }

  private handleCartItems(items: readonly SyncCartItem[]): void {
    if (items.length === 0) return;
    this.lastCartItems.set(items);
    this.toast.success('Печатная корзина готова, открываю оплату.');
    void this.openPaymentDialog(items);
  }

  private async openPaymentDialog(items: readonly SyncCartItem[]): Promise<void> {
    const { PaymentDialogComponent } = await import('../payment-dialog/payment-dialog.component');
    const chat = this.sourceMode() === 'chat' ? this.selectedChat() : null;
    const total = this.cartTotal(items);
    const cartDetails = this.buildPaymentCartDetails(items, total);
    const prefillServices = this.buildPaymentPrefillServices(items);
    const data: PaymentDialogData = {
      mode: chat ? 'chat' : 'pos',
      phone: chat?.client_phone ?? chat?.visitor_phone ?? '',
      clientName: chat ? this.sessionTitle(chat) : 'Клиент без чата',
      ...(chat ? { sessionId: chat.id } : {}),
      ...(total > 0 ? { totalPrice: total } : {}),
      ...(prefillServices.length > 0 ? { prefillServices } : {}),
      prefillCartDetails: cartDetails,
    };

    this.dialog.open(PaymentDialogComponent, {
      width: 'calc(100vw - 24px)',
      maxWidth: '100vw',
      height: 'calc(100vh - 24px)',
      maxHeight: '100vh',
      panelClass: 'payment-dialog-panel',
      data,
    }).afterClosed()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((result: PaymentDialogResult | undefined) => this.handlePaymentResult(result));
  }

  private handlePaymentResult(result: PaymentDialogResult | undefined): void {
    if (!result || result.type === 'cancelled') return;
    if (result.type === 'sent') {
      this.toast.success('Ссылка на оплату отправлена в чат');
      return;
    }
    if (result.type === 'posReceipt') {
      this.toast.success(`Чек ${result.receiptNumber} создан`);
    }
  }

  private buildPaymentPrefillServices(items: readonly SyncCartItem[]): PaymentDialogPrefillService[] {
    return items.map(item => {
      const pricingGroupKey = this.cartItemMetadataString(item, 'pricingGroupKey');
      return {
        id: item.serviceOptionId ?? null,
        slug: this.cartItemMetadataString(item, 'slug'),
        name: item.name,
        price: item.price,
        quantity: this.cartItemQuantity(item),
        ...(pricingGroupKey ? { pricingGroupKey } : {}),
      };
    });
  }

  private buildPaymentCartDetails(items: readonly SyncCartItem[], total: number): PaymentCartDetails {
    const lines = items.flatMap(item => this.cartItemDisplayLines(item));
    const subtotal = this.roundCartAmount(lines.reduce((sum, line) => sum + line.total, 0));
    const lineSavings = lines.reduce((sum, line) => sum + line.discountAmount, 0);
    const inferredSavings = total > 0 ? Math.max(0, subtotal - total) : 0;
    return {
      lines,
      subtotal,
      savings: this.roundCartAmount(Math.max(lineSavings, inferredSavings)),
    };
  }

  private cartItemDisplayLines(item: SyncCartItem): PaymentCartDetails['lines'] {
    const details = item.displayDetails;
    if (details?.lines.length) {
      return details.lines.map(line => ({
        name: line.name || item.name,
        quantity: this.cartLineQuantity(line.quantity),
        unitPrice: this.roundCartAmount(line.unitPrice),
        total: this.roundCartAmount(line.total),
        priceNote: line.priceNote ?? details.priceNote ?? item.description ?? item.note ?? null,
        discountLabel: line.discountLabel ?? null,
        discountAmount: this.roundCartAmount(Math.max(0, line.discountAmount ?? 0)),
      }));
    }

    const quantity = this.cartItemQuantity(item);
    const total = this.roundCartAmount(this.cartItemTotal(item));
    return [{
      name: item.name,
      quantity,
      unitPrice: this.roundCartAmount(quantity > 0 ? total / quantity : item.price),
      total,
      priceNote: item.description ?? item.note ?? null,
      discountLabel: null,
      discountAmount: 0,
    }];
  }

  private cartItemTotal(item: SyncCartItem): number {
    const metadataTotal = this.cartItemMetadataNumber(item, 'priceTotal');
    if (metadataTotal !== null) return metadataTotal;
    const displaySubtotal = item.displayDetails?.subtotal;
    if (typeof displaySubtotal === 'number' && Number.isFinite(displaySubtotal)) {
      return displaySubtotal;
    }
    if (item.nextPrice != null && item.nextPrice !== item.price && item.quantity > 1) {
      return item.price + item.nextPrice * (item.quantity - 1);
    }
    return item.price * item.quantity;
  }

  private cartItemQuantity(item: SyncCartItem): number {
    return this.cartLineQuantity(item.quantity);
  }

  private cartLineQuantity(value: number): number {
    if (!Number.isFinite(value)) return 1;
    return Math.max(1, Math.trunc(value));
  }

  private cartItemMetadataNumber(item: SyncCartItem, key: string): number | null {
    const value = item.metadata?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }

  private cartItemMetadataString(item: SyncCartItem, key: string): string | null {
    const value = item.metadata?.[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  private roundCartAmount(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 100) / 100;
  }

  private extractErrorMessage(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error;
      if (typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string') {
        return body.error;
      }
      if (typeof body === 'string' && body.trim()) {
        return body;
      }
    }

    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    return 'Не удалось загрузить файл';
  }
}
