import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';

export interface PromptDialogData {
  title: string;
  message?: string;
  label: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Если true — кнопка подтверждения недоступна пока поле пустое */
  required?: boolean;
}

@Component({
  selector: 'app-prompt-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, FormsModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      @if (data.message) {
        <p class="message">{{ data.message }}</p>
      }
      <mat-form-field class="full-width" subscriptSizing="dynamic">
        <mat-label>{{ data.label }}</mat-label>
        <textarea matInput [(ngModel)]="value"
                  [placeholder]="data.placeholder ?? ''"
                  rows="3"
                  cdkFocusInitial></textarea>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">{{ data.cancelLabel ?? 'Отмена' }}</button>
      <button mat-flat-button color="primary"
              [disabled]="!!data.required && !value.trim()"
              (click)="confirm()">
        {{ data.confirmLabel ?? 'Подтвердить' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .message { margin: 0 0 12px; font-size: 14px; color: var(--mat-sys-on-surface-variant); }
    .full-width { width: 100%; }
  `],
})
export class PromptDialogComponent {
  readonly data: PromptDialogData = inject(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<PromptDialogComponent>);

  value = '';

  confirm(): void {
    this.dialogRef.close(this.value);
  }

  cancel(): void {
    this.dialogRef.close(null);
  }
}
