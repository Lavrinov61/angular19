import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

@Component({
  selector: 'app-photo-toolbar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule],
  host: { class: 'photo-toolbar' },
  template: `
    <button mat-icon-button (click)="prevClicked.emit()" matTooltip="Предыдущее"
            [disabled]="currentIndex() <= 0">
      <mat-icon>chevron_left</mat-icon>
    </button>
    <span class="photo-index">
      {{ currentIndex() + 1 }} / {{ totalCount() }}
    </span>
    <button mat-icon-button (click)="nextClicked.emit()" matTooltip="Следующее"
            [disabled]="currentIndex() >= totalCount() - 1">
      <mat-icon>chevron_right</mat-icon>
    </button>

    <div class="toolbar-spacer"></div>

    @if (hasOriginal()) {
      <button mat-icon-button (click)="compareToggled.emit()"
              [class.active-tool]="compareMode()"
              matTooltip="Сравнить с оригиналом">
        <mat-icon>compare</mat-icon>
      </button>
    }
    <button mat-icon-button (click)="annotationStarted.emit()"
            [class.active-tool]="placingAnnotation()"
            matTooltip="Отметить на фото">
      <mat-icon>push_pin</mat-icon>
    </button>
    <button mat-icon-button (click)="fullscreenToggled.emit()"
            matTooltip="На весь экран">
      <mat-icon>{{ fullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 0;
    }

    .photo-index {
      font-size: 13px;
      color: var(--ed-on-surface-variant, #a0a0a0);
      font-weight: 500;
    }

    .toolbar-spacer { flex: 1; }

    .active-tool {
      color: var(--ed-accent, #f59e0b) !important;
      background: rgba(245, 158, 11, 0.1);
      border-radius: 50%;
    }
  `,
})
export class PhotoToolbarComponent {
  readonly currentIndex = input(0);
  readonly totalCount = input(0);
  readonly hasOriginal = input(false);
  readonly compareMode = input(false);
  readonly placingAnnotation = input(false);
  readonly fullscreen = input(false);

  readonly prevClicked = output<void>();
  readonly nextClicked = output<void>();
  readonly compareToggled = output<void>();
  readonly annotationStarted = output<void>();
  readonly fullscreenToggled = output<void>();
}
