import {
  Component, inject, signal, OnInit, ChangeDetectionStrategy, DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { FormsModule } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { ProductionApiService, PrintingHouse } from '../../../services/production-api.service';
import { CAPABILITY_LIST } from '../production.constants';
import { ConfirmDialogComponent, ConfirmDialogData } from '../../shared/confirm-dialog.component';

const ALL_CAPABILITIES = CAPABILITY_LIST;

@Component({
  selector: 'app-production-house-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, MatSelectModule, MatCheckboxModule, MatProgressSpinnerModule,
    MatSnackBarModule, FormsModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ house ? 'Редактировать типографию' : 'Новая типография' }}</h2>

    <mat-dialog-content>
      <form class="house-form">
        <div class="form-row">
          <mat-form-field class="flex-2">
            <mat-label>Название *</mat-label>
            <input matInput [(ngModel)]="form.name" name="name" required />
            <mat-error>Обязательное поле</mat-error>
          </mat-form-field>
          <mat-form-field class="flex-1">
            <mat-label>Код (slug) *</mat-label>
            <input matInput [(ngModel)]="form.code" name="code" required placeholder="primaprint" />
            <mat-error>Обязательное поле</mat-error>
          </mat-form-field>
        </div>

        <div class="form-row">
          <mat-form-field class="flex-1" subscriptSizing="dynamic">
            <mat-label>Статус</mat-label>
            <mat-select [(ngModel)]="form.status" name="status">
              <mat-option value="active">Активна</mat-option>
              <mat-option value="inactive">Неактивна</mat-option>
              <mat-option value="testing">Тестирование</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field class="flex-1" subscriptSizing="dynamic">
            <mat-label>Способ взаимодействия</mat-label>
            <mat-select [(ngModel)]="form.api_type" name="api_type">
              <mat-option value="manual">Ручной</mat-option>
              <mat-option value="email">Email</mat-option>
              <mat-option value="api">API</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <div class="form-row">
          <mat-form-field class="flex-1" subscriptSizing="dynamic">
            <mat-label>Контактное лицо</mat-label>
            <input matInput [(ngModel)]="form.contact_name" name="contact_name" />
          </mat-form-field>
          <mat-form-field class="flex-1" subscriptSizing="dynamic">
            <mat-label>Телефон</mat-label>
            <input matInput [(ngModel)]="form.contact_phone" name="contact_phone" />
          </mat-form-field>
        </div>

        <div class="form-row">
          <mat-form-field class="flex-1" subscriptSizing="dynamic">
            <mat-label>Email</mat-label>
            <input matInput [(ngModel)]="form.contact_email" name="contact_email" type="email" />
          </mat-form-field>
          <mat-form-field class="flex-1" subscriptSizing="dynamic">
            <mat-label>Сайт</mat-label>
            <input matInput [(ngModel)]="form.website" name="website" placeholder="https://" />
          </mat-form-field>
        </div>

        <mat-form-field class="full-width" subscriptSizing="dynamic">
          <mat-label>Адрес</mat-label>
          <input matInput [(ngModel)]="form.address" name="address" />
        </mat-form-field>

        <div class="capabilities-section">
          <div class="caps-label">Возможности</div>
          <div class="caps-grid">
            @for (cap of allCaps; track cap.value) {
              <mat-checkbox
                [checked]="form.capabilities.includes(cap.value)"
                (change)="toggleCap(cap.value)">
                {{ cap.label }}
              </mat-checkbox>
            }
          </div>
        </div>

        <mat-form-field class="full-width" subscriptSizing="dynamic">
          <mat-label>Заметки</mat-label>
          <textarea matInput [(ngModel)]="form.notes" name="notes" rows="3"></textarea>
        </mat-form-field>
      </form>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Отмена</button>
      @if (house) {
        <button mat-stroked-button color="warn" [disabled]="saving()" (click)="remove()">
          Удалить
        </button>
      }
      <button mat-flat-button color="primary"
              [disabled]="!form.name || !form.code || saving()"
              (click)="save()">
        @if (saving()) { <mat-spinner diameter="18" /> }
        {{ house ? 'Сохранить' : 'Добавить' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .house-form { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }
    .form-row { display: flex; gap: 12px; }
    .flex-1 { flex: 1; }
    .flex-2 { flex: 2; }
    .full-width { width: 100%; }

    .capabilities-section {
      border: 1px solid var(--crm-border); border-radius: 8px; padding: 12px;
    }
    .caps-label {
      font-size: 12px; color: var(--crm-text-secondary); margin-bottom: 8px; font-weight: 500;
    }
    .caps-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
  `,
})
export class ProductionHouseFormComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly dialogRef = inject(MatDialogRef<ProductionHouseFormComponent>);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly data = inject<{ house?: PrintingHouse }>(MAT_DIALOG_DATA);

  readonly saving = signal(false);
  readonly allCaps = ALL_CAPABILITIES;

  house?: PrintingHouse;

  form = {
    name: '',
    code: '',
    status: 'active' as 'active' | 'inactive' | 'testing',
    api_type: 'manual' as 'manual' | 'api' | 'email',
    contact_name: '',
    contact_phone: '',
    contact_email: '',
    website: '',
    address: '',
    notes: '',
    capabilities: [] as string[],
  };

  ngOnInit() {
    this.house = this.data.house;
    if (this.house) {
      this.form = {
        name: this.house.name,
        code: this.house.code,
        status: this.house.status,
        api_type: this.house.api_type,
        contact_name: this.house.contact_name ?? '',
        contact_phone: this.house.contact_phone ?? '',
        contact_email: this.house.contact_email ?? '',
        website: this.house.website ?? '',
        address: this.house.address ?? '',
        notes: this.house.notes ?? '',
        capabilities: [...(this.house.capabilities ?? [])],
      };
    }
  }

  toggleCap(cap: string) {
    const idx = this.form.capabilities.indexOf(cap);
    if (idx >= 0) {
      this.form.capabilities.splice(idx, 1);
    } else {
      this.form.capabilities.push(cap);
    }
  }

  remove() {
    if (!this.house) return;
    const message = this.house.total_orders > 0
      ? `Удалить "${this.house.name}"? (${this.house.total_orders} заказов) — будет деактивирована.`
      : `Удалить "${this.house.name}"? Это действие необратимо.`;
    const ref = this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Удалить типографию',
        message,
        icon: 'delete',
        warn: true,
        confirmLabel: 'Удалить',
      } as ConfirmDialogData,
    });
    ref.afterClosed().subscribe(ok => {
      if (!ok || !this.house) return;
      this.saving.set(true);
      this.api.deleteHouse(this.house.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => { this.saving.set(false); this.dialogRef.close(true); },
        error: err => {
          this.snackBar.open(err?.error?.message ?? 'Не удалось удалить типографию', 'OK', { duration: 4000 });
          this.saving.set(false);
        },
      });
    });
  }

  save() {
    this.saving.set(true);
    const payload: Partial<PrintingHouse> = { ...this.form };
    const isNew = !this.house;
    const req$ = this.house
      ? this.api.updateHouse(this.house.id, payload)
      : this.api.createHouse(payload);

    req$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.saving.set(false);
        this.snackBar.open(isNew ? 'Типография добавлена' : 'Изменения сохранены', 'OK', { duration: 3000 });
        this.dialogRef.close(true);
      },
      error: err => {
        this.saving.set(false);
        this.snackBar.open(err?.error?.message ?? 'Ошибка при сохранении', 'OK', { duration: 4000 });
      },
    });
  }
}
