import { Component, ChangeDetectionStrategy, input, model } from '@angular/core';

export interface StudioFilterOption {
  id: string;
  name: string;
  count: number;
}

/**
 * Row of chips для выбора студии. single-select, null = «все».
 */
@Component({
  selector: 'app-fleet-studio-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="filter-row" role="tablist" aria-label="Фильтр по студиям">
      <button
        type="button"
        class="chip"
        [class.active]="selected() === null"
        (click)="select(null)"
        role="tab"
        [attr.aria-selected]="selected() === null">
        Все студии
        <span class="chip-count">{{ totalCount() }}</span>
      </button>
      @for (s of studios(); track s.id) {
        <button
          type="button"
          class="chip"
          [class.active]="selected() === s.id"
          (click)="select(s.id)"
          role="tab"
          [attr.aria-selected]="selected() === s.id">
          {{ s.name }}
          <span class="chip-count">{{ s.count }}</span>
        </button>
      }
    </div>
  `,
  styles: [`
    :host { display: block; }
    .filter-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding: 6px 0;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: var(--crm-radius-sm, 6px);
      border: 1px solid rgba(0, 0, 0, 0.1);
      background: transparent;
      color: var(--crm-text-muted, #6b7280);
      font-size: var(--crm-text-sm, 13px);
      font-family: var(--crm-font-sans, system-ui);
      white-space: nowrap;
      cursor: pointer;
      transition: color 0.15s, background 0.15s, border-color 0.15s;
    }
    .chip:hover {
      color: var(--crm-text-secondary, #111827);
      background: var(--crm-surface-hover, rgba(0,0,0,0.04));
    }
    .chip.active {
      background: var(--crm-accent-muted, rgba(59, 130, 246, 0.12));
      color: var(--crm-accent, #2563eb);
      border-color: var(--crm-accent, #2563eb);
    }
    .chip-count {
      background: var(--crm-surface-raised, rgba(0,0,0,0.06));
      border-radius: 8px;
      padding: 0 6px;
      font-size: var(--crm-text-xs, 11px);
      font-family: var(--crm-font-mono, monospace);
      min-width: 18px;
      text-align: center;
      font-weight: 600;
    }
  `]
})
export class FleetStudioFilterComponent {
  readonly studios = input<StudioFilterOption[]>([]);
  readonly totalCount = input<number>(0);
  readonly selected = model<string | null>(null);

  select(id: string | null): void {
    this.selected.set(id);
  }
}
