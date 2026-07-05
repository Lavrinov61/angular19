import { Component, ChangeDetectionStrategy, input } from '@angular/core';

type SkeletonVariant = 'text' | 'title' | 'avatar' | 'card' | 'thumbnail' | 'button';

@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (variant()) {
      @case ('avatar') {
        <div class="skeleton skeleton-avatar" [style.width.px]="size()" [style.height.px]="size()"></div>
      }
      @case ('title') {
        <div class="skeleton skeleton-title" [style.width]="width()"></div>
      }
      @case ('thumbnail') {
        <div class="skeleton skeleton-thumbnail" [style.width]="width()" [style.height]="height()"></div>
      }
      @case ('card') {
        <div class="skeleton-card">
          <div class="skeleton skeleton-thumbnail" style="width:100%;height:160px"></div>
          <div style="padding:16px">
            <div class="skeleton skeleton-title" style="width:70%;margin-bottom:12px"></div>
            <div class="skeleton skeleton-text" style="width:100%;margin-bottom:8px"></div>
            <div class="skeleton skeleton-text" style="width:85%"></div>
          </div>
        </div>
      }
      @case ('button') {
        <div class="skeleton skeleton-button"></div>
      }
      @default {
        @for (_ of lines(); track $index) {
          <div class="skeleton skeleton-text" [style.width]="$index === lines().length - 1 ? '60%' : '100%'"></div>
        }
      }
    }
  `,
  styles: [`
    :host { display: block; }

    .skeleton {
      background: linear-gradient(90deg, var(--ed-surface-container, #1a1a1a) 25%, var(--ed-surface-container-high, #222) 50%, var(--ed-surface-container, #1a1a1a) 75%);
      background-size: 200% 100%;
      animation: shimmer 1.5s ease-in-out infinite;
      border-radius: 4px;
    }

    .skeleton-text {
      height: 14px;
      margin-bottom: 8px;
      border-radius: 4px;
    }

    .skeleton-title {
      height: 22px;
      margin-bottom: 12px;
      border-radius: 4px;
    }

    .skeleton-avatar {
      border-radius: 50%;
    }

    .skeleton-thumbnail {
      border-radius: 8px;
      min-height: 120px;
    }

    .skeleton-button {
      height: 40px;
      width: 120px;
      border-radius: 20px;
    }

    .skeleton-card {
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    @keyframes shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `],
})
export class SkeletonComponent {
  variant = input<SkeletonVariant>('text');
  width = input<string>('100%');
  height = input<string>('120px');
  size = input<number>(40);

  lines = input<number[]>([1, 2, 3]);
}
