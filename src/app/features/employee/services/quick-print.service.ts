import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, of, switchMap, map, catchError, forkJoin } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  PrintApiService,
  PrintJob,
  Printer,
  PrintPresetRecord,
  BridgePrinterStatus,
  CreatePrintJobParams,
} from './print-api.service';

export interface QuickPrintResult {
  job: PrintJob;
  printerName: string;
  presetName: string;
}

const LAST_PRESET_KEY = 'quick_print_preset';

@Injectable({ providedIn: 'root' })
export class QuickPrintService {
  private readonly printApi = inject(PrintApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  readonly lastPresetSlug = signal(
    this.isBrowser ? (localStorage.getItem(LAST_PRESET_KEY) || '10x15_glossy') : '10x15_glossy',
  );

  saveLastPreset(slug: string): void {
    this.lastPresetSlug.set(slug);
    if (this.isBrowser) {
      localStorage.setItem(LAST_PRESET_KEY, slug);
    }
  }

  private printersCache: Printer[] | null = null;
  private presetsCache: PrintPresetRecord[] | null = null;
  private statusesCache: BridgePrinterStatus[] | null = null;

  /** Load and cache printers + document presets + online statuses */
  private loadResources(): Observable<{ printers: Printer[]; presets: PrintPresetRecord[]; statuses: BridgePrinterStatus[] }> {
    const printers$ = this.printersCache
      ? of(this.printersCache)
      : this.printApi.getAllPrinters().pipe(map(p => { this.printersCache = p; return p; }));

    const presets$ = this.presetsCache
      ? of(this.presetsCache)
      : this.printApi.getPresets({ printer_type: 'photo' }).pipe(
          map(p => { this.presetsCache = p; return p; }),
        );

    const statuses$ = this.statusesCache
      ? of(this.statusesCache)
      : this.printApi.getPrinterStatuses().pipe(
          map(r => { this.statusesCache = r.printers ?? []; return this.statusesCache!; }),
          catchError(() => of([] as BridgePrinterStatus[])),
        );

    return forkJoin({ printers: printers$, presets: presets$, statuses: statuses$ });
  }

  /** Get available document presets (for dropdown) */
  getDocumentPresets(): Observable<PrintPresetRecord[]> {
    return this.loadResources().pipe(
      map(({ presets }) => presets.filter(p => p.is_active)),
    );
  }

  /** Find first online photo printer */
  private findPhotoPrinter(printers: Printer[], statuses: BridgePrinterStatus[]): Printer | null {
    const onlineNames = new Set(statuses.filter(s => s.online).map(s => s.printer_name));
    // Prefer online printers, fallback to any active photo printer
    return printers.find(p => p.printer_type === 'photo' && p.is_active && onlineNames.has(p.name))
      ?? printers.find(p => p.printer_type === 'photo' && p.is_active)
      ?? null;
  }

  /**
   * Quick print: send image to printer with preset, no dialog.
   * Returns the created job or null on error.
   */
  quickPrint(imageUrl: string, presetSlug: string, copies = 1): void {
    this.loadResources().pipe(
      switchMap(({ printers, presets, statuses }) => {
        const printer = this.findPhotoPrinter(printers, statuses);
        if (!printer) {
          this.snackBar.open('Нет доступных фото-принтеров', '', { duration: 4000 });
          return of(null);
        }

        const preset = presets.find(p => p.slug === presetSlug || p.id === presetSlug);
        if (!preset) {
          this.snackBar.open('Пресет не найден', '', { duration: 4000 });
          return of(null);
        }

        const params: CreatePrintJobParams = {
          printer_id: printer.id,
          file_url: imageUrl,
          copies,
          paper_size: preset.paper_size,
          color_mode: preset.color_mode,
          quality: preset.quality,
          duplex: preset.duplex,
          borderless: preset.borderless,
          media_type: preset.media_type ?? undefined,
          fit_mode: preset.fit_mode,
          rendering_intent: (preset.rendering_intent as CreatePrintJobParams['rendering_intent']) ?? undefined,
          document_template_slug: presetSlug,
        };

        return this.printApi.createPrintJob(params).pipe(
          map(res => ({
            job: res.job,
            printerName: printer.name,
            presetName: preset.name,
          } satisfies QuickPrintResult)),
        );
      }),
      catchError(() => {
        this.snackBar.open('Ошибка отправки на печать', '', { duration: 4000 });
        return of(null);
      }),
    ).subscribe(result => {
      if (!result) return;

      const ref = this.snackBar.open(
        `Отправлено: ${result.presetName} → ${result.printerName}`,
        'Отменить',
        { duration: 5000 },
      );

      ref.onAction().subscribe(() => {
        this.cancelJob(result.job.id);
      });
    });
  }

  /** Cancel a queued job */
  private cancelJob(jobId: string): void {
    this.printApi.cancelJob(jobId).pipe(
      catchError(() => {
        this.snackBar.open('Уже печатается, отмена невозможна', '', { duration: 3000 });
        return of(null);
      }),
    ).subscribe(() => {
      this.snackBar.open('Печать отменена', '', { duration: 2000 });
    });
  }

  /** Invalidate cache (e.g. after adding a printer) */
  clearCache(): void {
    this.printersCache = null;
    this.presetsCache = null;
    this.statusesCache = null;
  }
}
