import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { MD3_BP, MEDIA_QUERIES } from '../constants/breakpoints';

/**
 * Service for managing responsive layouts based on Material Design 3 window size classes.
 * This service uses Angular CDK's BreakpointObserver to provide reactive layout information.
 */
@Injectable({
  providedIn: 'root'
})
export class ResponsiveLayoutService {
  // Using constant from breakpoints.ts file
  private breakpointObserver = inject(BreakpointObserver);

  // Observables for checking which breakpoint is active
  isCompact$: Observable<boolean>;
  isMedium$: Observable<boolean>;
  isExpanded$: Observable<boolean>;
  isLarge$: Observable<boolean>;
  isXLarge$: Observable<boolean>;

  // Observables for logical layout decisions
  isHandset$: Observable<boolean>;
  isTablet$: Observable<boolean>;
  isDesktop$: Observable<boolean>;
  
  // Observables for common layout patterns
  isAtLeastMedium$: Observable<boolean>;
  isAtLeastExpanded$: Observable<boolean>;
  isAtLeastLarge$: Observable<boolean>;
  isMobile$: Observable<boolean>;

  // Observable that emits the current active MD3 window size class
  currentWindowSizeClass$: Observable<string>;

  constructor() {
    // Initialize observables for specific MD3 breakpoints
    this.isCompact$ = this.createBreakpointObserver(MD3_BP.Compact);
    this.isMedium$ = this.createBreakpointObserver(MD3_BP.Medium);
    this.isExpanded$ = this.createBreakpointObserver(MD3_BP.Expanded);
    this.isLarge$ = this.createBreakpointObserver(MD3_BP.Large);
    this.isXLarge$ = this.createBreakpointObserver(MD3_BP.XLarge);
      // Initialize observables for device categories
    this.isHandset$ = this.createBreakpointObserver(Breakpoints.Handset);
    this.isTablet$ = this.createBreakpointObserver(Breakpoints.Tablet);
    this.isDesktop$ = this.createBreakpointObserver(Breakpoints.Web);
    
    // Initialize observables for common layout patterns
    this.isAtLeastMedium$ = this.createBreakpointObserver(MEDIA_QUERIES.AtLeastMedium);
    this.isAtLeastExpanded$ = this.createBreakpointObserver(MEDIA_QUERIES.AtLeastExpanded);
    this.isAtLeastLarge$ = this.createBreakpointObserver(MEDIA_QUERIES.AtLeastLarge);
    this.isMobile$ = this.createBreakpointObserver(MEDIA_QUERIES.OnlyMobile);
      // Initialize observable for current window size class
    this.currentWindowSizeClass$ = this.breakpointObserver
      .observe([
        MD3_BP.Compact,
        MD3_BP.Medium,
        MD3_BP.Expanded,
        MD3_BP.Large,
        MD3_BP.XLarge
      ])
      .pipe(
        map(result => {          if (result.breakpoints[MD3_BP.XLarge]) return 'X-Large';
          if (result.breakpoints[MD3_BP.Large]) return 'Large';
          if (result.breakpoints[MD3_BP.Expanded]) return 'Expanded';
          if (result.breakpoints[MD3_BP.Medium]) return 'Medium';
          return 'Compact';
        }),
        shareReplay(1)
      );
  }

  /**
   * Helper method to create an observable for a specific breakpoint
   */
  private createBreakpointObserver(breakpoint: string): Observable<boolean> {
    return this.breakpointObserver
      .observe(breakpoint)
      .pipe(
        map(result => result.matches),
        shareReplay(1)
      );
  }

  /**
   * Determines if the navigation rail should be shown based on window size class
   */
  get shouldShowNavigationRail$(): Observable<boolean> {    return this.breakpointObserver
      .observe([
        MD3_BP.Medium,
        MD3_BP.Expanded,
        MD3_BP.Large,
        MD3_BP.XLarge
      ])
      .pipe(
        map(result => result.matches),
        shareReplay(1)
      );
  }

  /**
   * Determines if the bottom navigation should be shown based on window size class
   */
  get shouldShowBottomNav$(): Observable<boolean> {
    return this.isCompact$;
  }
  /**
   * Determines if the navigation rail should be expanded based on window size class
   */  get shouldExpandNavigationRail$(): Observable<boolean> {
    return this.breakpointObserver
      .observe(MD3_BP.XLarge)
      .pipe(
        map(result => result.matches),
        shareReplay(1)
      );
  }
}
