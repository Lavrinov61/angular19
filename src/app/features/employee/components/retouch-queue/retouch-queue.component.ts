import {
  Component, ChangeDetectionStrategy, inject,
  signal, computed, effect, DestroyRef, afterNextRender, OnDestroy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatBadgeModule } from '@angular/material/badge';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RetouchApiService, RetouchTask, RetouchOption } from '../../services/retouch-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { WebSocketService } from '../../../../core/services/websocket.service';

/** View-модель для сгруппированного рендера опций ретуши в шаблоне. */
interface RetouchOptionItemView { key: string; label: string; }
interface RetouchOptionGroupView { key: string; name: string; items: RetouchOptionItemView[]; }

@Component({
  selector: 'app-retouch-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatCardModule, MatButtonModule, MatButtonToggleModule,
    MatIconModule, MatBadgeModule, MatCheckboxModule, MatChipsModule,
    MatProgressSpinnerModule, MatTooltipModule,
  ],
  template: `
    <div class="retouch-queue">
      <div class="queue-header">
        <h2>
          <mat-icon>brush</mat-icon>
          Очередь ретуши
          @if (tasks().length) {
            <span class="count-badge">{{ tasks().length }}</span>
          }
        </h2>
        <button mat-icon-button (click)="selectionMode.set(!selectionMode())" matTooltip="Выбрать несколько">
          <mat-icon>checklist</mat-icon>
        </button>
        <button mat-stroked-button (click)="loadTasks()">
          <mat-icon>refresh</mat-icon>
        </button>
      </div>

      <mat-button-toggle-group [value]="activeTab()" (change)="activeTab.set($event.value)" class="tab-group">
        <mat-button-toggle value="my">
          Мои
          @if (counts().my) {
            <span class="tab-badge">{{ counts().my }}</span>
          }
        </mat-button-toggle>
        <mat-button-toggle value="pending">
          Свободные
          @if (counts().pending) {
            <span class="tab-badge">{{ counts().pending }}</span>
          }
        </mat-button-toggle>
        <mat-button-toggle value="waiting">
          На согласовании
          @if (counts().waiting) {
            <span class="tab-badge">{{ counts().waiting }}</span>
          }
        </mat-button-toggle>
      </mat-button-toggle-group>

      @if (selectionMode()) {
        <div class="bulk-bar">
          <mat-checkbox
            [checked]="allSelected()"
            [indeterminate]="selectedIds().length > 0 && !allSelected()"
            (change)="toggleSelectAll($event.checked)">
            Выбрано: {{ selectedIds().length }}
          </mat-checkbox>

          <span class="bulk-spacer"></span>

          <button mat-stroked-button (click)="bulkAssignDialog()" [disabled]="selectedIds().length === 0">
            <mat-icon>person_add</mat-icon> Назначить
          </button>
          <button mat-stroked-button color="warn" (click)="bulkCancel()" [disabled]="selectedIds().length === 0">
            <mat-icon>cancel</mat-icon> Отменить
          </button>
          <button mat-icon-button (click)="selectionMode.set(false); selectedIds.set([])">
            <mat-icon>close</mat-icon>
          </button>
        </div>
      }

      @if (loading()) {
        <div class="loading">
          <mat-spinner diameter="32"></mat-spinner>
          <span>Загрузка...</span>
        </div>
      } @else if (!filteredTasks().length) {
        <div class="empty-state">
          <mat-icon>check_circle_outline</mat-icon>
          <p>{{ emptyMessage() }}</p>
        </div>
      } @else {
        @for (task of filteredTasks(); track task.id) {
          <mat-card class="task-card" [class.urgent]="task.priority === 'urgent'">
            <div class="task-row">
              @if (selectionMode()) {
                <mat-checkbox
                  [checked]="selectedIds().includes(task.id)"
                  (change)="toggleSelect(task.id, $event.checked)"
                  (click)="$event.stopPropagation()" />
              }
              <div class="task-thumb">
                @if (task.source_photo_url) {
                  <img [src]="task.source_photo_url" alt="Исходник" />
                } @else {
                  <mat-icon>image</mat-icon>
                }
              </div>
              <div class="task-info">
                <div class="task-title">
                  {{ task.title || 'Задача #' + task.task_number }}
                </div>
                <div class="task-meta">
                  @if (task.client_name) {
                    <span class="meta-item">{{ task.client_name }}</span>
                  }
                  <mat-icon class="meta-icon">auto_fix_high</mat-icon>
                  <span class="level-chip" [class]="'level-' + task.retouch_level">
                    {{ levelLabel(task.retouch_level) }}
                  </span>
                </div>
                @if (task.retouch_options.length) {
                  <div class="task-options">
                    @for (grp of groupedOptions(task.retouch_options); track grp.key) {
                      @if (grp.name) {
                        <span class="option-group">
                          <span class="option-group-name">{{ grp.name }}:</span>
                          @for (opt of grp.items; track opt.key) {
                            <span class="option-chip">{{ opt.label }}</span>
                          }
                        </span>
                      } @else {
                        @for (opt of grp.items; track opt.key) {
                          <span class="option-chip">{{ opt.label }}</span>
                        }
                      }
                    }
                  </div>
                }
              </div>
              <div class="task-right">
                @if (task.priority === 'urgent') {
                  <span class="priority-badge urgent">Срочно</span>
                }
                @if (task.due_date) {
                  <span class="deadline">
                    <mat-icon>schedule</mat-icon>
                    {{ formatDeadline(task.due_date) }}
                  </span>
                }
                <span class="status-chip" [class]="'status-' + task.status">
                  {{ statusLabel(task.status) }}
                </span>
              </div>
              <div class="task-actions">
                @if (task.status === 'open' || task.status === 'assigned') {
                  <button mat-flat-button color="accent" (click)="startTask(task); $event.stopPropagation()">
                    <mat-icon>play_arrow</mat-icon>
                    Приступить
                  </button>
                } @else {
                  <button mat-stroked-button (click)="openTask(task)">
                    <mat-icon>open_in_new</mat-icon>
                    Открыть
                  </button>
                }
              </div>
            </div>
          </mat-card>
        }
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .retouch-queue { padding: 16px; max-width: 900px; margin: 0 auto; }
    .queue-header {
      display: flex; align-items: center; gap: 8px;
      justify-content: space-between; margin-bottom: 16px;
    }
    .queue-header h2 {
      display: flex; align-items: center; gap: 8px;
      margin: 0; font-size: 20px; color: var(--mat-sys-on-surface);
    }
    .count-badge {
      background: var(--mat-sys-primary); color: var(--mat-sys-on-primary);
      border-radius: 12px; padding: 2px 8px; font-size: 12px;
    }
    .tab-group { margin-bottom: 16px; width: 100%; }
    .tab-badge {
      background: var(--mat-sys-primary); color: var(--mat-sys-on-primary);
      border-radius: 10px; padding: 1px 6px; font-size: 11px; margin-left: 4px;
    }
    .loading {
      display: flex; align-items: center; gap: 12px;
      padding: 32px; justify-content: center;
      color: var(--mat-sys-on-surface-variant);
    }
    .empty-state {
      display: flex; flex-direction: column; align-items: center;
      padding: 48px; color: var(--mat-sys-outline); gap: 8px;
    }
    .empty-state mat-icon { font-size: 48px; height: 48px; width: 48px; }

    .task-card {
      margin-bottom: 10px;
      border-left: 4px solid var(--mat-sys-outline-variant);
      cursor: pointer;
      transition: border-color .15s;
      &:hover { border-left-color: var(--mat-sys-primary); }
      &.urgent { border-left-color: var(--mat-sys-error); }
    }
    .task-row {
      display: flex; align-items: center; gap: 12px; padding: 12px;
    }
    .task-thumb {
      width: 44px; height: 44px; border-radius: 6px; overflow: hidden;
      flex-shrink: 0; background: var(--mat-sys-surface-variant);
      display: flex; align-items: center; justify-content: center;
      img { width: 100%; height: 100%; object-fit: cover; }
      mat-icon { color: var(--mat-sys-outline); }
    }
    .task-info { flex: 1; min-width: 0; }
    .task-title {
      font-size: 14px; font-weight: 500;
      color: var(--mat-sys-on-surface);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .task-meta {
      display: flex; align-items: center; gap: 6px;
      margin-top: 4px; font-size: 12px; color: var(--mat-sys-on-surface-variant);
    }
    .meta-item { margin-right: 4px; }
    .meta-icon { font-size: 14px; width: 14px; height: 14px; }
    .level-chip {
      padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 500;
    }
    .level-basic {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .level-extended {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .level-maximum {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .level-super {
      background: linear-gradient(135deg, #b8860b 0%, #ffd700 50%, #b8860b 100%);
      color: #2b1d00; font-weight: 700;
      box-shadow: 0 0 0 1px rgba(255, 215, 0, .4);
    }
    .task-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
    .option-group {
      display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px;
    }
    .option-group-name {
      font-size: 11px; font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
    }
    .option-chip {
      font-size: 11px; padding: 1px 6px; border-radius: 4px;
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    .task-right {
      display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
      flex-shrink: 0;
    }
    .priority-badge {
      font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 500;
      &.urgent {
        background: var(--mat-sys-error-container);
        color: var(--mat-sys-on-error-container);
      }
    }
    .deadline {
      display: flex; align-items: center; gap: 4px;
      font-size: 12px; color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }
    .status-chip {
      font-size: 11px; padding: 2px 8px; border-radius: 4px;
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }
    .status-in_progress {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
    .status-waiting {
      background: var(--mat-sys-tertiary-container);
      color: var(--mat-sys-on-tertiary-container);
    }
    .status-completed {
      background: rgba(52, 211, 153, .15);
      color: #34d399;
    }
    .task-actions { flex-shrink: 0; }

    .bulk-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: var(--mat-sys-surface-container);
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .bulk-spacer { flex: 1; }
  `],
})
export class RetouchQueueComponent implements OnDestroy {
  private readonly api = inject(RetouchApiService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly ws = inject(WebSocketService);

  readonly tasks = signal<RetouchTask[]>([]);
  readonly loading = signal(false);
  readonly activeTab = signal<'my' | 'pending' | 'waiting'>('my');
  readonly selectedIds = signal<readonly string[]>([]);
  readonly selectionMode = signal(false);
  readonly allSelected = computed(() => {
    const filtered = this.filteredTasks();
    const selected = this.selectedIds();
    return filtered.length > 0 && filtered.every(t => selected.includes(t.id));
  });

  private refreshInterval?: ReturnType<typeof setInterval>;

  readonly filteredTasks = computed(() => {
    const tab = this.activeTab();
    const all = this.tasks();
    switch (tab) {
      case 'my':
        return all.filter(t => t.status === 'in_progress' || t.status === 'assigned');
      case 'pending':
        return all.filter(t => t.status === 'open');
      case 'waiting':
        return all.filter(t => t.status === 'waiting');
      default:
        return all;
    }
  });

  readonly counts = computed(() => {
    const all = this.tasks();
    return {
      my: all.filter(t => t.status === 'in_progress' || t.status === 'assigned').length,
      pending: all.filter(t => t.status === 'open').length,
      waiting: all.filter(t => t.status === 'waiting').length,
    };
  });

  readonly emptyMessage = computed(() => {
    switch (this.activeTab()) {
      case 'my': return 'Нет задач в работе';
      case 'pending': return 'Нет свободных задач';
      case 'waiting': return 'Нет задач на согласовании';
      default: return 'Нет задач';
    }
  });

  constructor() {
    afterNextRender(() => {
      this.loadTasks();
      this.refreshInterval = setInterval(() => this.loadTasks(), 30000);
    });

    // Real-time updates via WebSocket
    effect(() => {
      const event = this.ws.retouchQueueEvent();
      if (event) {
        this.loadTasks();
      }
    });
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  loadTasks(): void {
    this.loading.set(true);
    this.api.getQueue()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: res => {
          this.tasks.set(res.data);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  startTask(task: RetouchTask): void {
    this.api.start(task.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Задача взята в работу');
          this.router.navigate(['/employee', 'retouch-queue', task.id]);
        },
        error: () => this.toast.error('Не удалось взять задачу'),
      });
  }

  openTask(task: RetouchTask): void {
    this.router.navigate(['/employee', 'retouch-queue', task.id]);
  }

  levelLabel(level: string): string {
    const labels: Record<string, string> = {
      basic: 'Базовая', extended: 'Расширенная', maximum: 'Максимальная', super: 'Супер',
    };
    return labels[level] ?? level;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      open: 'Открыта', assigned: 'Назначена', in_progress: 'В работе',
      waiting: 'Согласование', completed: 'Завершена', cancelled: 'Отменена',
    };
    return labels[status] ?? status;
  }

  /**
   * Группирует опции ретуши по group_name для объектного формата
   * {group, group_name, slug, label}. Для исторического строкового формата
   * (или объектов без group_name) — единая группа без заголовка (плоский вывод).
   */
  groupedOptions(options: readonly RetouchOption[]): RetouchOptionGroupView[] {
    const groups: RetouchOptionGroupView[] = [];
    const byKey = new Map<string, RetouchOptionGroupView>();
    options.forEach((opt, index) => {
      const isObj = typeof opt === 'object' && opt !== null;
      const groupName = isObj ? (opt.group_name ?? '') : '';
      const groupKey = isObj ? (opt.group ?? opt.group_name ?? '') : '';
      const label = isObj ? (opt.label ?? opt.slug ?? '') : opt;
      const itemKey = isObj ? (opt.slug ?? `i${index}`) : `s${index}`;
      // ключ группы: для плоского формата всегда '' → одна общая группа
      const mapKey = groupName ? `${groupKey}|${groupName}` : '';
      let group = byKey.get(mapKey);
      if (!group) {
        group = { key: mapKey || 'flat', name: groupName, items: [] };
        byKey.set(mapKey, group);
        groups.push(group);
      }
      group.items.push({ key: itemKey, label });
    });
    return groups;
  }

  toggleSelect(id: string, checked: boolean): void {
    this.selectedIds.update(prev =>
      checked ? [...prev, id] : prev.filter(x => x !== id),
    );
  }

  toggleSelectAll(checked: boolean): void {
    if (checked) {
      this.selectedIds.set(this.filteredTasks().map(t => t.id));
    } else {
      this.selectedIds.set([]);
    }
  }

  bulkCancel(): void {
    const ids = this.selectedIds();
    this.api.bulkCancel([...ids]).subscribe(() => {
      this.selectedIds.set([]);
      this.selectionMode.set(false);
      this.loadTasks();
    });
  }

  bulkAssignDialog(): void {
    // MVP: prompt for retoucher selection — will be replaced with mat-menu
    this.toast.info('Выберите ретушёра для назначения');
  }

  formatDeadline(dateStr: string): string {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const hours = Math.floor(diff / 3600000);
    if (hours < 0) return 'Просрочено';
    if (hours < 1) return `${Math.floor(diff / 60000)} мин`;
    if (hours < 24) return `${hours} ч`;
    return `${Math.floor(hours / 24)} дн`;
  }
}
