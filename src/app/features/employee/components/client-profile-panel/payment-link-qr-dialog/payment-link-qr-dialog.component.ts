import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import type { PaymentLink } from '../../../services/payments.service';

export interface PaymentLinkQrDialogData {
  paymentLink: PaymentLink;
  payUrl: string;
}

@Component({
  selector: 'app-payment-link-qr-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './payment-link-qr-dialog.component.html',
  styleUrls: ['./payment-link-qr-dialog.component.scss'],
})
export class PaymentLinkQrDialogComponent implements OnInit {
  readonly data = inject<PaymentLinkQrDialogData>(MAT_DIALOG_DATA);
  readonly dialogRef = inject(MatDialogRef<PaymentLinkQrDialogComponent>);
  readonly qrDataUrl = signal<string | null>(null);
  readonly copied = signal(false);
  readonly error = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(this.data.payUrl, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      this.qrDataUrl.set(dataUrl);
    } catch (err) {
      console.error('QR generation failed', err);
      this.error.set('Не удалось сгенерировать QR-код');
    }
  }

  async copyLink(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(this.data.payUrl);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch (err) {
      console.error('Clipboard write failed', err);
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}
