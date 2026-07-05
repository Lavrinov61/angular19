import { Component, inject, output, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatRippleModule } from '@angular/material/core';
import { DashboardDataService } from '../../services/dashboard-data.service';
import { statusLabel, typeIcon, priorityLabel } from '../../utils/crm-helpers';
import { WorkTask } from '../../services/tasks-api.service';

type TaskTab = 'assigned' | 'created';

@Component({
  selector: 'app-dashboard-my-tasks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatRippleModule],
  template: `
    <div class="section-card">
      <div class="section-header">
        <mat-icon>checklist</mat-icon>
        <h4>Мои задачи</h4>
        <span class="section-count">{{ activeTasks().length }}</span>
      </div>

      <div class="task-tabs" role="tablist" aria-label="Фильтр задач">
        <button type="button" role="tab" [class.active]="activeTab() === 'assigned'" (click)="setTab('assigned')">
          <mat-icon>assignment_ind</mat-icon>
          <span>Мне</span>
          <b>{{ assignedCount() }}</b>
        </button>
        <button type="button" role="tab" [class.active]="activeTab() === 'created'" (click)="setTab('created')">
          <mat-icon>outgoing_mail</mat-icon>
          <span>Поставил</span>
          <b>{{ createdCount() }}</b>
        </button>
      </div>

      @if (activeTasks().length) {
        <div class="task-list">
          @for (t of activeTasks(); track t.id) {
            <div class="task-item" matRipple (click)="openTask(t)" (keydown.enter)="openTask(t)" tabindex="0"
                 [class.urgent]="t.priority === 'urgent'"
                 [class.overdue]="isOverdue(t)">
              <mat-icon class="task-type-icon">{{ getTypeIcon(t.task_type) }}</mat-icon>
              <div class="task-info">
                <span class="task-title">
                  <span class="task-num">#{{ t.task_number }}</span>
                  {{ t.title }}
                </span>
                <span class="task-meta">
                  {{ taskMeta(t) }}
                </span>
              </div>
              <div class="task-right">
                @if (t.priority === 'urgent' || t.priority === 'high') {
                  <span class="priority-badge" [class]="'p-' + t.priority">
                    {{ getPriorityLabel(t.priority) }}
                  </span>
                }
                <span class="task-status" [class]="'s-' + t.status">
                  {{ getStatusLabel(t.status) }}
                </span>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="empty-compact">
          <mat-icon>task_alt</mat-icon>
          <span>{{ emptyText() }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .section-card {
      background: var(--crm-gradient-card);
      backdrop-filter: blur(var(--crm-glass-blur));
      -webkit-backdrop-filter: blur(var(--crm-glass-blur));
      border-radius: var(--crm-radius-lg);
      border: 1px solid var(--crm-glass-border);
      box-shadow: var(--crm-shadow-card);
      overflow: hidden;
    }

    .section-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 14px 8px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--crm-status-warning); }
      h4 { margin: 0; font-size: 13px; font-weight: 600; flex: 1; }
    }

    .section-count {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;
      background: var(--crm-status-warning-muted);
      color: var(--crm-status-warning);
    }

    .task-tabs {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px;
      padding: 8px 10px 4px;

      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 5px;
        min-width: 0;
        height: 28px;
        border: 1px solid var(--crm-glass-border);
        border-radius: var(--crm-radius-sm);
        background: var(--crm-surface);
        color: var(--crm-text-muted);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition:
          background var(--crm-transition-fast),
          color var(--crm-transition-fast),
          border-color var(--crm-transition-fast);

        mat-icon { font-size: 15px; width: 15px; height: 15px; }
        b { color: inherit; font-size: 10px; }

        &.active {
          color: var(--crm-accent);
          border-color: var(--crm-accent);
          background: var(--crm-accent-muted);
        }
      }
    }

    .task-list { padding: 4px 6px 8px; }

    .task-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 8px;
      border-radius: var(--crm-radius-md);
      cursor: pointer;
      transition:
        background var(--crm-transition-fast),
        transform var(--crm-transition-spring);

      &:hover {
        background: var(--crm-surface-hover);
        transform: translateX(2px);
      }
      &.urgent { border-left: 3px solid var(--crm-status-error); }
      &.overdue { border-left: 3px solid var(--crm-status-error); }
    }

    .task-type-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);
      flex-shrink: 0;
    }

    .task-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }

    .task-title {
      font-size: 13px;
      font-weight: 500;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .task-num {
      font-weight: 600;
      color: var(--crm-accent);
      margin-right: 4px;
    }

    .task-meta {
      font-size: 11px;
      color: var(--crm-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .task-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
      flex-shrink: 0;
    }

    .priority-badge {
      font-size: 9px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 8px;
      text-transform: uppercase;

      &.p-urgent { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
      &.p-high { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
    }

    .task-status {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 10px;

      &.s-open { background: var(--crm-status-info-muted); color: var(--crm-status-info); }
      &.s-assigned { background: var(--crm-status-warning-muted); color: var(--crm-status-warning); }
      &.s-in_progress { background: var(--crm-status-success-muted); color: var(--crm-status-success); }
      &.s-waiting { background: var(--crm-status-error-muted); color: var(--crm-status-error); }
      &.s-handed_off { background: var(--crm-accent-muted); color: var(--crm-accent); }
    }

    .empty-compact {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 14px;
      color: var(--crm-text-muted);

      mat-icon { font-size: 16px; width: 16px; height: 16px; opacity: 0.5; }
      span { font-size: 12px; }
    }
  `],
})
export class DashboardMyTasksComponent {
  readonly dashData = inject(DashboardDataService);
  selectItem = output<{ type: string; id: string }>();
  readonly activeTab = signal<TaskTab>('assigned');
  readonly assignedCount = computed(() => this.dashData.assignedTasks().length);
  readonly createdCount = computed(() => this.dashData.createdTasks().length);
  readonly activeTasks = computed(() => this.activeTab() === 'assigned'
    ? this.dashData.assignedTasks()
    : this.dashData.createdTasks());

  setTab(tab: TaskTab): void {
    this.activeTab.set(tab);
  }

  openTask(task: WorkTask): void {
    this.selectItem.emit({ type: 'task', id: task.id });
  }

  isOverdue(task: WorkTask): boolean {
    if (!task.due_date) return false;
    return new Date(task.due_date) < new Date();
  }

  getTypeIcon(type: string): string { return typeIcon(type); }
  getStatusLabel(status: string): string { return statusLabel(status); }
  getPriorityLabel(priority: string): string { return priorityLabel(priority); }

  taskMeta(task: WorkTask): string {
    const parts: string[] = [];
    if (this.activeTab() === 'created' && task.assigned_to_name) {
      parts.push(`Исполнитель: ${task.assigned_to_name}`);
    } else if (task.client_name) {
      parts.push(task.client_name);
    }
    if (task.studio_name) parts.push(task.studio_name);
    return parts.join(' · ');
  }

  emptyText(): string {
    return this.activeTab() === 'created'
      ? 'Нет поставленных активных задач'
      : 'Нет активных задач';
  }
}
