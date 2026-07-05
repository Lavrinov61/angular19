import { Component, inject, signal, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { AiCrmApiService, FollowUpCandidate } from '../../services/ai-crm-api.service';

@Component({
  selector: 'app-ai-follow-up',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatChipsModule, MatProgressSpinnerModule],
  template: `
    <div class="follow-up-page">
      <div class="page-header">
        <h1><mat-icon>auto_fix_high</mat-icon> AI Follow-Up</h1>
        <p class="subtitle">Автоматические напоминания клиентам</p>
        <button mat-flat-button (click)="loadCandidates()" [disabled]="loading()">
          @if (loading()) {
            <mat-spinner diameter="18" />
          } @else {
            <mat-icon>refresh</mat-icon>
          }
          Обновить
        </button>
      </div>

      @if (candidates().length) {
        <div class="candidates-list">
          @for (c of candidates(); track c.sessionId) {
            <mat-card class="candidate-card" appearance="outlined">
              <mat-card-header>
                <mat-icon mat-card-avatar>{{ typeIcon(c.type) }}</mat-icon>
                <mat-card-title>{{ typeLabel(c.type) }}</mat-card-title>
                <mat-card-subtitle>{{ c.message.channel }} · через {{ c.message.delay_minutes }} мин</mat-card-subtitle>
              </mat-card-header>
              <mat-card-content>
                <p class="message-preview">{{ c.message.text }}</p>
              </mat-card-content>
              <mat-card-actions>
                <button mat-flat-button (click)="sendFollowUp(c)">
                  <mat-icon>send</mat-icon> Отправить
                </button>
                <button mat-button (click)="dismiss(c)">Пропустить</button>
              </mat-card-actions>
            </mat-card>
          }
        </div>
      } @else if (!loading()) {
        <div class="empty-state">
          <mat-icon>celebration</mat-icon>
          <p>Нет кандидатов для follow-up</p>
          <span>Все клиенты получили ответ. Отличная работа!</span>
        </div>
      }
    </div>
  `,
  styles: `
    .follow-up-page { max-width: 800px; margin: 0 auto; padding: 16px; }
    .page-header {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      margin-bottom: 20px;
      h1 { margin: 0; display: flex; align-items: center; gap: 8px; font-size: 22px; flex: 1; }
      .subtitle { margin: 0; color: var(--mat-sys-on-surface-variant); font-size: 14px; flex-basis: 100%; }
    }
    .candidates-list { display: flex; flex-direction: column; gap: 12px; }
    .candidate-card { border-left: 4px solid var(--mat-sys-tertiary); }
    .message-preview {
      margin: 8px 0 0;
      font-size: 14px;
      line-height: 1.5;
      padding: 12px;
      background: var(--mat-sys-surface-container);
      border-radius: 8px;
      white-space: pre-wrap;
    }
    .empty-state {
      text-align: center; padding: 60px 20px;
      color: var(--mat-sys-on-surface-variant);
      mat-icon { font-size: 48px; width: 48px; height: 48px; margin-bottom: 12px; }
      p { font-size: 16px; margin: 0; }
      span { font-size: 14px; }
    }
  `,
})
export class AiFollowUpComponent implements OnInit {
  private readonly aiCrm = inject(AiCrmApiService);
  private readonly http = inject(HttpClient);
  private readonly snackBar = inject(MatSnackBar);

  candidates = signal<FollowUpCandidate[]>([]);
  loading = signal(false);

  ngOnInit() {
    this.loadCandidates();
  }

  loadCandidates() {
    this.loading.set(true);
    this.aiCrm.getFollowUpCandidates().subscribe({
      next: (data) => {
        this.candidates.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  sendFollowUp(c: FollowUpCandidate) {
    if (c.message.channel === 'chat') {
      this.http.post(`/api/visitor-chat/sessions/${c.sessionId}/operator-reply`, {
        content: c.message.text,
      }).subscribe({
        next: () => this.snackBar.open('Follow-up отправлен', 'OK', { duration: 3000 }),
        error: () => this.snackBar.open('Ошибка отправки', 'OK', { duration: 3000 }),
      });
    } else {
      this.snackBar.open(`Follow-up (${c.message.channel}) — запланирован`, 'OK', { duration: 3000 });
    }
    this.candidates.update(list => list.filter(x => x.sessionId !== c.sessionId));
  }

  dismiss(c: FollowUpCandidate) {
    this.candidates.update(list => list.filter(x => x.sessionId !== c.sessionId));
  }

  typeIcon(type: string): string {
    const icons: Record<string, string> = {
      abandoned_chat: 'chat_bubble_outline',
      no_show: 'event_busy',
      review_request: 'star_outline',
      win_back: 'person_search',
    };
    return icons[type] || 'auto_fix_high';
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      abandoned_chat: 'Брошенный чат',
      no_show: 'Не пришёл на запись',
      review_request: 'Запрос отзыва',
      win_back: 'Возврат клиента',
    };
    return labels[type] || type;
  }
}
