import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { PrintPreset } from '../../data/print-prices.data';

@Component({
  selector: 'app-print-preset-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule],
  host: { class: 'print-preset-bar' },
  template: `
    <div class="presets-bar">
      @for (preset of presets(); track preset.id) {
        <button mat-stroked-button
                class="preset-chip"
                [class.active]="activePresetId() === preset.id"
                (click)="presetSelected.emit(preset)">
          <mat-icon>{{ preset.icon }}</mat-icon>
          {{ preset.label }}
        </button>
      }
    </div>
  `,
  styles: [`
    .presets-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 4px 0;
    }

    .preset-chip {
      font-size: 12px !important;
      min-height: 34px !important;
      padding: 0 14px !important;
      border-radius: var(--crm-radius-lg, 16px) !important;
      transition: all var(--crm-transition-normal, 200ms) ease !important;
      border-color: var(--crm-glass-border, var(--mat-sys-outline-variant)) !important;
    }

    .preset-chip:hover {
      background: color-mix(in srgb, var(--crm-accent) 8%, transparent) !important;
      border-color: var(--crm-accent) !important;
      transform: translateY(-1px);
      box-shadow: var(--crm-shadow-sm, 0 1px 3px rgba(0,0,0,0.1));
    }

    .preset-chip.active {
      background: var(--crm-accent) !important;
      color: #fff !important;
      border-color: var(--crm-accent) !important;
      box-shadow: 0 2px 8px color-mix(in srgb, var(--crm-accent) 40%, transparent);
    }

    .preset-chip mat-icon {
      font-size: 16px;
      width: 16px;
      height: 16px;
      margin-right: 5px;
    }
  `],
})
export class PrintPresetBarComponent {
  readonly presets = input.required<PrintPreset[]>();
  readonly activePresetId = input<string | null>(null);
  readonly presetSelected = output<PrintPreset>();
}
