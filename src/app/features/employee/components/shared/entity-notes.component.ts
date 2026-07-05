import { Component, inject, input, effect, signal, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDividerModule } from '@angular/material/divider';
import { ToastService } from '../../../../core/services/toast.service';

interface CrmNote {
  id: string;
  author_name: string;
  content: string;
  created_at: string;
}

@Component({
  selector: 'app-entity-notes',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatDividerModule],
  template: `
    <mat-divider />
    <div class="notes-section">
      <h3 class="notes-title">
        <mat-icon>sticky_note_2</mat-icon>
        Заметки
        @if (notes().length) {
          <span class="notes-count">{{ notes().length }}</span>
        }
      </h3>

      @for (note of notes(); track note.id) {
        <div class="note-item">
          <div class="note-header">
            <span class="note-author">{{ note.author_name }}</span>
            <span class="note-time">{{ timeLabel(note.created_at) }}</span>
          </div>
          <div class="note-content">{{ note.content }}</div>
        </div>
      }

      <div class="note-add">
        <mat-form-field appearance="outline" class="note-field">
          <textarea matInput placeholder="Добавить заметку..." [(ngModel)]="newNote" rows="2"></textarea>
        </mat-form-field>
        <button mat-flat-button [disabled]="!newNote.trim() || saving()" (click)="addNote()">
          <mat-icon>add</mat-icon> Добавить
        </button>
      </div>
    </div>
  `,
  styles: [`
    .notes-section { padding: 12px 0; }

    .notes-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 14px;
      font-weight: 600;
      margin: 0 0 8px;
      color: var(--crm-text-primary);

      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    .notes-count {
      background: var(--crm-surface-raised);
      border-radius: 10px;
      padding: 0 6px;
      font-size: 12px;
      font-weight: 500;
    }

    .note-item {
      padding: 8px 0;
      border-bottom: 1px solid var(--crm-border);

      &:last-of-type { border-bottom: none; }
    }

    .note-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2px;
    }

    .note-author { font-size: 12px; font-weight: 500; color: var(--crm-accent); }
    .note-time { font-size: 11px; color: var(--crm-text-muted); }
    .note-content { font-size: 13px; white-space: pre-wrap; line-height: 1.4; }

    .note-add {
      display: flex;
      gap: 8px;
      align-items: flex-end;
      margin-top: 8px;
    }

    .note-field {
      flex: 1;
      ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    }
  `],
})
export class EntityNotesComponent {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  entityType = input.required<string>();
  entityId = input.required<string>();

  notes = signal<CrmNote[]>([]);
  saving = signal(false);
  newNote = '';

  private readonly loadEffect = effect(() => {
    const type = this.entityType();
    const id = this.entityId();
    if (type && id) this.loadNotes(type, id);
  });

  private loadNotes(type: string, id: string): void {
    this.http.get<{ success: boolean; data: CrmNote[] }>(`/api/crm/notes?entity_type=${encodeURIComponent(type)}&entity_id=${encodeURIComponent(id)}`).subscribe({
      next: (res) => {
        if (res.success) this.notes.set(res.data || []);
      },
    });
  }

  addNote(): void {
    if (!this.newNote.trim()) return;
    this.saving.set(true);
    this.http.post<{ success: boolean; data: CrmNote }>('/api/crm/notes', {
      entity_type: this.entityType(),
      entity_id: this.entityId(),
      content: this.newNote.trim(),
    }).subscribe({
      next: (res) => {
        if (res.success && res.data) {
          this.notes.update(prev => [...prev, res.data]);
          this.newNote = '';
        }
        this.saving.set(false);
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Не удалось добавить заметку');
      },
    });
  }

  timeLabel(iso: string): string {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
}
