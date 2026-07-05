import { Component, input, ChangeDetectionStrategy, effect, inject, DestroyRef, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';

export interface ProcessStep {
  number: number;
  title: string;
  description: string;
  icon: string;
  details?: string[];
}

@Component({
  selector: 'app-process-slider',
  imports: [MatIconModule],
  templateUrl: './process-slider.component.html',
  styleUrls: ['./process-slider.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ProcessSliderComponent {
  steps = input<ProcessStep[]>([]);
  title = input<string>('Процесс съёмки');
  autoSlide = input<boolean>(true);
  slideInterval = input<number>(4000);

  currentSlide = 0;
  private autoSlideInterval?: number;
  private destroyRef = inject(DestroyRef);
  private platformId = inject(PLATFORM_ID);

  constructor() {
    effect(() => {
      const auto = this.autoSlide();
      const steps = this.steps();
      if (auto && steps.length > 1) {
        this.startAutoSlide();
      } else {
        this.stopAutoSlide();
      }
    });

    this.destroyRef.onDestroy(() => {
      this.stopAutoSlide();
    });
  }

  goToSlide(index: number): void {
    this.currentSlide = index;
    this.resetAutoSlide();
  }

  private startAutoSlide(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    this.stopAutoSlide();
    this.autoSlideInterval = window.setInterval(() => {
      this.currentSlide = (this.currentSlide + 1) % this.steps().length;
    }, this.slideInterval());
  }

  private stopAutoSlide(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.autoSlideInterval) {
      clearInterval(this.autoSlideInterval);
      this.autoSlideInterval = undefined;
    }
  }

  private resetAutoSlide(): void {
    if (this.autoSlide()) {
      this.startAutoSlide();
    }
  }
}
