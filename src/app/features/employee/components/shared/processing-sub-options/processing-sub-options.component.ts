import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export interface SubOptionInfo {
  readonly label: string;
  readonly inherited: boolean;
  readonly pricePerFeature: number;
}

@Component({
  selector: 'app-processing-sub-options',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (subs().length) {
      <div class="psub-options">
        @for (sub of subs(); track sub.label) {
          @let off = !sub.inherited && isDisabled()(sub.label);
          @let lastEnabled = !off && !sub.inherited && !canDisableMore();
          <label class="psub-option"
                 [class.psub-option--inherited]="sub.inherited"
                 [class.psub-option--off]="off">
            <input type="checkbox"
              [checked]="sub.inherited || !isDisabled()(sub.label)"
              [disabled]="sub.inherited || lastEnabled"
              (change)="subToggle.emit(sub.label)">
            <span class="psub-label">{{ sub.label }}</span>
            @if (!sub.inherited && sub.pricePerFeature > 0) {
              <span class="psub-price" [class.psub-price--off]="off">
                {{ off ? '\u2212' : '+' }}{{ sub.pricePerFeature }}\u20BD
              </span>
            }
          </label>
        }
      </div>
    }
  `,
  styles: [`
    .psub-options {
      display: flex; flex-direction: column; gap: 2px;
      padding: 6px 12px 8px 36px;
      margin: -2px 0 4px;
      border: 1px solid var(--crm-border);
      border-top: none;
      border-radius: 0 0 6px 6px;
      background: rgba(255,255,255,0.02);
    }
    .psub-option {
      display: flex; align-items: center; gap: 6px;
      padding: 2px 0;
      font-size: 11.5px;
      cursor: pointer;
      color: var(--crm-text-secondary);
    }
    .psub-option input[type="checkbox"]:disabled { cursor: default; }
    .psub-option--inherited { opacity: 0.55; cursor: default; }
    .psub-option--off .psub-label { text-decoration: line-through; opacity: 0.4; }
    .psub-label { flex: 1 1 auto; }
    .psub-price {
      margin-left: auto;
      font-size: 10px;
      color: var(--crm-text-muted);
      font-family: var(--crm-font-mono, monospace);
    }
    .psub-price--off { color: var(--crm-status-error); font-weight: 600; }
  `],
})
export class ProcessingSubOptionsComponent {
  readonly subs = input.required<readonly SubOptionInfo[]>();
  readonly isDisabled = input.required<(label: string) => boolean>();
  readonly canDisableMore = input<boolean>(true);
  readonly subToggle = output<string>();
}
