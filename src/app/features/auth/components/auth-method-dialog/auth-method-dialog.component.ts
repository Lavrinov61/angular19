import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface AuthMethodDialogData {
  title: string;
  subtitle: string;
  showEmail: boolean;
  showSocial: boolean;
  showPhone: boolean;
  mode: 'login' | 'register' | 'link';
  providers: ('google' | 'apple')[];
}

@Component({
  selector: 'app-auth-method-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>
      <p>{{ data.subtitle }}</p>
      <!-- TODO: Implement auth method selection UI -->
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button (click)="close()">Отмена</button>
    </mat-dialog-actions>
  `
})
export class AuthMethodDialogComponent {
  protected readonly dialogRef = inject(MatDialogRef<AuthMethodDialogComponent>);
  protected readonly data = inject<AuthMethodDialogData>(MAT_DIALOG_DATA);

  close(): void {
    this.dialogRef.close();
  }
}



