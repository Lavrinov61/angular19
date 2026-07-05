import { Component, ChangeDetectionStrategy, inject } from '@angular/core';

import { MatDialogRef, MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';
import { StudioAddress } from '../../../core/data/address.data';

export interface AddressSelectDialogData {
  addresses: StudioAddress[];
}

@Component({
  selector: 'app-address-select-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatCardModule
],
  template: `
    <div class="address-select-dialog">
      <h2 mat-dialog-title>
        <mat-icon>location_on</mat-icon>
        Выберите адрес студии
      </h2>
      
      <mat-dialog-content>
        <div class="addresses-list">
          @for (address of data.addresses; track address.id) {
            <mat-card 
              class="address-card"
              (click)="selectAddress(address)">
              <mat-card-header>
                <div mat-card-avatar class="address-avatar">
                  <mat-icon>business</mat-icon>
                </div>
                <mat-card-title>{{ address.name }}</mat-card-title>
                <mat-card-subtitle>{{ address.address }}</mat-card-subtitle>
              </mat-card-header>
              
              <mat-card-content>
                <div class="address-info">
                  <div class="info-item">
                    <mat-icon>schedule</mat-icon>
                    <span>{{ address.workHours }}</span>
                  </div>
                </div>
              </mat-card-content>
              
              <mat-card-actions>
                <button mat-raised-button color="primary" (click)="selectAddress(address); $event.stopPropagation()">
                  <mat-icon>directions</mat-icon>
                  Построить маршрут
                </button>
              </mat-card-actions>
            </mat-card>
          }
        </div>
      </mat-dialog-content>
      
      <mat-dialog-actions align="end">
        <button mat-button mat-dialog-close>Отмена</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [`
    .address-select-dialog {
      max-width: 600px;
      width: 100%;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      padding: 24px 24px 16px;
      border-bottom: 1px solid var(--ed-outline-variant, #2a2a2a);
      font-family: var(--ed-font-display, 'Oswald', sans-serif);
      text-transform: uppercase;
      letter-spacing: -0.01em;
      color: var(--ed-on-surface, #f5f5f5);
    }

    h2[mat-dialog-title] mat-icon {
      color: var(--ed-accent, #f59e0b);
    }

    mat-dialog-content {
      padding: 24px;
      max-height: 60vh;
      overflow-y: auto;
    }

    .addresses-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .address-card {
      cursor: pointer;
      transition: border-color 200ms, transform 200ms;
      border: 1px solid var(--ed-outline-variant, #2a2a2a);
      background: var(--ed-surface-container, #1a1a1a);
    }

    .address-card:hover {
      border-color: var(--ed-accent, #f59e0b);
      transform: translateY(-2px);
    }

    .address-avatar {
      background: var(--ed-accent-container, #451a03);
      color: var(--ed-accent, #f59e0b);
    }

    .address-info {
      margin-top: 12px;
    }

    .info-item {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--ed-on-surface-muted, #666);
      font-size: 14px;
    }

    .info-item mat-icon {
      font-size: 18px;
      width: 18px;
      height: 18px;
    }

    mat-card-actions {
      padding: 8px 16px 16px;
    }

    mat-card-actions button {
      width: 100%;
    }

    mat-dialog-actions {
      padding: 16px 24px 24px;
      border-top: 1px solid var(--ed-outline-variant, #2a2a2a);
    }

    @media (max-width: 600px) {
      .address-select-dialog {
        margin: 8px;
        max-width: calc(100vw - 16px);
      }

      h2[mat-dialog-title],
      mat-dialog-content,
      mat-dialog-actions {
        padding-left: 16px;
        padding-right: 16px;
      }
    }
  `]
})
export class AddressSelectDialogComponent {
  dialogRef = inject<MatDialogRef<AddressSelectDialogComponent>>(MatDialogRef);
  data = inject<AddressSelectDialogData>(MAT_DIALOG_DATA);


  selectAddress(address: StudioAddress): void {
    this.dialogRef.close(address);
  }
}




