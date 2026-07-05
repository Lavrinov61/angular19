import { Injectable, inject, signal, computed, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, catchError, firstValueFrom } from 'rxjs';

import { OrdersApiService } from '../../services/orders-api.service';
import { PosApiService, type CustomerLookup } from '../../services/pos-api.service';
import { PricingApiService } from '../../../../core/services/pricing-api.service';
import { ToastService } from '../../../../core/services/toast.service';
import { AuthService } from '../../../../core/services/auth.service';
import {
  type WizardServiceType,
  type WizardDocumentType,
  type DocumentTemplate,
  type ProcessingTier,
  type UploadFile,
  type PaymentMethod,
  type WizardEmployee,
  type DetailsVariant,
  WIZARD_SERVICE_TYPE_CONFIGS,
  WIZARD_DOCUMENT_TYPE_CONFIGS,
} from './order-wizard.types';

// ── S3 presigned upload types ────────────────────────────────────────────────

interface PresignResponse {
  success: boolean;
  data: { uploads: { s3Key: string; uploadUrl: string; contentType: string }[] };
}

interface CompleteResponse {
  success: boolean;
  files?: { s3Url: string; s3Key: string; fileName: string }[];
  count?: number;
}

// ── Visa country options ─────────────────────────────────────────────────────

export interface VisaCountryOption {
  readonly code: string;
  readonly name: string;
  readonly photoSize: string;
  readonly group: 'popular' | 'asia' | 'other';
}

export const VISA_COUNTRY_OPTIONS: readonly VisaCountryOption[] = [
  { code: 'schengen', name: 'Шенген', photoSize: '35x45', group: 'popular' },
  { code: 'us', name: 'США', photoSize: '51x51', group: 'popular' },
  { code: 'cn', name: 'Китай', photoSize: '33x48', group: 'popular' },
  { code: 'gb', name: 'Великобритания', photoSize: '35x45', group: 'popular' },
  { code: 'jp', name: 'Япония', photoSize: '45x45', group: 'asia' },
  { code: 'kr', name: 'Корея', photoSize: '35x45', group: 'asia' },
  { code: 'in', name: 'Индия', photoSize: '51x51', group: 'asia' },
  { code: 'th', name: 'Таиланд', photoSize: '35x45', group: 'asia' },
  { code: 'au', name: 'Австралия', photoSize: '35x45', group: 'other' },
  { code: 'ca', name: 'Канада', photoSize: '50x70', group: 'other' },
  { code: 'br', name: 'Бразилия', photoSize: '50x70', group: 'other' },
];

@Injectable()
export class OrderWizardStore {
  private readonly http = inject(HttpClient);
  private readonly ordersApi = inject(OrdersApiService);
  private readonly posApi = inject(PosApiService);
  private readonly pricing = inject(PricingApiService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Step navigation ────────────────────────────────────────────────────────
  readonly currentStep = signal(0);

  // ── Step 1: Service type ───────────────────────────────────────────────────
  readonly selectedServiceType = signal<WizardServiceType | null>(null);

  // ── Step 2: Details ────────────────────────────────────────────────────────
  readonly selectedDocumentType = signal<WizardDocumentType | null>(null);
  readonly visaCountry = signal<string | null>(null);
  readonly selectedPhotoSize = signal<string | null>(null);
  readonly selectedTier = signal<ProcessingTier | null>(null);
  readonly formSubstitutionNotes = signal('');
  readonly hasMedalsAndChevrons = signal(false);
  readonly medalsDescription = signal('');

  // ── Step 3: Files ──────────────────────────────────────────────────────────
  readonly clientFiles = signal<UploadFile[]>([]);
  readonly formExampleFiles = signal<UploadFile[]>([]);

  // ── Step 4: Summary ────────────────────────────────────────────────────────
  readonly clientPhone = signal('');
  readonly clientName = signal('');
  readonly deadline = signal<string | null>(null);
  readonly priority = signal<'normal' | 'urgent' | 'vip'>('normal');
  readonly assignedEmployeeId = signal<string | null>(null);
  readonly comment = signal('');
  readonly supportTeam = signal(false);
  readonly submitting = signal(false);

  // ── Loaded data ────────────────────────────────────────────────────────────
  readonly documentTemplates = signal<DocumentTemplate[]>([]);
  readonly employees = signal<WizardEmployee[]>([]);
  readonly customerLookup = signal<CustomerLookup | null>(null);

  // ── Phone lookup ───────────────────────────────────────────────────────────
  private readonly phoneSearch$ = new Subject<string>();

  constructor() {
    this.phoneSearch$.pipe(
      debounceTime(500),
      distinctUntilChanged(),
      switchMap(phone => {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length < 10) return of(null);
        return this.posApi.lookupCustomer(cleaned).pipe(
          catchError(() => of(null)),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(result => {
      this.customerLookup.set(result);
      if (result?.customer_name && !this.clientName()) {
        this.clientName.set(result.customer_name);
      }
    });

    this.pricing.loadCategories();
    this.loadDocumentTemplates();
    this.loadEmployees();

    this.destroyRef.onDestroy(() => this.cleanupFiles());
  }

  // ── Computed ───────────────────────────────────────────────────────────────

  readonly wizardServiceTypes = computed(() => WIZARD_SERVICE_TYPE_CONFIGS);

  readonly detailsVariant = computed((): DetailsVariant => {
    return this.selectedServiceType()?.detailsVariant ?? 'simple';
  });

  readonly step1Complete = computed(() => this.selectedServiceType() !== null);

  readonly step2Complete = computed(() => {
    const variant = this.detailsVariant();
    if (variant === 'document') {
      return this.selectedDocumentType() !== null;
    }
    if (variant === 'form-substitution') {
      return true; // notes are optional
    }
    return true; // simple has no required fields
  });

  readonly step3Complete = computed(() => {
    const svc = this.selectedServiceType();
    if (!svc?.fileRequired) return true;
    return this.clientFiles().length > 0;
  });

  readonly showPassportVisaAlert = computed(() => {
    const doc = this.selectedDocumentType();
    return doc?.slug === 'zagranpassport' || doc?.slug === 'visa';
  });

  readonly activeDocumentTemplate = computed(() => {
    const doc = this.selectedDocumentType();
    if (!doc) return null;
    const templates = this.documentTemplates();
    // Match by template slug, optionally by country for visa
    if (doc.requiresCountry && this.visaCountry()) {
      const byCountry = templates.find(
        t => t.slug === doc.templateSlug && t.country_code === this.visaCountry(),
      );
      if (byCountry) return byCountry;
    }
    return templates.find(t => t.slug === doc.templateSlug) ?? null;
  });

  readonly availablePhotoSizes = computed((): string[] => {
    const doc = this.selectedDocumentType();
    if (!doc) return [];
    const template = this.activeDocumentTemplate();
    if (template) {
      return [`${template.photo_width_mm}x${template.photo_height_mm}`];
    }
    return [doc.defaultSize];
  });

  readonly processingTiers = computed((): readonly ProcessingTier[] => {
    const cat = this.pricing.getCategoryBySlug('photo-docs');
    const group = cat?.optionGroups.find(g => g.slug === 'processing-level');
    if (!group?.options.length) return [];
    return group.options.map(opt => ({
      slug: opt.slug,
      name: opt.name,
      description: opt.description ?? '',
      price: this.pricing.resolveOptionPrice(opt, 'pickup'),
      popular: opt.popular,
    }));
  });

  readonly showFormExampleUpload = computed(() => {
    return this.detailsVariant() === 'form-substitution';
  });

  readonly grandTotal = computed(() => {
    const tier = this.selectedTier();
    let total = tier?.price ?? 0;
    if (this.supportTeam()) {
      total += 39;
    }
    return total;
  });

  readonly canSubmit = computed(() => {
    return this.step1Complete()
      && this.step2Complete()
      && this.step3Complete()
      && !this.submitting();
  });

  readonly documentTypes = computed(() => WIZARD_DOCUMENT_TYPE_CONFIGS);

  readonly reminders = computed((): string[] => {
    const list: string[] = [];
    const doc = this.selectedDocumentType();
    if (doc?.slug === 'zagranpassport') {
      list.push('Для загранпаспорта нового образца — биометрическое фото делается в МФЦ/ГУВМ');
    }
    if (doc?.slug === 'visa') {
      list.push('Проверьте актуальные требования консульства к фото');
    }
    if (this.hasMedalsAndChevrons()) {
      list.push('Медали и шевроны увеличивают время обработки на 15-20 минут');
    }
    return list;
  });

  // ── Actions ────────────────────────────────────────────────────────────────

  selectServiceType(type: WizardServiceType): void {
    this.selectedServiceType.set(type);
    // Reset step 2 when service type changes
    this.selectedDocumentType.set(null);
    this.visaCountry.set(null);
    this.selectedPhotoSize.set(null);
    this.selectedTier.set(null);
    this.formSubstitutionNotes.set('');
    this.hasMedalsAndChevrons.set(false);
    this.medalsDescription.set('');
  }

  selectDocumentType(doc: WizardDocumentType): void {
    this.selectedDocumentType.set(doc);
    this.visaCountry.set(null);
    this.selectedPhotoSize.set(doc.defaultSize);
  }

  selectVisaCountry(code: string): void {
    this.visaCountry.set(code);
    const country = VISA_COUNTRY_OPTIONS.find(c => c.code === code);
    if (country) {
      this.selectedPhotoSize.set(country.photoSize);
    }
  }

  selectTier(tier: ProcessingTier): void {
    this.selectedTier.set(tier);
  }

  addClientFiles(files: File[]): void {
    const additions: UploadFile[] = files.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      name: f.name,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      isImage: f.type.startsWith('image/'),
    }));
    this.clientFiles.update(existing => [...existing, ...additions]);
  }

  removeClientFile(id: string): void {
    const file = this.clientFiles().find(f => f.id === id);
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
    this.clientFiles.update(files => files.filter(f => f.id !== id));
  }

  addFormExampleFiles(files: File[]): void {
    const additions: UploadFile[] = files.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      name: f.name,
      previewUrl: f.type.startsWith('image/') ? URL.createObjectURL(f) : '',
      isImage: f.type.startsWith('image/'),
    }));
    this.formExampleFiles.update(existing => [...existing, ...additions]);
  }

  removeFormExampleFile(id: string): void {
    const file = this.formExampleFiles().find(f => f.id === id);
    if (file?.previewUrl) URL.revokeObjectURL(file.previewUrl);
    this.formExampleFiles.update(files => files.filter(f => f.id !== id));
  }

  nextStep(): void {
    this.currentStep.update(s => Math.min(s + 1, 3));
  }

  prevStep(): void {
    this.currentStep.update(s => Math.max(s - 1, 0));
  }

  onPhoneChange(phone: string): void {
    this.clientPhone.set(phone);
    this.phoneSearch$.next(phone);
  }

  // ── Data loading ───────────────────────────────────────────────────────────

  loadDocumentTemplates(): void {
    this.http.get<{ success: boolean; data: DocumentTemplate[] }>('/api/document-templates')
      .pipe(
        catchError(() => of({ success: false, data: [] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(res => {
        if (res.success) {
          this.documentTemplates.set(res.data);
        }
      });
  }

  loadEmployees(): void {
    this.ordersApi.getStaffList()
      .pipe(
        catchError(() => of({ success: false, data: [] as WizardEmployee[] })),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(res => {
        if (res.success) {
          this.employees.set(res.data);
        }
      });
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async submitPayment(method: PaymentMethod): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);

    try {
      // 1. Upload files to S3 via presigned URLs
      const allFiles = [...this.clientFiles(), ...this.formExampleFiles()];
      let uploadedFiles: { s3Key: string; s3Url: string; fileName: string }[] = [];

      if (allFiles.length > 0) {
        uploadedFiles = await this.uploadFilesToS3(allFiles);
      }

      // 2. Build order items
      const svc = this.selectedServiceType();
      const doc = this.selectedDocumentType();
      const tier = this.selectedTier();

      const itemName = svc?.name ?? 'Услуга';
      const itemDescription = [
        doc?.name,
        this.selectedPhotoSize() ? `${this.selectedPhotoSize()} мм` : null,
        tier?.name,
        this.hasMedalsAndChevrons() ? 'с медалями/шевронами' : null,
      ].filter(Boolean).join(', ');

      const items = [
        {
          name: `${itemName}: ${itemDescription}`,
          slug: svc?.slug,
          quantity: 1,
          price: tier?.price ?? 0,
        },
      ];

      if (this.supportTeam()) {
        items.push({
          name: 'Поддержать команду',
          slug: 'support-team',
          quantity: 1,
          price: 39,
        });
      }

      // 3. Create order
      const res = await firstValueFrom(this.ordersApi.createCrmOrder({
        items,
        total_price: this.grandTotal(),
        description: this.buildDescription(),
        client_name: this.clientName() || undefined,
        client_phone: this.clientPhone() || undefined,
        assigned_employee_id: this.assignedEmployeeId() || undefined,
        deadline_at: this.deadline() || undefined,
        priority: this.priority(),
        comment: this.comment() || undefined,
        source: 'walk_in',
        payment_method: method,
      }));

      // 4. Link uploaded files to order
      if (uploadedFiles.length > 0) {
        await firstValueFrom(this.http.post<CompleteResponse>(
          '/api/orders/photo-print/attachments/complete',
          {
            orderId: res.data.orderId,
            files: uploadedFiles.map(f => ({
              s3Key: f.s3Key,
              fileName: f.fileName,
              contentType: 'image/jpeg',
              fileSize: 0,
            })),
          },
        ));
      }

      this.submitting.set(false);
      this.toast.success(`Заказ ${res.data.orderNumber} создан`);
      this.resetWizard();
    } catch {
      this.submitting.set(false);
      this.toast.error('Ошибка создания заказа');
    }
  }

  // ── S3 Upload ──────────────────────────────────────────────────────────────

  private async uploadFilesToS3(files: readonly UploadFile[]): Promise<{ s3Key: string; s3Url: string; fileName: string }[]> {
    // 1. Get presigned URLs
    const filesMeta = files.map(f => ({
      fileName: f.name,
      contentType: f.file.type || 'application/octet-stream',
      fileSize: f.file.size,
    }));

    const presignRes = await firstValueFrom(
      this.http.post<PresignResponse>('/api/orders/photo-print/attachments/presign', { files: filesMeta }),
    );

    if (!presignRes?.success) throw new Error('Presign failed');

    // 2. PUT files to S3
    const uploads = presignRes.data.uploads;
    const results: { s3Key: string; s3Url: string; fileName: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const { s3Key, uploadUrl } = uploads[i];

      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', file.file.type || 'application/octet-stream');
        xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file.file);
      });

      results.push({ s3Key, s3Url: uploadUrl.split('?')[0], fileName: file.name });
    }

    return results;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private buildDescription(): string {
    const parts: string[] = [];
    const svc = this.selectedServiceType();
    const doc = this.selectedDocumentType();
    if (svc) parts.push(svc.name);
    if (doc) parts.push(doc.name);
    if (this.visaCountry()) {
      const country = VISA_COUNTRY_OPTIONS.find(c => c.code === this.visaCountry());
      if (country) parts.push(`Виза: ${country.name}`);
    }
    if (this.selectedPhotoSize()) parts.push(`Размер: ${this.selectedPhotoSize()} мм`);
    if (this.hasMedalsAndChevrons()) parts.push('Медали/шевроны');
    if (this.medalsDescription()) parts.push(`Описание: ${this.medalsDescription()}`);
    if (this.formSubstitutionNotes()) parts.push(`Пожелания: ${this.formSubstitutionNotes()}`);
    return parts.join(' | ');
  }

  private resetWizard(): void {
    this.currentStep.set(0);
    this.selectedServiceType.set(null);
    this.selectedDocumentType.set(null);
    this.visaCountry.set(null);
    this.selectedPhotoSize.set(null);
    this.selectedTier.set(null);
    this.formSubstitutionNotes.set('');
    this.hasMedalsAndChevrons.set(false);
    this.medalsDescription.set('');
    this.cleanupFiles();
    this.clientFiles.set([]);
    this.formExampleFiles.set([]);
    this.clientPhone.set('');
    this.clientName.set('');
    this.deadline.set(null);
    this.priority.set('normal');
    this.assignedEmployeeId.set(null);
    this.comment.set('');
    this.supportTeam.set(false);
    this.customerLookup.set(null);
  }

  private cleanupFiles(): void {
    for (const f of this.clientFiles()) {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    }
    for (const f of this.formExampleFiles()) {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    }
  }
}
