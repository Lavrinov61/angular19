import type { MatDialogConfig } from '@angular/material/dialog';

const PRINT_FULLSCREEN_DIALOG_SIZE = {
  width: 'calc(100vw - 8px)',
  maxWidth: '100vw',
  height: 'calc(100vh - 8px)',
  maxHeight: '100vh',
} satisfies Pick<MatDialogConfig<unknown>, 'width' | 'maxWidth' | 'height' | 'maxHeight'>;

const PRINT_FULLSCREEN_PANEL_CLASS = 'print-fullscreen-dialog-panel';

function withPrintDialogPanel<D>(data: D, panelClass: string): MatDialogConfig<D> {
  return {
    ...PRINT_FULLSCREEN_DIALOG_SIZE,
    panelClass: [PRINT_FULLSCREEN_PANEL_CLASS, panelClass],
    data,
  };
}

export function printDialogConfig<D>(data: D): MatDialogConfig<D> {
  return withPrintDialogPanel(data, 'print-dialog-panel');
}

export function documentSetPrintDialogConfig<D>(data: D): MatDialogConfig<D> {
  return withPrintDialogPanel(data, 'document-set-print-dialog-panel');
}

export function batchPrintDialogConfig<D>(data: D): MatDialogConfig<D> {
  return withPrintDialogPanel(data, 'batch-print-dialog-panel');
}
