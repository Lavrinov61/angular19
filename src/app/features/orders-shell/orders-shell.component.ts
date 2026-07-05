import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  computed,
  effect,
  ElementRef,
  viewChildren,
} from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';

interface ShellTab {
  readonly route: string;
  readonly label: string;
  readonly icon: string;
  readonly exact: boolean;
}

@Component({
  selector: 'app-orders-shell',
  imports: [RouterOutlet, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'orders-shell',
  },
  template: `
    <nav class="secondary-tabs" role="tablist">
      @for (tab of tabs; track tab.route; let i = $index) {
        <button
          #tabBtn
          class="tab-item"
          [class.active]="activeIndex() === i"
          role="tab"
          [attr.aria-selected]="activeIndex() === i"
          (click)="navigate(tab)"
        >
          <mat-icon class="tab-icon">{{ tab.icon }}</mat-icon>
          <span class="tab-label">{{ tab.label }}</span>
          @if (tab.route === '/orders/approvals' && approvalsBadge() > 0) {
            <span class="dot-badge" aria-label="Есть ожидающие согласования"></span>
          }
        </button>
      }
      <!-- Active indicator (sliding bottom line) -->
      <span
        class="active-indicator"
        [style.transform]="indicatorTransform()"
      ></span>
    </nav>

    <div class="tab-content">
      <router-outlet />
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    /* ─── Secondary Tabs, M3E pill indicator ─── */
    .secondary-tabs {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      height: 48px;
      background: var(--ed-surface, #0a0a0a);
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      padding: 0 4px;
    }

    /* ─── Tab Item ─── */
    .tab-item {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      position: relative;
      background: none;
      border: none;
      cursor: pointer;
      padding: 0 8px;
      height: 40px;
      border-radius: var(--m3e-corner-full, 9999px);
      font-size: 13px;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);
      transition:
        color var(--m3e-effect-fast-duration, 200ms) var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1)),
        background var(--m3e-effect-fast-duration, 200ms) var(--m3e-effect-fast, cubic-bezier(0.2, 0, 0, 1));
      -webkit-tap-highlight-color: transparent;
    }

    .tab-item:hover {
      color: var(--ed-on-surface, #e5e5e5);
      background: rgba(255, 255, 255, 0.05);
    }

    .tab-item.active {
      color: var(--ed-on-accent, #0a0a0a);
      font-weight: 600;
      background: var(--ed-accent, #f59e0b);
    }

    .tab-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    .tab-label {
      white-space: nowrap;
    }

    /* ─── Dot Badge ─── */
    .dot-badge {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #ef4444;
      flex-shrink: 0;
      margin-left: 2px;
      margin-bottom: 8px;
    }

    /* ─── Active Indicator, hidden, replaced by pill background ─── */
    .active-indicator {
      display: none;
    }

    /* ─── Content ─── */
    .tab-content {
      flex: 1;
      min-height: 0;
    }
  `],
})
export class OrdersShellComponent {
  private readonly router = inject(Router);

  readonly approvalsBadge = input<number>(0);

  readonly tabs: readonly ShellTab[] = [
    { route: '/orders', label: 'Заказы', icon: 'receipt_long', exact: true },
    { route: '/orders/bookings', label: 'Записи', icon: 'event', exact: true },
    { route: '/orders/approvals', label: 'Согласование', icon: 'compare', exact: true },
  ] as const;

  readonly tabBtns = viewChildren<ElementRef<HTMLButtonElement>>('tabBtn');

  /** Current URL from router events */
  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(e => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Index of the active tab (-1 = none match) */
  readonly activeIndex = computed(() => {
    const url = this.currentUrl();
    // Strip query params and fragment
    const path = url.split('?')[0].split('#')[0];
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      if (tab.exact ? path === tab.route : path.startsWith(tab.route)) {
        return i;
      }
    }
    return 0; // fallback to first tab
  });

  /** CSS transform for the sliding indicator */
  readonly indicatorTransform = computed(() => {
    const idx = this.activeIndex();
    return `translateX(${idx * 100}%)`;
  });

  /** Dynamically set indicator width via effect (1/N of container) */
  private readonly indicatorWidthEffect = effect(() => {
    // Access tabBtns to track changes
    const btns = this.tabBtns();
    if (btns.length === 0) return;
    // Find the indicator element (sibling after the tab buttons)
    const container = btns[0].nativeElement.parentElement;
    if (!container) return;
    const indicator = container.querySelector('.active-indicator') as HTMLElement | null;
    if (indicator) {
      indicator.style.width = `${100 / this.tabs.length}%`;
    }
  });

  navigate(tab: ShellTab): void {
    this.router.navigate([tab.route]);
  }
}
