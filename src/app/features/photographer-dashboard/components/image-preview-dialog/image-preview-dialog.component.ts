import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-image-preview-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule
],
  template: `
    <div class="image-preview-container">
      <div class="dialog-header">
        <h2 mat-dialog-title>{{ data.title }}</h2>
        <button mat-icon-button (click)="close()" class="close-button">
          <mat-icon>close</mat-icon>
        </button>
      </div>
      
      <div class="image-container" mat-dialog-content>
        <img [src]="data.imageUrl" [alt]="data.title" class="preview-image">
      </div>
      
      <div class="dialog-actions" mat-dialog-actions>
        <button mat-button (click)="close()">Закрыть</button>
        <button mat-raised-button color="warn" (click)="delete()">
          <mat-icon>delete</mat-icon>
          Удалить
        </button>
      </div>
    </div>
  `,
  styles: [`
    .image-preview-container {
      max-width: 90vw;
      max-height: 90vh;
      display: flex;
      flex-direction: column;
    }

    .dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 16px;
      border-bottom: 1px solid #e0e0e0;
    }

    .close-button {
      margin-left: auto;
    }

    .image-container {
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      background: #f5f5f5;
      border-radius: 8px;
      margin: 16px 0;
    }

    .preview-image {
      max-width: 100%;
      max-height: 70vh;
      object-fit: contain;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      padding-top: 16px;
      border-top: 1px solid #e0e0e0;
    }
  `]
})
export class ImagePreviewDialogComponent {
  dialogRef = inject<MatDialogRef<ImagePreviewDialogComponent>>(MatDialogRef);
  data = inject<{
    imageUrl: string;
    title: string;
}>(MAT_DIALOG_DATA);


  close(): void {
    this.dialogRef.close();
  }

  delete(): void {
    this.dialogRef.close('delete');
  }
}
