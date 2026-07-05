import { Component, ChangeDetectionStrategy, input } from '@angular/core';

type Severity = 'critical' | 'warn' | 'info';

@Component({
  selector: 'app-fleet-alert-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (count() > 0) {
      <span class="chip" [attr.data-severity]="severity()">
        <span class="chip-count">{{ count() }}</span>
        <span class="chip-label">{{ labelFor(severity()) }}</span>
      </span>
    }
  `,
  styles: [`
    .chip {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      line-height: 1.4;
    }
    .chip-count { font-weight: 800; font-size: 12px; }
    .chip-label { text-transform: uppercase; letter-spacing: 0.04em; font-size: 10px; opacity: 0.85; }
    .chip[data-severity='critical'] { background: rgba(239, 68, 68, 0.14); color: #b91c1c; }
    .chip[data-severity='warn']     { background: rgba(234, 179, 8, 0.18); color: #a16207; }
    .chip[data-severity='info']     { background: rgba(59, 130, 246, 0.14); color: #1d4ed8; }
  `]
})
export class FleetAlertChipComponent {
  readonly severity = input.required<Severity>();
  readonly count = input.required<number>();

  labelFor(s: Severity): string {
    switch (s) {
      case 'critical': return 'критич.';
      case 'warn':     return 'внимание';
      case 'info':     return 'инфо';
    }
  }
}
