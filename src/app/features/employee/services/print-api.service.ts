import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpEvent, HttpEventType, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable, timer, throwError } from 'rxjs';
import { filter, map, shareReplay, tap, retry, timeout } from 'rxjs/operators';

// ─── TYPES ────────────────────────────────────────────────

export interface PaperSize {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
}

export interface MediaType {
  id: string;
  name: string;
}

export interface QualityMode {
  id: string;
  name: string;
}

export interface PrinterCapabilities {
  paper_sizes: PaperSize[];
  media_types: MediaType[];
  quality_modes: QualityMode[];
  color: boolean;
  duplex: boolean;
  borderless: boolean;
  max_dpi: number;
  sublimation?: boolean;
  mirror_default?: boolean;
  paper_sources?: { id: string; name: string }[];
  finishing?: { id: string; name: string; icon?: string }[];
}

export interface Printer {
  id: string;
  name: string;
  printer_type: 'photo' | 'document' | 'mfp' | 'sublimation';
  cups_printer_name: string;
  /** @deprecated use cups_printer_name */
  win_printer_name?: string;
  studio_id: string | null;
  studio_name?: string | null;
  capabilities: PrinterCapabilities;
  is_active: boolean;
  queue_paused?: boolean;
  queue_paused_at?: string;
  queue_paused_reason?: string;
  queue_depth?: number;
  auto_pause_supply_threshold?: number;
}

export interface BridgePrinterStatus {
  printer_name: string;
  online: boolean;
  state: string;
  state_reasons: string[];
  jobs_count: number;
}

export interface PrintJob {
  id: string;
  printer_id: string;
  file_url: string;
  file_name: string | null;
  copies: number;
  paper_size: string;
  color_mode: 'color' | 'bw';
  quality: string;
  duplex: boolean;
  orientation: 'portrait' | 'landscape' | 'auto';
  borderless: boolean;
  media_type: string | null;
  fit_mode: 'fit' | 'fill' | 'stretch' | 'actual';
  status: 'queued' | 'sending' | 'processing' | 'printing' | 'completed' | 'failed' | 'cancelled' | 'converting' | 'paused' | 'held' | 'scheduled' | 'splitting' | 'finishing';
  error_message: string | null;
  order_id: string | null;
  order_type: string | null;
  created_by: string;
  studio_id: string | null;
  completed_at: string | null;
  created_at: string;
  printer_name?: string;
  printer_type?: string;
  creator_name?: string;
  progress_percent?: number;
  priority?: number;
  parent_job_id?: string;
  page_number?: number;
  source_file_type?: string;
  source_file_url?: string;
  conversion_dpi?: number;
  font_size_delta_pt?: number | null;
  // P0-3: Progress
  progress_current_copy?: number;
  progress_total_copies?: number;
  // P0-4: Splitting
  child_count?: number;
  split_strategy?: 'round_robin' | 'even';
  // P0-5: Auto-balance
  auto_balanced?: boolean;
  original_printer_id?: string;
  // P1-6: Scheduled
  scheduled_at?: string;
  // P1-7: Hold
  held_by?: string;
  held_at?: string;
  // P1-11: Finishing
  finishing_ops?: string[];
  finishing_status?: 'none' | 'pending' | 'in_progress' | 'done';
  // P1-12: Groups
  group_id?: string;
  group_sequence?: number;
  // P2-14: Self-service
  tracking_code?: string;
  // Watermark & Banner
  watermark_text?: string;
  watermark_opacity?: number;
  watermark_position?: string;
  banner_page?: boolean;
  // Extended options
  nup?: number;
  collate?: boolean;
  resolution_dpi?: number;
  toner_save?: string;
  gray_mode?: string;
  mirror?: boolean;
  photo_enhance?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  department_id?: string;
  secure_pin?: string;
}

export interface PrintUploadedFile {
  asset_id?: string;
  sha256?: string;
  url: string;
  key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  document_type: string;
  kind: 'image' | 'document';
  fast_profile?: PrintFastProfile;
  asset?: PrintAsset;
  preparation?: PrintPreparation;
}

export interface PrintFastProfile {
  pipeline: 'document' | 'photo';
  max_format: 'A3' | 'A4' | string;
  recommended_printer_kind: 'laser' | 'inkjet' | string;
  coverage_required: boolean;
  coverage_required_on_laser?: boolean;
}

export type PrintAssetSource = 'local' | 'chat';
export type PrintPreparationStatus = 'queued' | 'processing' | 'ready' | 'failed';

export interface PrintAsset {
  id: string;
  source: PrintAssetSource | string;
  source_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  storage_url: string;
  storage_key: string;
  document_type: string;
  kind: 'image' | 'document';
  pipeline: 'document' | 'photo';
  max_format: 'A3' | 'A4' | string;
}

export interface PrintPreparation {
  asset_id: string;
  status: PrintPreparationStatus;
  detected_format: 'A3' | 'A4' | string;
  page_count: number | null;
  preview_url: string | null;
  coverage_percentages: number[] | null;
  coverage_required_on_laser: boolean;
  error: string | null;
}

export type PrintUploadEvent =
  | { type: 'progress'; progress: number; loaded: number; total: number }
  | { type: 'completed'; file: PrintUploadedFile };

export interface StateTransition {
  id: number;
  job_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_type: 'user' | 'system' | 'agent' | 'scheduler';
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CreatePrintJobParams {
  printer_id: string;
  file_url: string;
  file_name?: string;
  copies?: number;
  paper_size?: string;
  color_mode?: 'color' | 'bw';
  quality?: string;
  duplex?: boolean;
  orientation?: 'portrait' | 'landscape' | 'auto';
  borderless?: boolean;
  media_type?: string;
  fit_mode?: 'fit' | 'fill' | 'stretch' | 'actual';
  rotation?: number;
  layout_rows?: number;
  layout_cols?: number;
  cut_margin_mm?: number;
  cut_marks?: boolean;
  cut_mark_length_mm?: number;
  cut_mark_offset_mm?: number;
  custom_photo_width_mm?: number;
  custom_photo_height_mm?: number;
  order_id?: string;
  order_type?: string;
  receipt_id?: string;
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  crop_mode?: 'fit' | 'fill';
  template_type?: string;
  document_template_slug?: string;
  priority?: number;
  pages?: number[];
  dpi?: number;
  font_size_delta_pt?: number;
  price_total?: number;
  trace_id?: string;
  icc_profile_id?: string;
  rendering_intent?: 'perceptual' | 'relative_colorimetric' | 'saturation' | 'absolute_colorimetric';
  scheduled_at?: string;
  finishing_ops?: string[];
  paper_source?: string;
  // Watermark & Banner
  watermark_text?: string;
  watermark_opacity?: number;
  watermark_position?: 'center' | 'top' | 'bottom' | 'diagonal';
  banner_page?: boolean;
  // Extended print options
  nup?: number;
  pages_per_sheet?: number;
  collate?: boolean;
  resolution_dpi?: number;
  toner_save?: string;
  gray_mode?: string;
  mirror?: boolean;
  department_id?: string;
  secure_pin?: string;
  color_auto_detect?: boolean;
  booklet?: boolean;
  binding?: string;
  staple_position?: string;
  hole_punch?: string;
  hole_punch_type?: string;
  duplex_mode?: string;
  scaling_percent?: number;
  output_bin?: string;
  page_range?: string;
  coverage_percent?: number;
  photo_enhance?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

export interface LayoutBatchImageParams {
  file_url: string;
  fit_mode?: 'fit' | 'fill' | 'stretch' | 'actual';
  rotation?: number;
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  photo_enhance?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
}

export interface CreateLayoutBatchParams {
  printer_id: string;
  images: LayoutBatchImageParams[];
  paper_size?: string;
  media_type?: string;
  paper_source?: string;
  paper_width_mm: number;
  paper_height_mm: number;
  photo_width_mm: number;
  photo_height_mm: number;
  cut_margin_mm?: number;
  cut_marks?: boolean;
  template_mode?: 'polaroid' | 'passport' | 'collage' | 'label' | 'business-card';
  bottom_padding_mm?: number;
  photo_preset_id?: string;
  order_id?: string;
  order_type?: string;
  color_mode?: 'color' | 'bw';
  quality?: string;
  borderless?: boolean;
  priority?: number;
  price_total?: number;
  mirror?: boolean;
}

export interface RustLayoutResult {
  rows: number;
  cols: number;
  photos_per_sheet: number;
  waste_percent: number;
  photo_cell_w_mm: number;
  photo_cell_h_mm: number;
  cut_margin_mm: number;
  sheets_needed?: number;
  template_mode?: string | null;
  photo_area_h_mm?: number | null;
  bottom_padding_mm?: number | null;
  content_x_mm?: number;
  content_y_mm?: number;
  content_w_mm?: number;
  content_h_mm?: number;
}

export interface PolaroidResult {
  url: string;
  s3Key: string;
  faceDetected: boolean;
  cropTop: number;
  processingTimeMs: number;
}

export interface PolaroidBatchResult {
  results: (PolaroidResult & { originalUrl: string })[];
  totalTimeMs: number;
}

export interface CreatePrinterDto {
  name: string;
  printer_type: 'photo' | 'document' | 'mfp' | 'sublimation';
  cups_printer_name: string;
  studio_id?: string | null;
  capabilities: PrinterCapabilities;
  is_active?: boolean;
}

export interface QueueFilters {
  printer_id?: string;
  status?: string;
  studio_id?: string;
  order_id?: string;
  limit?: number;
  offset?: number;
  page?: number;
  created_by?: string;
  date_from?: string;
  date_to?: string;
  search?: string;
  sort_by?: string;
  sort_order?: string;
}

export interface PaginatedQueueResponse {
  jobs: PrintJob[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PrinterTelemetry {
  id: string;
  printer_id: string;
  printer_name: string;
  printer_type: string;
  is_online: boolean;
  state: string;
  state_reasons: string[];
  supplies: Record<string, number> | null;
  trays: unknown;
  counters: unknown;
  model: string | null;
  manufacturer: string | null;
  serial_number: string | null;
  collected_at: string;
}

// ─── CONSUMABLE TYPES ────────────────────────────────────

export interface ConsumableStock {
  id: string;
  station_id: string;
  station_name: string | null;
  consumable_type: string;
  current_amount: number;
  max_capacity: number | null;
  unit: string;
  low_threshold: number | null;
  cost_per_unit: number | null;
  last_refilled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConsumableAlert {
  id: string;
  station_name: string;
  consumable_type: string;
  current_amount: number;
  low_threshold: number;
  unit: string;
  percent_remaining: number | null;
}

export interface ConsumableTransaction {
  id: string;
  consumable_stock_id: string;
  transaction_type: 'refill' | 'usage';
  amount: number;
  notes: string | null;
  created_at: string;
}

export interface CreateConsumableStockDto {
  station_id: string;
  consumable_type: string;
  current_amount: number;
  max_capacity: number | null;
  unit: string;
  low_threshold: number | null;
  cost_per_unit: number | null;
}

export interface RefillConsumableDto {
  amount: number;
  notes?: string;
}

// ─── DOCUMENT TEMPLATE TYPES ─────────────────────────────

export interface DocumentTemplate {
  id: string;
  slug: string;
  name: string;
  category: string;
  country_code: string;
  photo_width_mm: number;
  photo_height_mm: number;
  head_height_min_mm: number | null;
  head_height_max_mm: number | null;
  photos_per_sheet: number;
  layout_rows: number;
  layout_cols: number;
  cut_margin_mm: number;
  default_media_size: string;
  background_color: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentTemplateDto {
  slug: string;
  name: string;
  category: string;
  country_code: string;
  photo_width_mm: number;
  photo_height_mm: number;
  head_height_min_mm: number | null;
  head_height_max_mm: number | null;
  photos_per_sheet: number;
  layout_rows: number;
  layout_cols: number;
  cut_margin_mm: number;
  default_media_size: string;
  background_color: string;
  sort_order: number;
}

// ─── ICC PROFILE TYPES ───────────────────────────────────

export interface IccProfile {
  id: string;
  device_id: string;
  device_name: string | null;
  profile_name: string;
  media_type: string;
  file_key: string;
  is_default: boolean;
  calibrated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateIccProfileDto {
  device_id: string;
  media_type: string;
  profile_name: string;
  file_key: string;
  is_default: boolean;
}

// ─── SERVICE CATALOG TYPES ───────────────────────────────

export interface ServiceCatalogItem {
  id: string;
  slug: string;
  name: string;
  category: string;
  required_device_type: string | null;
  base_price: number;
  price_per_unit: number;
  sort_order: number;
  requires_template: boolean;
  requires_design_editor: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateServiceCatalogDto {
  slug: string;
  name: string;
  category: string;
  required_device_type: string | null;
  base_price: number;
  price_per_unit: number;
  sort_order: number;
  requires_template: boolean;
  requires_design_editor: boolean;
}

// ─── PRINT PRESET TYPES ─────────────────────────────────

export interface PrintPresetRecord {
  id: string;
  name: string;
  slug: string;
  icon: string;
  printer_type: 'photo' | 'mfp' | 'document';
  sublimation: boolean;
  paper_size: string;
  media_type: string | null;
  quality: string;
  fit_mode: 'fit' | 'fill' | 'stretch' | 'actual';
  borderless: boolean;
  color_mode: 'color' | 'bw';
  duplex: boolean;
  mirror: boolean;
  rendering_intent: string | null;
  price: number;
  sort_order: number;
  is_active: boolean;
  studio_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePrintPresetDto {
  name: string;
  icon?: string;
  printer_type: string;
  sublimation?: boolean;
  paper_size: string;
  media_type?: string;
  quality?: string;
  fit_mode?: string;
  borderless?: boolean;
  color_mode?: string;
  duplex?: boolean;
  mirror?: boolean;
  price?: number;
  sort_order?: number;
  studio_id?: string;
}

export interface PreviewRequestParams {
  printer_id?: string;
  file_url: string;
  paper_size: string;
  orientation?: 'portrait' | 'landscape' | 'auto';
  color_mode?: 'color' | 'bw';
  quality?: string;
  borderless?: boolean;
  media_type?: string;
  fit_mode?: 'fit' | 'fill' | 'stretch' | 'actual';
  rotation?: number;
  mirror?: boolean;
  crop_x?: number;
  crop_y?: number;
  crop_width?: number;
  crop_height?: number;
  photo_enhance?: boolean;
  brightness?: number;
  contrast?: number;
  saturation?: number;
  crop_mode?: 'fit' | 'fill';
  layout_rows?: number;
  layout_cols?: number;
  cut_margin_mm?: number;
  cut_marks?: boolean;
  cut_mark_length_mm?: number;
  cut_mark_offset_mm?: number;
  custom_photo_width_mm?: number;
  custom_photo_height_mm?: number;
  document_template_slug?: string;
  resolution_dpi?: number;
  icc_profile_id?: string;
  rendering_intent?: 'perceptual' | 'relative_colorimetric' | 'saturation' | 'absolute_colorimetric';
  preview_width?: number;
  preview_height?: number;
  paper_source?: string;
  dpi?: number;
  font_size_delta_pt?: number;
  booklet?: boolean;
  pages_per_sheet?: number;
  duplex_mode?: string;
  /** 1-based страница для постраничного (ленивого) превью документа. */
  page?: number;
}

// ─── ANALYTICS TYPES ─────────────────────────────────────

export interface DailyStats {
  day: string;
  studio_id: string | null;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  total_copies: number;
  total_sheets: number;
  revenue: number;
  avg_duration_ms: number;
  waste_sheets: number;
  waste_cost: number;
}

export interface UtilizationStats {
  hour: string;
  printer_id: string | null;
  printer_name: string | null;
  jobs_count: number;
  pages_printed: number;
  busy_minutes: number;
  idle_minutes: number;
  utilization_pct: number;
}

export interface WasteRecord {
  id: number;
  waste_type: string;
  sheets_wasted: number;
  paper_size: string | null;
  media_type: string | null;
  printer_id: string | null;
  studio_id: string | null;
  print_job_id: string | null;
  reported_by: string | null;
  notes: string | null;
  cost_estimate: number | null;
  created_at: string;
}

export interface CreateWasteDto {
  waste_type: string;
  sheets_wasted: number;
  paper_size?: string;
  media_type?: string;
  printer_id?: string;
  studio_id?: string;
  print_job_id?: string;
  notes?: string;
  cost_estimate?: number;
}

// ─── COPY CENTER TYPES ───────────────────────────────────

export interface PrintJobGroup {
  id: string;
  name?: string;
  customer_id?: string;
  customer_name?: string;
  total_price?: number;
  receipt_id?: string;
  status: 'open' | 'printing' | 'completed' | 'cancelled';
  created_by?: string;
  studio_id?: string;
  created_at: string;
  jobs?: PrintJob[];
}

export interface SplitJobParams {
  target_printers: string[];
  strategy: 'round_robin' | 'even';
  chunk_size?: number;
}

export interface SplitResult {
  parent_job_id: string;
  child_jobs: { id: string; printer_id: string; copies: number }[];
}

export interface ClientBillingRow {
  customer_id: string;
  client_name: string;
  total_jobs: number;
  total_copies: number;
  total_revenue: number;
  last_print_at: string;
  billing_month: string;
}

export interface PresetStats {
  preset_id: string;
  slug: string;
  name: string;
  usage_count: number;
}

export interface DowntimeRecord {
  printer_id: string;
  printer_name: string;
  total_incidents: number;
  total_downtime_minutes: number;
  avg_downtime_minutes: number;
  last_downtime: string;
}

export interface PrinterDowntimeDetail {
  id: string;
  printer_id: string;
  started_at: string;
  ended_at?: string;
  duration_minutes: number;
  reason?: string;
  auto_detected: boolean;
}

// ─── SERVICE ──────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class PrintApiService {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/print';

  private static readonly CACHE_TTL = 5 * 60 * 1000;
  private static readonly MUTATION_TIMEOUT = 30_000;
  private static readonly LAYOUT_BATCH_TIMEOUT = 300_000;
  private static readonly PREVIEW_RENDER_TIMEOUT = 45_000;
  private static readonly UPLOAD_TIMEOUT = 300_000;
  private static readonly READ_TIMEOUT = 15_000;
  private static readonly RETRY_COUNT = 2;
  private static readonly RETRY_DELAY = 1_000;

  private printersCache$: Observable<Printer[]> | null = null;
  private printersCacheTime = 0;
  private presetsCache$: Observable<PrintPresetRecord[]> | null = null;
  private presetsCacheTime = 0;

  private retryOnTransient<T>() {
    return retry<T>({
      count: PrintApiService.RETRY_COUNT,
      delay: (error: unknown, attempt: number) => {
        if (error instanceof HttpErrorResponse && (error.status === 0 || error.status === 429 || error.status >= 500)) {
          return timer(PrintApiService.RETRY_DELAY * attempt);
        }
        return throwError(() => error);
      },
    });
  }

  clearCache(): void {
    this.printersCache$ = null;
    this.printersCacheTime = 0;
    this.presetsCache$ = null;
    this.presetsCacheTime = 0;
  }

  getAllPrinters(): Observable<Printer[]> {
    return this.http.get<{ success: boolean; printers: Printer[] }>(
      `${this.base}/printers/all`
    ).pipe(map(r => r.printers));
  }

  createPrinterRecord(data: CreatePrinterDto): Observable<Printer> {
    return this.http.post<{ success: boolean; printer: Printer }>(
      `${this.base}/printers`, data
    ).pipe(map(r => r.printer), tap(() => this.clearCache()));
  }

  updatePrinterRecord(id: string, data: Partial<CreatePrinterDto>): Observable<Printer> {
    return this.http.put<{ success: boolean; printer: Printer }>(
      `${this.base}/printers/${id}`, data
    ).pipe(map(r => r.printer), tap(() => this.clearCache()));
  }

  deletePrinterRecord(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/printers/${id}`).pipe(tap(() => this.clearCache()));
  }

  getPrinters(studioId?: string): Observable<Printer[]> {
    if (!studioId) {
      const now = Date.now();
      if (this.printersCache$ && now - this.printersCacheTime < PrintApiService.CACHE_TTL) {
        return this.printersCache$;
      }
      this.printersCache$ = this.http.get<{ success: boolean; printers: Printer[] }>(
        `${this.base}/printers`
      ).pipe(
        timeout(PrintApiService.READ_TIMEOUT),
        map(r => r.printers),
        shareReplay(1),
      );
      this.printersCacheTime = now;
      return this.printersCache$;
    }
    const params: Record<string, string> = { studio_id: studioId };
    return this.http.get<{ success: boolean; printers: Printer[] }>(
      `${this.base}/printers`, { params }
    ).pipe(timeout(PrintApiService.READ_TIMEOUT), map(r => r.printers));
  }

  getPrinterStatuses(): Observable<{ printers: BridgePrinterStatus[] }> {
    return this.http.get<{ printers: BridgePrinterStatus[] }>(
      `${this.base}/printers/status`
    );
  }

  createPrintJob(params: CreatePrintJobParams): Observable<{ success: boolean; job: PrintJob }> {
    return this.http.post<{ success: boolean; job: PrintJob }>(
      `${this.base}/jobs`, params
    ).pipe(timeout(PrintApiService.MUTATION_TIMEOUT));
  }

  createLayoutBatchJobs(params: CreateLayoutBatchParams): Observable<{ success: boolean; jobs: PrintJob[]; total_sheets: number; layout: RustLayoutResult }> {
    return this.http.post<{ success: boolean; jobs: PrintJob[]; total_sheets: number; layout: RustLayoutResult }>(
      `${this.base}/jobs/layout-batch`, params,
    ).pipe(timeout(PrintApiService.LAYOUT_BATCH_TIMEOUT));
  }

  uploadPrintFile(file: File): Observable<PrintUploadEvent> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    return this.http.post<{ success: boolean; file: PrintUploadedFile }>(
      `${this.base}/uploads`,
      formData,
      {
        observe: 'events',
        reportProgress: true,
      },
    ).pipe(
      timeout(PrintApiService.UPLOAD_TIMEOUT),
      filter((event: HttpEvent<{ success: boolean; file: PrintUploadedFile }>) =>
        event.type === HttpEventType.UploadProgress || event.type === HttpEventType.Response
      ),
      map((event: HttpEvent<{ success: boolean; file: PrintUploadedFile }>): PrintUploadEvent => {
        if (event.type === HttpEventType.UploadProgress) {
          const total = event.total ?? file.size;
          return {
            type: 'progress',
            loaded: event.loaded,
            total,
            progress: total > 0 ? Math.round((event.loaded / total) * 100) : 0,
          };
        }

        if (!(event instanceof HttpResponse) || !event.body?.file) {
          throw new Error('Сервер не вернул данные загруженного файла');
        }

        return {
          type: 'completed',
          file: event.body.file,
        };
      }),
    );
  }

  requestLayoutSheetPreview(params: CreateLayoutBatchParams): Observable<Blob> {
    return this.http.post(`${this.base}/preview/layout-sheet`, params, {
      responseType: 'blob',
    }).pipe(
      timeout(PrintApiService.PREVIEW_RENDER_TIMEOUT),
      retry({ count: 1, delay: 500 }),
    );
  }

  getQueue(filters: QueueFilters = {}): Observable<PaginatedQueueResponse> {
    let params = new HttpParams();
    if (filters.printer_id) params = params.set('printer_id', filters.printer_id);
    if (filters.status) params = params.set('status', filters.status);
    if (filters.studio_id) params = params.set('studio_id', filters.studio_id);
    if (filters.order_id) params = params.set('order_id', filters.order_id);
    if (filters.limit) params = params.set('limit', String(filters.limit));
    if (filters.offset != null) params = params.set('offset', String(filters.offset));
    if (filters.page != null) params = params.set('page', String(filters.page));
    if (filters.created_by) params = params.set('created_by', filters.created_by);
    if (filters.date_from) params = params.set('date_from', filters.date_from);
    if (filters.date_to) params = params.set('date_to', filters.date_to);
    if (filters.search) params = params.set('search', filters.search);
    if (filters.sort_by) params = params.set('sort_by', filters.sort_by);
    if (filters.sort_order) params = params.set('sort_order', filters.sort_order);
    return this.http.get<{ success: boolean; jobs: PrintJob[]; total?: number; page?: number; limit?: number; pages?: number }>(
      `${this.base}/jobs`, { params }
    ).pipe(timeout(PrintApiService.READ_TIMEOUT), map(r => {
      const jobs = r.jobs;
      const total = r.total ?? jobs.length;
      const page = r.page ?? (filters.page ?? 1);
      const limit = r.limit ?? (filters.limit ?? jobs.length);
      const pages = r.pages ?? (limit > 0 ? Math.ceil(total / limit) : 1);
      return { jobs, total, page, limit, pages };
    }));
  }

  getJobsByOrderId(orderId: string): Observable<PrintJob[]> {
    return this.getQueue({ order_id: orderId, limit: 50 }).pipe(map(r => r.jobs));
  }

  getJob(jobId: string): Observable<PrintJob | null> {
    return this.http.get<{ success: boolean; job: PrintJob }>(
      `${this.base}/jobs/${encodeURIComponent(jobId)}`,
    ).pipe(
      timeout(PrintApiService.READ_TIMEOUT),
      map(result => result.job ?? null),
    );
  }

  setPriority(jobId: string, priority: number): Observable<{ success: boolean; priority: number }> {
    return this.http.put<{ success: boolean; priority: number }>(
      `${this.base}/jobs/${jobId}/priority`, { priority }
    );
  }

  cancelJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/jobs/${jobId}/cancel`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT), this.retryOnTransient(),
    );
  }

  reprintJob(jobId: string): Observable<{ success: boolean; job: PrintJob }> {
    return this.http.post<{ success: boolean; job: PrintJob }>(
      `${this.base}/jobs/${jobId}/reprint`, {}
    ).pipe(timeout(PrintApiService.MUTATION_TIMEOUT), this.retryOnTransient());
  }

  retryJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/jobs/${jobId}/retry`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT), this.retryOnTransient(),
    );
  }

  reassignJob(jobId: string, targetPrinterId: string): Observable<PrintJob> {
    return this.http.post<{ success: boolean; job: PrintJob }>(
      `${this.base}/jobs/${jobId}/reassign`, { target_printer_id: targetPrinterId }
    ).pipe(timeout(PrintApiService.MUTATION_TIMEOUT), this.retryOnTransient(), map(r => r.job));
  }

  // ─── CONVERSION PAGES ─────────────────────────────────────

  getConversionPages(jobId: string): Observable<{
    success: boolean;
    parent_job_id: string;
    conversion: { status: string; total_pages: number; converted_pages: number; error: string | null } | null;
    child_jobs: PrintJob[];
  }> {
    return this.http.get<{
      success: boolean;
      parent_job_id: string;
      conversion: { status: string; total_pages: number; converted_pages: number; error: string | null } | null;
      child_jobs: PrintJob[];
    }>(`${this.base}/jobs/${jobId}/pages`);
  }

  // ─── CONSUMABLES ─────────────────────────────────────────

  getConsumableStock(): Observable<ConsumableStock[]> {
    return this.http.get<{ success: boolean; stocks: ConsumableStock[] }>(
      `${this.base}/consumables/stock`
    ).pipe(map(r => r.stocks));
  }

  getConsumableAlerts(): Observable<ConsumableAlert[]> {
    return this.http.get<{ success: boolean; alerts: ConsumableAlert[] }>(
      `${this.base}/consumables/alerts`
    ).pipe(map(r => r.alerts));
  }

  getConsumableTransactions(stockId?: string, limit?: number): Observable<ConsumableTransaction[]> {
    const params: Record<string, string> = {};
    if (stockId) params['stock_id'] = stockId;
    if (limit) params['limit'] = String(limit);
    return this.http.get<{ success: boolean; transactions: ConsumableTransaction[] }>(
      `${this.base}/consumables/transactions`, { params }
    ).pipe(map(r => r.transactions));
  }

  createConsumableStock(dto: CreateConsumableStockDto): Observable<ConsumableStock> {
    return this.http.post<{ success: boolean; stock: ConsumableStock }>(
      `${this.base}/consumables/stock`, dto
    ).pipe(map(r => r.stock));
  }

  refillConsumable(id: string, dto: RefillConsumableDto): Observable<ConsumableStock> {
    return this.http.post<{ success: boolean; stock: ConsumableStock }>(
      `${this.base}/consumables/stock/${id}/refill`, dto
    ).pipe(map(r => r.stock));
  }

  // ─── CONSUMABLE FORECAST ──────────────────────────────────

  getConsumableForecast(studioId?: string): Observable<{
    printer_id: string;
    printer_name: string;
    supplies: {
      name: string;
      color: string;
      current_level: number;
      daily_usage: number;
      days_remaining: number | null;
      estimated_empty_date: string | null;
      status: 'ok' | 'warning' | 'critical';
    }[];
  }[]> {
    const params: Record<string, string> = {};
    if (studioId) params['studio_id'] = studioId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.http.get<{ success: boolean; forecasts: any[] }>(
      `${this.base}/consumables/forecast`, { params }
    ).pipe(map(r => r.forecasts));
  }

  // ─── DOCUMENT TEMPLATES ──────────────────────────────────

  getDocumentTemplates(): Observable<DocumentTemplate[]> {
    return this.http.get<{ success: boolean; templates: DocumentTemplate[] }>(
      `${this.base}/document-templates`
    ).pipe(map(r => r.templates));
  }

  createDocumentTemplate(dto: CreateDocumentTemplateDto): Observable<DocumentTemplate> {
    return this.http.post<{ success: boolean; template: DocumentTemplate }>(
      `${this.base}/document-templates`, dto
    ).pipe(map(r => r.template));
  }

  updateDocumentTemplate(id: string, data: Partial<CreateDocumentTemplateDto>): Observable<DocumentTemplate> {
    return this.http.put<{ success: boolean; template: DocumentTemplate }>(
      `${this.base}/document-templates/${id}`, data
    ).pipe(map(r => r.template));
  }

  deleteDocumentTemplate(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/document-templates/${id}`);
  }

  // ─── ICC PROFILES ────────────────────────────────────────

  getIccProfiles(): Observable<IccProfile[]> {
    return this.http.get<{ success: boolean; profiles: IccProfile[] }>(
      `${this.base}/icc-profiles`
    ).pipe(map(r => r.profiles));
  }

  createIccProfile(dto: CreateIccProfileDto): Observable<IccProfile> {
    return this.http.post<{ success: boolean; profile: IccProfile }>(
      `${this.base}/icc-profiles`, dto
    ).pipe(map(r => r.profile));
  }

  updateIccProfile(id: string, data: Partial<CreateIccProfileDto>): Observable<IccProfile> {
    return this.http.put<{ success: boolean; profile: IccProfile }>(
      `${this.base}/icc-profiles/${id}`, data
    ).pipe(map(r => r.profile));
  }

  deleteIccProfile(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/icc-profiles/${id}`);
  }

  // ─── SERVICE CATALOG ─────────────────────────────────────

  getServiceCatalog(): Observable<ServiceCatalogItem[]> {
    return this.http.get<{ success: boolean; services: ServiceCatalogItem[] }>(
      `${this.base}/service-catalog`
    ).pipe(map(r => r.services));
  }

  createServiceCatalogItem(dto: CreateServiceCatalogDto): Observable<ServiceCatalogItem> {
    return this.http.post<{ success: boolean; service: ServiceCatalogItem }>(
      `${this.base}/service-catalog`, dto
    ).pipe(map(r => r.service));
  }

  updateServiceCatalogItem(id: string, data: Partial<CreateServiceCatalogDto>): Observable<ServiceCatalogItem> {
    return this.http.put<{ success: boolean; service: ServiceCatalogItem }>(
      `${this.base}/service-catalog/${id}`, data
    ).pipe(map(r => r.service));
  }

  deleteServiceCatalogItem(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/service-catalog/${id}`);
  }

  // ─── PRINT PRESETS ────────────────────────────────────────

  getPresets(params?: { printer_type?: string; studio_id?: string }): Observable<PrintPresetRecord[]> {
    if (!params?.printer_type && !params?.studio_id) {
      const now = Date.now();
      if (this.presetsCache$ && now - this.presetsCacheTime < PrintApiService.CACHE_TTL) {
        return this.presetsCache$;
      }
      this.presetsCache$ = this.http.get<{ success: boolean; presets: PrintPresetRecord[] }>(
        `${this.base}/presets`
      ).pipe(
        timeout(PrintApiService.READ_TIMEOUT),
        map(r => r.presets),
        shareReplay(1),
      );
      this.presetsCacheTime = now;
      return this.presetsCache$;
    }
    const queryParams: Record<string, string> = {};
    if (params?.printer_type) queryParams['printer_type'] = params.printer_type;
    if (params?.studio_id) queryParams['studio_id'] = params.studio_id;
    return this.http.get<{ success: boolean; presets: PrintPresetRecord[] }>(
      `${this.base}/presets`, { params: queryParams }
    ).pipe(timeout(PrintApiService.READ_TIMEOUT), map(r => r.presets));
  }

  createPreset(dto: CreatePrintPresetDto): Observable<PrintPresetRecord> {
    return this.http.post<{ success: boolean; preset: PrintPresetRecord }>(
      `${this.base}/presets`, dto
    ).pipe(map(r => r.preset), tap(() => this.clearCache()));
  }

  updatePreset(id: string, data: Partial<CreatePrintPresetDto>): Observable<PrintPresetRecord> {
    return this.http.put<{ success: boolean; preset: PrintPresetRecord }>(
      `${this.base}/presets/${id}`, data
    ).pipe(map(r => r.preset));
  }

  deletePreset(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/presets/${id}`);
  }

  // ─── PREVIEW ──────────────────────────────────────────────

  requestPreview(params: PreviewRequestParams): Observable<{ preview_id: string; status: string }> {
    return this.http.post<{ success: boolean; preview_id: string; status: string }>(
      `${this.base}/preview`, params
    );
  }

  // ─── ANALYTICS ─────────────────────────────────────────

  getAnalyticsSummary(params: Record<string, string>): Observable<{ total_jobs: number; completed: number; failed: number; failure_rate: number; total_copies: number; revenue: number; avg_duration_ms: number; waste_sheets: number }> {
    return this.http.get<{ success: boolean; summary: { total_jobs: number; completed: number; failed: number; failure_rate: number; total_copies: number; revenue: number; avg_duration_ms: number; waste_sheets: number } }>(
      `${this.base}/analytics/summary`, { params }
    ).pipe(map(r => r.summary));
  }

  getAnalyticsByPrinter(params: Record<string, string>): Observable<{ printer_id: string; printer_name: string; total_jobs: number; completed: number; failed: number; copies: number; revenue: number }[]> {
    return this.http.get<{ success: boolean; printers: { printer_id: string; printer_name: string; total_jobs: number; completed: number; failed: number; copies: number; revenue: number }[] }>(
      `${this.base}/analytics/by-printer`, { params }
    ).pipe(map(r => r.printers));
  }

  getAnalyticsByOperator(params: Record<string, string>): Observable<{ operator_id: string; operator_name: string; total_jobs: number; completed: number; failed: number; copies: number; avg_speed_ms: number }[]> {
    return this.http.get<{ success: boolean; operators: { operator_id: string; operator_name: string; total_jobs: number; completed: number; failed: number; copies: number; avg_speed_ms: number }[] }>(
      `${this.base}/analytics/by-operator`, { params }
    ).pipe(map(r => r.operators));
  }

  getDailyTrend(params: Record<string, string>): Observable<DailyStats[]> {
    return this.http.get<{ success: boolean; daily: DailyStats[] }>(
      `${this.base}/analytics/daily`, { params }
    ).pipe(map(r => r.daily));
  }

  getUtilization(params: Record<string, string>): Observable<UtilizationStats[]> {
    return this.http.get<{ success: boolean; utilization: UtilizationStats[] }>(
      `${this.base}/analytics/utilization`, { params }
    ).pipe(map(r => r.utilization));
  }

  getWasteStats(params: Record<string, string>): Observable<WasteRecord[]> {
    return this.http.get<{ success: boolean; waste: WasteRecord[] }>(
      `${this.base}/analytics/waste`, { params }
    ).pipe(map(r => r.waste));
  }

  reportWaste(data: CreateWasteDto): Observable<{ success: boolean; id: number }> {
    return this.http.post<{ success: boolean; id: number }>(
      `${this.base}/waste`, data
    );
  }

  exportAnalyticsCsv(dateFrom: string, dateTo: string, studioId?: string): Observable<Blob> {
    let params = new HttpParams()
      .set('date_from', dateFrom)
      .set('date_to', dateTo);
    if (studioId) params = params.set('studio_id', studioId);
    return this.http.get(`${this.base}/analytics/export-csv`, {
      params,
      responseType: 'blob',
    });
  }

  getPreviewImage(previewId: string): Observable<Blob | null> {
    return this.http.get(`${this.base}/preview/${previewId}`, {
      responseType: 'blob',
      observe: 'response',
    }).pipe(
      map(resp => {
        if (resp.status === 202) return null; // still pending
        return resp.body;
      }),
    );
  }

  // ─── POLAROID ─────────────────────────────────────────────

  generatePolaroid(imageUrl: string, faceData?: {
    forehead_y: number; chin_y: number; image_width: number; image_height: number;
  }): Observable<PolaroidResult> {
    return this.http.post<{ success: boolean; data: PolaroidResult }>(
      '/api/polaroid/generate',
      { image_url: imageUrl, ...(faceData ? { face_data: faceData } : {}) },
    ).pipe(map(r => r.data));
  }

  generatePolaroidBatch(imageUrls: string[]): Observable<PolaroidBatchResult> {
    return this.http.post<{ success: boolean; data: PolaroidBatchResult }>(
      '/api/polaroid/batch',
      { image_urls: imageUrls },
    ).pipe(map(r => r.data));
  }

  // ─── TELEMETRY ────────────────────────────────────────────

  getTelemetry(studioId?: string): Observable<PrinterTelemetry[]> {
    const params: Record<string, string> = {};
    if (studioId) params['studio_id'] = studioId;
    return this.http.get<{ success: boolean; telemetry: PrinterTelemetry[] }>(
      `${this.base}/telemetry`, { params }
    ).pipe(map(r => r.telemetry));
  }

  getActivePrices(): Observable<{
    paper_size: string;
    label: string;
    price: number;
    printer_type: string;
    media_type: string | null;
  }[]> {
    return this.getPresets().pipe(
      map(presets => presets
        .filter(p => p.is_active)
        .map(p => ({
          paper_size: p.paper_size,
          label: p.name,
          price: p.price,
          printer_type: p.printer_type === 'document' ? 'mfp' : p.printer_type,
          media_type: p.media_type,
        }))
      ),
    );
  }

  // ─── P0-1: Pause/Resume Jobs ──────────────────────────────

  pauseJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/jobs/${jobId}/pause`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  resumeJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/jobs/${jobId}/resume`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  // ─── P0-2: Pause/Resume Printer Queue ────────────────────

  pausePrinterQueue(printerId: string, reason?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/printers/${printerId}/pause-queue`, { reason }).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  resumePrinterQueue(printerId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/printers/${printerId}/resume-queue`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  // ─── P0-4: Job Splitting ─────────────────────────────────

  splitJob(jobId: string, params: SplitJobParams): Observable<SplitResult> {
    return this.http.post<{ entity: SplitResult }>(`${this.base}/jobs/${jobId}/split`, params).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT),
      map(r => r.entity)
    );
  }

  // ─── P1-6: Scheduled Jobs ────────────────────────────────

  scheduleJob(jobId: string, scheduledAt: string): Observable<void> {
    return this.http.post<void>(`${this.base}/jobs/${jobId}/schedule`, { scheduled_at: scheduledAt }).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  // ─── P1-7: Hold/Release ──────────────────────────────────

  holdJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/jobs/${jobId}/hold`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  releaseJob(jobId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/jobs/${jobId}/release`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  updateFinishingOps(jobId: string, ops: string[]): Observable<{ success: boolean }> {
    return this.http.patch<{ success: boolean }>(`${this.base}/jobs/${jobId}/finishing_ops`, { finishing_ops: ops }).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  // ─── P1-9: Billing ───────────────────────────────────────

  getBillingByClient(params: { date_from?: string; date_to?: string; studio_id?: string }): Observable<ClientBillingRow[]> {
    return this.http.get<{ entity: ClientBillingRow[] }>(`${this.base}/analytics/by-client`, { params: params as Record<string, string> }).pipe(
      timeout(PrintApiService.READ_TIMEOUT),
      map(r => r.entity)
    );
  }

  // ─── P1-10: Template Stats ───────────────────────────────

  getPresetStats(): Observable<PresetStats[]> {
    return this.http.get<{ entity: PresetStats[] }>(`${this.base}/presets/stats`).pipe(
      timeout(PrintApiService.READ_TIMEOUT),
      map(r => r.entity)
    );
  }

  recordPresetUsage(presetId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/presets/${presetId}/usage`, {}).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  // ─── P1-11: Finishing ────────────────────────────────────

  updateFinishingStatus(jobId: string, status: string, notes?: string): Observable<void> {
    return this.http.put<void>(`${this.base}/jobs/${jobId}/finishing`, { finishing_status: status, notes }).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT)
    );
  }

  // ─── P1-12: Groups ───────────────────────────────────────

  createJobGroup(params: { name?: string; customer_id?: string; job_ids: string[] }): Observable<PrintJobGroup> {
    return this.http.post<{ entity: PrintJobGroup }>(`${this.base}/jobs/group`, params).pipe(
      timeout(PrintApiService.MUTATION_TIMEOUT),
      map(r => r.entity)
    );
  }

  getJobGroups(params?: { status?: string; studio_id?: string }): Observable<PrintJobGroup[]> {
    return this.http.get<{ entity: PrintJobGroup[] }>(`${this.base}/jobs/groups`, { params: params as Record<string, string> }).pipe(
      timeout(PrintApiService.READ_TIMEOUT),
      map(r => r.entity)
    );
  }

  getJobTransitions(jobId: string): Observable<StateTransition[]> {
    return this.http.get<{ success: boolean; transitions: StateTransition[] }>(
      `${this.base}/jobs/${jobId}/transitions`
    ).pipe(map(r => r.transitions));
  }

  assignJobToGroup(jobId: string, groupId: string): Observable<void> {
    return this.http.put<void>(`${this.base}/jobs/${jobId}/group`, { group_id: groupId });
  }

  removeJobFromGroup(jobId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/jobs/${jobId}/group`);
  }

  // ─── P2-14: Self-service ─────────────────────────────────

  trackSelfServiceJob(trackingCode: string): Observable<{ job: PrintJob; position?: number }> {
    return this.http.get<{ entity: { job: PrintJob; position?: number } }>(`${this.base}/self-service/track/${trackingCode}`).pipe(
      timeout(PrintApiService.READ_TIMEOUT),
      map(r => r.entity)
    );
  }

  // ─── P2-17: Downtime ─────────────────────────────────────

  getDowntimeStats(params: { date_from?: string; date_to?: string; studio_id?: string }): Observable<DowntimeRecord[]> {
    return this.http.get<{ entity: DowntimeRecord[] }>(`${this.base}/analytics/downtime`, { params: params as Record<string, string> }).pipe(
      timeout(PrintApiService.READ_TIMEOUT),
      map(r => r.entity)
    );
  }
}
