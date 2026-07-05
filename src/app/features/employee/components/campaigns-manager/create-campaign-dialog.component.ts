import {
  Component, inject, signal, ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  CampaignApiService,
  CampaignType,
  CreateCampaignPayload,
} from '../../services/campaign-api.service';

@Component({
  selector: 'app-create-campaign-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatDialogModule, MatButtonModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatIconModule,
    MatSnackBarModule, MatProgressSpinnerModule,
  ],
  template: `
    <h2 mat-dialog-title>Новая кампания</h2>
    <mat-dialog-content>
      <div class="form-grid">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Название</mat-label>
          <input matInput [(ngModel)]="name" required />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Тип</mat-label>
          <mat-select [(ngModel)]="type">
            @for (t of typeOptions; track t.value) {
              <mat-option [value]="t.value">{{ t.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Канал</mat-label>
          <input matInput [(ngModel)]="channel" placeholder="напр. Соборный" />
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Описание</mat-label>
          <textarea matInput [(ngModel)]="description" rows="2"></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Бюджет (руб.)</mat-label>
          <input matInput type="number" [(ngModel)]="budget" min="0" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Дата начала</mat-label>
          <input matInput type="date" [(ngModel)]="startDate" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>Дата окончания</mat-label>
          <input matInput type="date" [(ngModel)]="endDate" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>UTM Source</mat-label>
          <input matInput [(ngModel)]="utmSource" placeholder="flyer" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>UTM Campaign</mat-label>
          <input matInput [(ngModel)]="utmCampaign" placeholder="soborny-2026" />
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      <button mat-flat-button color="primary"
              [disabled]="!name.trim() || saving()"
              (click)="save()">
        @if (saving()) {
          <mat-spinner diameter="18" />
        } @else {
          <ng-container><mat-icon>add</mat-icon> Создать</ng-container>
        }
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 12px;
      min-width: 440px;
    }

    .full-width {
      grid-column: 1 / -1;
    }

    mat-dialog-content {
      max-height: 70vh;
    }
  `],
})
export class CreateCampaignDialogComponent {
  private readonly api = inject(CampaignApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly dialogRef = inject(MatDialogRef<CreateCampaignDialogComponent>);

  name = '';
  type: CampaignType = 'flyer';
  channel = '';
  description = '';
  budget: number | null = null;
  startDate = '';
  endDate = '';
  utmSource = '';
  utmCampaign = '';

  readonly saving = signal(false);

  readonly typeOptions: { value: CampaignType; label: string }[] = [
    { value: 'flyer', label: 'Флайер' },
    { value: 'email', label: 'Email' },
    { value: 'social', label: 'Соцсети' },
    { value: 'sms', label: 'SMS' },
    { value: 'other', label: 'Другое' },
  ];

  save(): void {
    if (!this.name.trim()) return;
    this.saving.set(true);

    const payload: CreateCampaignPayload = {
      name: this.name.trim(),
      type: this.type,
    };
    if (this.channel.trim()) payload.channel = this.channel.trim();
    if (this.description.trim()) payload.description = this.description.trim();
    if (this.budget !== null && this.budget > 0) payload.budget = this.budget;
    if (this.startDate) payload.start_date = this.startDate;
    if (this.endDate) payload.end_date = this.endDate;
    if (this.utmSource.trim()) payload.utm_source = this.utmSource.trim();
    if (this.utmCampaign.trim()) payload.utm_campaign = this.utmCampaign.trim();

    this.api.createCampaign(payload).subscribe({
      next: () => {
        this.snack.open('Кампания создана', 'OK', { duration: 2000 });
        this.dialogRef.close(true);
      },
      error: () => {
        this.snack.open('Ошибка создания кампании', 'OK', { duration: 3000 });
        this.saving.set(false);
      },
    });
  }
}
