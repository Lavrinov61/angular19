import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, map } from 'rxjs';

/** Режим цвета: 'auto' = авто-детект Rust, 'color'/'bw' = override (≤15% заливки: ч/б ↔ цвет). */
export type EduPrintColorMode = 'auto' | 'color' | 'bw';

/** Фазы калькулятора: загрузка файла → анализ → результат. */
export type EduPrintEstimateState =
  | 'idle'
  | 'uploading'
  | 'analyzing'
  | 'done'
  | 'error';

/** Постраничная разбивка оценки (цены приходят с бэкенда, фронт ничего не считает). */
export interface EduPrintEstimatePage {
  readonly page: number;
  readonly coveragePercent: number;
  readonly isColor: boolean;
  readonly tier: string;
  readonly slug: string;
  readonly catalogPriceRub: number;
  readonly eduPriceRub: number;
  readonly withinLimit: boolean;
}

export interface EduPrintEstimateSummary {
  readonly catalogTotalRub: number;
  readonly eduTotalRub: number;
  readonly savingsRub: number;
  readonly documentsConsumed: number;
  readonly documentsOverLimit: number;
  readonly minimumCheckRub: number;
  readonly belowMinimum: boolean;
}

export interface EduPrintEstimateAllowance {
  readonly active: boolean;
  readonly documentsRemaining: number;
  readonly documentsLimit: number;
  readonly photosRemaining: number;
  readonly photosLimit: number;
  readonly periodEnd: string | null;
}

export interface EduPrintEstimateResult {
  readonly pageCount: number;
  readonly documentType: string;
  readonly detectedColor: boolean;
  readonly appliedColorMode: EduPrintColorMode;
  readonly pages: readonly EduPrintEstimatePage[];
  readonly summary: EduPrintEstimateSummary;
  readonly allowance: EduPrintEstimateAllowance | null;
  readonly subscription: { readonly active: boolean };
}

interface ApiSuccess<T> {
  readonly success: true;
  readonly data: T;
}

interface PresignResponseData {
  readonly s3Key: string;
  readonly uploadUrl: string;
  readonly contentType: string;
}

/**
 * Калькулятор стоимости edu-печати для кабинета подписчика.
 *
 * Поток: presign → PUT файла напрямую в S3 → estimate(s3Key, colorMode). Тумблер Ч/Б↔Цвет
 * вызывает reprice(), который повторно зовёт estimate с тем же s3Key, БЕЗ повторной загрузки.
 * Только HTTP + типы; вся бизнес-логика (цены, лимиты, тиры), на бэкенде.
 */
@Injectable({ providedIn: 'root' })
export class EduPrintEstimateService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/education/print-estimate';

  private readonly _state = signal<EduPrintEstimateState>('idle');
  private readonly _result = signal<EduPrintEstimateResult | null>(null);
  private readonly _error = signal('');
  private readonly _fileName = signal('');
  private readonly _colorMode = signal<EduPrintColorMode>('auto');
  private readonly _s3Key = signal<string | null>(null);

  /** Текущая фаза калькулятора. */
  readonly state = this._state.asReadonly();
  /** Последний успешный результат оценки (или null). */
  readonly result = this._result.asReadonly();
  /** Сообщение об ошибке для UI. */
  readonly error = this._error.asReadonly();
  /** Имя выбранного файла. */
  readonly fileName = this._fileName.asReadonly();
  /** Текущий режим цвета (управляет тумблером). */
  readonly colorMode = this._colorMode.asReadonly();

  readonly isBusy = computed(
    () => this._state() === 'uploading' || this._state() === 'analyzing',
  );

  /**
   * Загрузка нового файла: presign → PUT в S3 → первая оценка (auto).
   * Сбрасывает предыдущий результат и режим цвета.
   */
  async upload(file: File): Promise<void> {
    this._error.set('');
    this._result.set(null);
    this._fileName.set(file.name);
    this._colorMode.set('auto');
    this._s3Key.set(null);
    this._state.set('uploading');

    try {
      const presigned = await firstValueFrom(this.presign(file));
      await firstValueFrom(this.put(presigned.uploadUrl, presigned.contentType, file));
      this._s3Key.set(presigned.s3Key);
      await this.runEstimate(presigned.s3Key, 'auto');
    } catch (error: unknown) {
      this._state.set('error');
      this._error.set(
        this.readErrorMessage(error, 'Не удалось проанализировать файл.'),
      );
    }
  }

  /**
   * Пересчёт по новому режиму цвета без повторной загрузки файла (тумблер Ч/Б↔Цвет).
   * Использует уже загруженный s3Key. No-op, если файл ещё не загружен или режим не изменился.
   */
  async reprice(colorMode: EduPrintColorMode): Promise<void> {
    const s3Key = this._s3Key();
    if (!s3Key || colorMode === this._colorMode()) {
      return;
    }
    this._colorMode.set(colorMode);
    this._error.set('');
    try {
      await this.runEstimate(s3Key, colorMode);
    } catch (error: unknown) {
      this._state.set('error');
      this._error.set(
        this.readErrorMessage(error, 'Не удалось пересчитать стоимость.'),
      );
    }
  }

  /** Перевод калькулятора в состояние ошибки с заданным сообщением (валидация на фронте). */
  fail(message: string): void {
    this._result.set(null);
    this._s3Key.set(null);
    this._error.set(message);
    this._state.set('error');
  }

  /** Полный сброс калькулятора в исходное состояние. */
  reset(): void {
    this._state.set('idle');
    this._result.set(null);
    this._error.set('');
    this._fileName.set('');
    this._colorMode.set('auto');
    this._s3Key.set(null);
  }

  private async runEstimate(
    s3Key: string,
    colorMode: EduPrintColorMode,
  ): Promise<void> {
    this._state.set('analyzing');
    const result = await firstValueFrom(this.estimate(s3Key, colorMode));
    this._result.set(result);
    this._colorMode.set(result.appliedColorMode);
    this._state.set('done');
  }

  private presign(file: File): Observable<PresignResponseData> {
    return this.http
      .post<ApiSuccess<PresignResponseData>>(`${this.baseUrl}/presign`, {
        fileName: file.name,
        contentType: file.type,
        fileSize: file.size,
      })
      .pipe(map((response) => response.data));
  }

  private put(uploadUrl: string, contentType: string, file: File) {
    const headers = new HttpHeaders({ 'Content-Type': contentType });
    return this.http.put(uploadUrl, file, { headers, responseType: 'text' });
  }

  private estimate(
    s3Key: string,
    colorMode: EduPrintColorMode,
  ): Observable<EduPrintEstimateResult> {
    return this.http
      .post<ApiSuccess<EduPrintEstimateResult>>(this.baseUrl, {
        s3Key,
        colorMode,
      })
      .pipe(map((response) => response.data));
  }

  private readErrorMessage(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null) {
      return fallback;
    }

    const responseError = Reflect.get(error, 'error');
    if (typeof responseError === 'string') {
      return responseError;
    }

    if (typeof responseError === 'object' && responseError !== null) {
      const nestedError = Reflect.get(responseError, 'error');
      if (typeof nestedError === 'string') {
        return nestedError;
      }

      const nestedMessage = Reflect.get(responseError, 'message');
      if (typeof nestedMessage === 'string') {
        return nestedMessage;
      }
    }

    const message = Reflect.get(error, 'message');
    return typeof message === 'string' ? message : fallback;
  }
}
