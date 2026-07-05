import { Component, inject, input, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TasksApiService, TaskLink } from '../../../services/tasks-api.service';

@Component({
  selector: 'app-task-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, FormsModule, MatCardModule, MatButtonModule, MatIconModule,
            MatChipsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatTooltipModule],
  template: `
    <mat-card class="links-card">
      <mat-card-header>
        <mat-icon mat-card-avatar>link</mat-icon>
        <mat-card-title>Связанные задачи</mat-card-title>
        @if (links().length > 0) {
          <mat-card-subtitle>{{ links().length }}</mat-card-subtitle>
        }
      </mat-card-header>

      <mat-card-content>
        @for (link of links(); track link.link_id) {
          <div class="link-item">
            <a [routerLink]="['/employee/tasks', link.id]" class="link-task">
              <span class="link-type-badge" [class]="'lt-' + link.link_type">{{ linkTypeLabel(link.link_type) }}</span>
              #{{ link.task_number }} {{ link.title }}
            </a>
            <div class="link-meta">
              <mat-chip [class]="'priority-' + link.priority" class="mini-chip">{{ link.priority }}</mat-chip>
              <span class="link-status">{{ link.status }}</span>
              @if (link.assigned_to_name) { <span class="link-assignee">{{ link.assigned_to_name }}</span> }
            </div>
            <div class="link-actions">
              @if (link.link_type === 'duplicate') {
                <button mat-icon-button matTooltip="Склеить" (click)="mergeTask(link.id)">
                  <mat-icon>merge</mat-icon>
                </button>
              }
              <button mat-icon-button (click)="unlinkTask(link.link_id)">
                <mat-icon>link_off</mat-icon>
              </button>
            </div>
          </div>
        }

        @if (links().length === 0 && !showLinkForm()) {
          <p class="no-links">Нет связанных задач</p>
        }

        <!-- Link form -->
        @if (showLinkForm()) {
          <div class="link-form">
            <mat-form-field appearance="outline" class="task-id-field">
              <mat-label>Номер задачи</mat-label>
              <input matInput [(ngModel)]="targetTaskNumber" type="number" placeholder="123">
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Тип связи</mat-label>
              <mat-select [(ngModel)]="linkType">
                <mat-option value="related">Связана</mat-option>
                <mat-option value="duplicate">Дубликат</mat-option>
                <mat-option value="parent_child">Родитель-потомок</mat-option>
              </mat-select>
            </mat-form-field>
            <button mat-flat-button color="primary" (click)="submitLink()" [disabled]="!targetTaskNumber">
              <mat-icon>link</mat-icon> Привязать
            </button>
            <button mat-button (click)="showLinkForm.set(false)">Отмена</button>
          </div>
          @if (linkError()) {
            <p class="link-error">{{ linkError() }}</p>
          }
        }
      </mat-card-content>

      <mat-card-actions>
        @if (!showLinkForm()) {
          <button mat-button (click)="showLinkForm.set(true)">
            <mat-icon>add_link</mat-icon> Привязать задачу
          </button>
        }
      </mat-card-actions>
    </mat-card>
  `,
  styles: [`
    .links-card { margin-bottom: 12px; }
    .link-item { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--mat-sys-outline-variant); flex-wrap: wrap; }
    .link-item:last-child { border-bottom: none; }
    .link-task { color: var(--mat-sys-primary); text-decoration: none; font-size: 13px; }
    .link-task:hover { text-decoration: underline; }
    .link-type-badge { font-size: 10px; padding: 2px 6px; border-radius: 4px; margin-right: 4px; font-weight: 600; }
    .lt-related { background: var(--crm-status-info-container); color: var(--crm-status-info); }
    .lt-duplicate { background: var(--crm-status-warning-container); color: var(--crm-status-warning); }
    .lt-parent_child { background: var(--crm-accent-container); color: var(--crm-accent); }
    .lt-merged { background: var(--crm-status-success-container); color: var(--crm-status-success); }
    .link-meta { display: flex; gap: 6px; align-items: center; font-size: 11px; }
    .mini-chip { font-size: 10px; min-height: 18px; padding: 0 6px; }
    .link-status { color: var(--mat-sys-on-surface-variant); }
    .link-assignee { color: var(--mat-sys-on-surface-variant); }
    .link-actions { margin-left: auto; display: flex; }
    .no-links { color: var(--mat-sys-on-surface-variant); font-style: italic; font-size: 13px; }
    .link-form { display: flex; gap: 8px; align-items: flex-end; flex-wrap: wrap; margin-top: 8px; }
    .task-id-field { max-width: 120px; }
    .link-error { color: var(--crm-status-error); font-size: 12px; margin: 4px 0; }
    .priority-urgent { background: var(--crm-status-error); color: white; }
    .priority-high { background: var(--crm-status-warning); color: white; }
  `],
})
export class TaskLinksComponent implements OnInit {
  private readonly tasksApi = inject(TasksApiService);

  taskId = input.required<string>();
  links = signal<TaskLink[]>([]);
  showLinkForm = signal(false);
  linkError = signal('');
  targetTaskNumber: number | null = null;
  linkType = 'related';

  ngOnInit() {
    this.loadLinks();
  }

  loadLinks() {
    this.tasksApi.getLinkedTasks(this.taskId()).subscribe({
      next: (res) => { if (res.data) this.links.set(res.data); },
    });
  }

  submitLink() {
    if (!this.targetTaskNumber) return;
    this.linkError.set('');

    this.tasksApi.getTaskByNumber(this.targetTaskNumber).subscribe({
      next: (res) => {
        if (!res.data) {
          this.linkError.set('Задача с таким номером не найдена');
          return;
        }
        this.tasksApi.linkTask(this.taskId(), res.data.id, this.linkType).subscribe({
          next: () => {
            this.showLinkForm.set(false);
            this.targetTaskNumber = null;
            this.loadLinks();
          },
          error: () => this.linkError.set('Ошибка привязки'),
        });
      },
      error: (err) => {
        this.linkError.set(err.status === 404 ? 'Задача с таким номером не найдена' : 'Ошибка поиска задачи');
      },
    });
  }

  unlinkTask(linkId: string) {
    this.tasksApi.unlinkTask(this.taskId(), linkId).subscribe({
      next: () => this.loadLinks(),
    });
  }

  mergeTask(sourceId: string) {
    if (!confirm('Склеить задачу? Исходная задача будет отменена, все заметки и чаты перенесены сюда.')) return;
    this.tasksApi.mergeTasks(this.taskId(), sourceId).subscribe({
      next: () => this.loadLinks(),
    });
  }

  linkTypeLabel(t: string): string {
    return { related: 'Связана', duplicate: 'Дубликат', parent_child: 'Подзадача', merged: 'Склеена' }[t] || t;
  }
}
