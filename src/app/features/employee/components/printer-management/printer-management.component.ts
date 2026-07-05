import {
  Component, inject, signal, computed, ChangeDetectionStrategy, OnInit, OnDestroy, effect,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { startWith, map } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { PrintApiService, Printer, PrinterCapabilities, CreatePrinterDto } from '../../services/print-api.service';
import { InfraRealtimeService } from '../../services/infra-realtime.service';

// ─── CAPABILITY PRESETS ────────────────────────────────────

const CAPABILITY_PRESETS: Record<string, PrinterCapabilities> = {
  photo: {
    paper_sizes: [
      { id: '10x15', name: '10×15', width_mm: 100, height_mm: 150 },
      { id: '9x13', name: '9×13', width_mm: 90, height_mm: 130 },
      { id: '13x18', name: '13×18', width_mm: 130, height_mm: 180 },
      { id: 'a6', name: 'A6', width_mm: 105, height_mm: 148 },
      { id: 'a5', name: 'A5', width_mm: 148, height_mm: 210 },
      { id: 'a4', name: 'A4', width_mm: 210, height_mm: 297 },
      { id: '20x25', name: '20×25', width_mm: 203, height_mm: 254 },
    ],
    media_types: [
      { id: 'glossy', name: 'Глянцевая' },
      { id: 'semi_glossy', name: 'Полуглянцевая' },
      { id: 'matte', name: 'Матовая' },
      { id: 'luster', name: 'Люстр' },
      { id: 'plain', name: 'Обычная' },
    ],
    quality_modes: [
      { id: 'draft', name: 'Черновик' },
      { id: 'normal', name: 'Стандарт' },
      { id: 'photo', name: 'Фото' },
      { id: 'best', name: 'Лучшее фото' },
    ],
    color: true, duplex: false, borderless: true, max_dpi: 5760,
  },
  mfp: {
    paper_sizes: [
      { id: 'a4', name: 'A4', width_mm: 210, height_mm: 297 },
      { id: 'a3', name: 'A3', width_mm: 297, height_mm: 420 },
      { id: 'a5', name: 'A5', width_mm: 148, height_mm: 210 },
      { id: 'b4', name: 'B4', width_mm: 250, height_mm: 353 },
      { id: 'b5', name: 'B5', width_mm: 176, height_mm: 250 },
      { id: 'c6_envelope', name: 'C6 конверт', width_mm: 114, height_mm: 162 },
    ],
    media_types: [
      { id: 'plain', name: 'Обычная' },
      { id: 'thick', name: 'Плотная' },
      { id: 'recycled', name: 'Переработанная' },
      { id: 'envelope', name: 'Конверт' },
      { id: 'labels', name: 'Этикетки' },
      { id: 'coated', name: 'Мелованная' },
    ],
    quality_modes: [
      { id: 'draft', name: 'Черновик' },
      { id: 'normal', name: 'Стандарт' },
      { id: 'high', name: 'Высокое' },
    ],
    color: true, duplex: true, borderless: false, max_dpi: 1200,
    paper_sources: [
      { id: 'auto', name: 'Авто' },
      { id: 'tray1', name: 'Лоток 1' },
      { id: 'tray2', name: 'Лоток 2' },
      { id: 'universal', name: 'Универсальный' },
    ],
    finishing: [
      { id: 'staple', name: 'Сшивка', icon: 'push_pin' },
      { id: 'punch', name: 'Перфорация', icon: 'radio_button_unchecked' },
      { id: 'fold', name: 'Фальцовка', icon: 'file_copy' },
      { id: 'booklet', name: 'Брошюра', icon: 'menu_book' },
    ],
  },
  document: {
    paper_sizes: [
      { id: 'a4', name: 'A4', width_mm: 210, height_mm: 297 },
    ],
    media_types: [
      { id: 'plain', name: 'Обычная' },
    ],
    quality_modes: [
      { id: 'draft', name: 'Черновик' },
      { id: 'normal', name: 'Стандарт' },
    ],
    color: false, duplex: false, borderless: false, max_dpi: 600,
  },
  sublimation: {
    paper_sizes: [
      { id: 'a4', name: 'A4', width_mm: 210, height_mm: 297 },
      { id: 'a5', name: 'A5', width_mm: 148, height_mm: 210 },
    ],
    media_types: [
      { id: 'sublimation', name: 'Сублимационная' },
      { id: 'ds_transfer', name: 'DS Transfer' },
    ],
    quality_modes: [
      { id: 'standard', name: 'Стандарт' },
      { id: 'high', name: 'Высокое' },
    ],
    color: true, duplex: false, borderless: false, max_dpi: 5760,
    sublimation: true, mirror_default: true,
  },
};

const TYPE_LABELS: Record<string, string> = { photo: 'Фото', mfp: 'МФУ', document: 'Документы', sublimation: 'Сублимация' };
const TYPE_COLORS: Record<string, string> = { photo: 'var(--crm-printer-photo)', mfp: 'var(--crm-printer-mfp)', document: 'var(--crm-printer-document)', sublimation: '#e040fb' };

interface Studio { id: string; name: string; }

interface PrinterLiveStatus {
  status: 'idle' | 'printing' | 'error' | 'offline';
  queue_length: number;
  error_message?: string;
}

type PrinterLiveStatusById = ReadonlyMap<string, PrinterLiveStatus>;

function normalizePrinterType(value: unknown): Printer['printer_type'] {
  switch (value) {
    case 'photo':
    case 'document':
    case 'mfp':
    case 'sublimation':
      return value;
    default:
      return 'mfp';
  }
}

function formString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function formNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length ? value : null;
}

const STATUS_CONFIG: Record<string, { color: string; icon: string; label: string }> = {
  idle: { color: 'var(--crm-status-success)', icon: 'check_circle', label: 'Готов' },
  printing: { color: 'var(--crm-status-info)', icon: 'print', label: 'Печатает' },
  error: { color: 'var(--crm-status-error)', icon: 'error', label: 'Ошибка' },
  offline: { color: 'var(--crm-text-muted)', icon: 'cloud_off', label: 'Офлайн' },
};

@Component({
  selector: 'app-printer-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, FormsModule,
    MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSlideToggleModule, MatProgressSpinnerModule,
    MatTooltipModule, MatDividerModule,
  ],
  template: `
    <div class="pm-page">
      <!-- Header -->
      <div class="pm-header">
        <div>
          <h2 class="pm-title">Принтеры</h2>
          <p class="pm-subtitle">{{ printers().length }} принтер(ов) в системе</p>
        </div>
        <button mat-flat-button class="add-btn" (click)="startAdd()" [disabled]="adding()">
          <mat-icon>add</mat-icon> Добавить
        </button>
      </div>

      <!-- Add / Edit form -->
      @if (adding() || editingId()) {
        <mat-card class="pm-form-card">
          <div class="form-title">
            {{ editingId() ? 'Редактировать принтер' : 'Новый принтер' }}
          </div>
          <form [formGroup]="form" (ngSubmit)="save()" class="pm-form">
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-name">
                <mat-label>Название</mat-label>
                <input matInput formControlName="name" placeholder="Epson L8050" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="field-type">
                <mat-label>Тип</mat-label>
                <mat-select formControlName="printer_type">
                  <mat-option value="photo">Фото</mat-option>
                  <mat-option value="mfp">МФУ (лазерный)</mat-option>
                  <mat-option value="document">Документный</mat-option>
                  <mat-option value="sublimation">Сублимация</mat-option>
                </mat-select>
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="field-winname">
                <mat-label>Имя принтера CUPS</mat-label>
                <input matInput formControlName="cups_printer_name" placeholder="Epson_L8050_Series" />
                <mat-hint>Имя из CUPS (lpstat -p) или «Устройства и принтеры» Windows</mat-hint>
              </mat-form-field>

              <mat-form-field appearance="outline" class="field-studio">
                <mat-label>Студия</mat-label>
                <mat-select formControlName="studio_id">
                  <mat-option [value]="null">Все студии</mat-option>
                  @for (s of studios(); track s.id) {
                    <mat-option [value]="s.id">{{ s.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="form-capabilities">
              <div class="cap-label">Возможности (preset из типа)</div>
              <div class="cap-chips">
                @for (size of capPreview().paper_sizes; track size.id) {
                  <span class="cap-chip">{{ size.name }}</span>
                }
                @for (m of capPreview().media_types; track m.id) {
                  <span class="cap-chip cap-chip--media">{{ m.name }}</span>
                }
                @for (q of capPreview().quality_modes; track q.id) {
                  <span class="cap-chip cap-chip--quality">{{ q.name }}</span>
                }
                @if (capPreview().color) { <span class="cap-chip cap-chip--feat">Цвет</span> }
                @if (capPreview().duplex) { <span class="cap-chip cap-chip--feat">Duplex</span> }
                @if (capPreview().borderless) { <span class="cap-chip cap-chip--feat">Без полей</span> }
                <span class="cap-chip cap-chip--dpi">{{ capPreview().max_dpi }} DPI</span>
              </div>
            </div>

            <div class="form-toggle">
              <mat-slide-toggle formControlName="is_active" color="primary">Активен</mat-slide-toggle>
            </div>

            <div class="form-actions">
              <button mat-flat-button type="submit" [disabled]="form.invalid || saving()" class="save-btn">
                @if (saving()) { <mat-spinner diameter="16" /> }
                @else { <mat-icon>save</mat-icon> }
                {{ editingId() ? 'Сохранить' : 'Создать' }}
              </button>
              <button mat-button type="button" (click)="cancelEdit()">Отмена</button>
            </div>
          </form>
        </mat-card>
      }

      <!-- Printer list -->
      @if (loading()) {
        <div class="pm-loading"><mat-spinner diameter="32" /></div>
      } @else if (printers().length === 0) {
        <div class="pm-empty">
          <mat-icon>print_disabled</mat-icon>
          <span>Принтеры не добавлены</span>
        </div>
      } @else {
        <div class="pm-list">
          @for (p of printers(); track p.id) {
            <mat-card class="pm-card" [class.pm-card--inactive]="!p.is_active">
              <!-- Delete confirm overlay -->
              @if (confirmDeleteId() === p.id) {
                <div class="delete-confirm">
                  <mat-icon class="delete-icon">warning</mat-icon>
                  <span>Удалить «{{ p.name }}»?</span>
                  <div class="delete-actions">
                    <button mat-flat-button color="warn" (click)="confirmDelete(p.id)">Удалить</button>
                    <button mat-button (click)="confirmDeleteId.set(null)">Отмена</button>
                  </div>
                </div>
              }

              <div class="pm-card__header">
                <div class="pm-card__name-row">
                  <span class="printer-name">{{ p.name }}</span>
                  <span class="type-badge" [style.background]="typeColor(p.printer_type) + '22'" [style.color]="typeColor(p.printer_type)">
                    {{ typeLabel(p.printer_type) }}
                  </span>
                  @if (!p.is_active) {
                    <span class="inactive-badge">Отключён</span>
                  }
                </div>
                <div class="pm-card__actions">
                  <button mat-icon-button matTooltip="Редактировать" (click)="startEdit(p)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Удалить" class="delete-btn" (click)="requestDelete(p.id)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>

              <div class="pm-card__winname">
                <mat-icon class="meta-icon">computer</mat-icon>
                <span class="win-name">{{ p.cups_printer_name }}</span>
              </div>

              @if (p.studio_name) {
                <div class="pm-card__studio">
                  <mat-icon class="meta-icon">location_on</mat-icon>
                  <span>{{ p.studio_name }}</span>
                </div>
              }

              <div class="pm-card__live-status">
                <span class="status-dot" [style.background]="statusConfig(p.id).color"></span>
                <mat-icon class="status-icon" [style.color]="statusConfig(p.id).color">{{ statusConfig(p.id).icon }}</mat-icon>
                <span class="status-label" [style.color]="statusConfig(p.id).color">{{ statusConfig(p.id).label }}</span>
                @if (queueLength(p.id) > 0) {
                  <span class="queue-badge">{{ queueLength(p.id) }} в очереди</span>
                }
                @if (statusError(p.id); as err) {
                  <span class="error-hint" [matTooltip]="err">{{ err }}</span>
                }
              </div>

              <!-- Queue pause/resume -->
              <div class="pm-card__queue-control">
                @if (p.queue_paused) {
                  <div class="queue-paused-banner">
                    <mat-icon>pause_circle</mat-icon>
                    <span class="paused-text">Очередь приостановлена</span>
                    @if (p.queue_paused_reason) {
                      <span class="paused-reason">{{ p.queue_paused_reason }}</span>
                    }
                  </div>
                  <button mat-stroked-button class="queue-btn resume-btn"
                          (click)="resumeQueue(p.id)" [disabled]="queueActionLoading()">
                    <mat-icon>play_arrow</mat-icon> Возобновить
                  </button>
                } @else {
                  <button mat-stroked-button class="queue-btn pause-btn"
                          (click)="showPauseDialog(p.id)" [disabled]="queueActionLoading()">
                    <mat-icon>pause</mat-icon> Приостановить очередь
                  </button>
                }
              </div>

              @if (pauseDialogPrinterId() === p.id) {
                <div class="pause-reason-form">
                  <mat-form-field appearance="outline" class="pause-reason-field">
                    <mat-label>Причина (необязательно)</mat-label>
                    <input matInput [(ngModel)]="pauseReason" placeholder="Замена бумаги..." />
                  </mat-form-field>
                  <div class="pause-reason-actions">
                    <button mat-flat-button class="confirm-pause-btn" (click)="confirmPauseQueue(p.id)">
                      <mat-icon>pause</mat-icon> Приостановить
                    </button>
                    <button mat-button (click)="pauseDialogPrinterId.set(null)">Отмена</button>
                  </div>
                </div>
              }

              <mat-divider />

              <div class="pm-card__caps">
                <div class="caps-row">
                  @for (size of p.capabilities.paper_sizes; track size.id) {
                    <span class="cap-chip">{{ size.name }}</span>
                  }
                  @for (m of p.capabilities.media_types; track m.id) {
                    <span class="cap-chip cap-chip--media">{{ m.name }}</span>
                  }
                </div>
                <div class="caps-features">
                  @if (p.capabilities.color) { <span class="feat-dot feat-dot--on">Цвет</span> }
                  @else { <span class="feat-dot feat-dot--off">Ч/Б</span> }
                  @if (p.capabilities.duplex) { <span class="feat-dot feat-dot--on">Duplex</span> }
                  @if (p.capabilities.borderless) { <span class="feat-dot feat-dot--on">Без полей</span> }
                  <span class="feat-dot feat-dot--neutral">{{ p.capabilities.max_dpi }} dpi</span>
                </div>
              </div>
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .pm-page {
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px 24px;
    }

    .pm-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 20px;
    }

    .pm-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin: 0 0 2px;
    }

    .pm-subtitle {
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin: 0;
    }

    .add-btn {
      background: var(--crm-accent);
      color: #fff;
      font-size: 13px;
      height: 34px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }

    /* ── FORM ── */

    .pm-form-card {
      background: var(--crm-surface-2);
      border: 1px solid rgba(255,255,255,0.07);
      padding: 20px;
      margin-bottom: 20px;
      border-radius: 8px;
    }

    .form-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary);
      margin-bottom: 16px;
    }

    .pm-form {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .form-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }

    .field-name { flex: 2; min-width: 200px; }
    .field-type { flex: 1; min-width: 140px; }
    .field-winname { flex: 2; min-width: 200px; }
    .field-studio { flex: 1; min-width: 160px; }

    .form-capabilities {
      background: var(--crm-surface-3, #1a1a1a);
      border-radius: 6px;
      padding: 10px 12px;
      margin: 4px 0;
    }

    .cap-label {
      font-size: 11px;
      color: var(--crm-text-secondary);
      margin-bottom: 6px;
    }

    .cap-chips { display: flex; flex-wrap: wrap; gap: 4px; }

    .cap-chip {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 4px;
      background: rgba(139,92,246,0.12);
      color: var(--crm-accent);
      border: 1px solid rgba(139,92,246,0.25);
    }

    .cap-chip--media { background: var(--crm-status-info-muted); color: var(--crm-status-info); border-color: rgba(96,165,250,0.2); }
    .cap-chip--quality { background: var(--crm-status-success-muted); color: var(--crm-status-success); border-color: rgba(52,211,153,0.2); }
    .cap-chip--feat { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); border-color: rgba(251,191,36,0.2); }
    .cap-chip--dpi { background: rgba(156,163,175,0.1); color: #9ca3af; border-color: rgba(156,163,175,0.2); }

    .form-toggle {
      padding: 4px 0;
    }

    .form-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      padding-top: 8px;
    }

    .save-btn {
      background: var(--crm-accent);
      color: #fff;
      font-size: 13px;
      height: 34px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      mat-spinner { display: inline-block; }
    }

    /* ── LIST ── */

    .pm-loading, .pm-empty {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 48px;
      color: var(--crm-text-secondary);
      font-size: 14px;

      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    }

    .pm-list {
      display: grid;
      grid-template-columns: 1fr;
      gap: 12px;

      @media (min-width: 700px) {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    .pm-card {
      background: var(--crm-surface-2);
      border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px;
      padding: 14px 16px;
      position: relative;
      transition: border-color 150ms;

      &:hover { border-color: rgba(139,92,246,0.3); }
    }

    .pm-card--inactive {
      opacity: 0.55;
    }

    .pm-card__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .pm-card__name-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .printer-name {
      font-size: 14px;
      font-weight: 600;
      color: var(--crm-text-primary);
    }

    .type-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 4px;
      letter-spacing: 0.03em;
    }

    .inactive-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 4px;
      background: var(--crm-status-error-muted);
      color: var(--crm-status-error);
    }

    .pm-card__actions {
      display: flex;
      gap: 0;
      margin: -6px -8px 0 0;

      button mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-secondary); }
      .delete-btn mat-icon { color: color-mix(in srgb, var(--crm-status-error) 60%, transparent); }
      .delete-btn:hover mat-icon { color: var(--crm-status-error); }
    }

    .pm-card__winname, .pm-card__studio {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 12px;
      color: var(--crm-text-secondary);
      margin-bottom: 4px;
    }

    .win-name { font-family: var(--crm-font-mono, monospace); font-size: 11px; }

    .meta-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
      color: var(--crm-text-secondary);
    }

    .pm-card__live-status {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 8px 0 4px;
      font-size: 12px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-icon {
      font-size: 14px;
      width: 14px;
      height: 14px;
    }

    .status-label {
      font-weight: 500;
    }

    .queue-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
      background: var(--crm-status-info-muted);
      color: var(--crm-status-info);
      font-weight: 500;
    }

    .error-hint {
      font-size: 10px;
      color: var(--crm-status-error);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 160px;
      cursor: help;
    }

    mat-divider {
      margin: 10px 0 8px;
      border-color: rgba(255,255,255,0.05);
    }

    .pm-card__caps { display: flex; flex-direction: column; gap: 5px; }

    .caps-row { display: flex; flex-wrap: wrap; gap: 3px; }

    .caps-features {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }

    .feat-dot {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 3px;
    }

    .feat-dot--on { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .feat-dot--off { background: rgba(156,163,175,0.1); color: #9ca3af; }
    .feat-dot--neutral { background: rgba(156,163,175,0.08); color: #6b7280; }

    /* ── QUEUE CONTROL ── */

    .pm-card__queue-control {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 6px 0 2px;
      flex-wrap: wrap;
    }

    .queue-paused-banner {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 4px 10px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--crm-status-warning) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--crm-status-warning) 20%, transparent);
      flex: 1;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-status-warning);
      }
    }

    .paused-text {
      font-size: 11px;
      font-weight: 600;
      color: var(--crm-status-warning);
    }

    .paused-reason {
      font-size: 10px;
      color: var(--crm-text-secondary);
      margin-left: auto;
    }

    .queue-btn {
      font-size: 11px !important;
      min-height: 28px !important;
      padding: 0 10px !important;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
        margin-right: 3px;
      }
    }

    .pause-btn {
      color: var(--crm-status-warning) !important;
      border-color: color-mix(in srgb, var(--crm-status-warning) 40%, transparent) !important;
    }

    .resume-btn {
      color: var(--crm-status-success) !important;
      border-color: color-mix(in srgb, var(--crm-status-success) 40%, transparent) !important;
    }

    .pause-reason-form {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px 0;
    }

    .pause-reason-field {
      width: 100%;
      font-size: 12px;
    }

    .pause-reason-actions {
      display: flex;
      gap: 6px;
    }

    .confirm-pause-btn {
      background: var(--crm-status-warning) !important;
      color: #fff !important;
      font-size: 11px !important;
      min-height: 28px !important;

      mat-icon {
        font-size: 14px;
        width: 14px;
        height: 14px;
      }
    }

    /* ── DELETE CONFIRM ── */

    .delete-confirm {
      position: absolute;
      inset: 0;
      background: rgba(13,13,13,0.95);
      border-radius: 8px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 16px;
      text-align: center;
    }

    .delete-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      color: var(--crm-status-error);
    }

    .delete-confirm span {
      font-size: 13px;
      color: var(--crm-text-primary);
    }

    .delete-actions {
      display: flex;
      gap: 8px;
    }
  `],
})
export class PrinterManagementComponent implements OnInit, OnDestroy {
  private readonly api = inject(PrintApiService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  private readonly infra = inject(InfraRealtimeService);

  readonly printers = signal<Printer[]>([]);
  readonly studios = signal<Studio[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly adding = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly queueActionLoading = signal(false);
  readonly pauseDialogPrinterId = signal<string | null>(null);
  pauseReason = '';

  /** Live status map: printer_id → status */
  readonly liveStatuses = signal<PrinterLiveStatusById>(new Map<string, PrinterLiveStatus>());

  private readonly statusEffect = effect(() => {
    const ev = this.infra.printerStatus();
    if (!ev) return;
    this.liveStatuses.update(map => {
      const next = new Map(map);
      next.set(ev.printer_id, { status: ev.status, queue_length: ev.queue_length, error_message: ev.error_message });
      return next;
    });
  });

  readonly form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    printer_type: ['photo', Validators.required],
    cups_printer_name: ['', Validators.required],
    studio_id: [null as string | null],
    is_active: [true],
  });

  // Convert form printer_type to signal for use in computed
  private readonly printerTypeSignal = toSignal(
    this.form.get('printer_type')!.valueChanges.pipe(startWith('photo'), map(v => normalizePrinterType(v))),
    { initialValue: 'photo' }
  );

  // Capabilities preview based on selected type
  readonly capPreview = computed<PrinterCapabilities>(() =>
    CAPABILITY_PRESETS[this.printerTypeSignal()] ?? CAPABILITY_PRESETS['mfp']
  );

  ngOnInit(): void {
    this.infra.subscribe();
    this.loadPrinters();
    this.loadStudios();
  }

  ngOnDestroy(): void {
    this.infra.unsubscribe();
  }

  private loadPrinters(): void {
    this.loading.set(true);
    this.api.getAllPrinters().subscribe({
      next: printers => { this.printers.set(printers); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private loadStudios(): void {
    this.http.get<{ studios?: Studio[]; data?: Studio[] }>('/api/studios').subscribe({
      next: res => this.studios.set(res.studios ?? res.data ?? []),
    });
  }

  typeLabel(type: string): string { return TYPE_LABELS[type] ?? type; }
  typeColor(type: string): string { return TYPE_COLORS[type] ?? '#a0a0a0'; }

  statusConfig(printerId: string): { color: string; icon: string; label: string } {
    const live = this.liveStatuses().get(printerId);
    return STATUS_CONFIG[live?.status ?? 'offline'] ?? STATUS_CONFIG['offline'];
  }

  queueLength(printerId: string): number {
    return this.liveStatuses().get(printerId)?.queue_length ?? 0;
  }

  statusError(printerId: string): string | undefined {
    return this.liveStatuses().get(printerId)?.error_message;
  }

  startAdd(): void {
    this.editingId.set(null);
    this.form.reset({ name: '', printer_type: 'photo', cups_printer_name: '', studio_id: null, is_active: true });
    this.adding.set(true);
  }

  startEdit(printer: Printer): void {
    this.adding.set(false);
    this.confirmDeleteId.set(null);
    this.editingId.set(printer.id);
    this.form.patchValue({
      name: printer.name,
      printer_type: printer.printer_type,
      cups_printer_name: printer.cups_printer_name,
      studio_id: printer.studio_id,
      is_active: printer.is_active,
    });
  }

  cancelEdit(): void {
    this.adding.set(false);
    this.editingId.set(null);
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;

    const formValue = this.form.getRawValue();
    const name = formString(formValue.name);
    const printer_type = normalizePrinterType(formValue.printer_type);
    const cups_printer_name = formString(formValue.cups_printer_name);
    const studio_id = formNullableString(formValue.studio_id);
    const is_active = typeof formValue.is_active === 'boolean' ? formValue.is_active : true;

    const capabilities = CAPABILITY_PRESETS[printer_type] ?? CAPABILITY_PRESETS['mfp'];

    const dto: CreatePrinterDto = {
      name, printer_type, cups_printer_name, studio_id, capabilities, is_active,
    };

    this.saving.set(true);
    const id = this.editingId();

    const request = id
      ? this.api.updatePrinterRecord(id, dto)
      : this.api.createPrinterRecord(dto);

    request.subscribe({
      next: printer => {
        if (id) {
          this.printers.update(list => list.map(p => p.id === id ? { ...p, ...printer } : p));
        } else {
          this.printers.update(list => [...list, printer]);
        }
        this.saving.set(false);
        this.adding.set(false);
        this.editingId.set(null);
      },
      error: () => this.saving.set(false),
    });
  }

  requestDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  confirmDelete(id: string): void {
    this.api.deletePrinterRecord(id).subscribe({
      next: () => {
        this.printers.update(list => list.filter(p => p.id !== id));
        this.confirmDeleteId.set(null);
      },
    });
  }

  showPauseDialog(printerId: string): void {
    this.pauseDialogPrinterId.set(printerId);
    this.pauseReason = '';
  }

  confirmPauseQueue(printerId: string): void {
    this.queueActionLoading.set(true);
    this.api.pausePrinterQueue(printerId, this.pauseReason || undefined).subscribe({
      next: () => {
        this.printers.update(list => list.map(p =>
          p.id === printerId ? { ...p, queue_paused: true, queue_paused_reason: this.pauseReason || undefined } : p,
        ));
        this.pauseDialogPrinterId.set(null);
        this.queueActionLoading.set(false);
      },
      error: () => this.queueActionLoading.set(false),
    });
  }

  resumeQueue(printerId: string): void {
    this.queueActionLoading.set(true);
    this.api.resumePrinterQueue(printerId).subscribe({
      next: () => {
        this.printers.update(list => list.map(p =>
          p.id === printerId ? { ...p, queue_paused: false, queue_paused_reason: undefined } : p,
        ));
        this.queueActionLoading.set(false);
      },
      error: () => this.queueActionLoading.set(false),
    });
  }
}
