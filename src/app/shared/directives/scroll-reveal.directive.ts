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

@Directive({ selector: '[appScrollReveal]' })
export class ScrollRevealDirective {
  /** Delay in ms before adding .revealed class (for staggered effects) */
  readonly delay = input(0);
  /** Direction: 'up' | 'left' | 'right' */
  readonly direction = input<'up' | 'left' | 'right'>('up');

  private el = inject(ElementRef);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);
  private observer: IntersectionObserver | null = null;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      afterNextRender(() => this.setup());
    }
  }

  private setup(): void {
    const element = this.el.nativeElement as HTMLElement;
    const dir = this.direction();

    // If already in viewport (SSR hydration), reveal immediately, no flash
    const rect = element.getBoundingClientRect();
    if (rect.top < window.innerHeight && rect.bottom > 0) {
      element.classList.add('scroll-reveal', `scroll-reveal--${dir}`, 'revealed');
      return;
    }

    // Below viewport, set up scroll-triggered animation
    element.classList.add('scroll-reveal', `scroll-reveal--${dir}`);

    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const delayMs = this.delay();
            if (delayMs > 0) {
              setTimeout(() => element.classList.add('revealed'), delayMs);
            } else {
              element.classList.add('revealed');
            }
            this.observer?.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );

    this.observer.observe(element);

    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
      this.observer = null;
    });
  }
}
