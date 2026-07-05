import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Printer, BridgePrinterStatus, PrinterTelemetry } from '../../services/print-api.service';
import { groupPrintersSmart, SmartPrinterGroup } from '../../utils/printer-grouping';

interface SupplyDot {
  key: string;
  label: string;
  level: number;
}

const TYPE_LABELS: Record<string, string> = { photo: 'Фото', mfp: 'МФУ', document: 'Документы' };
const TYPE_ICONS: Record<string, string> = { photo: 'photo_camera', mfp: 'print', document: 'description' };

@Component({
  selector: 'app-printer-select-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, MatTooltipModule],
  host: { class: 'printer-select-cards' },
  template: `
    @for (group of printerGroups(); track group.key) {
      <div class="studio-label">
        <mat-icon class="studio-icon">{{ group.icon }}</mat-icon>
        {{ group.label }}
      </div>
      <div class="printer-cards-row" [class.compact]="group.printers.length > 4">
        @for (p of group.printers; track p.id) {
          <div class="printer-card" role="button" tabindex="0"
               [class.selected]="selectedPrinterId() === p.id"
               [class.offline]="!isOnline(p)"
               [class.queue-paused]="p.queue_paused"
               [matTooltip]="p.name + ' — ' + typeLabel(p.printer_type)"
               (click)="printerSelected.emit(p)"
               (keydown.enter)="printerSelected.emit(p)"
               (keydown.space)="printerSelected.emit(p)">
            <mat-icon class="printer-type-icon"
                      [class]="'type-' + effectiveType(p)">
              {{ typeIcon(p.printer_type) }}
            </mat-icon>
            <div class="printer-card-body">
              <span class="printer-card-name">{{ p.name }}</span>
              <span class="printer-card-type">{{ typeLabel(p.printer_type) }}</span>
              @if (p.queue_paused) {
                <span class="paused-hint">Очередь приостановлена</span>
              }
            </div>
            <span class="status-dot"
                  [class.online]="isOnline(p)"
                  [matTooltip]="isOnline(p) ? 'Онлайн' : 'Недоступен'">
            </span>
            @if (getSupplyDots(p.id); as dots) {
              @if (dots.length) {
                <div class="supply-indicator">
                  @for (item of dots; track item.key) {
                    <div class="supply-dot"
                         [style.background]="item.level > 30 ? '#4caf50' : item.level > 10 ? '#ff9800' : '#f44336'"
                         [matTooltip]="item.label + ': ' + item.level + '%'">
                    </div>
                  }
                </div>
              }
            }
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .studio-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary);
      margin: 6px 0 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .studio-icon {
      font-size: 15px;
      width: 15px;
      height: 15px;
      color: var(--crm-text-muted);
    }

    .printer-cards-row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .printer-card {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border: 2px solid var(--crm-glass-border, var(--mat-sys-outline-variant));
      border-radius: var(--crm-radius-md, 12px);
      cursor: pointer;
      transition: all var(--crm-transition-normal, 200ms) ease;
      flex: 1;
      min-width: 180px;
      background: var(--crm-surface-2, transparent);
    }

    .printer-card:hover {
      border-color: color-mix(in srgb, var(--crm-accent) 50%, transparent);
      box-shadow: var(--crm-shadow-card-hover, 0 4px 12px rgba(0,0,0,0.12));
      transform: translateY(-1px);
    }

    .printer-card.selected {
      border-color: var(--crm-accent);
      background: color-mix(in srgb, var(--crm-accent) 12%, transparent);
      box-shadow: 0 2px 10px color-mix(in srgb, var(--crm-accent) 20%, transparent);
    }

    .printer-card.offline { opacity: 0.45; }

    .printer-card.queue-paused {
      border-color: var(--crm-status-warning);
    }

    .printer-type-icon {
      font-size: 28px;
      width: 28px;
      height: 28px;
      flex-shrink: 0;
    }

    .type-photo { color: var(--crm-printer-photo); }
    .type-mfp, .type-document { color: var(--crm-printer-mfp); }
    .type-sublimation { color: var(--crm-printer-sublimation); }

    .printer-cards-row.compact .printer-card {
      min-width: 150px;
      padding: 8px 12px;
    }

    .printer-cards-row.compact .printer-type-icon {
      font-size: 22px;
      width: 22px;
      height: 22px;
    }

    .printer-cards-row.compact .printer-card-name {
      font-size: 12px;
    }

    .printer-cards-row.compact .printer-card-type {
      font-size: 10px;
    }

    .printer-card-body {
      display: flex;
      flex-direction: column;
      min-width: 0;
      gap: 1px;
    }

    .printer-card-name {
      font-size: 14px;
      font-weight: 500;
      line-height: 1.25;
      color: var(--crm-text-primary);
      word-break: break-word;
    }

    .printer-card-type {
      font-size: 11px;
      color: var(--crm-text-muted);
    }

    .paused-hint {
      font-size: 10px;
      color: var(--crm-status-warning);
      font-weight: 500;
    }

    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--crm-status-error);
      flex-shrink: 0;
      margin-left: auto;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--crm-status-error) 25%, transparent);
    }

    .status-dot.online {
      background: var(--crm-status-success);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--crm-status-success) 25%, transparent);
      animation: pulse-online 2s ease-in-out infinite;
    }

    @keyframes pulse-online {
      0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--crm-status-success) 25%, transparent); }
      50% { box-shadow: 0 0 0 4px color-mix(in srgb, var(--crm-status-success) 15%, transparent); }
    }

    .supply-indicator {
      display: flex;
      gap: 3px;
      margin-left: auto;
      padding-left: 4px;
    }

    .supply-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
  `],
})
export class PrinterSelectCardsComponent {
  readonly printers = input.required<Printer[]>();
  readonly statuses = input<BridgePrinterStatus[]>([]);
  readonly telemetry = input<PrinterTelemetry[]>([]);
  readonly selectedPrinterId = input<string | null>(null);
  readonly printerSelected = output<Printer>();

  readonly printerGroups = computed((): SmartPrinterGroup[] => groupPrintersSmart(this.printers()));

  isOnline(p: Printer): boolean {
    const status = this.statuses().find(s => s.printer_name === p.cups_printer_name);
    return status?.online ?? false;
  }

  effectiveType(p: Printer): string {
    if (p.capabilities?.sublimation || p.capabilities?.media_types?.some(m => m.id === 'ds_transfer')) {
      return 'sublimation';
    }
    return p.printer_type;
  }

  getSupplyDots(printerId: string): SupplyDot[] {
    const t = this.telemetry().find(x => x.printer_id === printerId);
    if (!t?.supplies) return [];
    return Object.entries(t.supplies).map(([key, level]) => ({
      key,
      label: SUPPLY_LABELS[key] ?? key,
      level: typeof level === 'number' ? level : 0,
    }));
  }

  typeLabel(type: string): string { return TYPE_LABELS[type] ?? type; }
  typeIcon(type: string): string { return TYPE_ICONS[type] ?? 'print'; }
}

const SUPPLY_LABELS: Record<string, string> = {
  cyan: 'Голубой', magenta: 'Пурпурный', yellow: 'Жёлтый', black: 'Чёрный',
  'light-cyan': 'Св. голубой', 'light-magenta': 'Св. пурпурный',
  toner: 'Тонер', drum: 'Барабан', waste: 'Отработка',
};
