import {
  Component, inject, signal, ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DatePipe, JsonPipe } from '@angular/common';
import {
  WorkflowsApiService,
  Workflow,
  WorkflowCondition,
  WorkflowAction,
  WorkflowRun,
  TriggerType,
  ActionType,
  ConditionOp,
} from '../../services/workflows-api.service';

// ── Metadata ─────────────────────────────────────────────────

const TRIGGERS: { value: TriggerType; label: string; icon: string; desc: string }[] = [
  { value: 'order_paid',         label: 'Заказ оплачен',        icon: 'payments',        desc: 'При получении оплаты за заказ' },
  { value: 'chat_created',       label: 'Новый чат',            icon: 'chat_bubble',     desc: 'При создании нового чата с посетителем' },
  { value: 'chat_closed',        label: 'Чат закрыт',           icon: 'chat_bubble_outline', desc: 'При закрытии чата оператором' },
  { value: 'booking_completed',  label: 'Запись выполнена',     icon: 'event_available', desc: 'После завершения записи' },
  { value: 'manual',             label: 'Ручной запуск',        icon: 'play_circle',     desc: 'Запускается вручную из интерфейса' },
];

const CONDITION_FIELDS: { value: string; label: string; type: 'number' | 'text' }[] = [
  { value: 'amount',        label: 'Сумма заказа (₽)',   type: 'number' },
  { value: 'channel',       label: 'Канал чата',          type: 'text' },
  { value: 'client_phone',  label: 'Телефон клиента',     type: 'text' },
  { value: 'status',        label: 'Статус',              type: 'text' },
];

const CONDITION_OPS: { value: ConditionOp; label: string; numOnly: boolean }[] = [
  { value: 'eq',          label: '=',               numOnly: false },
  { value: 'neq',         label: '≠',               numOnly: false },
  { value: 'gt',          label: '>',               numOnly: true },
  { value: 'gte',         label: '≥',               numOnly: true },
  { value: 'lt',          label: '<',               numOnly: true },
  { value: 'lte',         label: '≤',               numOnly: true },
  { value: 'contains',    label: 'содержит',        numOnly: false },
  { value: 'starts_with', label: 'начинается с',    numOnly: false },
];

const ACTION_TYPES: { value: ActionType; label: string; icon: string }[] = [
  { value: 'create_task',   label: 'Создать задачу',      icon: 'task_alt' },
  { value: 'notify_team',   label: 'Уведомить команду',   icon: 'notifications' },
  { value: 'send_email',    label: 'Отправить email',      icon: 'email' },
  { value: 'add_note',      label: 'Добавить заметку',    icon: 'note_add' },
  { value: 'set_tag',       label: 'Поставить тег',       icon: 'label' },
];

// ── Component ─────────────────────────────────────────────────

type ViewMode = 'list' | 'form' | 'runs';

interface FormState {
  name: string;
  description: string;
  trigger_type: TriggerType;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  is_active: boolean;
}

function emptyForm(): FormState {
  return {
    name: '',
    description: '',
    trigger_type: 'order_paid',
    conditions: [],
    actions: [],
    is_active: true,
  };
}

function emptyCondition(): WorkflowCondition {
  return { field: 'amount', op: 'gte', value: 0 };
}

function emptyAction(): WorkflowAction {
  return { type: 'create_task', params: { title: 'Задача из workflow' }, delay_seconds: 0 };
}

@Component({
  selector: 'app-workflow-builder',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatTooltipModule, DatePipe, JsonPipe],
  template: `
<div class="wb-page">
  <!-- Header -->
  <div class="wb-header">
    <div class="wb-header-left">
      @if (view() !== 'list') {
        <button class="btn-icon" (click)="backToList()" matTooltip="Назад">
          <mat-icon>arrow_back</mat-icon>
        </button>
      }
      <h2 class="wb-title">
        @if (view() === 'list')  { Автоматизации }
        @if (view() === 'form')  { {{ editingId() ? 'Редактировать' : 'Создать' }} workflow }
        @if (view() === 'runs')  { История запусков }
      </h2>
    </div>
    @if (view() === 'list') {
      <button class="btn-primary" (click)="openCreate()">
        <mat-icon>add</mat-icon> Создать
      </button>
    }
    @if (view() === 'form') {
      <button class="btn-primary" [disabled]="saving()" (click)="save()">
        <mat-icon>{{ saving() ? 'hourglass_empty' : 'save' }}</mat-icon>
        {{ saving() ? 'Сохранение…' : 'Сохранить' }}
      </button>
    }
  </div>

  <!-- Error banner -->
  @if (error()) {
    <div class="wb-error">
      <mat-icon>error</mat-icon> {{ error() }}
      <button class="btn-icon btn-close" (click)="error.set(null)">
        <mat-icon>close</mat-icon>
      </button>
    </div>
  }

  <!-- ── List View ─────────────────────────────────────── -->
  @if (view() === 'list') {
    @if (loading()) {
      <div class="wb-loading"><mat-icon class="spin">sync</mat-icon> Загрузка…</div>
    } @else if (workflows().length === 0) {
      <div class="wb-empty">
        <mat-icon>automation</mat-icon>
        <p>Нет автоматизаций. Создайте первый workflow!</p>
        <button class="btn-primary" (click)="openCreate()">Создать workflow</button>
      </div>
    } @else {
      <div class="wb-list">
        @for (wf of workflows(); track wf.id) {
          <div class="wb-card" [class.wb-card--inactive]="!wf.is_active">
            <div class="wb-card-top">
              <div class="wb-card-icon">
                <mat-icon>{{ getTriggerIcon(wf.trigger_type) }}</mat-icon>
              </div>
              <div class="wb-card-info">
                <div class="wb-card-name">{{ wf.name }}</div>
                @if (wf.description) {
                  <div class="wb-card-desc">{{ wf.description }}</div>
                }
                <div class="wb-card-meta">
                  <span class="tag tag--trigger">{{ getTriggerLabel(wf.trigger_type) }}</span>
                  <span class="tag">{{ wf.actions.length || 0 }} действ.</span>
                  @if (wf.conditions.length) {
                    <span class="tag">{{ wf.conditions.length }} усл.</span>
                  }
                </div>
              </div>
              <div class="wb-card-stats">
                <div class="stat">
                  <span class="stat-val">{{ wf.total_runs ?? wf.run_count }}</span>
                  <span class="stat-key">запусков</span>
                </div>
                @if (wf.last_run_at) {
                  <div class="wb-last-run">{{ wf.last_run_at | date:'dd.MM HH:mm' }}</div>
                }
              </div>
            </div>
            <div class="wb-card-actions">
              <button class="btn-sm" (click)="toggleActive(wf)"
                      [matTooltip]="wf.is_active ? 'Деактивировать' : 'Активировать'">
                <mat-icon>{{ wf.is_active ? 'pause_circle' : 'play_circle' }}</mat-icon>
                {{ wf.is_active ? 'Активен' : 'Неактивен' }}
              </button>
              <button class="btn-sm" (click)="openRuns(wf)" matTooltip="История запусков">
                <mat-icon>history</mat-icon>
              </button>
              <button class="btn-sm" (click)="openEdit(wf)" matTooltip="Редактировать">
                <mat-icon>edit</mat-icon>
              </button>
              @if (wf.trigger_type === 'manual' || true) {
                <button class="btn-sm btn-sm--accent" (click)="runNow(wf)" matTooltip="Запустить сейчас">
                  <mat-icon>play_arrow</mat-icon>
                </button>
              }
              <button class="btn-sm btn-sm--danger" (click)="deleteWorkflow(wf)" matTooltip="Удалить">
                <mat-icon>delete</mat-icon>
              </button>
            </div>
          </div>
        }
      </div>
    }
  }

  <!-- ── Form View ─────────────────────────────────────── -->
  @if (view() === 'form') {
    <div class="wb-form">
      <!-- Basic info -->
      <section class="wb-section">
        <h3 class="section-title">Основное</h3>
        <div class="form-row">
          <span class="form-label" aria-label="Название">Название *</span>
          <input class="form-input" [(ngModel)]="form.name" placeholder="Запрос отзыва после оплаты" />
        </div>
        <div class="form-row">
          <span class="form-label" aria-label="Описание">Описание</span>
          <input class="form-input" [(ngModel)]="form.description" placeholder="Опционально" />
        </div>
        <div class="form-row">
          <span class="form-label" aria-label="Статус">Статус</span>
          <span class="toggle-label">
            <input type="checkbox" class="toggle" [(ngModel)]="form.is_active" />
            <span class="toggle-text">{{ form.is_active ? 'Активен' : 'Неактивен' }}</span>
          </span>
        </div>
      </section>

      <!-- Trigger -->
      <section class="wb-section">
        <h3 class="section-title">
          <mat-icon>bolt</mat-icon> Триггер — когда запускать?
        </h3>
        <div class="trigger-grid">
          @for (t of triggers; track t.value) {
            <button class="trigger-btn"
                    [class.trigger-btn--active]="form.trigger_type === t.value"
                    (click)="form.trigger_type = t.value">
              <mat-icon>{{ t.icon }}</mat-icon>
              <span class="trigger-label">{{ t.label }}</span>
              <span class="trigger-desc">{{ t.desc }}</span>
            </button>
          }
        </div>
      </section>

      <!-- Conditions -->
      <section class="wb-section">
        <div class="section-header">
          <h3 class="section-title">
            <mat-icon>filter_alt</mat-icon> Условия
            <span class="section-hint">(все должны выполняться)</span>
          </h3>
          <button class="btn-sm" (click)="addCondition()">
            <mat-icon>add</mat-icon> Добавить
          </button>
        </div>

        @if (form.conditions.length === 0) {
          <p class="empty-hint">Без условий workflow запускается при каждом событии</p>
        }

        @for (cond of form.conditions; track $index) {
          <div class="cond-row">
            <select class="form-select cond-field" [(ngModel)]="cond.field">
              @for (f of conditionFields; track f.value) {
                <option [value]="f.value">{{ f.label }}</option>
              }
            </select>
            <select class="form-select cond-op" [(ngModel)]="cond.op">
              @for (op of getOpsForField(cond.field); track op.value) {
                <option [value]="op.value">{{ op.label }}</option>
              }
            </select>
            <input class="form-input cond-val"
                   [type]="getFieldType(cond.field)"
                   [(ngModel)]="cond.value"
                   placeholder="значение" />
            <button class="btn-icon btn-del" (click)="removeCondition($index)" matTooltip="Удалить">
              <mat-icon>remove_circle</mat-icon>
            </button>
          </div>
        }
      </section>

      <!-- Actions -->
      <section class="wb-section">
        <div class="section-header">
          <h3 class="section-title">
            <mat-icon>play_circle</mat-icon> Действия *
          </h3>
          <button class="btn-sm" (click)="addAction()">
            <mat-icon>add</mat-icon> Добавить
          </button>
        </div>

        @if (form.actions.length === 0) {
          <p class="empty-hint wb-error-hint">Добавьте хотя бы одно действие</p>
        }

        @for (action of form.actions; track $index) {
          <div class="action-card">
            <div class="action-header">
              <span class="action-num">{{ $index + 1 }}</span>
              <select class="form-select" [(ngModel)]="action.type" (ngModelChange)="onActionTypeChange($index)">
                @for (a of actionTypes; track a.value) {
                  <option [value]="a.value">{{ a.label }}</option>
                }
              </select>
              <div class="action-delay">
                <mat-icon class="delay-icon">timer</mat-icon>
                <input class="form-input delay-input" type="number" min="0"
                       [(ngModel)]="action.delay_seconds"
                       placeholder="0" />
                <span class="delay-unit">сек</span>
              </div>
              <button class="btn-icon btn-del" (click)="removeAction($index)" matTooltip="Удалить">
                <mat-icon>remove_circle</mat-icon>
              </button>
            </div>

            <!-- Action params -->
            @if (action.type === 'create_task') {
              <div class="action-params">
                <div class="form-row-inline">
                  <span class="form-label-sm" aria-label="Заголовок задачи">Заголовок задачи</span>
                  <input class="form-input" [(ngModel)]="action.params['title']"
                         placeholder="Запросить отзыв у клиента" />
                </div>
                <div class="form-row-inline">
                  <span class="form-label-sm" aria-label="Приоритет">Приоритет</span>
                  <select class="form-select" [(ngModel)]="action.params['priority']">
                    <option value="low">Низкий</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий</option>
                  </select>
                </div>
              </div>
            }

            @if (action.type === 'notify_team') {
              <div class="action-params">
                <div class="form-row-inline">
                  <span class="form-label-sm" aria-label="Сообщение">Сообщение</span>
                  <input class="form-input" [(ngModel)]="action.params['message']"
                         placeholder="Новый заказ от клиента" />
                </div>
              </div>
            }

            @if (action.type === 'send_email') {
              <div class="action-params">
                <div class="form-row-inline">
                  <span class="form-label-sm" aria-label="Кому">Кому</span>
                  <input class="form-input" [(ngModel)]="action.params['to']"
                         placeholder="studio@example.com" />
                </div>
                <div class="form-row-inline">
                  <span class="form-label-sm" aria-label="Тема">Тема</span>
                  <input class="form-input" [(ngModel)]="action.params['subject']"
                         placeholder="Новый заказ" />
                </div>
              </div>
            }

            @if (action.type === 'add_note') {
              <div class="action-params">
                <div class="form-row-inline">
                  <span class="form-label-sm" aria-label="Текст заметки">Текст заметки</span>
                  <input class="form-input" [(ngModel)]="action.params['content']"
                         placeholder="Клиент оплатил заказ" />
                </div>
              </div>
            }

            @if (action.type === 'set_tag') {
              <div class="action-params">
                <div class="form-row-inline">
                  <span class="form-label-sm" aria-label="Тег">Тег</span>
                  <input class="form-input" [(ngModel)]="action.params['tag']"
                         placeholder="vip_client" />
                </div>
              </div>
            }
          </div>
        }
      </section>
    </div>
  }

  <!-- ── Runs View ──────────────────────────────────────── -->
  @if (view() === 'runs') {
    @if (runsLoading()) {
      <div class="wb-loading"><mat-icon class="spin">sync</mat-icon> Загрузка…</div>
    } @else if (runs().length === 0) {
      <div class="wb-empty">
        <mat-icon>history</mat-icon>
        <p>Нет запусков для этого workflow</p>
      </div>
    } @else {
      <div class="runs-list">
        @for (run of runs(); track run.id) {
          <div class="run-row" [class]="'run-row--' + run.status">
            <mat-icon class="run-icon">{{ getRunIcon(run.status) }}</mat-icon>
            <div class="run-info">
              <div class="run-status">
                {{ getRunStatusLabel(run.status) }}
                @if (run.error_message) {
                  <span class="run-error">— {{ run.error_message }}</span>
                }
              </div>
              <div class="run-time">
                {{ run.created_at | date:'dd.MM.yyyy HH:mm:ss' }}
                @if (run.completed_at && run.started_at) {
                  <span class="run-duration">
                    {{ getDuration(run.started_at, run.completed_at) }}
                  </span>
                }
              </div>
            </div>
            <div class="run-payload" [title]="run.trigger_data | json">
              @for (key of getPayloadKeys(run.trigger_data); track key) {
                <span class="tag">{{ key }}: {{ run.trigger_data[key] }}</span>
              }
            </div>
          </div>
        }
      </div>
    }
  }
</div>
  `,
  styles: [`
    .wb-page { max-width: 900px; margin: 0 auto; padding: 16px; }

    .wb-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px; gap: 12px;
    }
    .wb-header-left { display: flex; align-items: center; gap: 8px; }
    .wb-title { font-size: 20px; font-weight: 600; color: var(--crm-text-primary); margin: 0; }

    /* Buttons */
    .btn-primary {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer;
      background: var(--crm-accent); color: #fff; font-size: 14px; font-weight: 500;
      transition: opacity 0.15s;
      &:hover { opacity: 0.85; } &:disabled { opacity: 0.5; cursor: default; }
    }
    .btn-sm {
      display: inline-flex; align-items: center; gap: 4px;
      padding: 5px 10px; border-radius: 6px; border: 1px solid var(--crm-border);
      background: var(--crm-surface-hover); color: var(--crm-text-primary);
      cursor: pointer; font-size: 13px; transition: background 0.15s;
      &:hover { background: var(--crm-surface-active); }
    }
    .btn-sm--accent { border-color: var(--crm-accent); color: var(--crm-accent); }
    .btn-sm--danger { border-color: #ef4444; color: #ef4444; }
    .btn-icon {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 6px; border: none;
      background: transparent; cursor: pointer; color: var(--crm-text-secondary);
      transition: background 0.15s, color 0.15s;
      &:hover { background: var(--crm-surface-hover); color: var(--crm-text-primary); }
    }
    .btn-del { color: #ef4444; &:hover { background: rgba(239,68,68,0.1); } }
    .btn-close { width: 24px; height: 24px; }

    /* Error */
    .wb-error {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-radius: 8px; margin-bottom: 16px;
      background: rgba(239,68,68,0.1); color: #ef4444; font-size: 14px;
    }

    /* Loading / empty */
    .wb-loading {
      display: flex; align-items: center; gap: 8px; justify-content: center;
      padding: 48px; color: var(--crm-text-secondary);
    }
    .wb-empty {
      text-align: center; padding: 60px 20px;
      color: var(--crm-text-secondary);
      mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 16px; }
      p { margin: 0 0 20px; font-size: 16px; }
    }
    .spin { animation: spin 1s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Workflow List */
    .wb-list { display: flex; flex-direction: column; gap: 12px; }
    .wb-card {
      border: 1px solid var(--crm-border); border-radius: 10px;
      background: var(--crm-surface); padding: 16px;
      transition: border-color 0.15s;
      &:hover { border-color: var(--crm-accent); }
    }
    .wb-card--inactive { opacity: 0.6; }
    .wb-card-top { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
    .wb-card-icon {
      width: 40px; height: 40px; border-radius: 8px;
      background: rgba(139,92,246,0.1); display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      mat-icon { color: var(--crm-accent); }
    }
    .wb-card-info { flex: 1; min-width: 0; }
    .wb-card-name { font-weight: 600; color: var(--crm-text-primary); margin-bottom: 2px; }
    .wb-card-desc { font-size: 13px; color: var(--crm-text-secondary); margin-bottom: 6px; }
    .wb-card-meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .wb-card-stats { text-align: right; flex-shrink: 0; }
    .stat { display: flex; flex-direction: column; align-items: flex-end; }
    .stat-val { font-size: 18px; font-weight: 600; color: var(--crm-text-primary); }
    .stat-key { font-size: 11px; color: var(--crm-text-secondary); }
    .wb-last-run { font-size: 11px; color: var(--crm-text-secondary); margin-top: 4px; }
    .wb-card-actions { display: flex; gap: 8px; flex-wrap: wrap; }

    /* Tags */
    .tag {
      display: inline-flex; padding: 2px 8px; border-radius: 99px; font-size: 11px;
      background: var(--crm-surface-hover); color: var(--crm-text-secondary);
    }
    .tag--trigger { background: rgba(139,92,246,0.12); color: var(--crm-accent); }

    /* Form */
    .wb-form { display: flex; flex-direction: column; gap: 20px; }
    .wb-section {
      border: 1px solid var(--crm-border); border-radius: 10px;
      padding: 16px; background: var(--crm-surface);
    }
    .section-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
    }
    .section-title {
      display: flex; align-items: center; gap: 6px;
      font-size: 15px; font-weight: 600; color: var(--crm-text-primary); margin: 0 0 12px;
    }
    .section-hint { font-size: 12px; font-weight: 400; color: var(--crm-text-secondary); }
    .form-row { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
    .form-row-inline { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
    .form-label { font-size: 13px; color: var(--crm-text-secondary); font-weight: 500; }
    .form-label-sm { font-size: 12px; color: var(--crm-text-secondary); white-space: nowrap; min-width: 100px; }
    .form-input, .form-select {
      padding: 8px 10px; border-radius: 6px;
      border: 1px solid var(--crm-border); background: var(--crm-bg);
      color: var(--crm-text-primary); font-size: 14px; outline: none;
      &:focus { border-color: var(--crm-accent); }
    }
    .form-input { flex: 1; }
    .empty-hint { color: var(--crm-text-secondary); font-size: 13px; font-style: italic; margin: 0; }
    .wb-error-hint { color: #ef4444; }

    /* Triggers grid */
    .trigger-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 8px; }
    .trigger-btn {
      display: flex; flex-direction: column; align-items: center; gap: 4px;
      padding: 12px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-surface-hover); cursor: pointer; text-align: center;
      transition: border-color 0.15s, background 0.15s;
      mat-icon { color: var(--crm-text-secondary); }
    }
    .trigger-btn--active {
      border-color: var(--crm-accent); background: rgba(139,92,246,0.08);
      mat-icon { color: var(--crm-accent); }
    }
    .trigger-label { font-size: 13px; font-weight: 500; color: var(--crm-text-primary); }
    .trigger-desc { font-size: 11px; color: var(--crm-text-secondary); line-height: 1.3; }

    /* Conditions */
    .cond-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
    .cond-field { min-width: 160px; }
    .cond-op { min-width: 100px; }
    .cond-val { max-width: 140px; }

    /* Actions */
    .action-card {
      border: 1px solid var(--crm-border); border-radius: 8px;
      padding: 12px; margin-bottom: 10px; background: var(--crm-surface-hover);
    }
    .action-header { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
    .action-num {
      width: 22px; height: 22px; border-radius: 50%; background: var(--crm-accent);
      color: #fff; font-size: 12px; font-weight: 600;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .action-delay { display: flex; align-items: center; gap: 4px; margin-left: auto; }
    .delay-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-secondary); }
    .delay-input { width: 64px; min-width: 64px; }
    .delay-unit { font-size: 12px; color: var(--crm-text-secondary); white-space: nowrap; }
    .action-params { padding-top: 8px; border-top: 1px solid var(--crm-border); }

    /* Toggle */
    .toggle-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
    .toggle { width: 40px; height: 22px; appearance: none; background: var(--crm-border);
      border-radius: 99px; position: relative; cursor: pointer; transition: background 0.2s;
      &:checked { background: var(--crm-accent); }
      &::before { content: ''; position: absolute; width: 18px; height: 18px;
        border-radius: 50%; background: #fff; top: 2px; left: 2px; transition: transform 0.2s; }
      &:checked::before { transform: translateX(18px); }
    }
    .toggle-text { font-size: 14px; color: var(--crm-text-primary); }

    /* Runs */
    .runs-list { display: flex; flex-direction: column; gap: 8px; }
    .run-row {
      display: flex; gap: 12px; align-items: flex-start;
      padding: 12px; border-radius: 8px; border: 1px solid var(--crm-border);
      background: var(--crm-surface);
    }
    .run-row--completed { border-left: 3px solid #10b981; }
    .run-row--failed    { border-left: 3px solid #ef4444; }
    .run-row--pending   { border-left: 3px solid #f59e0b; }
    .run-row--running   { border-left: 3px solid var(--crm-accent); }
    .run-row--skipped   { border-left: 3px solid var(--crm-border); }
    .run-icon { font-size: 20px; width: 20px; height: 20px; flex-shrink: 0; margin-top: 2px; }
    .run-info { flex: 1; }
    .run-status { font-size: 14px; font-weight: 500; color: var(--crm-text-primary); }
    .run-error { color: #ef4444; font-weight: 400; }
    .run-time { font-size: 12px; color: var(--crm-text-secondary); margin-top: 2px; }
    .run-duration { margin-left: 8px; }
    .run-payload { display: flex; gap: 4px; flex-wrap: wrap; align-items: flex-start; }
  `],
})
export class WorkflowBuilderComponent {
  private readonly api = inject(WorkflowsApiService);

  // ── Metadata ─────────────────────────────────────────────
  readonly triggers = TRIGGERS;
  readonly conditionFields = CONDITION_FIELDS;
  readonly conditionOps = CONDITION_OPS;
  readonly actionTypes = ACTION_TYPES;

  // ── State ────────────────────────────────────────────────
  readonly view = signal<ViewMode>('list');
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly runsLoading = signal(false);
  readonly error = signal<string | null>(null);

  readonly workflows = signal<Workflow[]>([]);
  readonly runs = signal<WorkflowRun[]>([]);

  readonly editingId = signal<number | null>(null);
  readonly runsWorkflowId = signal<number | null>(null);

  form: FormState = emptyForm();

  constructor() {
    this.loadList();
  }

  // ── List ──────────────────────────────────────────────────

  loadList(): void {
    this.loading.set(true);
    this.api.list().subscribe({
      next: (wfs) => { this.workflows.set(wfs); this.loading.set(false); },
      error: (e) => { this.error.set(e?.error?.error || 'Ошибка загрузки'); this.loading.set(false); },
    });
  }

  // ── Navigation ────────────────────────────────────────────

  openCreate(): void {
    this.editingId.set(null);
    this.form = emptyForm();
    this.view.set('form');
  }

  openEdit(wf: Workflow): void {
    this.editingId.set(wf.id);
    this.form = {
      name: wf.name,
      description: wf.description || '',
      trigger_type: wf.trigger_type,
      conditions: JSON.parse(JSON.stringify(wf.conditions || [])),
      actions: JSON.parse(JSON.stringify(wf.actions || [])),
      is_active: wf.is_active,
    };
    this.view.set('form');
  }

  openRuns(wf: Workflow): void {
    this.runsWorkflowId.set(wf.id);
    this.view.set('runs');
    this.runsLoading.set(true);
    this.api.getRuns(wf.id).subscribe({
      next: ({ data }) => { this.runs.set(data); this.runsLoading.set(false); },
      error: (e) => { this.error.set(e?.error?.error || 'Ошибка загрузки истории'); this.runsLoading.set(false); },
    });
  }

  backToList(): void {
    this.view.set('list');
    this.error.set(null);
    this.loadList();
  }

  // ── Form ──────────────────────────────────────────────────

  addCondition(): void {
    this.form.conditions = [...this.form.conditions, emptyCondition()];
  }

  removeCondition(i: number): void {
    this.form.conditions = this.form.conditions.filter((_, idx) => idx !== i);
  }

  addAction(): void {
    this.form.actions = [...this.form.actions, emptyAction()];
  }

  removeAction(i: number): void {
    this.form.actions = this.form.actions.filter((_, idx) => idx !== i);
  }

  onActionTypeChange(i: number): void {
    const type = this.form.actions[i].type;
    const defaults: Record<ActionType, Record<string, unknown>> = {
      create_task:  { title: 'Задача из workflow', priority: 'medium' },
      notify_team:  { message: 'Уведомление от workflow' },
      send_email:   { to: '', subject: 'Уведомление' },
      add_note:     { content: 'Заметка от workflow' },
      set_tag:      { tag: '' },
    };
    this.form.actions[i].params = defaults[type] || {};
  }

  save(): void {
    if (!this.form.name.trim()) { this.error.set('Название обязательно'); return; }
    if (this.form.actions.length === 0) { this.error.set('Добавьте хотя бы одно действие'); return; }

    this.saving.set(true);
    this.error.set(null);

    const payload = {
      name: this.form.name.trim(),
      description: this.form.description.trim() || null,
      trigger_type: this.form.trigger_type,
      conditions: this.form.conditions,
      actions: this.form.actions,
      is_active: this.form.is_active,
    };

    const req$ = this.editingId()
      ? this.api.update(this.editingId()!, payload)
      : this.api.create(payload);

    req$.subscribe({
      next: () => { this.saving.set(false); this.backToList(); },
      error: (e) => { this.error.set(e?.error?.error || 'Ошибка сохранения'); this.saving.set(false); },
    });
  }

  // ── Actions ───────────────────────────────────────────────

  toggleActive(wf: Workflow): void {
    this.api.update(wf.id, { is_active: !wf.is_active }).subscribe({
      next: (updated) => {
        this.workflows.update(list => list.map(w => w.id === updated.id ? updated : w));
      },
      error: (e) => this.error.set(e?.error?.error || 'Ошибка'),
    });
  }

  runNow(wf: Workflow): void {
    this.api.run(wf.id).subscribe({
      next: () => this.loadList(),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка запуска'),
    });
  }

  deleteWorkflow(wf: Workflow): void {
    if (!confirm(`Удалить workflow «${wf.name}»? История запусков также будет удалена.`)) return;
    this.api.delete(wf.id).subscribe({
      next: () => this.workflows.update(list => list.filter(w => w.id !== wf.id)),
      error: (e) => this.error.set(e?.error?.error || 'Ошибка удаления'),
    });
  }

  // ── Helpers ───────────────────────────────────────────────

  getTriggerIcon(type: TriggerType): string {
    return TRIGGERS.find(t => t.value === type)?.icon || 'bolt';
  }

  getTriggerLabel(type: TriggerType): string {
    return TRIGGERS.find(t => t.value === type)?.label || type;
  }

  getOpsForField(field: string): typeof CONDITION_OPS {
    const isNum = CONDITION_FIELDS.find(f => f.value === field)?.type === 'number';
    return isNum ? CONDITION_OPS : CONDITION_OPS.filter(op => !op.numOnly);
  }

  getFieldType(field: string): string {
    return CONDITION_FIELDS.find(f => f.value === field)?.type || 'text';
  }

  getRunIcon(status: string): string {
    return { completed: 'check_circle', failed: 'error', pending: 'hourglass_empty',
             running: 'sync', skipped: 'skip_next' }[status] || 'help';
  }

  getRunStatusLabel(status: string): string {
    return { completed: 'Выполнен', failed: 'Ошибка', pending: 'Ожидает',
             running: 'Выполняется', skipped: 'Пропущен' }[status] || status;
  }

  getDuration(start: string, end: string): string {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    if (ms < 1000) return `${ms}мс`;
    return `${(ms / 1000).toFixed(1)}с`;
  }

  getPayloadKeys(data: Record<string, unknown>): string[] {
    return Object.keys(data || {}).slice(0, 3);
  }
}
