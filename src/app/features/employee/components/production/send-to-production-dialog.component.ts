import {
  Component, ChangeDetectionStrategy, inject, signal, computed, OnInit,
} from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { forkJoin } from 'rxjs';
import {
  ProductionApiService, PrintingHouse, ProductionOrder, CrmFile,
} from '../../services/production-api.service';

export interface SendToProductionInput {
  source: 'pos' | 'cart' | 'production_order';
  receiptId?: string;
  receiptItems?: { product_name: string; quantity: number; unit_price: number; total: number }[];
  cartItems?: { name: string; price: number; quantity: number }[];
  orderId?: string;
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  canvas: ['холст', 'canvas', 'натяж', 'подрамник'],
  photo_book: ['фотокниг', 'книг', 'альбом'],
  calendar: ['календар'],
  photo_print: ['фотопечат', 'печат', '10x15', '15x21', '20x30'],
  large_format: ['плакат', 'poster', 'баннер', 'широкоформат'],
  souvenir: ['кружк', 'магнит', 'пазл', 'подушк'],
  polygraphy: ['визитк', 'листовк', 'буклет'],
};

function inferCategory(name: string): string | null {
  const lower = name.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some(kw => lower.includes(kw))) return cat;
  }
  return null;
}

@Component({
  selector: 'app-send-to-production-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule,
    MatSelectModule, MatFormFieldModule, MatInputModule, MatCheckboxModule,
    MatSnackBarModule, FormsModule,
  ],
  template: `
    <div mat-dialog-title class="dialog-header">
      <mat-icon class="header-icon">factory</mat-icon>
      <span>Отправить на производство</span>
    </div>

    <mat-dialog-content>
      @if (loading()) {
        <div class="center-state"><mat-spinner diameter="36" /></div>
      } @else if (success()) {
        <div class="success-state">
          <mat-icon class="success-icon">check_circle</mat-icon>
          <h3>Email отправлен</h3>
          <p>Заказ {{ order()?.order_number }} отправлен в типографию</p>
          <p class="success-detail">Статус: {{ emailResult()?.orderStatus }}</p>
        </div>
      } @else {
        <!-- Типография -->
        <section class="section">
          <span class="section-label">Типография</span>
          <mat-form-field class="full-width" subscriptSizing="dynamic">
            <mat-select [(ngModel)]="selectedHouseId" placeholder="Выберите типографию">
              @for (h of houses(); track h.id) {
                <mat-option [value]="h.id">
                  {{ h.name }}
                  @if (!h.contact_email) { <span class="no-email"> (нет email)</span> }
                </mat-option>
              }
            </mat-select>
          </mat-form-field>
          @if (selectedHouse() && !selectedHouse()!.contact_email) {
            <div class="warn-banner">
              <mat-icon>warning</mat-icon>
              У типографии «{{ selectedHouse()!.name }}» не указан email. Добавьте контакт перед отправкой.
            </div>
          }
        </section>

        <!-- ТЗ таблица -->
        <section class="section">
          <span class="section-label">Состав заказа</span>
          <div class="items-table">
            <div class="items-header">
              <span>Продукт</span>
              <span class="col-qty">Кол-во</span>
              <span class="col-price">Цена</span>
              <span class="col-total">Итого</span>
              <span class="col-action"></span>
            </div>
            @for (item of items(); track $index; let i = $index) {
              <div class="items-row">
                <span class="item-name">{{ item.product_name }}</span>
                <div class="col-qty qty-controls">
                  <button class="qty-btn" (click)="changeQty(i, -1)" [disabled]="item.quantity <= 1">−</button>
                  <span>{{ item.quantity }}</span>
                  <button class="qty-btn" (click)="changeQty(i, 1)">+</button>
                </div>
                <span class="col-price">{{ item.unit_price }}₽</span>
                <span class="col-total total-val">{{ item.total_price }}₽</span>
                <button class="col-action remove-btn" (click)="removeItem(i)">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
            <div class="items-footer">
              <span>Итого</span>
              <span class="total-cost">{{ totalCost() }}₽</span>
            </div>
          </div>
        </section>

        <!-- Файлы -->
        <section class="section">
          <span class="section-label">Файлы для производства</span>
          @if (linkedFiles().length > 0) {
            <div class="file-list">
              @for (f of linkedFiles(); track f.uuid) {
                <div class="file-item">
                  <mat-checkbox [checked]="isFileSelected(f.uuid)"
                                (change)="toggleFile(f.uuid)" />
                  <mat-icon class="file-icon">insert_drive_file</mat-icon>
                  <span class="file-name">{{ f.original_name }}</span>
                </div>
              }
            </div>
          }
          <div class="upload-zone" tabindex="0" (click)="fileInput.click()" (keydown.enter)="fileInput.click()"
               (drop)="onDrop($event)" (dragover)="$event.preventDefault()">
            <mat-icon>cloud_upload</mat-icon>
            <span>Загрузить файлы (drag & drop или клик)</span>
            <input #fileInput type="file" multiple hidden (change)="onFileSelect($event)" />
          </div>
          @if (uploadedFiles().length > 0) {
            <div class="file-list uploaded">
              @for (f of uploadedFiles(); track f.uuid) {
                <div class="file-item">
                  <mat-icon class="file-icon uploaded-icon">check_circle</mat-icon>
                  <span class="file-name">{{ f.original_name }}</span>
                </div>
              }
            </div>
          }
          @if (uploading()) {
            <div class="upload-progress">
              <mat-spinner diameter="16" />
              <span>Загрузка...</span>
            </div>
          }
        </section>

        <!-- Примечания -->
        <section class="section">
          <mat-form-field class="full-width" subscriptSizing="dynamic">
            <mat-label>Примечания для типографии</mat-label>
            <textarea matInput [(ngModel)]="printingHouseNotes" rows="3"
                      placeholder="Особые пожелания, требования к материалам..."></textarea>
          </mat-form-field>
        </section>

        <!-- Дедлайн -->
        <section class="section">
          <mat-form-field class="full-width" subscriptSizing="dynamic">
            <mat-label>Дедлайн</mat-label>
            <input matInput type="date" [(ngModel)]="deadline" />
          </mat-form-field>
        </section>
      }
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      @if (success()) {
        <button mat-flat-button color="primary" [mat-dialog-close]="true">Готово</button>
      } @else {
        <button mat-button [mat-dialog-close]="false">Отмена</button>
        <button mat-flat-button color="primary"
                [disabled]="sending() || !canSend()"
                (click)="send()">
          @if (sending()) { <mat-spinner diameter="18" /> }
          <mat-icon>email</mat-icon>
          Отправить ТЗ
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-header {
      display: flex; align-items: center; gap: 10px;
      font-size: 18px; font-weight: 600;
    }
    .header-icon { color: var(--crm-accent); }

    .center-state { display: flex; justify-content: center; padding: 40px; }

    .success-state {
      text-align: center; padding: 32px 20px;
      .success-icon { font-size: 56px; width: 56px; height: 56px; color: #34d399; }
      h3 { margin: 12px 0 4px; font-size: 20px; color: var(--crm-text-primary); }
      p { font-size: 14px; color: var(--crm-text-secondary); margin: 4px 0; }
      .success-detail { font-size: 12px; color: var(--crm-text-muted); }
    }

    .section { margin-bottom: 16px; }
    .section-label {
      display: block; font-size: 12px; font-weight: 600; text-transform: uppercase;
      letter-spacing: 0.04em; color: var(--crm-text-secondary); margin-bottom: 6px;
    }
    .full-width { width: 100%; }
    .no-email { color: #f87171; font-size: 12px; }

    .warn-banner {
      display: flex; align-items: center; gap: 6px;
      padding: 8px 12px; background: #fff3e0; border-radius: 8px;
      font-size: 12px; color: #e65100; margin-top: 6px;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
    }

    .items-table { border: 1px solid var(--crm-border); border-radius: 8px; overflow: hidden; }
    .items-header {
      display: grid; grid-template-columns: 1fr 90px 70px 70px 32px;
      padding: 8px 12px; background: var(--crm-surface-hover);
      font-size: 12px; font-weight: 600; color: var(--crm-text-secondary);
    }
    .items-row {
      display: grid; grid-template-columns: 1fr 90px 70px 70px 32px;
      padding: 8px 12px; border-top: 1px solid var(--crm-border);
      font-size: 13px; align-items: center;
    }
    .item-name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .qty-controls { display: flex; align-items: center; gap: 4px; }
    .qty-btn {
      width: 22px; height: 22px; border-radius: 6px;
      border: 1px solid var(--crm-border); background: var(--crm-glass-bg);
      font-size: 13px; font-weight: 600; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      &:disabled { opacity: 0.3; }
    }
    .total-val { font-weight: 600; }
    .remove-btn {
      border: none; background: none; cursor: pointer;
      color: var(--crm-text-muted); display: flex; align-items: center;
      mat-icon { font-size: 16px; width: 16px; height: 16px; }
      &:hover { color: #f87171; }
    }
    .items-footer {
      display: flex; justify-content: space-between; padding: 10px 12px;
      border-top: 2px solid var(--crm-border); background: var(--crm-surface-hover);
      font-weight: 600;
    }
    .total-cost { color: var(--crm-accent); font-size: 16px; }

    .file-list { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
    .file-list.uploaded { margin-top: 8px; }
    .file-item {
      display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer;
      padding: 4px 0;
    }
    .file-icon { font-size: 16px; width: 16px; height: 16px; color: var(--crm-text-muted); }
    .uploaded-icon { color: #34d399; }
    .file-name {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      color: var(--crm-text-primary);
    }

    .upload-zone {
      display: flex; align-items: center; justify-content: center; gap: 8px;
      padding: 16px; border: 2px dashed var(--crm-border); border-radius: 8px;
      cursor: pointer; color: var(--crm-text-muted); font-size: 13px;
      transition: border-color 150ms, background 150ms;
      &:hover { border-color: var(--crm-accent); background: var(--crm-surface-hover); }
    }

    .upload-progress {
      display: flex; align-items: center; gap: 6px;
      font-size: 12px; color: var(--crm-text-secondary); margin-top: 6px;
    }
  `,
})
export class SendToProductionDialogComponent implements OnInit {
  private readonly api = inject(ProductionApiService);
  private readonly http = inject(HttpClient);
  private readonly dialogRef = inject(MatDialogRef<SendToProductionDialogComponent>);
  private readonly snackBar = inject(MatSnackBar);
  readonly data = inject<SendToProductionInput>(MAT_DIALOG_DATA);

  readonly loading = signal(true);
  readonly sending = signal(false);
  readonly uploading = signal(false);
  readonly success = signal(false);

  readonly order = signal<ProductionOrder | null>(null);
  readonly houses = signal<PrintingHouse[]>([]);
  selectedHouseId: string | null = null;
  readonly items = signal<{
    product_name: string; quantity: number; unit_price: number; total_price: number;
  }[]>([]);
  readonly linkedFiles = signal<CrmFile[]>([]);
  readonly uploadedFiles = signal<CrmFile[]>([]);
  private readonly selectedFileUuids = signal<Set<string>>(new Set());
  printingHouseNotes = '';
  deadline: string | null = null;
  readonly emailResult = signal<{ emailId: number; orderStatus: string } | null>(null);

  readonly selectedHouse = computed(() => {
    const id = this.selectedHouseId;
    return this.houses().find(h => h.id === id) ?? null;
  });

  readonly totalCost = computed(() =>
    this.items().reduce((sum, i) => sum + i.total_price, 0),
  );

  canSend(): boolean {
    return !!this.selectedHouseId
      && !!this.selectedHouse()?.contact_email
      && this.items().length > 0
      && !this.uploading();
  }

  ngOnInit(): void {
    this.api.getHouses('active').subscribe(houses => {
      this.houses.set(houses);
      if (this.data.source === 'production_order' && this.data.orderId) {
        this.loadExistingOrder(this.data.orderId, houses);
      } else {
        this.initFromSource(houses);
      }
    });
  }

  private loadExistingOrder(orderId: string, _houses: PrintingHouse[]): void {
    this.api.getOrder(orderId).subscribe({
      next: o => {
        this.order.set(o);
        this.selectedHouseId = o.printing_house_id;
        this.items.set((o.items || []).map(i => ({
          product_name: i.product_name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total_price: i.total_price,
        })));
        this.printingHouseNotes = o.printing_house_notes || '';
        this.deadline = o.deadline_at ? o.deadline_at.split('T')[0] : null;
        this.loadLinkedFiles(orderId);
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Не удалось загрузить заказ', 'OK', { duration: 4000 });
        this.loading.set(false);
      },
    });
  }

  private initFromSource(houses: PrintingHouse[]): void {
    let mappedItems: {
      product_name: string; quantity: number; unit_price: number; total_price: number;
    }[] = [];

    if (this.data.source === 'pos' && this.data.receiptItems) {
      mappedItems = this.data.receiptItems.map(i => ({
        product_name: i.product_name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        total_price: i.total,
      }));
    } else if (this.data.source === 'cart' && this.data.cartItems) {
      mappedItems = this.data.cartItems.map(i => ({
        product_name: i.name,
        quantity: i.quantity,
        unit_price: i.price,
        total_price: i.price * i.quantity,
      }));
    }

    this.items.set(mappedItems);

    // Auto-select best house
    const _categories = [...new Set(
      mappedItems.map(i => inferCategory(i.product_name)).filter((c): c is string => c !== null),
    )];
    const ranked = houses.filter(h => h.contact_email).sort((a, b) => b.quality_score - a.quality_score);
    if (ranked.length > 0) {
      this.selectedHouseId = ranked[0].id;
    } else if (houses.length > 0) {
      this.selectedHouseId = houses[0].id;
    }

    this.loading.set(false);
  }

  private loadLinkedFiles(orderId: string): void {
    this.http.get<{ success: boolean; data: CrmFile[] }>(
      '/api/files/crm', { params: { entity_type: 'production_order', entity_id: orderId } },
    ).subscribe({
      next: res => {
        if (res.success && res.data) {
          this.linkedFiles.set(res.data);
          this.selectedFileUuids.set(new Set(res.data.map(f => f.uuid)));
        }
      },
    });
  }

  isFileSelected(uuid: string): boolean {
    return this.selectedFileUuids().has(uuid);
  }

  toggleFile(uuid: string): void {
    this.selectedFileUuids.update(set => {
      const next = new Set(set);
      if (next.has(uuid)) next.delete(uuid); else next.add(uuid);
      return next;
    });
  }

  changeQty(index: number, delta: number): void {
    this.items.update(list => list.map((item, i) => {
      if (i !== index) return item;
      const qty = Math.max(1, item.quantity + delta);
      return { ...item, quantity: qty, total_price: item.unit_price * qty };
    }));
  }

  removeItem(index: number): void {
    this.items.update(list => list.filter((_, i) => i !== index));
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files) this.uploadFiles(files);
  }

  onFileSelect(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files) this.uploadFiles(input.files);
  }

  private uploadFiles(files: FileList): void {
    this.uploading.set(true);
    const uploads = Array.from(files).map(file => {
      const form = new FormData();
      form.append('file', file);
      form.append('entity_type', 'production_order');
      if (this.order()) form.append('entity_id', this.order()!.id);
      form.append('is_public', 'true');
      return this.http.post<{ success: boolean; data: CrmFile }>('/api/files/crm/upload', form);
    });

    forkJoin(uploads).subscribe({
      next: results => {
        const uploaded = results.filter(r => r.success).map(r => r.data);
        this.uploadedFiles.update(list => [...list, ...uploaded]);
        this.selectedFileUuids.update(set => {
          const next = new Set(set);
          uploaded.forEach(f => next.add(f.uuid));
          return next;
        });
        this.uploading.set(false);
      },
      error: () => {
        this.snackBar.open('Ошибка загрузки файлов', 'OK', { duration: 4000 });
        this.uploading.set(false);
      },
    });
  }

  async send(): Promise<void> {
    this.sending.set(true);

    try {
      let orderId = this.order()?.id;

      // Create order first if needed
      if (!orderId) {
        const orderItems = this.items().map(i => ({
          product_id: this.selectedHouseId!,
          product_name: i.product_name,
          category: inferCategory(i.product_name) || 'other',
          specs: {},
          quantity: i.quantity,
          unit_price: i.unit_price,
          total_price: i.total_price,
        }));

        const created = await this.api.createOrder({
          printing_house_id: this.selectedHouseId!,
          items: orderItems,
          deadline_at: this.deadline || undefined,
          delivery_method: 'pickup',
        }).toPromise();

        if (!created) throw new Error('Не удалось создать заказ');
        this.order.set(created);
        orderId = created.id;

        // Link uploaded files to new order
        for (const f of this.uploadedFiles()) {
          await this.http.post(`/api/files/crm/${f.uuid}/link`, {
            entity_type: 'production_order',
            entity_id: orderId,
          }).toPromise();
        }
      }

      // Collect file uuids
      const fileUuids = [...this.selectedFileUuids()];

      const result = await this.api.sendOrderEmail(orderId!, {
        printing_house_notes: this.printingHouseNotes || undefined,
        file_uuids: fileUuids.length > 0 ? fileUuids : undefined,
      }).toPromise();

      this.emailResult.set(result!);
      this.success.set(true);
      this.sending.set(false);
    } catch (err: unknown) {
      this.sending.set(false);
      const msg = (err as { error?: { message?: string } })?.error?.message || 'Ошибка отправки';
      this.snackBar.open(msg, 'OK', { duration: 5000 });
    }
  }
}
