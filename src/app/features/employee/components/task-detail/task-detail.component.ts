import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TasksApiService, WorkTask } from '../../services/tasks-api.service';
import { AiCrmApiService, ChatSummary, AssignmentSuggestion } from '../../services/ai-crm-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ClientCardComponent } from './sections/client-card.component';
import { ChatTimelineComponent } from './sections/chat-timeline.component';
import { TaskLinksComponent } from './sections/task-links.component';
import {
  typeIcon, typeLabel, statusLabel, priorityLabel,
  channelLabel, formatDateTime,
} from '../../utils/crm-helpers';

@Component({
  selector: 'app-task-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatCardModule, MatButtonModule, MatIconModule,
    MatChipsModule, MatFormFieldModule, MatInputModule, MatDividerModule,
    MatProgressSpinnerModule, MatTooltipModule,
    ClientCardComponent, ChatTimelineComponent, TaskLinksComponent,
  ],
  templateUrl: './task-detail.component.html',
  styleUrl: './task-detail.component.scss',
})
export class TaskDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly tasksApi = inject(TasksApiService);
  private readonly aiCrm = inject(AiCrmApiService);
  private readonly authService = inject(AuthService);

  task = signal<WorkTask | null>(null);
  showHandoff = signal(false);
  newNote = '';
  handoffNote = '';

  // AI features
  aiSummary = signal<ChatSummary | null>(null);
  aiSummaryLoading = signal(false);
  aiAssignments = signal<AssignmentSuggestion[]>([]);
  aiAssignLoading = signal(false);

  readonly typeIcon = typeIcon;
  readonly typeLabel = typeLabel;
  readonly statusLabel = statusLabel;
  readonly priorityLabel = priorityLabel;
  readonly channelLabel = channelLabel;

  userId = () => this.authService.currentUser()?.id;

  ngOnInit() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) this.loadTask(id);
  }

  loadTask(id: string) {
    this.tasksApi.getTask(id).subscribe({
      next: (res) => { if (res.success && res.data) this.task.set(res.data); },
    });
  }

  takeTask() {
    const t = this.task();
    if (!t) return;
    this.tasksApi.assignTask(t.id, this.userId()!).subscribe({ next: () => this.loadTask(t.id) });
  }

  changeStatus(status: string) {
    const t = this.task();
    if (!t) return;
    this.tasksApi.updateStatus(t.id, status).subscribe({ next: () => this.loadTask(t.id) });
  }

  addNote() {
    const t = this.task();
    if (!t || !this.newNote) return;
    this.tasksApi.addNote(t.id, this.newNote).subscribe({
      next: () => { this.newNote = ''; this.loadTask(t.id); },
    });
  }

  submitHandoff() {
    const t = this.task();
    if (!t || !this.handoffNote) return;
    this.tasksApi.handoffTask(t.id, this.handoffNote).subscribe({
      next: () => { this.handoffNote = ''; this.showHandoff.set(false); this.loadTask(t.id); },
    });
  }

  formatTime(iso: string): string {
    return formatDateTime(iso);
  }

  // ─── AI Features ──────────────────────────────────────

  generateSummary() {
    const t = this.task();
    if (!t?.chat_session_id) return;
    this.aiSummaryLoading.set(true);
    this.aiCrm.getChatSummary(t.chat_session_id).subscribe({
      next: (summary) => {
        this.aiSummary.set(summary);
        this.aiSummaryLoading.set(false);
      },
      error: () => this.aiSummaryLoading.set(false),
    });
  }

  loadAssignmentSuggestions() {
    const t = this.task();
    if (!t) return;
    this.aiAssignLoading.set(true);
    this.aiCrm.getAssignmentSuggestions(t.id).subscribe({
      next: (suggestions) => {
        this.aiAssignments.set(suggestions);
        this.aiAssignLoading.set(false);
      },
      error: () => this.aiAssignLoading.set(false),
    });
  }

  assignTo(employeeId: string) {
    const t = this.task();
    if (!t) return;
    this.tasksApi.assignTask(t.id, employeeId).subscribe({
      next: () => {
        this.aiAssignments.set([]);
        this.loadTask(t.id);
      },
    });
  }

  sentimentIcon(sentiment: string): string {
    switch (sentiment) {
      case 'positive': return 'sentiment_satisfied';
      case 'negative': return 'sentiment_dissatisfied';
      default: return 'sentiment_neutral';
    }
  }
}
