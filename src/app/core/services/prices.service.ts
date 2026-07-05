import { Injectable, inject, PLATFORM_ID, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { catchError, tap, shareReplay } from 'rxjs/operators';
import { Observable, of } from 'rxjs';
import { LoggerService } from './logger.service';

export interface PhotoPrintPrices {
  premium_10x15: number;
  premium_15x20: number;
  premium_20x30: number;
  super_10x15: number;
  super_15x20: number;
  super_20x30: number;
}

export interface PricesResponse {
  success: boolean;
  timestamp: string;
  prices: PhotoPrintPrices;
  min_price: number;
  error?: string;
}

/** Позиция из Контур Маркет */
export interface KonturPriceItem {
  id: string;
  name: string;
  price: number | null;
  priceType: string;
  group?: string;
  groupId?: string;
  unit?: string;
}

/** Ответ от /api/prices (Контур Маркет) */
export interface KonturPricesResponse {
  items: KonturPriceItem[];
  updatedAt: string;
  shopId: string;
}

// Fallback prices if API is unavailable
const FALLBACK_PRICES: PhotoPrintPrices = {
  premium_10x15: 20,
  premium_15x20: 49,
  premium_20x30: 117,
  super_10x15: 36,
  super_15x20: 70,
  super_20x30: 140
};

@Injectable({
  providedIn: 'root'
})
export class PricesService {
  private http = inject(HttpClient);
  private platformId = inject(PLATFORM_ID);
  private log = inject(LoggerService);
  
  // Cached prices
  private pricesCache$: Observable<PricesResponse> | null = null;
  private lastFetch = 0;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  // Reactive signals for prices
  private _prices = signal<PhotoPrintPrices>(FALLBACK_PRICES);
  private _minPrice = signal<number>(20);
  private _isLoaded = signal<boolean>(false);
  
  // Public readonly signals
  readonly prices = this._prices.asReadonly();
  readonly minPrice = this._minPrice.asReadonly();
  readonly isLoaded = this._isLoaded.asReadonly();
  
  // Computed values for templates
  readonly premium10x15 = computed(() => this._prices().premium_10x15);
  readonly premium15x20 = computed(() => this._prices().premium_15x20);
  readonly premium20x30 = computed(() => this._prices().premium_20x30);
  readonly super10x15 = computed(() => this._prices().super_10x15);
  readonly super15x20 = computed(() => this._prices().super_15x20);
  readonly super20x30 = computed(() => this._prices().super_20x30);
  
  constructor() {
    // Load prices on initialization (only in browser)
    if (isPlatformBrowser(this.platformId)) {
      this.loadPrices();
    }
  }
  
  /**
   * Load photo print prices from API
   */
  loadPrices(): void {
    this.getPhotoPrintPrices().subscribe({
      next: (response) => {
        if (response.success && response.prices) {
          this._prices.set(response.prices);
          this._minPrice.set(response.min_price || this.calculateMinPrice(response.prices));
          this._isLoaded.set(true);
        }
      },
      error: (err) => {
        this.log.warn('Failed to load prices, using fallback:', err);
        this._prices.set(FALLBACK_PRICES);
        this._minPrice.set(this.calculateMinPrice(FALLBACK_PRICES));
        this._isLoaded.set(true);
      }
    });
  }
  
  /**
   * Get photo print prices with caching
   */
  getPhotoPrintPrices(): Observable<PricesResponse> {
    const now = Date.now();
    
    // Return cached response if still valid
    if (this.pricesCache$ && (now - this.lastFetch) < this.CACHE_TTL) {
      return this.pricesCache$;
    }
    
    // Fetch fresh prices
    this.lastFetch = now;
    this.pricesCache$ = this.http.get<PricesResponse>('/api/prices/photo-print').pipe(
      tap(response => {
        if (response.success) {
          this.log.debug('Prices loaded from API:', response.prices);
        }
      }),
      catchError(error => {
        this.log.error('Error fetching prices:', error);
        return of({
          success: true,
          timestamp: new Date().toISOString(),
          prices: FALLBACK_PRICES,
          min_price: this.calculateMinPrice(FALLBACK_PRICES)
        });
      }),
      shareReplay(1)
    );
    
    return this.pricesCache$;
  }
  
  /**
   * Get all services with prices
   */
  getAllServices(): Observable<unknown> {
    return this.http.get('/api/prices/services').pipe(
      catchError(error => {
        this.log.error('Error fetching services:', error);
        return of({ success: false, error: error.message, services: [] });
      })
    );
  }
  
  /**
   * Get price by format key
   */
  getPrice(key: keyof PhotoPrintPrices): number {
    return this._prices()[key] || 0;
  }
  
  /**
   * Get formatted price string
   */
  getFormattedPrice(key: keyof PhotoPrintPrices): string {
    const price = this.getPrice(key);
    // Format: show decimal only if not whole number
    if (price % 1 === 0) {
      return `${price}₽`;
    }
    return `${price.toFixed(1).replace('.', ',')}₽`;
  }
  
  /**
   * Calculate minimum price from all prices
   */
  private calculateMinPrice(prices: PhotoPrintPrices): number {
    return Math.min(
      prices.premium_10x15,
      prices.premium_15x20,
      prices.premium_20x30,
      prices.super_10x15,
      prices.super_15x20,
      prices.super_20x30
    );
  }
  
  /**
   * Force refresh prices (clears cache)
   */
  refreshPrices(): void {
    this.pricesCache$ = null;
    this.lastFetch = 0;
    this.loadPrices();
  }

  // ===== Контур Маркет (цены офлайн-студии) =====

  private _konturItems = signal<KonturPriceItem[]>([]);
  private _konturLoaded = signal(false);
  private konturCache$: Observable<KonturPricesResponse> | null = null;
  private konturLastFetch = 0;

  readonly konturItems = this._konturItems.asReadonly();
  readonly konturLoaded = this._konturLoaded.asReadonly();

  /**
   * Загрузить все цены из Контур Маркет
   */
  loadKonturPrices(): void {
    this.getKonturPrices().subscribe({
      next: (resp) => {
        this._konturItems.set(resp.items);
        this._konturLoaded.set(true);
      },
      error: () => {
        this._konturLoaded.set(true);
      },
    });
  }

  /**
   * Получить цены Контур Маркет (с кешем)
   */
  getKonturPrices(): Observable<KonturPricesResponse> {
    const now = Date.now();
    if (this.konturCache$ && (now - this.konturLastFetch) < this.CACHE_TTL) {
      return this.konturCache$;
    }
    this.konturLastFetch = now;
    this.konturCache$ = this.http.get<KonturPricesResponse>('/api/prices').pipe(
      tap(resp => this.log.debug(`📦 Kontur Market: ${resp.items.length} items loaded`)),
      catchError(err => {
        this.log.warn('Kontur Market prices unavailable:', err);
        return of({ items: [], updatedAt: new Date().toISOString(), shopId: '' });
      }),
      shareReplay(1),
    );
    return this.konturCache$;
  }

  /**
   * Найти цену по названию услуги/товара (нечёткий поиск)
   */
  findKonturPrice(query: string): KonturPriceItem | undefined {
    const q = query.toLowerCase();
    return this._konturItems().find(item =>
      item.name.toLowerCase().includes(q)
    );
  }

  /**
   * Получить все позиции по группе
   */
  getKonturByGroup(groupName: string): KonturPriceItem[] {
    const q = groupName.toLowerCase();
    return this._konturItems().filter(item =>
      item.group && item.group.toLowerCase().includes(q)
    );
  }

  /**
   * Получить форматированную цену Контур Маркет
   */
  getKonturFormattedPrice(item: KonturPriceItem): string {
    if (item.price === null || item.price === undefined) {
      return 'по запросу';
    }
    return item.price % 1 === 0 ? `${item.price}₽` : `${item.price.toFixed(0)}₽`;
  }
}
