import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-create-group-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule, FormsModule],
  template: `
    <h2 mat-dialog-title>Создать группу</h2>
    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Название группы</mat-label>
        <input matInput [(ngModel)]="name" required cdkFocusInitial />
      </mat-form-field>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Имя клиента</mat-label>
        <input matInput [(ngModel)]="customerName" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button [disabled]="!name.trim()" (click)="save()">Создать</button>
    </mat-dialog-actions>
  `,
  styles: [`.full-width { width: 100%; }`],
})
export class CreateGroupDialogComponent {
  private readonly dialogRef = inject(MatDialogRef);
  name = '';
  customerName = '';
  save(): void {
    this.dialogRef.close({ name: this.name.trim(), customerName: this.customerName.trim() || undefined });
  }
}
