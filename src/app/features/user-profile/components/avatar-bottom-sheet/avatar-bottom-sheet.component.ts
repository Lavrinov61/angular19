import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatListModule } from '@angular/material/list';
import { MatIconModule } from '@angular/material/icon';

export type AvatarAction = 'camera' | 'gallery' | 'remove';

@Component({
  selector: 'app-avatar-bottom-sheet',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatListModule, MatIconModule],
  template: `
    <mat-action-list class="avatar-sheet">
      <button mat-list-item (click)="select('camera')">
        <mat-icon matListItemIcon>photo_camera</mat-icon>
        <span matListItemTitle>Сделать фото</span>
      </button>
      <button mat-list-item (click)="select('gallery')">
        <mat-icon matListItemIcon>photo_library</mat-icon>
        <span matListItemTitle>Выбрать из галереи</span>
      </button>
      <button mat-list-item (click)="select('remove')" class="remove-action">
        <mat-icon matListItemIcon>delete_outline</mat-icon>
        <span matListItemTitle>Удалить фото</span>
      </button>
    </mat-action-list>
  `,
  styles: [`
    .avatar-sheet {
      padding-bottom: env(safe-area-inset-bottom, 8px);

      button {
        min-height: 52px;
      }
    }

    .remove-action {
      --mdc-list-list-item-label-text-color: #ef4444;
      mat-icon { color: #ef4444; }
    }
  `],
})
export class AvatarBottomSheetComponent {
  private readonly sheetRef = inject(MatBottomSheetRef<AvatarBottomSheetComponent>);

  select(action: AvatarAction): void {
    this.sheetRef.dismiss(action);
  }
}
