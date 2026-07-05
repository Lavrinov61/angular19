import { ChangeDetectionStrategy, Component, DestroyRef, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  TelephonyApiService,
  type ServiceSurveyResponseItem,
  type ServiceSurveyResponseStatus,
} from '../../services/telephony-api.service';

type StatusFilter = ServiceSurveyResponseStatus | 'all';

interface StatusOption {
  value: StatusFilter;
  label: string;
}

interface SurveyTerm {
  label: string;
  count: number;
}

const PAGE_SIZE = 30;
const SURVEY_STOP_WORDS = new Set([
  'без', 'вам', 'вас', 'все', 'для', 'или', 'как', 'мне', 'можно', 'надо', 'нам',
  'она', 'они', 'очень', 'под', 'при', 'про', 'так', 'там', 'тут', 'уже', 'что',
  'это', 'этот', 'этого', 'чтобы', 'пожалуйста', 'спасибо', 'хочу', 'нужно',
  'сделать', 'добавить', 'клиент', 'фото', 'фотографию', 'фотографии',
]);

@Component({
  selector: 'app-service-surveys',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatTooltipModule],
  template: `
    <section class="survey-page">
      <header class="survey-header">
        <a mat-icon-button routerLink="/employee/more" class="back-link" aria-label="Назад">
          <mat-icon>arrow_back</mat-icon>
        </a>
        <div class="title-block">
          <h1>Пожелания клиентов</h1>
          <p>Расшифровки звонков после услуги</p>
        </div>
        <button mat-icon-button type="button" (click)="load()" matTooltip="Обновить" aria-label="Обновить">
          <mat-icon>refresh</mat-icon>
        </button>
      </header>

      <div class="filters">
        <label class="search-field">
          <mat-icon>search</mat-icon>
          <input type="search"
                 placeholder="Клиент, телефон, текст"
                 [value]="query()"
                 (input)="onQueryInput($event)"
                 (keydown.enter)="applyFilters()" />
        </label>

        <label class="date-field">
          <span>С</span>
          <input type="date" [value]="fromDate()" (input)="onFromDateInput($event)" />
        </label>
        <label class="date-field">
          <span>По</span>
          <input type="date" [value]="toDate()" (input)="onToDateInput($event)" />
        </label>

        <div class="status-strip" aria-label="Статус">
          @for (option of statusOptions; track option.value) {
            <button type="button"
                    class="status-filter"
                    [class.status-filter--active]="statusFilter() === option.value"
                    (click)="setStatusFilter(option.value)">
              {{ option.label }}
            </button>
          }
        </div>

        <button mat-stroked-button type="button" (click)="applyFilters()">
          <mat-icon>filter_alt</mat-icon>
          <span>Показать</span>
        </button>
        <button mat-icon-button type="button" (click)="resetFilters()" matTooltip="Сбросить" aria-label="Сбросить">
          <mat-icon>restart_alt</mat-icon>
        </button>
      </div>

      <div class="summary-row">
        <div class="summary-item">
          <span class="summary-value">{{ total() }}</span>
          <span class="summary-label">всего</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">{{ loadedWithTranscript() }}</span>
          <span class="summary-label">с текстом</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">{{ loadedMissed() }}</span>
          <span class="summary-label">недозвон</span>
        </div>
        <div class="summary-item">
          <span class="summary-value">{{ loadedFailed() }}</span>
          <span class="summary-label">ошибки</span>
        </div>
      </div>

      <div class="survey-layout">
        <section class="list-panel">
          <div class="panel-head">
            <h2>Опросы</h2>
            <span>{{ pageRangeLabel() }}</span>
          </div>

          @if (loading()) {
            <div class="state">
              <mat-spinner diameter="24" />
            </div>
          } @else if (error()) {
            <div class="state state--error">{{ error() }}</div>
          } @else if (items().length) {
            <div class="response-list">
              @for (item of items(); track item.call_id) {
                <button type="button"
                        class="response-row"
                        [class.response-row--active]="selectedCallId() === item.call_id"
                        (click)="select(item)">
                  <div class="response-top">
                    <span class="client">{{ item.client_name || displayPhone(item) }}</span>
                    <span class="status-badge"
                          [class.status-badge--pending]="statusTone(item.status) === 'pending'"
                          [class.status-badge--info]="statusTone(item.status) === 'info'"
                          [class.status-badge--success]="statusTone(item.status) === 'success'"
                          [class.status-badge--warning]="statusTone(item.status) === 'warning'"
                          [class.status-badge--error]="statusTone(item.status) === 'error'">
                      {{ statusLabel(item.status) }}
                    </span>
                  </div>
                  <div class="snippet">
                    {{ item.transcript_text || transcriptPlaceholder(item.status) }}
                  </div>
                  <div class="response-meta">
                    <span>{{ formatDateTime(item.transcript_created_at || item.ended_at || item.started_at) }}</span>
                    @if (item.duration_seconds !== null) {
                      <span>{{ formatDuration(item.duration_seconds) }}</span>
                    }
                  </div>
                </button>
              }
            </div>

            <div class="pager">
              <button mat-stroked-button type="button" (click)="previousPage()" [disabled]="offset() === 0">
                <mat-icon>chevron_left</mat-icon>
                <span>Назад</span>
              </button>
              <button mat-stroked-button type="button" (click)="nextPage()" [disabled]="!hasNextPage()">
                <span>Дальше</span>
                <mat-icon>chevron_right</mat-icon>
              </button>
            </div>
          } @else {
            <div class="state">Нет записей</div>
          }
        </section>

        <section class="detail-panel">
          @if (selected(); as item) {
            <div class="detail-head">
              <div>
                <h2>{{ item.client_name || displayPhone(item) }}</h2>
                <p>{{ displayPhone(item) }}</p>
              </div>
              <span class="status-badge"
                    [class.status-badge--pending]="statusTone(item.status) === 'pending'"
                    [class.status-badge--info]="statusTone(item.status) === 'info'"
                    [class.status-badge--success]="statusTone(item.status) === 'success'"
                    [class.status-badge--warning]="statusTone(item.status) === 'warning'"
                    [class.status-badge--error]="statusTone(item.status) === 'error'">
                {{ statusLabel(item.status) }}
              </span>
            </div>

            <div class="facts">
              <div class="fact">
                <span>Дата</span>
                <strong>{{ formatDateTime(item.started_at) }}</strong>
              </div>
              <div class="fact">
                <span>Оператор</span>
                <strong>{{ item.operator_name || 'Не указан' }}</strong>
              </div>
              <div class="fact">
                <span>Длительность</span>
                <strong>{{ item.duration_seconds !== null ? formatDuration(item.duration_seconds) : 'Нет' }}</strong>
              </div>
              <div class="fact">
                <span>Точность</span>
                <strong>{{ formatConfidence(item.confidence) }}</strong>
              </div>
            </div>

            <div class="transcript-box">
              <div class="box-title">
                <mat-icon>subject</mat-icon>
                <span>Расшифровка</span>
              </div>
              @if (item.transcript_text) {
                <p>{{ item.transcript_text }}</p>
              } @else {
                <p class="muted">{{ transcriptPlaceholder(item.status) }}</p>
              }
            </div>

            @if (recordingUrl(item)) {
              <div class="recording-box">
                <div class="box-title">
                  <mat-icon>graphic_eq</mat-icon>
                  <span>Запись</span>
                </div>
                @if (recordingLoading()) {
                  <div class="recording-state">
                    <mat-spinner diameter="18" />
                    <span>Загрузка записи</span>
                  </div>
                } @else if (recordingObjectUrl(); as url) {
                  <audio controls preload="metadata" [src]="url"></audio>
                } @else if (recordingError()) {
                  <p class="muted">{{ recordingError() }}</p>
                }
              </div>
            }

            <div class="meta-grid">
              @if (item.order_id) {
                <div>
                  <span>Заказ</span>
                  <strong>{{ item.order_id }}</strong>
                </div>
              }
              @if (item.language_code) {
                <div>
                  <span>Язык</span>
                  <strong>{{ item.language_code }}</strong>
                </div>
              }
              @if (item.session_id) {
                <div>
                  <span>Сессия</span>
                  <strong>{{ item.session_id }}</strong>
                </div>
              }
            </div>
          } @else {
            <div class="state">Выберите запись</div>
          }
        </section>

        <aside class="topics-panel">
          <div class="panel-head">
            <h2>Частые темы</h2>
            <span>{{ topTerms().length }}</span>
          </div>
          @if (topTerms().length) {
            <div class="term-list">
              @for (term of topTerms(); track term.label) {
                <div class="term-row">
                  <span>{{ term.label }}</span>
                  <strong>{{ term.count }}</strong>
                </div>
              }
            </div>
          } @else {
            <div class="state state--compact">Пока нет текста</div>
          }
        </aside>
      </div>
    </section>
  `,
  styles: [`
    :host {
      display: block;
      height: 100%;
      color: var(--crm-text-primary);
      background: var(--crm-bg);
    }

    .survey-page {
      display: flex;
      flex-direction: column;
      gap: 12px;
      height: 100%;
      min-height: 0;
      padding: 16px;
      overflow: hidden;
    }

    .survey-header,
    .filters,
    .summary-row,
    .list-panel,
    .detail-panel,
    .topics-panel {
      border: 1px solid var(--crm-glass-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-surface) 88%, transparent);
    }

    .survey-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px;
    }

    .back-link,
    .survey-header button {
      flex: 0 0 auto;
      color: var(--crm-text-secondary) !important;
    }

    .title-block {
      min-width: 0;
      flex: 1;
    }

    h1,
    h2,
    p {
      margin: 0;
    }

    h1 {
      font-size: 20px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0;
    }

    h2 {
      font-size: 14px;
      line-height: 1.2;
      font-weight: 800;
      letter-spacing: 0;
    }

    .title-block p,
    .detail-head p {
      margin-top: 2px;
      color: var(--crm-text-muted);
      font-size: 12px;
    }

    .filters {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px;
      min-width: 0;
      overflow-x: auto;
    }

    .search-field,
    .date-field {
      height: 36px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: var(--crm-surface-raised);
      color: var(--crm-text-secondary);
    }

    .search-field {
      min-width: 260px;
      flex: 1 1 320px;
      padding: 0 10px;
    }

    .date-field {
      flex: 0 0 auto;
      padding: 0 8px;
      font-size: 12px;
    }

    .search-field mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
      color: var(--crm-text-muted);
    }

    input {
      min-width: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--crm-text-primary);
      font: inherit;
    }

    input[type="search"] {
      width: 100%;
    }

    input[type="date"] {
      width: 130px;
      color-scheme: dark;
    }

    .status-strip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto;
      padding: 3px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-surface-raised) 86%, transparent);
      border: 1px solid var(--crm-border);
    }

    .status-filter {
      height: 28px;
      padding: 0 10px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--crm-text-secondary);
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }

    .status-filter--active {
      background: var(--crm-accent-muted);
      color: var(--crm-accent);
    }

    .summary-row {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 1px;
      overflow: hidden;
    }

    .summary-item {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 10px 12px;
      background: color-mix(in srgb, var(--crm-surface-raised) 68%, transparent);
    }

    .summary-value {
      font-size: 18px;
      font-weight: 800;
      line-height: 1.1;
      color: var(--crm-text-primary);
    }

    .summary-label {
      color: var(--crm-text-muted);
      font-size: 11px;
    }

    .survey-layout {
      display: grid;
      grid-template-columns: minmax(320px, 0.95fr) minmax(420px, 1.4fr) minmax(220px, 0.65fr);
      gap: 12px;
      min-height: 0;
      flex: 1;
    }

    .list-panel,
    .detail-panel,
    .topics-panel {
      min-width: 0;
      min-height: 0;
      padding: 12px;
      overflow: hidden;
    }

    .list-panel,
    .topics-panel {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .detail-panel {
      overflow-y: auto;
    }

    .panel-head,
    .detail-head,
    .response-top,
    .response-meta,
    .box-title,
    .term-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .panel-head > span {
      color: var(--crm-text-muted);
      font-size: 12px;
    }

    .response-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-height: 0;
      overflow-y: auto;
      padding-right: 2px;
    }

    .response-row {
      display: block;
      width: 100%;
      min-height: 82px;
      padding: 10px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-surface-raised) 76%, transparent);
      color: inherit;
      text-align: left;
      cursor: pointer;
    }

    .response-row--active {
      border-color: var(--crm-accent);
      background: color-mix(in srgb, var(--crm-accent-muted) 36%, var(--crm-surface-raised));
    }

    .client,
    .snippet,
    .response-meta span,
    .meta-grid strong {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .client {
      font-size: 13px;
      font-weight: 800;
    }

    .snippet {
      margin-top: 6px;
      color: var(--crm-text-secondary);
      font-size: 12px;
      line-height: 1.35;
    }

    .response-meta {
      margin-top: 8px;
      color: var(--crm-text-muted);
      font-size: 11px;
    }

    .status-badge {
      flex: 0 0 auto;
      padding: 3px 7px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      color: var(--crm-text-secondary);
      background: color-mix(in srgb, var(--crm-border) 70%, transparent);
    }

    .status-badge--pending,
    .status-badge--info {
      color: var(--crm-accent);
      background: var(--crm-accent-muted);
    }

    .status-badge--success {
      color: var(--crm-status-success);
      background: color-mix(in srgb, var(--crm-status-success) 14%, transparent);
    }

    .status-badge--warning {
      color: var(--crm-status-warning);
      background: color-mix(in srgb, var(--crm-status-warning) 16%, transparent);
    }

    .status-badge--error {
      color: var(--crm-status-error);
      background: color-mix(in srgb, var(--crm-status-error) 14%, transparent);
    }

    .pager {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      flex: 0 0 auto;
    }

    .detail-head {
      align-items: flex-start;
      margin-bottom: 12px;
    }

    .facts,
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .fact,
    .meta-grid > div,
    .transcript-box,
    .recording-box {
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-surface-raised) 76%, transparent);
    }

    .fact,
    .meta-grid > div {
      display: flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      padding: 10px;
    }

    .fact span,
    .meta-grid span {
      color: var(--crm-text-muted);
      font-size: 11px;
    }

    .fact strong,
    .meta-grid strong {
      color: var(--crm-text-primary);
      font-size: 12px;
    }

    .transcript-box,
    .recording-box {
      margin-top: 12px;
      padding: 12px;
    }

    .box-title {
      justify-content: flex-start;
      color: var(--crm-text-secondary);
      font-size: 12px;
      font-weight: 800;
      margin-bottom: 8px;
    }

    .box-title mat-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
      color: var(--crm-accent);
    }

    .transcript-box p {
      color: var(--crm-text-primary);
      font-size: 15px;
      line-height: 1.55;
      white-space: pre-wrap;
    }

    .transcript-box .muted {
      color: var(--crm-text-muted);
      font-size: 13px;
    }

    .recording-state {
      min-height: 36px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--crm-text-muted);
      font-size: 12px;
    }

    .recording-box .muted {
      color: var(--crm-text-muted);
      font-size: 13px;
    }

    audio {
      display: block;
      width: 100%;
      height: 36px;
    }

    .meta-grid {
      margin-top: 12px;
    }

    .term-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      overflow-y: auto;
      min-height: 0;
    }

    .term-row {
      min-height: 34px;
      padding: 7px 9px;
      border: 1px solid var(--crm-border);
      border-radius: 8px;
      background: color-mix(in srgb, var(--crm-surface-raised) 72%, transparent);
      font-size: 12px;
    }

    .term-row span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--crm-text-secondary);
    }

    .term-row strong {
      color: var(--crm-accent);
      font-size: 12px;
    }

    .state {
      min-height: 120px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--crm-text-muted);
      font-size: 13px;
      text-align: center;
    }

    .state--compact {
      min-height: 64px;
    }

    .state--error {
      color: var(--crm-status-error);
    }

    @media (max-width: 1180px) {
      .survey-layout {
        grid-template-columns: minmax(300px, 0.9fr) minmax(380px, 1.1fr);
      }

      .topics-panel {
        display: none;
      }
    }

    @media (max-width: 760px) {
      .survey-page {
        height: auto;
        min-height: 100%;
        overflow: visible;
        padding: 10px;
      }

      .filters {
        flex-wrap: wrap;
        overflow: visible;
      }

      .search-field {
        min-width: 100%;
      }

      .summary-row,
      .survey-layout,
      .facts,
      .meta-grid {
        grid-template-columns: 1fr;
      }

      .list-panel,
      .detail-panel {
        overflow: visible;
      }
    }
  `],
})
export class ServiceSurveysComponent {
  private readonly telephonyApi = inject(TelephonyApiService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly statusOptions: readonly StatusOption[] = [
    { value: 'all', label: 'Все' },
    { value: 'completed', label: 'Ответ' },
    { value: 'missed', label: 'Недозвон' },
    { value: 'failed', label: 'Ошибка' },
    { value: 'queued', label: 'Очередь' },
    { value: 'active', label: 'В разговоре' },
  ];

  protected readonly query = signal('');
  protected readonly fromDate = signal('');
  protected readonly toDate = signal('');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly offset = signal(0);
  protected readonly total = signal(0);
  protected readonly items = signal<ServiceSurveyResponseItem[]>([]);
  protected readonly selectedCallId = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly recordingObjectUrl = signal<string | null>(null);
  protected readonly recordingLoading = signal(false);
  protected readonly recordingError = signal<string | null>(null);
  private recordingObjectUrlValue: string | null = null;
  private recordingRequestId = 0;

  protected readonly selected = computed(() => {
    const selectedId = this.selectedCallId();
    return this.items().find(item => item.call_id === selectedId) || this.items()[0] || null;
  });

  protected readonly loadedWithTranscript = computed(() => (
    this.items().filter(item => Boolean(item.transcript_text?.trim())).length
  ));

  protected readonly loadedMissed = computed(() => (
    this.items().filter(item => item.status === 'missed').length
  ));

  protected readonly loadedFailed = computed(() => (
    this.items().filter(item => item.status === 'failed').length
  ));

  protected readonly topTerms = computed<SurveyTerm[]>(() => {
    const counts = new Map<string, number>();

    for (const item of this.items()) {
      const text = item.transcript_text?.toLowerCase() ?? '';
      const words = text
        .replace(/[^a-zа-яё0-9\s-]/giu, ' ')
        .split(/\s+/)
        .map(word => word.trim())
        .filter(word => word.length > 3 && !SURVEY_STOP_WORDS.has(word));

      for (const word of words) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'))
      .slice(0, 10);
  });

  protected readonly hasNextPage = computed(() => this.offset() + this.items().length < this.total());

  protected readonly pageRangeLabel = computed(() => {
    if (!this.total()) return '0';
    const from = this.offset() + 1;
    const to = this.offset() + this.items().length;
    return `${from}-${to} из ${this.total()}`;
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.revokeRecordingObjectUrl());
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    const status = this.statusFilter();
    this.telephonyApi.getServiceSurveyResponses({
      q: this.query().trim() || undefined,
      status: status === 'all' ? undefined : status,
      from: this.fromDate() || undefined,
      to: this.toDate() || undefined,
      limit: PAGE_SIZE,
      offset: this.offset(),
    }).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (res) => {
        const nextItems = res.success ? res.data : [];
        const currentSelected = this.selectedCallId();
        const nextSelectedCallId = nextItems.some(item => item.call_id === currentSelected)
          ? currentSelected
          : nextItems[0]?.call_id ?? null;
        this.items.set(nextItems);
        this.total.set(res.success ? res.total : 0);
        this.selectedCallId.set(nextSelectedCallId);
        this.loadRecording(nextItems.find(item => item.call_id === nextSelectedCallId) ?? null);
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.total.set(0);
        this.selectedCallId.set(null);
        this.loadRecording(null);
        this.error.set('Не удалось загрузить опросы');
        this.loading.set(false);
      },
    });
  }

  protected onQueryInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) this.query.set(target.value);
  }

  protected onFromDateInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) this.fromDate.set(target.value);
  }

  protected onToDateInput(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLInputElement) this.toDate.set(target.value);
  }

  protected setStatusFilter(status: StatusFilter): void {
    this.statusFilter.set(status);
    this.offset.set(0);
    this.load();
  }

  protected applyFilters(): void {
    this.offset.set(0);
    this.load();
  }

  protected resetFilters(): void {
    this.query.set('');
    this.fromDate.set('');
    this.toDate.set('');
    this.statusFilter.set('all');
    this.offset.set(0);
    this.load();
  }

  protected previousPage(): void {
    if (this.offset() === 0) return;
    this.offset.set(Math.max(0, this.offset() - PAGE_SIZE));
    this.load();
  }

  protected nextPage(): void {
    if (!this.hasNextPage()) return;
    this.offset.set(this.offset() + PAGE_SIZE);
    this.load();
  }

  protected select(item: ServiceSurveyResponseItem): void {
    this.selectedCallId.set(item.call_id);
    this.loadRecording(item);
  }

  protected displayPhone(item: ServiceSurveyResponseItem): string {
    return item.called_number || item.caller_number || 'Номер скрыт';
  }

  protected recordingUrl(item: ServiceSurveyResponseItem): string | null {
    return item.transcript_recording_url || item.call_recording_url;
  }

  protected statusLabel(status: string): string {
    switch (status) {
      case 'queued':
        return 'В очереди';
      case 'connecting':
      case 'ringing':
        return 'Дозвон';
      case 'active':
        return 'Разговор';
      case 'completed':
        return 'Ответ';
      case 'missed':
        return 'Недозвон';
      case 'failed':
        return 'Ошибка';
      default:
        return status;
    }
  }

  protected statusTone(status: string): 'pending' | 'info' | 'success' | 'warning' | 'error' {
    if (status === 'queued' || status === 'connecting' || status === 'ringing') return 'pending';
    if (status === 'active') return 'info';
    if (status === 'completed') return 'success';
    if (status === 'missed') return 'warning';
    return 'error';
  }

  protected transcriptPlaceholder(status: string): string {
    if (status === 'missed') return 'Клиент не ответил';
    if (status === 'failed') return 'Звонок не завершился';
    if (status === 'queued') return 'Ожидает запуска';
    if (status === 'active' || status === 'connecting' || status === 'ringing') return 'Звонок ещё идёт';
    return 'Расшифровка не сохранена';
  }

  protected formatDateTime(value: string | null): string {
    if (!value) return 'Нет даты';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Нет даты';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  protected formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} сек`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    return rest ? `${minutes} мин ${rest} сек` : `${minutes} мин`;
  }

  protected formatConfidence(value: number | null): string {
    if (value === null) return 'Нет';
    return `${Math.round(value * 100)}%`;
  }

  private loadRecording(item: ServiceSurveyResponseItem | null): void {
    const requestId = ++this.recordingRequestId;
    this.setRecordingObjectUrl(null);
    this.recordingError.set(null);

    if (!item || !this.recordingUrl(item)) {
      this.recordingLoading.set(false);
      return;
    }

    if (!this.isBrowser) {
      this.recordingLoading.set(false);
      return;
    }

    if (typeof URL.createObjectURL !== 'function') {
      this.recordingLoading.set(false);
      this.recordingError.set('Запись недоступна в этом режиме');
      return;
    }

    this.recordingLoading.set(true);
    this.telephonyApi.getServiceSurveyRecording(item.call_id).pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (blob) => {
        if (requestId !== this.recordingRequestId) return;
        this.setRecordingObjectUrl(URL.createObjectURL(blob));
        this.recordingLoading.set(false);
      },
      error: () => {
        if (requestId !== this.recordingRequestId) return;
        this.setRecordingObjectUrl(null);
        this.recordingError.set('Не удалось загрузить запись');
        this.recordingLoading.set(false);
      },
    });
  }

  private setRecordingObjectUrl(url: string | null): void {
    this.revokeRecordingObjectUrl();
    this.recordingObjectUrlValue = url;
    this.recordingObjectUrl.set(url);
  }

  private revokeRecordingObjectUrl(): void {
    if (this.recordingObjectUrlValue && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this.recordingObjectUrlValue);
    }
    this.recordingObjectUrlValue = null;
  }
}
