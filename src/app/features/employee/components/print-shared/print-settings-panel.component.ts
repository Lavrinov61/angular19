import { Component, ChangeDetectionStrategy, input, output, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatIconModule } from '@angular/material/icon';
import { PrinterCapabilities } from '../../services/print-api.service';

export interface PrintSettings {
  paper_size: string;
  media_type: string;
  quality: string;
  copies: number;
  borderless: boolean;
  duplex: boolean;
  mirror: boolean;
  color_mode: 'color' | 'bw';
  paper_source?: string;
  finishing_ops?: string[];
}

@Component({
  selector: 'app-print-settings-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, MatSelectModule, MatFormFieldModule,
    MatInputModule, MatCheckboxModule, MatSlideToggleModule, MatIconModule,
  ],
  host: { class: 'print-settings-panel' },
  template: `
    @if (capabilities(); as caps) {
      <div class="settings-block">
        <span class="settings-title">
          <mat-icon>description</mat-icon> Бумага / Качество
        </span>

        <div class="settings-row">
          <mat-form-field appearance="outline" class="field-half">
            <mat-label>Бумага</mat-label>
            <mat-select [ngModel]="settings().paper_size"
                        (ngModelChange)="updateSetting('paper_size', $event)">
              @for (ps of caps.paper_sizes; track ps.id) {
                <mat-option [value]="ps.id">{{ ps.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" class="field-half">
            <mat-label>Качество</mat-label>
            <mat-select [ngModel]="settings().quality"
                        (ngModelChange)="updateSetting('quality', $event)">
              @for (qm of caps.quality_modes; track qm.id) {
                <mat-option [value]="qm.id">{{ qm.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        </div>

        @if (caps.media_types.length > 1) {
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Тип бумаги</mat-label>
            <mat-select [ngModel]="settings().media_type"
                        (ngModelChange)="updateSetting('media_type', $event)">
              @for (mt of caps.media_types; track mt.id) {
                <mat-option [value]="mt.id">{{ mt.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        <div class="copies-row">
          <span class="copies-label">Копии</span>
          <div class="copies-control">
            <button class="copies-btn" (click)="changeCopies(-1)" [disabled]="settings().copies <= 1">-</button>
            <span class="copies-value">{{ settings().copies }}</span>
            <button class="copies-btn" (click)="changeCopies(1)" [disabled]="settings().copies >= 99">+</button>
          </div>
        </div>
      </div>

      <div class="settings-block">
        <span class="settings-title">
          <mat-icon>tune</mat-icon> Опции
        </span>

        @if (caps.borderless) {
          <mat-checkbox [ngModel]="settings().borderless"
                        (ngModelChange)="updateSetting('borderless', $event)">
            Без полей
          </mat-checkbox>
        }

        @if (caps.duplex) {
          <div class="toggle-row">
            <mat-icon class="toggle-icon">auto_stories</mat-icon>
            <span>Двусторонняя</span>
            <mat-slide-toggle [ngModel]="settings().duplex"
                              (ngModelChange)="updateSetting('duplex', $event)"
                              class="toggle-ctrl" />
          </div>
        }

        <div class="toggle-row">
          <mat-icon class="toggle-icon">swap_horiz</mat-icon>
          <span>Зеркало</span>
          <mat-slide-toggle [ngModel]="settings().mirror"
                            (ngModelChange)="updateSetting('mirror', $event)"
                            class="toggle-ctrl" />
        </div>

        @if (caps.color) {
          <div class="toggle-row">
            <mat-icon class="toggle-icon">palette</mat-icon>
            <span>Ч/Б печать</span>
            <mat-slide-toggle [ngModel]="settings().color_mode === 'bw'"
                              (ngModelChange)="updateSetting('color_mode', $event ? 'bw' : 'color')"
                              class="toggle-ctrl" />
          </div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .settings-block {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--crm-surface-2, rgba(255,255,255,0.03));
      border: 1px solid var(--crm-glass-border, rgba(255,255,255,0.06));
      border-radius: var(--crm-radius-md, 10px);
      padding: 14px 16px;
    }

    .settings-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      color: var(--crm-text-secondary);
      letter-spacing: 0.02em;
      margin-bottom: 2px;

      mat-icon {
        font-size: 16px;
        width: 16px;
        height: 16px;
        color: var(--crm-text-muted);
      }
    }

    .settings-row {
      display: flex;
      gap: 10px;
    }

    .field-half { flex: 1; }
    .full-width { width: 100%; }

    .copies-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
    }

    .copies-label {
      font-size: 13px;
      color: var(--crm-text-primary);
    }

    .copies-control {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .copies-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1px solid var(--crm-border);
      background: transparent;
      color: var(--crm-text-primary);
      font-size: 16px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 150ms;

      &:hover:not(:disabled) { background: var(--crm-surface-raised); }
      &:disabled { opacity: 0.3; cursor: default; }
    }

    .copies-value {
      min-width: 28px;
      text-align: center;
      font-weight: 700;
      font-size: 16px;
      color: var(--crm-text-primary);
    }

    .toggle-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      color: var(--crm-text-primary);
    }

    .toggle-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
      color: var(--crm-text-muted);
    }

    .toggle-ctrl { margin-left: auto; }
  `],
})
export class PrintSettingsPanelComponent {
  readonly capabilities = input.required<PrinterCapabilities>();
  readonly settings = model.required<PrintSettings>();
  readonly settingsChange = output<PrintSettings>();

  updateSetting<K extends keyof PrintSettings>(key: K, value: PrintSettings[K]): void {
    const updated = { ...this.settings(), [key]: value };
    this.settings.set(updated);
    this.settingsChange.emit(updated);
  }

  changeCopies(delta: number): void {
    const next = Math.max(1, Math.min(99, this.settings().copies + delta));
    this.updateSetting('copies', next);
  }
}
