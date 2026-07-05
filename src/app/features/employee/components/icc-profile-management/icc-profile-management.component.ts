import {
  Component, inject, signal, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import {
  PrintApiService, IccProfile, CreateIccProfileDto,
} from '../../services/print-api.service';

interface BridgeDevice {
  id: string;
  name: string;
  studio_id: string | null;
  agent_type: string | null;
  is_online: boolean;
}

const MEDIA_TYPES = [
  { id: 'glossy', name: 'Глянцевая' },
  { id: 'matte', name: 'Матовая' },
  { id: 'satin', name: 'Сатин' },
  { id: 'plain', name: 'Обычная' },
  { id: 'thick', name: 'Плотная' },
];

@Component({
  selector: 'app-icc-profile-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, DatePipe,
    MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSlideToggleModule, MatProgressSpinnerModule,
    MatTooltipModule, MatDividerModule,
  ],
  template: `
    <div class="icc-page">
      <div class="icc-header">
        <div>
          <h2 class="icc-title">ICC-профили</h2>
          <p class="icc-subtitle">Цветовые профили для калибровки принтеров</p>
        </div>
        <button mat-flat-button class="add-btn" (click)="startAdd()" [disabled]="adding()">
          <mat-icon>add</mat-icon> Добавить
        </button>
      </div>

      @if (adding() || editingId()) {
        <mat-card class="icc-form-card">
          <div class="form-title">
            {{ editingId() ? 'Редактировать профиль' : 'Новый ICC-профиль' }}
          </div>
          <form [formGroup]="form" (ngSubmit)="save()" class="icc-form">
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-name">
                <mat-label>Название профиля</mat-label>
                <input matInput formControlName="profile_name" placeholder="Epson L8050 Glossy" />
              </mat-form-field>

              <mat-form-field appearance="outline" class="field-media">
                <mat-label>Тип носителя</mat-label>
                <mat-select formControlName="media_type">
                  @for (m of mediaTypes; track m.id) {
                    <mat-option [value]="m.id">{{ m.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="field-device">
                <mat-label>Устройство (Bridge)</mat-label>
                <mat-select formControlName="device_id">
                  @for (d of devices(); track d.id) {
                    <mat-option [value]="d.id">
                      {{ d.name }}
                      @if (d.agent_type) { ({{ d.agent_type === 'rust_agent' ? 'CUPS' : 'Windows' }}) }
                    </mat-option>
                  }
                </mat-select>
              </mat-form-field>

              <mat-form-field appearance="outline" class="field-key">
                <mat-label>Ключ файла (S3)</mat-label>
                <input matInput formControlName="file_key" placeholder="icc/epson-l8050-glossy.icc" />
                <mat-hint>Путь к .icc файлу в S3</mat-hint>
              </mat-form-field>
            </div>

            <div class="form-toggle">
              <mat-slide-toggle formControlName="is_default" color="primary">Профиль по умолчанию</mat-slide-toggle>
            </div>

            <div class="form-actions">
              <button mat-flat-button type="submit" [disabled]="form.invalid || saving()" class="save-btn">
                @if (saving()) { <mat-spinner diameter="16" /> }
                @else { <mat-icon>save</mat-icon> }
                {{ editingId() ? 'Сохранить' : 'Создать' }}
              </button>
              <button mat-button type="button" (click)="cancelEdit()">Отмена</button>
            </div>
          </form>
        </mat-card>
      }

      @if (loading()) {
        <div class="icc-loading"><mat-spinner diameter="32" /></div>
      } @else if (profiles().length === 0) {
        <div class="icc-empty">
          <mat-icon>palette</mat-icon>
          <span>ICC-профили не добавлены</span>
        </div>
      } @else {
        <div class="icc-list">
          @for (p of profiles(); track p.id) {
            <mat-card class="icc-card">
              @if (confirmDeleteId() === p.id) {
                <div class="delete-confirm">
                  <mat-icon class="delete-icon">warning</mat-icon>
                  <span>Удалить профиль «{{ p.profile_name }}»?</span>
                  <div class="delete-actions">
                    <button mat-flat-button color="warn" (click)="confirmDelete(p.id)">Удалить</button>
                    <button mat-button (click)="confirmDeleteId.set(null)">Отмена</button>
                  </div>
                </div>
              }

              <div class="icc-card__header">
                <div class="icc-card__name-row">
                  <span class="profile-name">{{ p.profile_name }}</span>
                  @if (p.is_default) {
                    <span class="default-badge">По умолчанию</span>
                  }
                </div>
                <div class="icc-card__actions">
                  <button mat-icon-button matTooltip="Редактировать" (click)="startEdit(p)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Удалить" class="delete-btn" (click)="requestDelete(p.id)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>

              <div class="icc-card__meta">
                <mat-icon class="meta-icon">devices</mat-icon>
                <span>{{ p.device_name || 'Не привязан' }}</span>
              </div>

              <div class="icc-card__meta">
                <mat-icon class="meta-icon">texture</mat-icon>
                <span>{{ mediaLabel(p.media_type) }}</span>
              </div>

              <mat-divider />

              <div class="icc-card__file">
                <mat-icon class="meta-icon">insert_drive_file</mat-icon>
                <span class="file-key">{{ p.file_key }}</span>
              </div>

              @if (p.calibrated_at) {
                <div class="icc-card__meta">
                  <mat-icon class="meta-icon">event</mat-icon>
                  <span>Калибровка: {{ p.calibrated_at | date:'dd.MM.yyyy' }}</span>
                </div>
              }
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .icc-page { max-width: 900px; margin: 0 auto; padding: 20px 16px; }

    .icc-header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px;
    }

    .icc-title { font-size: 18px; font-weight: 600; color: var(--crm-text-primary); margin: 0 0 2px; }
    .icc-subtitle { font-size: 12px; color: var(--crm-text-secondary); margin: 0; }

    .add-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }

    .icc-form-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.07);
      padding: 20px; margin-bottom: 20px; border-radius: 8px;
    }

    .form-title { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); margin-bottom: 16px; }
    .icc-form { display: flex; flex-direction: column; gap: 4px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .field-name { flex: 2; min-width: 200px; }
    .field-media { flex: 1; min-width: 140px; }
    .field-device { flex: 1; min-width: 200px; }
    .field-key { flex: 2; min-width: 200px; }
    .form-toggle { padding: 4px 0; }

    .form-actions {
      display: flex; gap: 8px; align-items: center; padding-top: 8px;
    }

    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      mat-spinner { display: inline-block; }
    }

    .icc-loading, .icc-empty {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 48px; color: var(--crm-text-secondary); font-size: 14px;
      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    }

    .icc-list {
      display: grid; grid-template-columns: 1fr; gap: 12px;
      @media (min-width: 700px) { grid-template-columns: repeat(2, 1fr); }
    }

    .icc-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; padding: 14px 16px; position: relative; transition: border-color 150ms;
      &:hover { border-color: rgba(139,92,246,0.3); }
    }

    .icc-card__header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px;
    }

    .icc-card__name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .profile-name { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }

    .default-badge {
      font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;
      background: rgba(52,211,153,0.12); color: #34d399;
    }

    .icc-card__actions {
      display: flex; gap: 0; margin: -6px -8px 0 0;
      button mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-secondary); }
      .delete-btn mat-icon { color: rgba(248,113,113,0.6); }
      .delete-btn:hover mat-icon { color: #f87171; }
    }

    .icc-card__meta {
      display: flex; align-items: center; gap: 5px;
      font-size: 12px; color: var(--crm-text-secondary); margin-bottom: 4px;
    }

    .meta-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-text-secondary); }
    mat-divider { margin: 10px 0 8px; border-color: rgba(255,255,255,0.05); }

    .icc-card__file {
      display: flex; align-items: center; gap: 5px; margin-bottom: 4px;
    }

    .file-key {
      font-family: var(--crm-font-mono, monospace); font-size: 11px;
      color: var(--crm-text-secondary);
    }

    .delete-confirm {
      position: absolute; inset: 0; background: rgba(13,13,13,0.95); border-radius: 8px;
      z-index: 10; display: flex; flex-direction: column; align-items: center;
      justify-content: center; gap: 10px; padding: 16px; text-align: center;
    }
    .delete-icon { font-size: 28px; width: 28px; height: 28px; color: #f87171; }
    .delete-confirm span { font-size: 13px; color: var(--crm-text-primary); }
    .delete-actions { display: flex; gap: 8px; }
  `],
})
export class IccProfileManagementComponent implements OnInit {
  private readonly api = inject(PrintApiService);
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);

  readonly profiles = signal<IccProfile[]>([]);
  readonly devices = signal<BridgeDevice[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly adding = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly mediaTypes = MEDIA_TYPES;

  readonly form: FormGroup = this.fb.group({
    profile_name: ['', Validators.required],
    media_type: ['glossy', Validators.required],
    device_id: ['', Validators.required],
    file_key: ['', Validators.required],
    is_default: [false],
  });

  ngOnInit(): void {
    this.loadProfiles();
    this.loadDevices();
  }

  private loadProfiles(): void {
    this.loading.set(true);
    this.api.getIccProfiles().subscribe({
      next: profiles => { this.profiles.set(profiles); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  private loadDevices(): void {
    this.http.get<{ success: boolean; bridges: BridgeDevice[] }>('/api/print/bridges').subscribe({
      next: res => this.devices.set(res.bridges ?? []),
    });
  }

  mediaLabel(id: string): string {
    return MEDIA_TYPES.find(m => m.id === id)?.name ?? id;
  }

  startAdd(): void {
    this.editingId.set(null);
    this.form.reset({ profile_name: '', media_type: 'glossy', device_id: '', file_key: '', is_default: false });
    this.adding.set(true);
  }

  startEdit(profile: IccProfile): void {
    this.adding.set(false);
    this.confirmDeleteId.set(null);
    this.editingId.set(profile.id);
    this.form.patchValue({
      profile_name: profile.profile_name,
      media_type: profile.media_type,
      device_id: profile.device_id,
      file_key: profile.file_key,
      is_default: profile.is_default,
    });
  }

  cancelEdit(): void {
    this.adding.set(false);
    this.editingId.set(null);
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;

    const { profile_name, media_type, device_id, file_key, is_default } = this.form.value as {
      profile_name: string; media_type: string; device_id: string; file_key: string; is_default: boolean;
    };

    this.saving.set(true);
    const id = this.editingId();

    if (id) {
      this.api.updateIccProfile(id, { profile_name, media_type, file_key, is_default }).subscribe({
        next: profile => {
          this.profiles.update(list => list.map(p => p.id === id ? profile : p));
          this.saving.set(false);
          this.editingId.set(null);
        },
        error: () => this.saving.set(false),
      });
    } else {
      const dto: CreateIccProfileDto = { device_id, media_type, profile_name, file_key, is_default };
      this.api.createIccProfile(dto).subscribe({
        next: profile => {
          this.profiles.update(list => [...list, profile]);
          this.saving.set(false);
          this.adding.set(false);
        },
        error: () => this.saving.set(false),
      });
    }
  }

  requestDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  confirmDelete(id: string): void {
    this.api.deleteIccProfile(id).subscribe({
      next: () => {
        this.profiles.update(list => list.filter(p => p.id !== id));
        this.confirmDeleteId.set(null);
      },
    });
  }
}
