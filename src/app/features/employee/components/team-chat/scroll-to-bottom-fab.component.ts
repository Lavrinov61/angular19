import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@Component({
  selector: 'app-scroll-to-bottom-fab',
  imports: [MatIconModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" mat-mini-fab class="stb-fab" (click)="clicked.emit()"
            aria-label="Прокрутить вниз">
      <mat-icon>arrow_downward</mat-icon>
      @if (count() > 0) {
        <span class="badge">{{ count() }}</span>
      }
    </button>
  `,
  styles: [`
    :host {
      position: absolute;
      bottom: 96px;
      right: 16px;
      z-index: 10;
      pointer-events: auto;
    }
    .stb-fab {
      position: relative;
    }
    .badge {
      position: absolute;
      top: -4px;
      right: -4px;
      min-width: 18px;
      height: 18px;
      padding: 0 6px;
      background: #ff5252;
      color: #fff;
      border-radius: 9px;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }
  `],
})
export class ScrollToBottomFabComponent {
  readonly count = input(0);
  readonly clicked = output<void>();
}
