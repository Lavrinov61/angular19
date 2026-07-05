import {
  Component, inject, signal, ChangeDetectionStrategy, OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
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
  PrintApiService, ServiceCatalogItem, CreateServiceCatalogDto,
} from '../../services/print-api.service';

const SERVICE_CATEGORIES = [
  { id: 'photo_print', name: 'Фотопечать' },
  { id: 'copy', name: 'Ксерокопия' },
  { id: 'scan', name: 'Сканирование' },
  { id: 'lamination', name: 'Ламинирование' },
  { id: 'document_photo', name: 'Фото на документы' },
  { id: 'design', name: 'Дизайн' },
  { id: 'other', name: 'Прочее' },
];

const DEVICE_TYPES = [
  { id: 'photo', name: 'Фото-принтер' },
  { id: 'mfp', name: 'МФУ' },
  { id: 'document', name: 'Документный' },
];

@Component({
  selector: 'app-service-catalog-management',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule, DecimalPipe,
    MatCardModule, MatIconModule, MatButtonModule,
    MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSlideToggleModule, MatProgressSpinnerModule,
    MatTooltipModule, MatDividerModule,
  ],
  template: `
    <div class="sc-page">
      <div class="sc-header">
        <div>
          <h2 class="sc-title">Каталог услуг печати</h2>
          <p class="sc-subtitle">{{ services().length }} услуг(а) в каталоге</p>
        </div>
        <button mat-flat-button class="add-btn" (click)="startAdd()" [disabled]="adding()">
          <mat-icon>add</mat-icon> Добавить
        </button>
      </div>

      @if (adding() || editingId()) {
        <mat-card class="sc-form-card">
          <div class="form-title">
            {{ editingId() ? 'Редактировать услугу' : 'Новая услуга' }}
          </div>
          <form [formGroup]="form" (ngSubmit)="save()" class="sc-form">
            <div class="form-row">
              <mat-form-field appearance="outline" class="field-lg">
                <mat-label>Название</mat-label>
                <input matInput formControlName="name" placeholder="Фотопечать 10x15" />
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Slug</mat-label>
                <input matInput formControlName="slug" placeholder="photo-10x15" />
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Категория</mat-label>
                <mat-select formControlName="category">
                  @for (cat of serviceCategories; track cat.id) {
                    <mat-option [value]="cat.id">{{ cat.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-md">
                <mat-label>Тип устройства</mat-label>
                <mat-select formControlName="required_device_type">
                  <mat-option [value]="null">Любой</mat-option>
                  @for (dt of deviceTypes; track dt.id) {
                    <mat-option [value]="dt.id">{{ dt.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
            </div>

            <div class="form-row">
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Базовая цена</mat-label>
                <input matInput type="number" formControlName="base_price" />
                <span matTextSuffix>&#8381;</span>
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Цена за шт.</mat-label>
                <input matInput type="number" formControlName="price_per_unit" />
                <span matTextSuffix>&#8381;</span>
              </mat-form-field>
              <mat-form-field appearance="outline" class="field-sm">
                <mat-label>Порядок</mat-label>
                <input matInput type="number" formControlName="sort_order" />
              </mat-form-field>
            </div>

            <div class="form-toggles">
              <mat-slide-toggle formControlName="requires_template" color="primary">Нужен шаблон документа</mat-slide-toggle>
              <mat-slide-toggle formControlName="requires_design_editor" color="primary">Нужен дизайн-редактор</mat-slide-toggle>
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
        <div class="sc-loading"><mat-spinner diameter="32" /></div>
      } @else if (services().length === 0) {
        <div class="sc-empty">
          <mat-icon>storefront</mat-icon>
          <span>Каталог пуст</span>
        </div>
      } @else {
        <div class="sc-list">
          @for (s of services(); track s.id) {
            <mat-card class="sc-card" [class.sc-card--inactive]="!s.is_active">
              @if (confirmDeleteId() === s.id) {
                <div class="delete-confirm">
                  <mat-icon class="delete-icon">warning</mat-icon>
                  <span>Удалить «{{ s.name }}»?</span>
                  <div class="delete-actions">
                    <button mat-flat-button color="warn" (click)="confirmDelete(s.id)">Удалить</button>
                    <button mat-button (click)="confirmDeleteId.set(null)">Отмена</button>
                  </div>
                </div>
              }

              <div class="sc-card__header">
                <div class="sc-card__name-row">
                  <span class="service-name">{{ s.name }}</span>
                  <span class="cat-badge" [style.background]="catColor(s.category) + '18'" [style.color]="catColor(s.category)">
                    {{ categoryLabel(s.category) }}
                  </span>
                  @if (!s.is_active) {
                    <span class="inactive-badge">Скрыта</span>
                  }
                </div>
                <div class="sc-card__actions">
                  <button mat-icon-button matTooltip="Редактировать" (click)="startEdit(s)">
                    <mat-icon>edit</mat-icon>
                  </button>
                  <button mat-icon-button matTooltip="Удалить" class="delete-btn" (click)="requestDelete(s.id)">
                    <mat-icon>delete</mat-icon>
                  </button>
                </div>
              </div>

              <div class="sc-card__slug">
                <mat-icon class="meta-icon">link</mat-icon>
                <span class="slug-text">{{ s.slug }}</span>
              </div>

              <mat-divider />

              <div class="sc-card__pricing">
                @if (s.base_price > 0) {
                  <div class="price-item">
                    <span class="price-label">Базовая:</span>
                    <span class="price-value">{{ s.base_price | number:'1.0-0' }} &#8381;</span>
                  </div>
                }
                @if (s.price_per_unit > 0) {
                  <div class="price-item">
                    <span class="price-label">За шт.:</span>
                    <span class="price-value">{{ s.price_per_unit | number:'1.0-0' }} &#8381;</span>
                  </div>
                }
              </div>

              <div class="sc-card__flags">
                @if (s.required_device_type) {
                  <span class="flag-chip">{{ deviceLabel(s.required_device_type) }}</span>
                }
                @if (s.requires_template) {
                  <span class="flag-chip flag-chip--tpl">Шаблон</span>
                }
                @if (s.requires_design_editor) {
                  <span class="flag-chip flag-chip--design">Дизайн</span>
                }
              </div>
            </mat-card>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .sc-page { max-width: 900px; margin: 0 auto; padding: 20px 16px; }

    .sc-header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 20px;
    }

    .sc-title { font-size: 18px; font-weight: 600; color: var(--crm-text-primary); margin: 0 0 2px; }
    .sc-subtitle { font-size: 12px; color: var(--crm-text-secondary); margin: 0; }

    .add-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; margin-right: 4px; }
    }

    .sc-form-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.07);
      padding: 20px; margin-bottom: 20px; border-radius: 8px;
    }

    .form-title { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); margin-bottom: 16px; }
    .sc-form { display: flex; flex-direction: column; gap: 4px; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .field-lg { flex: 2; min-width: 200px; }
    .field-md { flex: 1; min-width: 140px; }
    .field-sm { flex: 1; min-width: 100px; }

    .form-toggles { display: flex; gap: 20px; flex-wrap: wrap; padding: 8px 0; }

    .form-actions {
      display: flex; gap: 8px; align-items: center; padding-top: 8px;
    }

    .save-btn {
      background: var(--crm-accent); color: #fff; font-size: 13px; height: 34px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      mat-spinner { display: inline-block; }
    }

    .sc-loading, .sc-empty {
      display: flex; align-items: center; justify-content: center; gap: 12px;
      padding: 48px; color: var(--crm-text-secondary); font-size: 14px;
      mat-icon { font-size: 32px; width: 32px; height: 32px; opacity: 0.4; }
    }

    .sc-list {
      display: grid; grid-template-columns: 1fr; gap: 12px;
      @media (min-width: 700px) { grid-template-columns: repeat(2, 1fr); }
    }

    .sc-card {
      background: var(--crm-surface-2); border: 1px solid rgba(255,255,255,0.06);
      border-radius: 8px; padding: 14px 16px; position: relative; transition: border-color 150ms;
      &:hover { border-color: rgba(139,92,246,0.3); }
    }

    .sc-card--inactive { opacity: 0.55; }

    .sc-card__header {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px;
    }

    .sc-card__name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .service-name { font-size: 14px; font-weight: 600; color: var(--crm-text-primary); }

    .cat-badge {
      font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px;
    }

    .inactive-badge {
      font-size: 10px; padding: 2px 7px; border-radius: 4px;
      background: rgba(248,113,113,0.12); color: #f87171;
    }

    .sc-card__actions {
      display: flex; gap: 0; margin: -6px -8px 0 0;
      button mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-secondary); }
      .delete-btn mat-icon { color: rgba(248,113,113,0.6); }
      .delete-btn:hover mat-icon { color: #f87171; }
    }

    .sc-card__slug {
      display: flex; align-items: center; gap: 5px; margin-bottom: 4px;
    }

    .slug-text {
      font-family: var(--crm-font-mono, monospace); font-size: 11px; color: var(--crm-text-secondary);
    }

    .meta-icon { font-size: 14px; width: 14px; height: 14px; color: var(--crm-text-secondary); }
    mat-divider { margin: 10px 0 8px; border-color: rgba(255,255,255,0.05); }

    .sc-card__pricing {
      display: flex; gap: 16px; margin-bottom: 8px;
    }

    .price-item { display: flex; gap: 4px; align-items: baseline; }
    .price-label { font-size: 11px; color: var(--crm-text-secondary); }
    .price-value { font-size: 14px; font-weight: 600; color: #34d399; }

    .sc-card__flags { display: flex; flex-wrap: wrap; gap: 4px; }

    .flag-chip {
      font-size: 10px; padding: 2px 8px; border-radius: 4px;
      background: rgba(156,163,175,0.1); color: #9ca3af;
      border: 1px solid rgba(156,163,175,0.2);
    }

    .flag-chip--tpl {
      background: rgba(96,165,250,0.1); color: #60a5fa; border-color: rgba(96,165,250,0.2);
    }

    .flag-chip--design {
      background: rgba(251,191,36,0.1); color: #fbbf24; border-color: rgba(251,191,36,0.2);
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
export class ServiceCatalogManagementComponent implements OnInit {
  private readonly api = inject(PrintApiService);
  private readonly fb = inject(FormBuilder);

  readonly services = signal<ServiceCatalogItem[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly adding = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly confirmDeleteId = signal<string | null>(null);
  readonly serviceCategories = SERVICE_CATEGORIES;
  readonly deviceTypes = DEVICE_TYPES;

  private readonly catColors: Record<string, string> = {
    photo_print: '#60a5fa', copy: '#9ca3af', scan: '#a78bfa',
    lamination: '#fbbf24', document_photo: '#34d399', design: '#f472b6', other: '#6b7280',
  };

  readonly form: FormGroup = this.fb.group({
    name: ['', Validators.required],
    slug: ['', Validators.required],
    category: ['photo_print', Validators.required],
    required_device_type: [null as string | null],
    base_price: [0],
    price_per_unit: [0],
    sort_order: [0],
    requires_template: [false],
    requires_design_editor: [false],
  });

  ngOnInit(): void {
    this.loadServices();
  }

  private loadServices(): void {
    this.loading.set(true);
    this.api.getServiceCatalog().subscribe({
      next: services => { this.services.set(services); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  categoryLabel(id: string): string {
    return SERVICE_CATEGORIES.find(c => c.id === id)?.name ?? id;
  }

  catColor(id: string): string {
    return this.catColors[id] ?? '#9ca3af';
  }

  deviceLabel(id: string): string {
    return DEVICE_TYPES.find(d => d.id === id)?.name ?? id;
  }

  startAdd(): void {
    this.editingId.set(null);
    this.form.reset({
      name: '', slug: '', category: 'photo_print', required_device_type: null,
      base_price: 0, price_per_unit: 0, sort_order: 0,
      requires_template: false, requires_design_editor: false,
    });
    this.adding.set(true);
  }

  startEdit(s: ServiceCatalogItem): void {
    this.adding.set(false);
    this.confirmDeleteId.set(null);
    this.editingId.set(s.id);
    this.form.patchValue({
      name: s.name, slug: s.slug, category: s.category,
      required_device_type: s.required_device_type,
      base_price: s.base_price, price_per_unit: s.price_per_unit,
      sort_order: s.sort_order, requires_template: s.requires_template,
      requires_design_editor: s.requires_design_editor,
    });
  }

  cancelEdit(): void {
    this.adding.set(false);
    this.editingId.set(null);
  }

  save(): void {
    if (this.form.invalid || this.saving()) return;

    const v = this.form.value;
    this.saving.set(true);
    const id = this.editingId();

    if (id) {
      this.api.updateServiceCatalogItem(id, {
        name: v.name, category: v.category, required_device_type: v.required_device_type,
        base_price: v.base_price, price_per_unit: v.price_per_unit,
        sort_order: v.sort_order, requires_template: v.requires_template,
        requires_design_editor: v.requires_design_editor,
      }).subscribe({
        next: service => {
          this.services.update(list => list.map(s => s.id === id ? service : s));
          this.saving.set(false);
          this.editingId.set(null);
        },
        error: () => this.saving.set(false),
      });
    } else {
      const dto: CreateServiceCatalogDto = {
        slug: v.slug, name: v.name, category: v.category,
        required_device_type: v.required_device_type,
        base_price: v.base_price, price_per_unit: v.price_per_unit,
        sort_order: v.sort_order, requires_template: v.requires_template,
        requires_design_editor: v.requires_design_editor,
      };
      this.api.createServiceCatalogItem(dto).subscribe({
        next: service => {
          this.services.update(list => [...list, service]);
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
    this.api.deleteServiceCatalogItem(id).subscribe({
      next: () => {
        this.services.update(list => list.filter(s => s.id !== id));
        this.confirmDeleteId.set(null);
      },
    });
  }
}
