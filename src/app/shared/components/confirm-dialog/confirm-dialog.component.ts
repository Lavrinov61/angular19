import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmButtonText: string;
  cancelButtonText: string;
  type: 'warning' | 'danger' | 'info';
}

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule
],
  template: `
    <div class="confirm-dialog" [class]="data.type">
      <div class="confirm-dialog__icon">
        @if (data.type === 'warning') {
          <mat-icon>warning</mat-icon>
        } @else if (data.type === 'danger') {
          <mat-icon>error_outline</mat-icon>
        } @else {
          <mat-icon>info</mat-icon>
        }
      </div>

      <h2 class="confirm-dialog__title">{{ data.title }}</h2>

      <p class="confirm-dialog__message" [innerHTML]="data.message"></p>

      <div class="confirm-dialog__actions">
        <button mat-stroked-button class="confirm-dialog__cancel" [mat-dialog-close]="false">
          {{ data.cancelButtonText || 'Отмена' }}
        </button>

        <button mat-flat-button class="confirm-dialog__confirm" [mat-dialog-close]="true">
          {{ data.confirmButtonText || 'Подтвердить' }}
        </button>
      </div>
    </div>
  `,
  styles: [`
    .confirm-dialog {
      padding: 22px 22px 16px;
      text-align: center;
    }

    .confirm-dialog__icon {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      margin: 0 auto 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .confirm-dialog__icon mat-icon {
      font-size: 30px;
      width: 30px;
      height: 30px;
    }

    .danger .confirm-dialog__icon { background: rgba(239, 68, 68, 0.12); }
    .danger .confirm-dialog__icon mat-icon { color: #ef4444; }

    .warning .confirm-dialog__icon { background: rgba(245, 158, 11, 0.14); }
    .warning .confirm-dialog__icon mat-icon { color: #f59e0b; }

    .info .confirm-dialog__icon { background: rgba(37, 99, 235, 0.12); }
    .info .confirm-dialog__icon mat-icon { color: #2563eb; }

    .confirm-dialog__title {
      margin: 0 0 8px;
      font-family: 'Oswald', sans-serif;
      font-size: 1.3rem;
      font-weight: 600;
      line-height: 1.25;
      color: #1a1a1a;
    }

    .confirm-dialog__message {
      margin: 0 auto 4px;
      max-width: 340px;
      font-size: 0.94rem;
      line-height: 1.5;
      color: #5b5b5b;
    }

    .confirm-dialog__message ::ng-deep strong { color: #1a1a1a; font-weight: 700; }

    .confirm-dialog__actions {
      display: flex;
      gap: 10px;
      justify-content: center;
      margin-top: 20px;
    }

    .confirm-dialog__actions button {
      min-width: 132px;
      border-radius: 10px;
      font-weight: 600;
    }

    .confirm-dialog__cancel {
      --mdc-outlined-button-label-text-color: #5b5b5b;
      --mdc-outlined-button-outline-color: #d8d8d8;
      color: #5b5b5b;
    }

    .confirm-dialog__confirm {
      --mdc-filled-button-label-text-color: #ffffff;
      color: #ffffff;
    }

    .danger .confirm-dialog__confirm { --mdc-filled-button-container-color: #ef4444; }
    .warning .confirm-dialog__confirm { --mdc-filled-button-container-color: #f59e0b; }
    .info .confirm-dialog__confirm { --mdc-filled-button-container-color: #2563eb; }

    @media (max-width: 420px) {
      .confirm-dialog__actions { flex-direction: column-reverse; }
      .confirm-dialog__actions button { width: 100%; }
    }
  `]
})
export class ConfirmDialogComponent {
  dialogRef = inject<MatDialogRef<ConfirmDialogComponent>>(MatDialogRef);
  data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);

  constructor() {
    // Светлая «карточка» поверх тёмного crm-active overlay (стили в src/styles.scss).
    this.dialogRef.addPanelClass('sf-confirm-dialog-panel');
  }
}
