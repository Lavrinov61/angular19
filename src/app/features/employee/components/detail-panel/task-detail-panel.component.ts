import { Component, inject, input, output, effect, signal, ChangeDetectionStrategy, computed } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { FormsModule } from '@angular/forms';
import { TasksApiService, WorkTask, UpdateWorkTaskRequest } from '../../services/tasks-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ChatTimelineComponent } from '../task-detail/sections/chat-timeline.component';
import { TaskLinksComponent } from '../task-detail/sections/task-links.component';
import { ToastService } from '../../../../core/services/toast.service';
import { statusLabel, typeLabel, typeIcon, priorityLabel, channelIcon, formatRelativeTime } from '../../utils/crm-helpers';

interface Employee {
  id: string;
  display_name: string;
  role: string;
}

interface TaskEditDraft {
  title: string;
  description: string;
  priority: WorkTask['priority'];
  due_date: string;
  client_name: string;
  client_phone: string;
  client_channel: string;
}

@Component({
  selector: 'app-task-detail-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatButtonModule, MatIconModule, MatChipsModule,
    MatFormFieldModule, MatInputModule, MatDividerModule, MatMenuModule, MatSelectModule,
    FormsModule, ChatTimelineComponent, TaskLinksComponent,
  ],
  template: `
    @if (loading()) {
      <div class="skeleton-panel">
        <div class="sk-row"><div class="sk-bar sk-title"></div></div>
        <div class="sk-row"><div class="sk-bar sk-chip"></div><div class="sk-bar sk-chip"></div></div>
        <div class="sk-row"><div class="sk-bar sk-line"></div></div>
        <div class="sk-row"><div class="sk-bar sk-line short"></div></div>
        <div class="sk-row"><div class="sk-bar sk-block"></div></div>
      </div>
    } @else if (task()) {
      <div class="task-detail">
        <!-- Header -->
        <div class="task-header">
          <div class="task-title-row">
            <div class="task-title-main">
              <mat-icon class="type-icon">{{ typeIcon(task()!.task_type) }}</mat-icon>
              <span class="task-number">#{{ task()!.task_number }}</span>
              <h2>{{ task()!.title }}</h2>
            </div>
            @if (canEdit() && !editing()) {
              <button mat-icon-button type="button" class="edit-btn" (click)="startEdit()" aria-label="Редактировать задачу">
                <mat-icon>edit</mat-icon>
              </button>
            }
          </div>
          <div class="task-chips">
            <mat-chip [class]="'priority-' + task()!.priority">{{ priorityLabel(task()!.priority) }}</mat-chip>
            <mat-chip [class]="'status-' + task()!.status">{{ statusLabel(task()!.status) }}</mat-chip>
            <mat-chip>{{ typeLabel(task()!.task_type) }}</mat-chip>
          </div>
        </div>

        @if (editing()) {
          <form class="edit-form" (ngSubmit)="saveEdit()">
            <mat-form-field appearance="outline" class="full">
              <mat-label>Название</mat-label>
              <input matInput name="title" [ngModel]="editDraft().title" (ngModelChange)="updateDraftField('title', $event)" required>
            </mat-form-field>

            <div class="edit-grid">
              <mat-form-field appearance="outline">
                <mat-label>Приоритет</mat-label>
                <mat-select name="priority" [ngModel]="editDraft().priority" (ngModelChange)="updateDraftPriority($event)">
                  <mat-option value="low">Низкий</mat-option>
                  <mat-option value="normal">Обычный</mat-option>
                  <mat-option value="high">Высокий</mat-option>
                  <mat-option value="urgent">Срочный</mat-option>
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Срок</mat-label>
                <input matInput type="datetime-local" name="due_date" [ngModel]="editDraft().due_date" (ngModelChange)="updateDraftField('due_date', $event)">
              </mat-form-field>
            </div>

            <div class="edit-grid">
              <mat-form-field appearance="outline">
                <mat-label>Клиент</mat-label>
                <input matInput name="client_name" [ngModel]="editDraft().client_name" (ngModelChange)="updateDraftField('client_name', $event)">
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Телефон</mat-label>
                <input matInput name="client_phone" [ngModel]="editDraft().client_phone" (ngModelChange)="updateDraftField('client_phone', $event)">
              </mat-form-field>
            </div>

            <mat-form-field appearance="outline" class="full">
              <mat-label>Канал</mat-label>
              <input matInput name="client_channel" [ngModel]="editDraft().client_channel" (ngModelChange)="updateDraftField('client_channel', $event)">
            </mat-form-field>

            <mat-form-field appearance="outline" class="full">
              <mat-label>Описание</mat-label>
              <textarea matInput name="description" rows="4" [ngModel]="editDraft().description" (ngModelChange)="updateDraftField('description', $event)"></textarea>
            </mat-form-field>

            <div class="edit-actions">
              <button mat-flat-button type="submit" [disabled]="saving() || !editDraft().title.trim()">
                <mat-icon>save</mat-icon> Сохранить
              </button>
              <button mat-button type="button" [disabled]="saving()" (click)="cancelEdit()">Отмена</button>
            </div>
          </form>
        } @else {
          <!-- Client info -->
          @if (task()!.client_name || task()!.client_phone) {
            <div class="client-row">
              <mat-icon>person</mat-icon>
              <span>{{ task()!.client_name || 'Клиент' }}</span>
              @if (task()!.client_phone) {
                <a [href]="'tel:' + task()!.client_phone">{{ task()!.client_phone }}</a>
              }
              @if (task()!.client_channel) {
                <mat-icon class="ch-icon">{{ channelIcon(task()!.client_channel) }}</mat-icon>
              }
            </div>
          }

        <!-- Assignment & dates -->
        <div class="meta-row">
          @if (task()!.assigned_to_name) {
            <span class="meta-item"><mat-icon>person_outline</mat-icon> {{ task()!.assigned_to_name }}</span>
          }
          @if (task()!.due_date) {
            <span class="meta-item" [class.overdue]="isOverdue()">
              <mat-icon>schedule</mat-icon> {{ formatDate(task()!.due_date!) }}
            </span>
          }
          <span class="meta-item"><mat-icon>access_time</mat-icon> {{ formatRelativeTime(task()!.created_at) }}</span>
        </div>

        <!-- Description -->
        @if (task()!.description) {
          <mat-card appearance="outlined" class="desc-card">
            <mat-card-content>
              <pre class="desc-text">{{ task()!.description }}</pre>
            </mat-card-content>
          </mat-card>
        }

        <!-- AI Summary -->
        @if (task()!.ai_summary) {
          <mat-card appearance="outlined" class="ai-card">
            <mat-card-header>
              <mat-icon mat-card-avatar>smart_toy</mat-icon>
              <mat-card-title>AI-сводка</mat-card-title>
            </mat-card-header>
            <mat-card-content>
              <p>{{ task()!.ai_summary }}</p>
            </mat-card-content>
          </mat-card>
        }

        <!-- Actions -->
        <div class="actions">
          @if (!task()!.assigned_to) {
            <button mat-flat-button (click)="assignToMe()"><mat-icon>person_add</mat-icon> Взять</button>
          }

          <!-- Assign to other employee -->
          <button mat-stroked-button [matMenuTriggerFor]="assignMenu">
            <mat-icon>group_add</mat-icon> Назначить
          </button>
          <mat-menu #assignMenu="matMenu">
            @for (emp of employees(); track emp.id) {
              <button mat-menu-item (click)="assignTo(emp.id)"
                      [disabled]="emp.id === task()!.assigned_to">
                <mat-icon>{{ emp.role === 'photographer' ? 'camera_alt' : 'person' }}</mat-icon>
                <span>{{ emp.display_name }}</span>
              </button>
            }
            @if (!employees().length) {
              <button mat-menu-item disabled>Загрузка...</button>
            }
          </mat-menu>

          @if (task()!.status === 'assigned' || task()!.status === 'open') {
            <button mat-flat-button (click)="changeStatus('in_progress')"><mat-icon>play_arrow</mat-icon> В работу</button>
          }
          @if (task()!.status === 'in_progress') {
            <button mat-stroked-button (click)="changeStatus('waiting')"><mat-icon>pause</mat-icon> Ожидание</button>
            <button mat-flat-button (click)="changeStatus('completed')"><mat-icon>check</mat-icon> Готово</button>
          }
          @if (task()!.status === 'waiting') {
            <button mat-flat-button (click)="changeStatus('in_progress')"><mat-icon>play_arrow</mat-icon> Продолжить</button>
          }
        </div>

        <mat-divider />

        <!-- Handoff -->
        @if (task()!.assigned_to && !showHandoff()) {
          <button mat-stroked-button class="handoff-btn" (click)="showHandoff.set(true)">
            <mat-icon>swap_horiz</mat-icon> Передать задачу
          </button>
        }
        @if (showHandoff()) {
          <div class="handoff-section">
            <h3>Передать задачу</h3>
            <mat-form-field appearance="outline" class="note-field">
              <textarea matInput placeholder="Причина передачи / контекст..." [(ngModel)]="handoffNote" rows="2"></textarea>
            </mat-form-field>
            <div class="handoff-actions">
              <button mat-flat-button [disabled]="!handoffNote.trim()" (click)="handoff()">
                <mat-icon>swap_horiz</mat-icon> Передать
              </button>
              <button mat-button (click)="showHandoff.set(false)">Отмена</button>
            </div>
          </div>
        }

        <!-- Handoff history -->
        @if (task()!.handoffs?.length) {
          <div class="handoff-history">
            <h4>История передач</h4>
            @for (h of task()!.handoffs!; track h.id) {
              <div class="handoff-item">
                <mat-icon>swap_horiz</mat-icon>
                <div>
                  <span class="handoff-who">{{ h.from_name || 'Неизвестно' }} → {{ h.to_name || 'Любой' }}</span>
                  <p class="handoff-note">{{ h.handoff_note }}</p>
                  @if (h.ai_context_summary) {
                    <p class="handoff-ai"><mat-icon>smart_toy</mat-icon> {{ h.ai_context_summary }}</p>
                  }
                  <span class="handoff-time">{{ formatRelativeTime(h.created_at) }}</span>
                </div>
              </div>
            }
          </div>
        }
        }

        <mat-divider />

        <!-- Notes -->
        <div class="notes-section">
          <h3>Заметки</h3>
          @for (note of task()!.notes || []; track note.id) {
            <div class="note-item" [class]="'note-' + note.note_type">
              <div class="note-header">
                <span class="note-author">{{ note.author_name || 'Система' }}</span>
                <span class="note-time">{{ formatRelativeTime(note.created_at) }}</span>
              </div>
              <p class="note-content">{{ note.content }}</p>
            </div>
          }
          <div class="add-note">
            <mat-form-field appearance="outline" class="note-field">
              <textarea matInput placeholder="Добавить заметку..." [(ngModel)]="noteText" rows="2"></textarea>
            </mat-form-field>
            <button mat-stroked-button [disabled]="!noteText.trim()" (click)="addNote()">
              <mat-icon>add_comment</mat-icon> Добавить
            </button>
          </div>
        </div>

        <!-- Linked tasks -->
        <app-task-links [taskId]="task()!.id" />

        <!-- Chat timeline -->
        @if (task()!.chat_links?.length) {
          <app-chat-timeline [taskId]="task()!.id" />
        }
      </div>
    }
  `,
  styles: [`
    :host { display: block; padding: 16px; }

    .skeleton-panel { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
    .sk-row { display: flex; gap: 8px; }
    .sk-bar {
      height: 14px;
      border-radius: var(--crm-radius-sm);
      background: linear-gradient(90deg, var(--crm-skeleton-base) 25%, var(--crm-skeleton-shine) 50%, var(--crm-skeleton-base) 75%);
      background-size: 400px 100%;
      animation: crmShimmer 1.5s infinite linear;
    }
    @keyframes crmShimmer { from { background-position: -200px 0; } to { background-position: 200px 0; } }
    .sk-title { width: 60%; height: 20px; }
    .sk-chip { width: 64px; height: 22px; border-radius: 11px; }
    .sk-line { width: 100%; }
    .sk-line.short { width: 40%; }
    .sk-block { width: 100%; height: 80px; border-radius: var(--crm-radius-md); }

    .task-header { margin-bottom: 12px; }
    .task-title-row { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px; }
    .task-title-main { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
    .task-title-row h2 { margin: 0; font-size: 18px; font-weight: 600; overflow-wrap: anywhere; }
    .edit-btn { flex-shrink: 0; color: var(--crm-text-muted); }
    .type-icon { color: var(--crm-accent); }
    .task-number { font-size: var(--crm-text-base); color: var(--crm-text-muted); font-family: var(--crm-font-mono); }
    .task-chips { display: flex; gap: 6px; flex-wrap: wrap; }

    mat-chip[class*="priority-"], mat-chip[class*="status-"] {
      font-size: var(--crm-text-sm);
      font-weight: 500;
      border-radius: var(--crm-radius-sm);
    }

    .priority-urgent { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
    .priority-high { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    .status-in_progress { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
    .status-waiting { background: var(--crm-status-error-muted); color: var(--crm-status-error); }

    .client-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      font-size: var(--crm-text-md);

      a { color: var(--crm-accent); text-decoration: none; }
      .ch-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .meta-row {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      padding: 4px 0 12px;
    }

    .meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: var(--crm-text-base);
      color: var(--crm-text-secondary);

      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &.overdue { color: var(--crm-status-error); }
    }

    .desc-card { margin-bottom: 12px; }
    .desc-text { white-space: pre-wrap; font-family: inherit; margin: 0; font-size: var(--crm-text-md); }

    .ai-card { margin-bottom: 12px; background: var(--crm-accent-muted); border-left: 3px solid var(--crm-accent); }
    .ai-card p { margin: 0; font-size: var(--crm-text-md); }

    .edit-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 4px 0 12px;
    }

    .edit-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 10px;
    }

    .full { width: 100%; }
    .edit-form ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    .edit-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 12px 0;
    }

    .handoff-btn { margin: 8px 0; }

    .handoff-section {
      padding: 12px 0;

      h3 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }
    }

    .handoff-actions { display: flex; gap: 8px; }

    .handoff-history {
      padding: 8px 0;

      h4 { font-size: var(--crm-text-base); font-weight: 600; margin: 0 0 8px; color: var(--crm-text-muted); }
    }

    .handoff-item {
      display: flex;
      gap: 8px;
      padding: 6px 0;
      font-size: var(--crm-text-base);

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); margin-top: 2px; }
    }

    .handoff-who { font-weight: 500; }
    .handoff-note { margin: 2px 0; color: var(--crm-text-secondary); }
    .handoff-ai {
      margin: 2px 0;
      font-style: italic;
      color: var(--crm-text-secondary);
      display: flex;
      align-items: center;
      gap: 4px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .handoff-time { font-size: var(--crm-text-sm); color: var(--crm-text-muted); }

    .notes-section { padding: 12px 0; }
    .notes-section h3 { font-size: 15px; font-weight: 600; margin: 0 0 8px; }

    .note-item {
      padding: 8px;
      border-radius: var(--crm-radius-md);
      margin-bottom: 6px;
      background: var(--crm-surface-raised);

      &.note-system { opacity: 0.7; font-style: italic; }
    }

    .note-header { display: flex; justify-content: space-between; font-size: 12px; color: var(--crm-text-muted); }
    .note-content { margin: 4px 0 0; font-size: var(--crm-text-md); }

    .add-note { display: flex; gap: 8px; align-items: flex-start; }
    .note-field { flex: 1; }
    .note-field ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }

    mat-divider { margin: 8px 0; }

    @media (max-width: 520px) {
      .edit-grid { grid-template-columns: 1fr; }
    }
  `],
})
export class TaskDetailPanelComponent {
  private readonly tasksApi = inject(TasksApiService);
  private readonly authService = inject(AuthService);
  private readonly toast = inject(ToastService);

  taskId = input.required<string>();
  clientPhoneResolved = output<string>();

  task = signal<WorkTask | null>(null);
  loading = signal(false);
  employees = signal<Employee[]>([]);
  showHandoff = signal(false);
  editing = signal(false);
  saving = signal(false);
  editDraft = signal<TaskEditDraft>(this.createEmptyDraft());
  noteText = '';
  handoffNote = '';

  readonly canEdit = computed(() => {
    const currentTask = this.task();
    const user = this.authService.currentUser();
    if (!currentTask || !user || currentTask.status === 'completed' || currentTask.status === 'cancelled') return false;
    return user.role === 'admin'
      || user.role === 'manager'
      || currentTask.created_by === user.id
      || currentTask.assigned_to === user.id;
  });

  // Reuse helpers
  readonly statusLabel = statusLabel;
  readonly typeLabel = typeLabel;
  readonly typeIcon = typeIcon;
  readonly priorityLabel = priorityLabel;
  readonly channelIcon = channelIcon;
  readonly formatRelativeTime = formatRelativeTime;

  private readonly loadEffect = effect(() => {
    const id = this.taskId();
    if (id) {
      this.loadTask(id);
      this.showHandoff.set(false);
      this.editing.set(false);
      this.saving.set(false);
      this.handoffNote = '';
    }
  });

  constructor() {
    this.loadEmployees();
  }

  private loadEmployees(): void {
    this.tasksApi.getEmployees().subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.employees.set(res.data);
        }
      },
    });
  }

  private loadTask(id: string): void {
    this.loading.set(true);
    this.tasksApi.getTask(id).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.task.set(res.data);
          if (res.data.client_phone) {
            this.clientPhoneResolved.emit(res.data.client_phone);
          }
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.toast.error('Не удалось загрузить задачу');
      },
    });
  }

  assignToMe(): void {
    this.tasksApi.assignTask(this.taskId(), 'self').subscribe({
      next: () => {
        this.loadTask(this.taskId());
        this.toast.success('Задача назначена вам');
      },
      error: () => this.toast.error('Не удалось назначить задачу'),
    });
  }

  assignTo(employeeId: string): void {
    this.tasksApi.assignTask(this.taskId(), employeeId).subscribe({
      next: () => {
        this.loadTask(this.taskId());
        const emp = this.employees().find(e => e.id === employeeId);
        this.toast.success(`Задача назначена: ${emp?.display_name || 'сотрудник'}`);
      },
      error: () => this.toast.error('Не удалось назначить задачу'),
    });
  }

  handoff(): void {
    if (!this.handoffNote.trim()) return;
    this.tasksApi.handoffTask(this.taskId(), this.handoffNote.trim()).subscribe({
      next: () => {
        this.handoffNote = '';
        this.showHandoff.set(false);
        this.loadTask(this.taskId());
        this.toast.success('Задача передана');
      },
      error: () => this.toast.error('Не удалось передать задачу'),
    });
  }

  changeStatus(status: string): void {
    this.tasksApi.updateStatus(this.taskId(), status).subscribe({
      next: () => {
        this.loadTask(this.taskId());
        this.toast.success('Статус обновлён');
      },
      error: () => this.toast.error('Не удалось обновить статус'),
    });
  }

  startEdit(): void {
    const currentTask = this.task();
    if (!currentTask) return;
    this.editDraft.set({
      title: currentTask.title,
      description: currentTask.description ?? '',
      priority: currentTask.priority,
      due_date: this.toDateTimeLocal(currentTask.due_date),
      client_name: currentTask.client_name ?? '',
      client_phone: currentTask.client_phone ?? '',
      client_channel: currentTask.client_channel ?? '',
    });
    this.showHandoff.set(false);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
    this.saving.set(false);
  }

  saveEdit(): void {
    const draft = this.editDraft();
    const title = draft.title.trim();
    if (!title) return;

    const payload: UpdateWorkTaskRequest = {
      title,
      description: this.emptyToNull(draft.description),
      priority: draft.priority,
      due_date: draft.due_date ? new Date(draft.due_date).toISOString() : null,
      client_name: this.emptyToNull(draft.client_name),
      client_phone: this.emptyToNull(draft.client_phone),
      client_channel: this.emptyToNull(draft.client_channel),
    };

    this.saving.set(true);
    this.tasksApi.updateTask(this.taskId(), payload).subscribe({
      next: () => {
        this.editing.set(false);
        this.saving.set(false);
        this.loadTask(this.taskId());
        this.toast.success('Задача обновлена');
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Не удалось обновить задачу');
      },
    });
  }

  updateDraftField(field: Exclude<keyof TaskEditDraft, 'priority'>, value: string): void {
    this.editDraft.update(draft => ({ ...draft, [field]: value }));
  }

  updateDraftPriority(priority: WorkTask['priority']): void {
    this.editDraft.update(draft => ({ ...draft, priority }));
  }

  addNote(): void {
    if (!this.noteText.trim()) return;
    this.tasksApi.addNote(this.taskId(), this.noteText.trim()).subscribe({
      next: () => {
        this.noteText = '';
        this.loadTask(this.taskId());
        this.toast.success('Заметка добавлена');
      },
      error: () => this.toast.error('Не удалось добавить заметку'),
    });
  }

  isOverdue(): boolean {
    const due = this.task()?.due_date;
    return due ? new Date(due) < new Date() : false;
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private createEmptyDraft(): TaskEditDraft {
    return {
      title: '',
      description: '',
      priority: 'normal',
      due_date: '',
      client_name: '',
      client_phone: '',
      client_channel: '',
    };
  }

  private emptyToNull(value: string): string | null {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  private toDateTimeLocal(value: string | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }
}
