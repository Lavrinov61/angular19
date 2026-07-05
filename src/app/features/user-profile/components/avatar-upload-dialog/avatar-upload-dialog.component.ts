import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../../core/services/auth.service';
import { FileStorageService } from '../../../../core/services/file-storage.service';

export interface AvatarUploadDialogData {
  userId: string;
}

@Component({
  selector: 'app-avatar-upload-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule
],
  template: `
    <div class="avatar-upload-dialog">
      <h2 mat-dialog-title>Загрузка фото профиля</h2>

      <mat-dialog-content>
        @if (imagePreview) {
          <div class="avatar-preview">
            <img [src]="imagePreview" alt="Предпросмотр">
          </div>
        }

        <div class="upload-controls">
          <button
            mat-raised-button
            color="primary"
            (click)="fileInput.click()"
            [disabled]="isLoading()">
            <mat-icon>add_photo_alternate</mat-icon>
            Выбрать фото
          </button>

          <input
            #fileInput
            type="file"
            hidden
            accept="image/*"
            (change)="onFileSelected($event)">
        </div>

        @if (isLoading()) {
          <mat-progress-bar mode="indeterminate"
            color="accent" />
        }
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button
          mat-button
          [mat-dialog-close]="false"
          [disabled]="isLoading()">
          Отмена
        </button>

        <button
          mat-raised-button
          color="primary"
          [disabled]="!selectedFile || isLoading()"
          (click)="uploadAvatar()">
          Загрузить
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .avatar-upload-dialog {
      padding: 16px;
    }

    .avatar-preview {
      width: 100%;
      height: 200px;
      margin-bottom: 16px;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      background-color: var(--ed-surface-container-lowest, #0a0a0a);

      img {
        max-width: 100%;
        max-height: 100%;
        object-fit: contain;
      }
    }

    .upload-controls {
      display: flex;
      justify-content: center;
      margin-bottom: 16px;
    }

    mat-progress-bar {
      margin-top: 16px;
    }
  `]
})
export class AvatarUploadDialogComponent {
  dialogRef = inject(MatDialogRef<AvatarUploadDialogComponent>);
  authService = inject(AuthService);
  fileStorageService = inject(FileStorageService);
  snackBar = inject(MatSnackBar);

  protected isLoading = signal(false);
  selectedFile: File | null = null;
  imagePreview: string | null = null;

  data = inject<AvatarUploadDialogData>(MAT_DIALOG_DATA);

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];

      // Создаем предпросмотр изображения
      const reader = new FileReader();
      reader.onload = () => {
        this.imagePreview = reader.result as string;
      };
      reader.readAsDataURL(this.selectedFile);
    }
  }

  async uploadAvatar(): Promise<void> {
    if (!this.selectedFile) return;

    this.isLoading.set(true);

    try {
      const user = this.authService.getCurrentUser();
      if (!user) {
        throw new Error('User not authenticated');
      }
      const userId = user.id || user.uid;
      if (!userId) {
        throw new Error('User ID is missing');
      }
      const path = `avatars/${userId}/${this.selectedFile.name}`;

      // 1. Upload the file
      const downloadURL = await this.fileStorageService.uploadFile(path, this.selectedFile).toPromise();

      if (!downloadURL) {
        throw new Error('File upload failed: no download URL returned.');
      }

      // 2. Update the user's profile with the new URL
      await this.authService.updateProfilePhoto(downloadURL).toPromise();

      this.snackBar.open('Аватар успешно обновлен', 'Закрыть', { duration: 3000 });
      this.dialogRef.close(true);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Ошибка при загрузке фото';
      this.snackBar.open(message, 'Закрыть', { duration: 5000 });
    } finally {
      this.isLoading.set(false);
    }
  }
}
