import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';

type ToastType = 'success' | 'error' | 'info' | 'warning';

const DURATION = 4000;

const TYPE_CONFIG: Record<ToastType, { panelClass: string; icon: string }> = {
  success: { panelClass: 'toast-success', icon: '\u2705' },
  error:   { panelClass: 'toast-error',   icon: '\u274C' },
  info:    { panelClass: 'toast-info',    icon: '\u2139\uFE0F' },
  warning: { panelClass: 'toast-warning', icon: '\u26A0\uFE0F' },
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  private snackBar = inject(MatSnackBar);

  success(message: string, action = 'OK'): void {
    this.show(message, action, 'success');
  }

  error(message: string, action = 'OK'): void {
    this.show(message, action, 'error', 6000);
  }

  info(message: string, action = 'OK'): void {
    this.show(message, action, 'info');
  }

  warning(message: string, action = 'OK'): void {
    this.show(message, action, 'warning', 5000);
  }

  private show(message: string, action: string, type: ToastType, duration = DURATION): void {
    const cfg = TYPE_CONFIG[type];
    const config: MatSnackBarConfig = {
      duration,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: [cfg.panelClass],
    };
    this.snackBar.open(`${cfg.icon} ${message}`, action, config);
  }
}
