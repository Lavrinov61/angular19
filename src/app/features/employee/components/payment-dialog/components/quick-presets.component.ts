import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import type { QuickPreset } from '../models/payment-dialog.models';

@Component({
  selector: 'app-pd-quick-presets',
  imports: [MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {},
  template: `
    <div class="qp-row">
      @for (preset of presets(); track preset.id) {
        <button
          class="qp-btn"
          (click)="presetSelected.emit(preset)"
        >
          <mat-icon class="qp-icon">{{ preset.icon }}</mat-icon>
          <span class="qp-label">{{ preset.label }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    :host {
      display: block;
      font-family: var(--crm-font-sans, 'Plus Jakarta Sans', sans-serif);
    }

    .qp-row {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      scrollbar-width: none;

      &::-webkit-scrollbar { display: none; }
    }

    .qp-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-radius: 8px;
      border: 1px solid rgba(52, 211, 153, 0.2);
      background: rgba(52, 211, 153, 0.06);
      color: #34d399;
      font-size: 12px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      flex-shrink: 0;
      transition: all 150ms ease;

      &:hover {
        background: rgba(52, 211, 153, 0.12);
        border-color: rgba(52, 211, 153, 0.35);
        transform: translateY(-1px);
      }

      &:focus-visible {
        outline: 2px solid rgba(52, 211, 153, 0.6);
        outline-offset: 2px;
      }
    }

    .qp-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
    }

    .qp-label {
      line-height: 1;
    }
  `],
})
export class QuickPresetsComponent {
  readonly presets = input.required<readonly QuickPreset[]>();
  readonly presetSelected = output<QuickPreset>();
}
