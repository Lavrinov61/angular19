import { Directive, ElementRef, OnInit, inject, Renderer2, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';

/**
 * Ensures dark theme classes are applied to the document and host element.
 * Only dark theme is supported.
 */
@Directive({
  selector: '[appThemeSync]',
})
export class ThemeSyncDirective implements OnInit {
  private document = inject(DOCUMENT);
  private renderer = inject(Renderer2);
  private platformId = inject(PLATFORM_ID);
  private el = inject(ElementRef);

  ngOnInit(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const html = this.document.documentElement;
    this.renderer.addClass(html, 'dark-theme');
    this.renderer.removeClass(html, 'light-theme');
    this.renderer.setAttribute(html, 'data-theme', 'dark');
    this.renderer.setStyle(html, 'color-scheme', 'dark');

    this.renderer.addClass(this.el.nativeElement, 'dark-theme');
    this.renderer.setAttribute(this.el.nativeElement, 'data-theme', 'dark');
    this.renderer.setStyle(this.el.nativeElement, 'color-scheme', 'dark');
  }
}
