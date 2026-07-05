import {
  Component, ChangeDetectionStrategy, inject, signal,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';

export interface ReassignDialogData {
  currentPrinterId: string;
  printerType: string;
  printers: { id: string; name: string; studio_name?: string | null }[];
  statuses: { printer_name: string; online: boolean }[];
}

@Component({
  selector: 'app-reassign-printer-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatFormFieldModule, MatSelectModule, MatIconModule,
  ],
  template: `
    <h2 mat-dialog-title>Переназначить задание</h2>

    <mat-dialog-content>
      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Принтер</mat-label>
        <mat-select (selectionChange)="selected.set($event.value)">
          @for (printer of data.printers; track printer.id) {
            <mat-option [value]="printer.id" [disabled]="!isOnline(printer.name)">
              <div class="printer-option">
                <span class="printer-name">{{ printer.name }}</span>
                <span class="status-dot" [class.online]="isOnline(printer.name)" [class.offline]="!isOnline(printer.name)"></span>
                @if (printer.studio_name) {
                  <span class="studio-name">{{ printer.studio_name }}</span>
                }
              </div>
            </mat-option>
          }
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary" [disabled]="!selected()" (click)="dialogRef.close(selected())">
        Переназначить
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; }
    .printer-option { display: flex; align-items: center; gap: 8px; }
    .printer-name { flex: 1; }
    .status-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    .status-dot.online { background: #4caf50; }
    .status-dot.offline { background: #f44336; }
    .studio-name { font-size: 12px; color: rgba(0,0,0,.54); }
  `],
})
export class ReassignPrinterDialogComponent {
  readonly dialogRef = inject(MatDialogRef<ReassignPrinterDialogComponent>);
  readonly data: ReassignDialogData = inject(MAT_DIALOG_DATA);
  readonly selected = signal<string | null>(null);

  isOnline(printerName: string): boolean {
    const s = this.data.statuses.find(st => st.printer_name === printerName);
    return s?.online ?? false;
  }
}
