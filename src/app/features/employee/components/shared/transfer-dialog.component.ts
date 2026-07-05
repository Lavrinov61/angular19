import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

interface StaffMember {
  id: string;
  display_name: string | null;
  email: string;
  role: 'admin' | 'manager' | 'employee' | 'photographer';
  is_system?: boolean;
}

@Component({
  selector: 'app-transfer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule, MatButtonModule, MatIconModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>swap_horiz</mat-icon> Передать чат
    </h2>
    <mat-dialog-content>
      @if (loading()) {
        <div class="loading"><mat-spinner diameter="24" /></div>
      } @else if (error()) {
        <div class="dialog-error">
          <mat-icon>error_outline</mat-icon> {{ error() }}
        </div>
      } @else if (operators().length === 0) {
        <div class="dialog-empty">
          <mat-icon>person_off</mat-icon> Нет доступных операторов
        </div>
      } @else {
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Оператор</mat-label>
          <mat-select [(ngModel)]="selectedOperator">
            @for (op of operators(); track op.id) {
              <mat-option [value]="op.id">
                {{ op.display_name || op.email }}
                @if (op.role === 'admin') { <span class="role-badge">Админ</span> }
                @else if (op.role === 'manager') { <span class="role-badge">Менеджер</span> }
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Примечание (необязательно)</mat-label>
          <textarea matInput [(ngModel)]="note" rows="2" maxlength="500"></textarea>
        </mat-form-field>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary"
              [disabled]="!selectedOperator || !!error() || operators().length === 0"
              (click)="confirm()">
        Передать
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2 { display: flex; align-items: center; gap: 8px; }
    .full-width { width: 100%; }
    .loading { display: flex; justify-content: center; padding: 24px; }
    .dialog-error, .dialog-empty {
      display: flex; align-items: center; gap: 8px;
      padding: 16px; border-radius: 8px;
      font-size: 14px;
    }
    .dialog-error { background: rgba(244,67,54,.08); color: #b71c1c; }
    .dialog-empty { background: rgba(0,0,0,.04); color: rgba(0,0,0,.6); }
    mat-dialog-content { min-width: 320px; }
    .role-badge {
      display: inline-block; margin-left: 6px;
      padding: 2px 6px; border-radius: 4px;
      font-size: 11px; font-weight: 500;
      background: rgba(0,0,0,.08); color: rgba(0,0,0,.6);
    }
  `],
})
export class TransferDialogComponent {
  private readonly http = inject(HttpClient);
  private readonly dialogRef = inject(MatDialogRef<TransferDialogComponent>);
  private readonly data = inject<{ currentOperatorId: string | null }>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly operators = signal<StaffMember[]>([]);
  readonly error = signal<string | null>(null);
  selectedOperator = '';
  note = '';

  constructor() {
    this.http.get<{ success: boolean; data: StaffMember[] }>('/api/tasks/employees').subscribe({
      next: (res) => {
        if (res.success) {
          const filtered = res.data.filter(op =>
            op.id !== this.data?.currentOperatorId
            && op.role !== 'photographer'
            && !op.is_system,
          );
          this.operators.set(filtered);
        } else {
          this.error.set('Не удалось загрузить список операторов');
        }
        this.loading.set(false);
      },
      error: (err: { error?: { error?: string } }) => {
        this.error.set(err?.error?.error || 'Не удалось загрузить список операторов');
        this.loading.set(false);
      },
    });
  }

  confirm(): void {
    this.dialogRef.close({ operatorId: this.selectedOperator, note: this.note || undefined });
  }
}
