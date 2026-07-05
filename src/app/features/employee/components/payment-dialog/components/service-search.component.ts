import {
  Component,
  ChangeDetectionStrategy,
  model,
  viewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-service-search',
  imports: [FormsModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    <div class="ss-wrap" [class.focused]="focused">
      <mat-icon class="ss-icon">search</mat-icon>
      <input
        #searchInput
        class="ss-input"
        type="text"
        placeholder="Поиск услуги..."
        autocomplete="off"
        [ngModel]="query()"
        (ngModelChange)="query.set($event)"
        (focus)="focused = true"
        (blur)="focused = false"
      />
      @if (!focused && !query()) {
        <span class="ss-hint">Ctrl+K</span>
      }
      @if (query()) {
        <button class="ss-clear" (click)="clear()">
          <mat-icon>close</mat-icon>
        </button>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      padding: 14px 20px 0;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .ss-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .ss-icon {
      position: absolute;
      left: 12px;
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: #7a7a7a;
      pointer-events: none;
      transition: color 150ms ease;

      .ss-wrap.focused & { color: #f59e0b; }
    }

    .ss-input {
      width: 100%;
      box-sizing: border-box;
      height: 40px;
      border-radius: 10px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(255, 255, 255, 0.04);
      color: #ececec;
      font-size: 13px;
      font-family: inherit;
      padding: 0 72px 0 40px;
      outline: none;
      transition: border-color 150ms ease, background 150ms ease;

      &::placeholder { color: #7a7a7a; }

      .ss-wrap.focused & {
        border-color: rgba(245, 158, 11, 0.4);
        background: rgba(245, 158, 11, 0.04);
      }
    }

    .ss-hint {
      position: absolute;
      right: 12px;
      font-size: 10px;
      font-family: var(--crm-font-mono, 'JetBrains Mono', monospace);
      color: #5c5c5c;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 2px 6px;
      line-height: 1;
      pointer-events: none;
    }

    .ss-clear {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      cursor: pointer;
      color: #7a7a7a;
      display: flex;
      align-items: center;
      padding: 4px;
      border-radius: 4px;
      transition: all 100ms ease;

      mat-icon { font-size: 16px; width: 16px; height: 16px; }

      &:hover {
        color: #ececec;
        background: rgba(255, 255, 255, 0.06);
      }
    }
  `],
})
export class ServiceSearchComponent {
  readonly query = model('');
  readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  protected focused = false;

  clear(): void {
    this.query.set('');
    this.inputEl()?.nativeElement.focus();
  }

  focus(): void {
    this.inputEl()?.nativeElement.focus();
  }
}
