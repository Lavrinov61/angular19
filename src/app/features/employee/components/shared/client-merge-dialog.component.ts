import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface MergePreview {
  bookings: number;
  orders: number;
  chats: number;
  notes: number;
}

interface MergeResult {
  merged_records: MergePreview;
}

@Component({
  selector: 'app-client-merge-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatDialogModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatIconModule,
    MatChipsModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Объединение клиентов</h2>
    <mat-dialog-content>
      <p class="hint">Все данные будут перенесены на основной номер телефона.</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Основной телефон</mat-label>
        <input matInput [(ngModel)]="primaryPhone" placeholder="+7 (___) ___-__-__" />
      </mat-form-field>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Телефон для объединения</mat-label>
        <input matInput [(ngModel)]="addPhone" placeholder="+7 (___) ___-__-__"
               (keyup.enter)="addMergePhone()" />
        <button matSuffix mat-icon-button (click)="addMergePhone()" [disabled]="!addPhone.trim()">
          <mat-icon>add</mat-icon>
        </button>
      </mat-form-field>

      @if (mergePhones().length) {
        <mat-chip-set class="merge-chips">
          @for (phone of mergePhones(); track phone) {
            <mat-chip (removed)="removeMergePhone(phone)">
              {{ phone }}
              <mat-icon matChipRemove>cancel</mat-icon>
            </mat-chip>
          }
        </mat-chip-set>
      }

      @if (mergePhones().length && primaryPhone.trim()) {
        <button mat-stroked-button class="preview-btn" (click)="loadPreview()" [disabled]="previewLoading()">
          @if (previewLoading()) { <mat-spinner diameter="18" /> }
          Предпросмотр
        </button>
      }

      @if (preview()) {
        <div class="preview-card">
          <div class="preview-title">Будет объединено:</div>
          <div class="preview-row">
            <span>Записи:</span> <strong>{{ preview()!.bookings }}</strong>
          </div>
          <div class="preview-row">
            <span>Заказы:</span> <strong>{{ preview()!.orders }}</strong>
          </div>
          <div class="preview-row">
            <span>Чаты:</span> <strong>{{ preview()!.chats }}</strong>
          </div>
          <div class="preview-row">
            <span>Заметки:</span> <strong>{{ preview()!.notes }}</strong>
          </div>
        </div>
      }

      @if (error()) {
        <p class="error-text">{{ error() }}</p>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="warn" (click)="merge()"
              [disabled]="!canMerge() || merging()">
        @if (merging()) { <mat-spinner diameter="18" /> }
        Объединить
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .hint { font-size: 13px; color: var(--mat-sys-on-surface-variant); margin: 0 0 16px; }
    .full-width { width: 100%; }
    .merge-chips { margin-bottom: 16px; }
    .preview-btn { margin-bottom: 16px; }
    .preview-card {
      padding: 12px 16px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .preview-title { font-weight: 600; font-size: 14px; margin-bottom: 8px; color: var(--mat-sys-on-surface); }
    .preview-row { display: flex; justify-content: space-between; font-size: 13px; padding: 2px 0; }
    .error-text { color: var(--mat-sys-error); font-size: 13px; }
  `],
})
export class ClientMergeDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly dialogRef = inject(MatDialogRef<ClientMergeDialogComponent>);
  private readonly data = inject<{ primaryPhone?: string }>(MAT_DIALOG_DATA, { optional: true });

  primaryPhone = this.data?.primaryPhone || '';
  addPhone = '';
  readonly mergePhones = signal<string[]>([]);
  readonly preview = signal<MergePreview | null>(null);
  readonly previewLoading = signal(false);
  readonly merging = signal(false);
  readonly error = signal<string | null>(null);

  readonly canMerge = signal(false);

  addMergePhone(): void {
    const phone = this.addPhone.trim();
    if (phone && !this.mergePhones().includes(phone)) {
      this.mergePhones.update(list => [...list, phone]);
      this.addPhone = '';
      this.preview.set(null);
      this.updateCanMerge();
    }
  }

  removeMergePhone(phone: string): void {
    this.mergePhones.update(list => list.filter(p => p !== phone));
    this.preview.set(null);
    this.updateCanMerge();
  }

  private updateCanMerge(): void {
    this.canMerge.set(this.primaryPhone.trim().length >= 10 && this.mergePhones().length > 0);
  }

  loadPreview(): void {
    const allPhones = [this.primaryPhone.trim(), ...this.mergePhones()];
    this.previewLoading.set(true);
    this.http.post<{ success: boolean; data: MergePreview }>(
      '/api/crm/clients/merge-preview',
      { merge_phones: allPhones }
    ).subscribe({
      next: (res) => {
        this.preview.set(res.data);
        this.previewLoading.set(false);
        this.updateCanMerge();
      },
      error: () => {
        this.previewLoading.set(false);
        this.error.set('Не удалось загрузить предпросмотр');
      },
    });
  }

  merge(): void {
    this.updateCanMerge();
    if (!this.canMerge()) return;

    this.merging.set(true);
    this.error.set(null);

    this.http.post<{ success: boolean; data: MergeResult }>(
      '/api/crm/clients/merge',
      { primary_phone: this.primaryPhone.trim(), merge_phones: this.mergePhones() }
    ).subscribe({
      next: (res) => {
        this.merging.set(false);
        if (res.success) {
          this.dialogRef.close(res.data.merged_records);
        }
      },
      error: (err) => {
        this.merging.set(false);
        this.error.set(err.error?.error || 'Ошибка при объединении');
      },
    });
  }
}
