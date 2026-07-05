import {
  Directive,
  ElementRef,
  inject,
  input,
  afterNextRender,
  DestroyRef,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Directive({ selector: '[appParallax]' })
export class ParallaxDirective {
  /** Speed factor: 0.1 = subtle, 0.5 = dramatic */
  readonly speed = input(0.15);

  private el = inject(ElementRef);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);
  private rafId: number | null = null;
  private onScroll: (() => void) | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => this.setup());
    }
  }

  private setup(): void {
    const element = this.el.nativeElement as HTMLElement;
    element.style.willChange = 'transform';
    element.style.transition = 'none';

    this.onScroll = () => {
      if (this.rafId !== null) return;

      this.rafId = requestAnimationFrame(() => {
        const rect = element.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        // Only apply when element is near viewport
        if (rect.bottom > -100 && rect.top < viewportHeight + 100) {
          const center = rect.top + rect.height / 2;
          const offset = (center - viewportHeight / 2) * this.speed();
          element.style.transform = `translateY(${offset}px)`;
        }

        this.rafId = null;
      });
    };

    window.addEventListener('scroll', this.onScroll, { passive: true });

    this.destroyRef.onDestroy(() => {
      if (this.onScroll) {
        window.removeEventListener('scroll', this.onScroll);
      }
      if (this.rafId !== null) {
        cancelAnimationFrame(this.rafId);
      }
    });
  }
}
