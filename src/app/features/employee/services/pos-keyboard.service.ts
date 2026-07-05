import { Injectable, NgZone, inject, OnDestroy } from '@angular/core';
import { Subject, Subscription, fromEvent } from 'rxjs';
import { filter } from 'rxjs/operators';

export type PosShortcut =
  | 'pay_cash' | 'pay_card' | 'pay_sbp' | 'pay_subscription'
  | 'focus_search' | 'clear_receipt' | 'show_report' | 'close_shift'
  | 'nav_up' | 'nav_down' | 'qty_plus' | 'qty_minus'
  | 'delete_item' | 'cancel' | 'confirm';

const SHORTCUT_MAP: Record<string, PosShortcut> = {
  F1: 'pay_cash',
  F2: 'pay_card',
  F3: 'pay_sbp',
  F4: 'pay_subscription',
  F5: 'focus_search',
  F8: 'clear_receipt',
  F10: 'show_report',
  F12: 'close_shift',
  ArrowUp: 'nav_up',
  ArrowDown: 'nav_down',
  Delete: 'delete_item',
  Escape: 'cancel',
  Enter: 'confirm',
};

const F_KEYS = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F8', 'F10', 'F12']);
const ALWAYS_ACTIVE_KEYS = new Set([...F_KEYS, 'Escape']);

@Injectable({ providedIn: 'root' })
export class PosKeyboardService implements OnDestroy {
  private readonly zone = inject(NgZone);
  readonly shortcuts$ = new Subject<PosShortcut>();
  private subscription: Subscription | null = null;

  register(element: HTMLElement | Document = document): void {
    this.unregister();

    this.zone.runOutsideAngular(() => {
      this.subscription = fromEvent<KeyboardEvent>(element, 'keydown')
        .pipe(
          filter(e => {
            const target = e.target as HTMLElement;
            const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

            // Ctrl+K always works for search
            if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
              return true;
            }

            // Numpad +/- always works
            if (e.key === '+' || e.key === '-') {
              return !isInput;
            }

            // F-keys and Escape work even in inputs
            if (ALWAYS_ACTIVE_KEYS.has(e.key)) {
              return true;
            }

            // Other shortcuts blocked when in input
            if (isInput) {
              return false;
            }

            return e.key in SHORTCUT_MAP;
          }),
        )
        .subscribe(e => {
          let shortcut: PosShortcut | null = null;

          if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
            shortcut = 'focus_search';
          } else if (e.key === '+') {
            shortcut = 'qty_plus';
          } else if (e.key === '-') {
            shortcut = 'qty_minus';
          } else {
            shortcut = SHORTCUT_MAP[e.key] ?? null;
          }

          if (shortcut) {
            // Prevent browser defaults for F-keys
            if (F_KEYS.has(e.key) || (e.key === 'k' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
            }

            this.zone.run(() => this.shortcuts$.next(shortcut));
          }
        });
    });
  }

  unregister(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  ngOnDestroy(): void {
    this.unregister();
    this.shortcuts$.complete();
  }
}
