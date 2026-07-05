import { Directive, inject, input, OnInit, TemplateRef, ViewContainerRef, effect } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ResponsiveLayoutService } from '../../core/services/responsive-layout.service';

/**
 * Structural directive that conditionally includes a template based on the current MD3 window size class.
 * 
 * Usage examples:
 * <div *ifWindowSize="'Compact'">Shows only in Compact mode</div>
 * <div *ifWindowSize="['Medium', 'Expanded']">Shows in Medium and Expanded modes</div>
 * <div *ifWindowSize="'Compact'; else notCompactTmpl">Shows in Compact mode</div>
 * <ng-template #notCompactTmpl>Shows in non-Compact modes</ng-template>
 */
@Directive({
  selector: '[appIfWindowSize]',
  
})
export class IfWindowSizeDirective implements OnInit {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly responsiveLayout = inject(ResponsiveLayoutService);
  private hasView = false;
  private windowSizes: string[] = [];
  readonly appIfWindowSize = input<string | string[]>([]);
  readonly appIfWindowSizeElse = input<TemplateRef<unknown> | undefined>(undefined);

  ngOnInit(): void {
    // Update windowSizes when input changes
    effect(() => {
      const value = this.appIfWindowSize();
      this.windowSizes = Array.isArray(value) ? value : [value];
    });

    this.responsiveLayout.currentWindowSizeClass$
      .pipe(takeUntilDestroyed())
      .subscribe(currentSize => {
        const shouldShow = this.windowSizes.includes(currentSize);
        
        if (shouldShow && !this.hasView) {
          this.viewContainer.createEmbeddedView(this.templateRef);
          this.hasView = true;
        } else if (!shouldShow && this.hasView) {
          this.viewContainer.clear();
          this.hasView = false;
            if (this.appIfWindowSizeElse()) {
            this.viewContainer.createEmbeddedView(this.appIfWindowSizeElse()!);
          }
        } else if (!shouldShow && !this.hasView && this.appIfWindowSizeElse()) {
          this.viewContainer.clear();
          this.viewContainer.createEmbeddedView(this.appIfWindowSizeElse()!);
        }
      });
  }
}

/**
 * Directive that shows content only on Compact window size (< 600px)
 * 
 * Usage:
 * <div *ifCompactSize>This only shows on mobile</div>
 */
@Directive({
  selector: '[appIfCompactSize]',
  
})
export class IfCompactSizeDirective implements OnInit {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly responsiveLayout = inject(ResponsiveLayoutService);
  private hasView = false;

  readonly appIfCompactSizeElse = input<TemplateRef<unknown> | undefined>(undefined);

  ngOnInit(): void {
    this.responsiveLayout.isCompact$
      .pipe(takeUntilDestroyed())
      .subscribe(isCompact => {
        if (isCompact && !this.hasView) {
          this.viewContainer.createEmbeddedView(this.templateRef);
          this.hasView = true;
        } else if (!isCompact && this.hasView) {
          this.viewContainer.clear();
          this.hasView = false;
            if (this.appIfCompactSizeElse()) {
            this.viewContainer.createEmbeddedView(this.appIfCompactSizeElse()!);
          }
        } else if (!isCompact && !this.hasView && this.appIfCompactSizeElse()) {
          this.viewContainer.clear();
          this.viewContainer.createEmbeddedView(this.appIfCompactSizeElse()!);
        }
      });
  }
}

/**
 * Directive that shows content only on larger screens (≥ 840px)
 * 
 * Usage:
 * <div *ifDesktopSize>This only shows on desktop</div>
 */
@Directive({
  selector: '[appIfDesktopSize]',
  
})
export class IfDesktopSizeDirective implements OnInit {
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly responsiveLayout = inject(ResponsiveLayoutService);
  private hasView = false;

  readonly appIfDesktopSizeElse = input<TemplateRef<unknown> | undefined>(undefined);

  ngOnInit(): void {
    this.responsiveLayout.shouldExpandNavigationRail$
      .pipe(takeUntilDestroyed())
      .subscribe(isDesktop => {
        if (isDesktop && !this.hasView) {
          this.viewContainer.createEmbeddedView(this.templateRef);
          this.hasView = true;
        } else if (!isDesktop && this.hasView) {
          this.viewContainer.clear();
          this.hasView = false;
            if (this.appIfDesktopSizeElse()) {
            this.viewContainer.createEmbeddedView(this.appIfDesktopSizeElse()!);
          }
        } else if (!isDesktop && !this.hasView && this.appIfDesktopSizeElse()) {
          this.viewContainer.clear();
          this.viewContainer.createEmbeddedView(this.appIfDesktopSizeElse()!);
        }
      });
  }
}
