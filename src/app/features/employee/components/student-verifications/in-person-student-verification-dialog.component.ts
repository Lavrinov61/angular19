import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { InPersonStudentVerificationComponent } from './in-person-student-verification.component';

export interface InPersonStudentVerificationDialogData {
  /** UUID диалога Пульта — пробрасывается как conversation_id в prepare. */
  readonly sessionId: string;
  /** Телефон из чата для префилла (telegram без номера → null). */
  readonly phone: string | null;
}

@Component({
  selector: 'app-in-person-student-verification-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, InPersonStudentVerificationComponent],
  template: `
    <div class="dialog-head">
      <div class="dialog-head__title">
        <mat-icon>school</mat-icon>
        <span>Зарегистрировать студента</span>
      </div>
      <button mat-icon-button type="button" (click)="close()" aria-label="Закрыть">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <div class="dialog-body">
      <app-in-person-student-verification
        [prefillPhone]="data.phone"
        [conversationId]="data.sessionId"
      />
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .dialog-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--crm-glass-border, rgba(255, 255, 255, 0.1));
    }

    .dialog-head__title {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--crm-text-primary, #f5f7fb);
      font-size: 16px;
      font-weight: 800;
    }

    .dialog-head__title mat-icon {
      color: var(--crm-accent, #f59e0b);
    }

    .dialog-body {
      padding: 16px;
      overflow: auto;
    }
  `],
})
export class InPersonStudentVerificationDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<InPersonStudentVerificationDialogComponent>);
  readonly data: InPersonStudentVerificationDialogData = inject(MAT_DIALOG_DATA);

  close(): void {
    this.dialogRef.close();
  }
}
