import {
  Component, ChangeDetectionStrategy, inject, input, model, signal, computed,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { PrintApiService, PrintJob, Printer } from '../../services/print-api.service';
import { ToastService } from '../../../../core/services/toast.service';

type JobStatus = PrintJob['status'];

const STATUS_CONFIG: Record<string, { icon: string; label: string; color: string }> = {
  queued:     { icon: 'schedule',        label: 'В очереди',     color: 'var(--crm-text-muted)' },
  sending:    { icon: 'upload',          label: 'Отправляется',  color: 'var(--crm-status-info)' },
  converting: { icon: 'autorenew',       label: 'Конвертация',   color: 'var(--crm-status-info)' },
  splitting:      { icon: 'call_split',      label: 'Разделение',    color: 'var(--crm-print-splitting, #fb923c)' },
  applying_icc:   { icon: 'palette',         label: 'ICC профиль',   color: 'var(--crm-print-icc, #d97706)' },
  rendering_layout: { icon: 'grid_view',     label: 'Раскладка',     color: 'var(--crm-print-rendering, #f59e0b)' },
  printing:   { icon: 'print',           label: 'Печатается',    color: 'var(--crm-accent)' },
  finishing:  { icon: 'content_cut',     label: 'Финишка',       color: 'var(--crm-status-warning)' },
  completed:  { icon: 'check_circle',    label: 'Готово',        color: 'var(--crm-status-success)' },
  failed:     { icon: 'error',           label: 'Ошибка',        color: 'var(--crm-status-error)' },
  cancelled:  { icon: 'cancel',          label: 'Отменено',      color: 'var(--crm-text-muted)' },
  paused:     { icon: 'pause_circle',    label: 'Пауза',         color: 'var(--crm-status-warning)' },
  held:       { icon: 'pan_tool',        label: 'Удержано',      color: 'var(--crm-status-warning)' },
  scheduled:  { icon: 'event',           label: 'Запланировано', color: 'var(--crm-status-info)' },
};

const STATUS_ORDER: JobStatus[] = [
  'queued', 'sending', 'converting',
  'splitting', 'printing', 'finishing', 'completed',
];

@Component({
  selector: 'app-print-job-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe, FormsModule,
    MatButtonModule, MatIconModule, MatTooltipModule, MatDividerModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatChipsModule,
  ],
  host: {
    'class': 'print-job-detail-panel',
    '[class.open]': 'open()',
  },
  template: `
    @if (open() && job(); as j) {
      <div class="panel-backdrop" role="button" tabindex="-1" (click)="open.set(false)" (keydown.escape)="open.set(false)"></div>
      <div class="panel-content">
        <div class="panel-header">
          <h3 class="panel-title">
            <mat-icon>print</mat-icon>
            Задание печати
          </h3>
          <button mat-icon-button (click)="open.set(false)" matTooltip="Закрыть">
            <mat-icon>close</mat-icon>
          </button>
        </div>

        <!-- Preview thumbnail -->
        <div class="preview-section">
          @if (isImage(j)) {
            <img [src]="j.file_url" class="preview-thumb" alt="Preview" />
          } @else {
            <div class="preview-placeholder">
              <mat-icon>{{ fileIcon(j) }}</mat-icon>
              <span>{{ j.file_name || 'Файл' }}</span>
            </div>
          }
        </div>

        <!-- Status badge -->
        <div class="status-section">
          <span class="status-badge" [style.--badge-color]="statusCfg(j.status).color">
            <mat-icon>{{ statusCfg(j.status).icon }}</mat-icon>
            {{ statusCfg(j.status).label }}
          </span>
          @if (j.error_message) {
            <div class="error-msg">
              <mat-icon>warning</mat-icon>
              {{ j.error_message }}
            </div>
          }
          @if (j.progress_percent !== null && j.progress_percent !== undefined && j.progress_percent < 100) {
            <div class="progress-bar-wrapper">
              <div class="progress-bar" [style.width.%]="j.progress_percent"></div>
              <span class="progress-label">{{ j.progress_percent }}%</span>
            </div>
          }
        </div>

        <!-- Status timeline -->
        <div class="timeline-section">
          <span class="section-label">Прогресс</span>
          <div class="timeline">
            @for (step of timelineSteps(); track step.status) {
              <div class="timeline-step"
                   [class.active]="step.active"
                   [class.done]="step.done"
                   [class.current]="step.current">
                <div class="step-dot"></div>
                <span class="step-label">{{ step.label }}</span>
              </div>
            }
          </div>
        </div>

        <mat-divider />

        <!-- Job parameters -->
        <div class="params-section">
          <span class="section-label">Параметры</span>
          <div class="params-grid">
            <div class="param"><span class="param-key">Принтер</span><span class="param-val">{{ j.printer_name || j.printer_id }}</span></div>
            <div class="param"><span class="param-key">Бумага</span><span class="param-val">{{ j.paper_size }}</span></div>
            <div class="param"><span class="param-key">Качество</span><span class="param-val">{{ j.quality }}</span></div>
            <div class="param"><span class="param-key">Копии</span><span class="param-val">{{ j.copies }}</span></div>
            <div class="param"><span class="param-key">Цвет</span><span class="param-val">{{ j.color_mode === 'color' ? 'Цветная' : 'Ч/Б' }}</span></div>
            <div class="param"><span class="param-key">Подгонка</span><span class="param-val">{{ j.fit_mode }}</span></div>
            @if (j.duplex) {
              <div class="param"><span class="param-key">Двустор.</span><span class="param-val">Да</span></div>
            }
            @if (j.borderless) {
              <div class="param"><span class="param-key">Без полей</span><span class="param-val">Да</span></div>
            }
            @if (j.media_type) {
              <div class="param"><span class="param-key">Тип бумаги</span><span class="param-val">{{ j.media_type }}</span></div>
            }
            @if (j.priority !== null && j.priority !== undefined && j.priority > 0) {
              <div class="param"><span class="param-key">Приоритет</span><span class="param-val">{{ j.priority }}</span></div>
            }
            @if (j.finishing_ops?.length) {
              <div class="param"><span class="param-key">Финишка</span><span class="param-val">{{ j.finishing_ops.join(', ') }}</span></div>
            }
            @if (j.scheduled_at) {
              <div class="param"><span class="param-key">Запланировано</span><span class="param-val">{{ j.scheduled_at | date:'dd.MM.yyyy HH:mm' }}</span></div>
            }
          </div>
        </div>

        <mat-divider />

        <!-- History / timestamps -->
        <div class="history-section">
          <span class="section-label">История</span>
          <div class="history-list">
            <div class="history-item">
              <mat-icon>add_circle_outline</mat-icon>
              <span>Создано: {{ j.created_at | date:'dd.MM.yyyy HH:mm:ss' }}</span>
            </div>
            @if (j.creator_name) {
              <div class="history-item">
                <mat-icon>person</mat-icon>
                <span>{{ j.creator_name }}</span>
              </div>
            }
            @if (j.completed_at) {
              <div class="history-item">
                <mat-icon>check_circle_outline</mat-icon>
                <span>Завершено: {{ j.completed_at | date:'dd.MM.yyyy HH:mm:ss' }}</span>
              </div>
            }
            @if (j.held_at) {
              <div class="history-item">
                <mat-icon>pan_tool</mat-icon>
                <span>Удержано: {{ j.held_at | date:'dd.MM.yyyy HH:mm:ss' }}{{ j.held_by ? ' — ' + j.held_by : '' }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Links -->
        @if (j.order_id || j.group_id || j.parent_job_id) {
          <mat-divider />
          <div class="links-section">
            <span class="section-label">Связи</span>
            @if (j.order_id) {
              <div class="link-item">
                <mat-icon>receipt</mat-icon>
                Заказ: {{ j.order_id }}
              </div>
            }
            @if (j.group_id) {
              <div class="link-item">
                <mat-icon>folder</mat-icon>
                Группа: {{ j.group_id }}
              </div>
            }
            @if (j.parent_job_id) {
              <div class="link-item">
                <mat-icon>account_tree</mat-icon>
                Родитель: {{ j.parent_job_id }}
              </div>
            }
            @if (j.child_count && j.child_count > 0) {
              <div class="link-item">
                <mat-icon>call_split</mat-icon>
                Дочерние: {{ j.child_count }}
              </div>
            }
          </div>
        }

        <mat-divider />

        <!-- Actions -->
        <div class="actions-section">
          <span class="section-label">Действия</span>

          @if (isActionable(j.status)) {
            <div class="action-row">
              @if (j.status === 'paused') {
                <button mat-stroked-button (click)="resumeJob(j.id)" [disabled]="actionLoading()">
                  <mat-icon>play_arrow</mat-icon> Продолжить
                </button>
              }

              @if (j.status === 'held') {
                <button mat-stroked-button (click)="releaseJob(j.id)" [disabled]="actionLoading()">
                  <mat-icon>lock_open</mat-icon> Отпустить
                </button>
              }

              @if (canHold(j.status)) {
                <button mat-stroked-button (click)="holdJob(j.id)" [disabled]="actionLoading()">
                  <mat-icon>pan_tool</mat-icon> Удержать
                </button>
              }

              @if (j.status === 'queued') {
                <button mat-stroked-button (click)="showScheduleInput.set(true)" [disabled]="actionLoading()">
                  <mat-icon>event</mat-icon> Запланировать
                </button>
              }

              @if (showScheduleInput()) {
                <div class="schedule-input-row">
                  <input type="datetime-local" class="schedule-input"
                         [value]="scheduleValue()"
                         (input)="scheduleValue.set($any($event.target).value)"
                         style="padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px" />
                  <button mat-flat-button color="primary" [disabled]="!scheduleValue() || actionLoading()"
                          (click)="scheduleJob(j.id)">OK</button>
                  <button mat-icon-button (click)="showScheduleInput.set(false)">
                    <mat-icon>close</mat-icon>
                  </button>
                </div>
              }

              @if (canCancel(j.status)) {
                <button mat-stroked-button class="action-danger" (click)="cancelJob(j.id)" [disabled]="actionLoading()">
                  <mat-icon>cancel</mat-icon> Отменить
                </button>
              }
            </div>
          }

          @if (j.status === 'failed' || j.status === 'cancelled') {
            <div class="action-row">
              <button mat-stroked-button (click)="retryJob(j.id)" [disabled]="actionLoading()">
                <mat-icon>replay</mat-icon> Повторить
              </button>
              <button mat-stroked-button (click)="reprintJob(j.id)" [disabled]="actionLoading()">
                <mat-icon>content_copy</mat-icon> Перепечатать
              </button>
            </div>
          }

          @if (j.status === 'completed') {
            <div class="action-row">
              <button mat-stroked-button (click)="reprintJob(j.id)" [disabled]="actionLoading()">
                <mat-icon>content_copy</mat-icon> Перепечатать
              </button>
            </div>
          }

          <!-- Priority adjustment -->
          @if (canChangePriority(j.status)) {
            <div class="priority-row">
              <span class="priority-label">Приоритет:</span>
              <mat-form-field appearance="outline" class="priority-field">
                <mat-select [ngModel]="j.priority ?? 0"
                            (ngModelChange)="setPriority(j.id, $event)">
                  <mat-option [value]="0">Обычный (0)</mat-option>
                  <mat-option [value]="3">Средний (3)</mat-option>
                  <mat-option [value]="5">Высокий (5)</mat-option>
                  <mat-option [value]="8">Срочный (8)</mat-option>
                  <mat-option [value]="10">Критический (10)</mat-option>
                </mat-select>
              </mat-form-field>
            </div>
          }

          <!-- Reassign to another printer -->
          @if (canReassign(j.status) && availablePrinters().length > 1) {
            <div class="reassign-row">
              <span class="reassign-label">Переназначить:</span>
              <mat-form-field appearance="outline" class="reassign-field">
                <mat-select (selectionChange)="reassignJob(j.id, $event.value)">
                  @for (p of availablePrinters(); track p.id) {
                    @if (p.id !== j.printer_id) {
                      <mat-option [value]="p.id">{{ p.name }}</mat-option>
                    }
                  }
                </mat-select>
              </mat-form-field>
            </div>
          }

          <!-- Finishing operations -->
          @if (j.finishing_ops?.length) {
            <div class="finishing-section">
              <span class="finishing-title">Финишная обработка</span>
              <div class="finishing-chips">
                @for (op of j.finishing_ops; track op) {
                  <span class="finishing-chip">
                    <mat-icon class="finishing-chip-icon">{{ getFinishingIcon(op) }}</mat-icon>
                    {{ getFinishingLabel(op) }}
                  </span>
                }
              </div>
              @if (j.status === 'finishing' && j.finishing_status !== 'done') {
                <button mat-stroked-button class="finishing-done-btn" (click)="markFinishingDone(j.id)" [disabled]="actionLoading()">
                  <mat-icon>check</mat-icon> Финишка готова
                </button>
              }
            </div>
          }

          <!-- Retry on different printer -->
          @if ((j.status === 'failed' || j.status === 'cancelled') && availablePrinters().length > 1) {
            <div class="retry-printer-section">
              <span class="retry-printer-label">Повторить на другом принтере:</span>
              <div class="retry-printer-list">
                @for (p of availablePrinters(); track p.id) {
                  @if (p.id !== j.printer_id) {
                    <button mat-stroked-button class="retry-printer-btn" (click)="retryOnPrinter(j.id, p.id)" [disabled]="actionLoading()">
                      {{ p.name }}
                    </button>
                  }
                }
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 1000;
      pointer-events: none;

      &.open { pointer-events: auto; }
    }

    .panel-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.4);
      z-index: 1000;
    }

    .panel-content {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 440px;
      max-width: 90vw;
      background: var(--crm-surface, #1a1a2e);
      border-left: 1px solid var(--crm-border);
      box-shadow: -4px 0 24px rgba(0,0,0,0.3);
      z-index: 1001;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0;
      animation: slideIn 200ms ease-out;
    }

    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid var(--crm-border);
      position: sticky;
      top: 0;
      background: var(--crm-surface);
      z-index: 1;
    }

    .panel-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 16px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin: 0;

      mat-icon { color: var(--crm-accent); }
    }

    .preview-section {
      padding: 16px 20px;
      display: flex;
      justify-content: center;
    }

    .preview-thumb {
      max-width: 100%;
      max-height: 180px;
      border-radius: 8px;
      object-fit: contain;
      background: #fff;
      border: 1px solid var(--crm-border);
    }

    .preview-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      color: var(--crm-text-secondary);
      padding: 24px;

      mat-icon { font-size: 40px; width: 40px; height: 40px; opacity: 0.5; }
      span { font-size: 12px; word-break: break-all; text-align: center; }
    }

    .status-section {
      padding: 0 20px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      color: var(--badge-color);
      background: color-mix(in srgb, var(--badge-color) 12%, transparent);
      border: 1px solid color-mix(in srgb, var(--badge-color) 30%, transparent);
      align-self: flex-start;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .error-msg {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--crm-status-error) 10%, transparent);
      color: var(--crm-status-error);
      font-size: 12px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; flex-shrink: 0; margin-top: 1px; }
    }

    .progress-bar-wrapper {
      position: relative;
      height: 6px;
      background: rgba(255,255,255,0.08);
      border-radius: 3px;
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      background: var(--crm-accent);
      border-radius: 3px;
      transition: width 300ms ease;
    }

    .progress-label {
      position: absolute;
      right: 0;
      top: -16px;
      font-size: 10px;
      color: var(--crm-text-secondary);
    }

    .section-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--crm-text-secondary);
      display: block;
      margin-bottom: 8px;
    }

    .timeline-section {
      padding: 12px 20px;
    }

    .timeline {
      display: flex;
      gap: 0;
      overflow-x: auto;
    }

    .timeline-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
      position: relative;

      &::after {
        content: '';
        position: absolute;
        top: 5px;
        left: 50%;
        right: -50%;
        height: 2px;
        background: rgba(255,255,255,0.08);
        z-index: 0;
      }

      &:last-child::after { display: none; }
      &.done::after { background: var(--crm-status-success); }
    }

    .step-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      border: 2px solid rgba(255,255,255,0.15);
      z-index: 1;
      transition: all 200ms;
    }

    .timeline-step.done .step-dot {
      background: var(--crm-status-success);
      border-color: var(--crm-status-success);
    }

    .timeline-step.current .step-dot {
      background: var(--crm-accent);
      border-color: var(--crm-accent);
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--crm-accent) 30%, transparent);
    }

    .step-label {
      font-size: 9px;
      color: var(--crm-text-muted);
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }

    .timeline-step.current .step-label,
    .timeline-step.done .step-label {
      color: var(--crm-text-secondary);
    }

    mat-divider {
      margin: 0 20px;
      border-color: rgba(255,255,255,0.06);
    }

    .params-section, .history-section, .links-section, .actions-section {
      padding: 12px 20px;
    }

    .params-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 12px;
    }

    .param {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .param-key {
      font-size: 10px;
      color: var(--crm-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .param-val {
      font-size: 13px;
      color: var(--crm-text-primary);
      font-weight: 500;
    }

    .history-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .history-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--crm-text-secondary);

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        color: var(--crm-text-muted);
      }
    }

    .link-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin-bottom: 4px;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        color: var(--crm-text-muted);
      }
    }

    .action-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 8px;

      button {
        font-size: 12px !important;
        min-height: 32px !important;
        padding: 0 12px !important;

        mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
      }
    }

    .action-danger {
      color: var(--crm-status-error) !important;
      border-color: var(--crm-status-error) !important;
    }

    .priority-row, .reassign-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .priority-label, .reassign-label {
      font-size: 12px;
      color: var(--crm-text-secondary);
      white-space: nowrap;
    }

    .priority-field, .reassign-field {
      flex: 1;
      max-width: 200px;
    }

    .schedule-input-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 8px;
    }

    .finishing-section {
      margin-top: 12px;
      padding: 12px;
      background: rgba(45, 212, 191, 0.06);
      border-radius: 8px;
    }

    .finishing-title {
      font-size: 12px;
      font-weight: 600;
      color: #0d9488;
      margin-bottom: 8px;
      display: block;
    }

    .finishing-chips {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .finishing-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 16px;
      font-size: 12px;
      background: rgba(45, 212, 191, 0.12);
      color: #0d9488;
    }

    .finishing-chip-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .finishing-done-btn {
      margin-top: 8px;
    }

    .retry-printer-section {
      margin-top: 8px;
    }

    .retry-printer-label {
      font-size: 12px;
      color: var(--crm-text-secondary);
    }

    .retry-printer-list {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .retry-printer-btn {
      font-size: 12px !important;
      min-height: 28px !important;
      padding: 0 10px !important;
    }
  `],
})
export class PrintJobDetailComponent {
  private readonly api = inject(PrintApiService);
  private readonly toast = inject(ToastService);

  readonly job = input<PrintJob | null>(null);
  readonly open = model(false);
  readonly availablePrinters = input<Printer[]>([]);

  readonly actionLoading = signal(false);
  readonly showScheduleInput = signal(false);
  readonly scheduleValue = signal('');

  readonly timelineSteps = computed(() => {
    const j = this.job();
    if (!j) return [];
    const currentIdx = STATUS_ORDER.indexOf(j.status as JobStatus);
    return STATUS_ORDER
      .filter(s => s !== 'splitting') // skip splitting for cleaner UI
      .map((status, _idx) => {
        const cfg = STATUS_CONFIG[status] ?? { icon: '', label: status, color: '' };
        const orderIdx = STATUS_ORDER.indexOf(status);
        return {
          status,
          label: cfg.label,
          done: currentIdx > orderIdx,
          current: j.status === status,
          active: currentIdx >= orderIdx,
        };
      });
  });

  statusCfg(status: string): { icon: string; label: string; color: string } {
    return STATUS_CONFIG[status] ?? { icon: 'help', label: status, color: 'var(--crm-text-muted)' };
  }

  isImage(j: PrintJob): boolean {
    const name = (j.file_name ?? j.file_url ?? '').toLowerCase();
    return /\.(jpg|jpeg|png|webp|gif|bmp)/.test(name);
  }

  fileIcon(j: PrintJob): string {
    const name = (j.file_name ?? '').toLowerCase();
    if (name.endsWith('.pdf')) return 'picture_as_pdf';
    if (name.endsWith('.docx') || name.endsWith('.doc')) return 'description';
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return 'table_chart';
    return 'insert_drive_file';
  }

  isActionable(status: string): boolean {
    return ['queued', 'paused', 'held', 'sending', 'printing', 'scheduled'].includes(status);
  }

  canHold(status: string): boolean {
    return ['queued', 'scheduled'].includes(status);
  }

  canCancel(status: string): boolean {
    return ['queued', 'sending', 'printing', 'paused', 'held', 'scheduled', 'converting'].includes(status);
  }

  canChangePriority(status: string): boolean {
    return ['queued', 'scheduled', 'held'].includes(status);
  }

  canReassign(status: string): boolean {
    return ['queued', 'held', 'scheduled'].includes(status);
  }

  cancelJob(jobId: string): void {
    this.actionLoading.set(true);
    this.api.cancelJob(jobId).subscribe({
      next: () => { this.toast.success('Задание отменено'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось отменить'); this.actionLoading.set(false); },
    });
  }

  retryJob(jobId: string): void {
    this.actionLoading.set(true);
    this.api.retryJob(jobId).subscribe({
      next: () => { this.toast.success('Задание перезапущено'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось перезапустить'); this.actionLoading.set(false); },
    });
  }

  reprintJob(jobId: string): void {
    this.actionLoading.set(true);
    this.api.reprintJob(jobId).subscribe({
      next: () => { this.toast.success('Перепечатка создана'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось перепечатать'); this.actionLoading.set(false); },
    });
  }

  holdJob(jobId: string): void {
    this.actionLoading.set(true);
    this.api.holdJob(jobId).subscribe({
      next: () => { this.toast.success('Задание удержано'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось удержать'); this.actionLoading.set(false); },
    });
  }

  releaseJob(jobId: string): void {
    this.actionLoading.set(true);
    this.api.releaseJob(jobId).subscribe({
      next: () => { this.toast.success('Задание отпущено'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось отпустить'); this.actionLoading.set(false); },
    });
  }

  setPriority(jobId: string, priority: number): void {
    this.actionLoading.set(true);
    this.api.setPriority(jobId, priority).subscribe({
      next: () => { this.toast.success('Приоритет обновлён'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось обновить приоритет'); this.actionLoading.set(false); },
    });
  }

  reassignJob(jobId: string, targetPrinterId: string): void {
    this.actionLoading.set(true);
    this.api.reassignJob(jobId, targetPrinterId).subscribe({
      next: () => { this.toast.success('Задание переназначено'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось переназначить'); this.actionLoading.set(false); },
    });
  }

  resumeJob(jobId: string): void {
    this.actionLoading.set(true);
    this.api.resumeJob(jobId).subscribe({
      next: () => { this.toast.success('Задание возобновлено'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось возобновить'); this.actionLoading.set(false); },
    });
  }

  scheduleJob(jobId: string): void {
    const val = this.scheduleValue();
    if (!val) return;
    this.actionLoading.set(true);
    this.api.scheduleJob(jobId, new Date(val).toISOString()).subscribe({
      next: () => { this.showScheduleInput.set(false); this.scheduleValue.set(''); this.toast.success('Задание запланировано'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось запланировать'); this.actionLoading.set(false); },
    });
  }

  getFinishingIcon(op: string): string {
    const map: Readonly<Record<string, string>> = {
      cut: 'content_cut', trim: 'content_cut', staple: 'push_pin',
      bind_spiral: 'menu_book', bind_thermal: 'menu_book', laminate: 'layers',
      fold: 'flip_to_back', punch: 'radio_button_unchecked',
      round_corners: 'rounded_corner', booklet: 'auto_stories',
    };
    return map[op] ?? 'build';
  }

  getFinishingLabel(op: string): string {
    const map: Readonly<Record<string, string>> = {
      cut: 'Обрезка', trim: 'Подрезка', staple: 'Скрепка',
      bind_spiral: 'Пружина', bind_thermal: 'Термопереплёт', laminate: 'Ламинация',
      fold: 'Фальцовка', punch: 'Перфорация',
      round_corners: 'Скругление', booklet: 'Буклет',
    };
    return map[op] ?? op;
  }

  markFinishingDone(jobId: string): void {
    this.actionLoading.set(true);
    this.api.updateFinishingStatus(jobId, 'done').subscribe({
      next: () => { this.toast.success('Финишка завершена'); this.actionLoading.set(false); },
      error: () => { this.toast.error('Не удалось обновить статус'); this.actionLoading.set(false); },
    });
  }

  retryOnPrinter(jobId: string, targetPrinterId: string): void {
    this.actionLoading.set(true);
    this.api.reassignJob(jobId, targetPrinterId).subscribe({
      next: () => {
        this.api.retryJob(jobId).subscribe({
          next: () => { this.toast.success('Задание перезапущено на другом принтере'); this.actionLoading.set(false); },
          error: () => { this.toast.error('Не удалось перезапустить'); this.actionLoading.set(false); },
        });
      },
      error: () => { this.toast.error('Не удалось переназначить'); this.actionLoading.set(false); },
    });
  }
}
