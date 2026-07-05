import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { FingerprintSecretService } from './fingerprint-secret.service';

// ========== Interfaces ==========

interface ScreenSignals {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  colorDepth: number;
  pixelRatio: number;
}

interface NavigatorSignals {
  userAgent: string;
  language: string;
  languages: string[];
  platform: string;
  hardwareConcurrency: number;
  deviceMemory: number | null;
  maxTouchPoints: number;
  vendor: string;
  doNotTrack: string | null;
  cookieEnabled: boolean;
  webdriver: boolean;
  pluginsLength: number;
  mimeTypesLength: number;
  pdfViewerEnabled: boolean;
}

interface WebGLSignals {
  renderer: string;
  vendor: string;
  extensions: string[];
  maxTextureSize: number;
  maxViewportDims: number[];
  shadingLanguageVersion: string;
  hash: string;
}

interface TimezoneSignals {
  timezone: string;
  timezoneOffset: number;
}

interface ConnectionSignals {
  effectiveType: string;
  downlink: number | null;
  rtt: number | null;
}

interface BatterySignals {
  charging: boolean;
  level: number;
}

interface UADataBrand { brand: string; version: string }

interface UserAgentDataSignals {
  brands: UADataBrand[];
  mobile: boolean;
  architecture: string | null;
  bitness: string | null;
  model: string | null;
  platform: string | null;
  platformVersion: string | null;
  uaFullVersion: string | null;
}

interface NavigatorUAData {
  brands?: UADataBrand[];
  mobile?: boolean;
  getHighEntropyValues?: (hints: string[]) => Promise<Record<string, unknown>>;
}
interface NavigatorWithUAData extends Navigator {
  userAgentData?: NavigatorUAData;
}

interface CollectedSignals {
  canvas: string | null;
  webgl: WebGLSignals | null;
  audio: string | null;
  fonts: string[];
  screen: ScreenSignals;
  navigator: NavigatorSignals;
  timezone: TimezoneSignals;
  connection: ConnectionSignals | null;
  storageQuota: number | null;
  math: string;
  performanceResolution: number;
  battery: BatterySignals | null;
  userAgentData: UserAgentDataSignals | null;
}

export interface FingerprintResult {
  visitor_id: string;
  confidence: number;
  is_bot: boolean;
  request_id: string;
}

interface CacheEntry {
  result: FingerprintResult;
  timestamp: number;
}

@Injectable({ providedIn: 'root' })
export class FingerprintCollectorService {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly secretService = inject(FingerprintSecretService);

  private readonly API_URL = '/api/fingerprint/identify';
  private readonly CACHE_KEY = 'sf_fingerprint_cache';
  private readonly CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  private collectPromise: Promise<FingerprintResult> | null = null;

  private readonly TEST_FONTS = [
    'Arial', 'Arial Black', 'Arial Narrow', 'Calibri', 'Cambria', 'Cambria Math',
    'Comic Sans MS', 'Consolas', 'Courier', 'Courier New', 'Georgia',
    'Helvetica', 'Impact', 'Lucida Console', 'Lucida Sans Unicode',
    'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe UI', 'Tahoma',
    'Times', 'Times New Roman', 'Trebuchet MS', 'Verdana',
    'Wingdings', 'Webdings', 'Symbol',
    // Mac
    'Menlo', 'Monaco', 'San Francisco', 'Helvetica Neue', 'Avenir',
    // Linux
    'Ubuntu', 'DejaVu Sans', 'Liberation Sans', 'Noto Sans',
    // CJK
    'MS Gothic', 'MS PGothic', 'SimHei', 'SimSun',
    // Additional
    'Candara', 'Century Gothic', 'Franklin Gothic Medium', 'Futura',
    'Garamond', 'Gill Sans', 'Rockwell', 'Perpetua',
    'Book Antiqua', 'Bodoni MT', 'Copperplate Gothic',
  ];

  /**
   * Collect browser signals and get visitor_id from the fingerprint server.
   * Returns cached result if available and fresh.
   * Deduplicates concurrent calls.
   */
  async collect(): Promise<FingerprintResult> {
    if (!isPlatformBrowser(this.platformId)) {
      return { visitor_id: '', confidence: 0, is_bot: false, request_id: '' };
    }

    // Return cached result if fresh
    const cached = this.getCached();
    if (cached) return cached;

    // Deduplicate concurrent calls
    if (this.collectPromise) return this.collectPromise;

    this.collectPromise = this.doCollect();
    try {
      return await this.collectPromise;
    } finally {
      this.collectPromise = null;
    }
  }

  private async doCollect(): Promise<FingerprintResult> {
    let signals: CollectedSignals;
    try {
      signals = await Promise.race([
        this.collectAllSignals(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]);
    } catch {
      signals = {
        canvas: null, webgl: null, audio: null, battery: null,
        connection: null, storageQuota: null, userAgentData: null,
        fonts: this.collectFonts(),
        screen: this.collectScreenSignals(),
        navigator: this.collectNavigatorSignals(),
        timezone: this.collectTimezone(),
        math: this.collectMathFingerprint(),
        performanceResolution: this.collectPerformanceResolution(),
      };
    }

    try {
      const payload = this.flattenSignals(signals);
      const result = await this.postWithRetry(this.API_URL, payload);
      this.setCache(result);
      return result;
    } catch {
      return this.localFallback(signals);
    }
  }

  private async raceTimeout<T>(
    producer: () => Promise<T>,
    ms: number,
    fallback: T | null = null,
  ): Promise<T | null> {
    const timeout = new Promise<null>(resolve => setTimeout(() => resolve(null), ms));
    try {
      const result = await Promise.race([producer(), timeout]);
      return result ?? fallback;
    } catch {
      return fallback;
    }
  }

  private async postWithRetry(
    url: string,
    payload: Record<string, unknown>,
    attempts = 3,
  ): Promise<FingerprintResult> {
    const delays = [500, 1000, 2000];
    const signature = await this.signPayload(payload);
    const headers = signature
      ? new HttpHeaders({ 'X-Fingerprint-Signature': signature })
      : undefined;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await firstValueFrom(
          this.http.post<FingerprintResult>(url, payload, headers ? { headers } : {}),
        );
      } catch (err: unknown) {
        lastError = err;
        const status = (err instanceof HttpErrorResponse) ? err.status : 0;
        const retryable = [0, 429, 500, 502, 503, 504].includes(status);
        if (!retryable || i === attempts - 1) throw err;
        await new Promise(r => setTimeout(r, delays[i] ?? 2000));
      }
    }
    throw lastError;
  }

  // ========== HMAC signing (P1.6) ==========

  private canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(v => this.canonicalJson(v)).join(',') + ']';
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys
      .filter(k => obj[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + this.canonicalJson(obj[k]))
      .join(',') + '}';
  }

  private async signPayload(payload: unknown): Promise<string | null> {
    const secret = this.secretService.secret()
      ?? (typeof window !== 'undefined' ? window.__FP_SECRET : null);
    if (!secret || typeof crypto === 'undefined' || !crypto.subtle) return null;
    try {
      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(this.canonicalJson(payload)));
      return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      console.warn('[fingerprint] sign failed:', e);
      return null;
    }
  }

  /**
   * Flatten the nested CollectedSignals into the flat JSON structure
   * expected by the Rust fingerprint server (FingerprintRequest).
   */
  private flattenSignals(s: CollectedSignals): Record<string, unknown> {
    return {
      canvas_hash: s.canvas,
      webgl_hash: s.webgl?.hash ?? null,
      webgl_vendor: s.webgl?.vendor ?? null,
      webgl_renderer: s.webgl?.renderer ?? null,
      webgl_extensions: s.webgl?.extensions ?? null,
      audio_hash: s.audio,
      fonts: s.fonts.length > 0 ? s.fonts : null,
      screen_width: s.screen.width,
      screen_height: s.screen.height,
      screen_avail_width: s.screen.availWidth,
      screen_avail_height: s.screen.availHeight,
      color_depth: s.screen.colorDepth,
      pixel_ratio: s.screen.pixelRatio,
      timezone: s.timezone.timezone,
      timezone_offset: s.timezone.timezoneOffset,
      language: s.navigator.language,
      languages: s.navigator.languages,
      platform: s.navigator.platform,
      hardware_concurrency: s.navigator.hardwareConcurrency,
      device_memory: s.navigator.deviceMemory,
      max_touch_points: s.navigator.maxTouchPoints,
      do_not_track: s.navigator.doNotTrack,
      cookie_enabled: s.navigator.cookieEnabled,
      webdriver: s.navigator.webdriver,
      plugins_count: s.navigator.pluginsLength,
      mime_types_count: s.navigator.mimeTypesLength,
      user_agent: s.navigator.userAgent,
      vendor: s.navigator.vendor,
      connection_type: s.connection?.effectiveType ?? null,
      connection_downlink: s.connection?.downlink ?? null,
      connection_rtt: s.connection?.rtt ?? null,
      storage_quota: s.storageQuota,
      math_tan: s.math,
      performance_resolution: s.performanceResolution,
      intl_timezone: s.timezone.timezone,
      intl_locale: s.navigator.language,
      battery_charging: s.battery?.charging ?? null,
      battery_level: s.battery?.level ?? null,
      ua_brands: s.userAgentData?.brands
        ? JSON.stringify(s.userAgentData.brands.map(b => `${b.brand}/${b.version}`))
        : null,
      ua_architecture: s.userAgentData?.architecture ?? null,
      ua_bitness: s.userAgentData?.bitness ?? null,
      ua_model: s.userAgentData?.model ?? null,
      ua_platform_version: s.userAgentData?.platformVersion ?? null,
      ua_mobile: s.userAgentData?.mobile ?? null,
      ua_full_version: s.userAgentData?.uaFullVersion ?? null,
    };
  }

  // ========== Signal collection (parallel) ==========

  private async collectAllSignals(): Promise<CollectedSignals> {
    // Per-signal timeouts: each async collector has its own budget
    const [canvas, webgl, audio, fonts, connection, storageQuota, userAgentData] =
      await Promise.all([
        this.raceTimeout(() => this.collectCanvasFingerprint(), 2000),
        this.raceTimeout(() => this.collectWebGLFingerprint(), 1000),
        this.raceTimeout(() => this.collectAudioFingerprint(), 1000),
        this.raceTimeout(() => Promise.resolve(this.collectFonts()), 500),
        this.raceTimeout(() => this.collectConnectionInfo(), 200),
        this.raceTimeout(() => this.collectStorageQuota(), 500),
        this.raceTimeout(() => this.collectUserAgentData(), 500),
      ]);

    return {
      canvas,
      webgl,
      audio,
      fonts: fonts ?? [],
      screen: this.collectScreenSignals(),
      navigator: this.collectNavigatorSignals(),
      timezone: this.collectTimezone(),
      connection,
      storageQuota,
      math: this.collectMathFingerprint(),
      performanceResolution: this.collectPerformanceResolution(),
      battery: null,
      userAgentData,
    };
  }

  // ========== userAgentData ==========

  private async collectUserAgentData(): Promise<UserAgentDataSignals | null> {
    try {
      const nav: NavigatorWithUAData = navigator;
      const uad = nav.userAgentData;
      if (!uad || typeof uad.getHighEntropyValues !== 'function') return null;

      const data = await uad.getHighEntropyValues([
        'architecture', 'model', 'platform', 'platformVersion', 'uaFullVersion', 'bitness',
      ]);
      const readString = (key: string): string | null => {
        const v = data[key];
        return typeof v === 'string' ? v : null;
      };

      return {
        brands: Array.isArray(uad.brands) ? uad.brands : [],
        mobile: !!uad.mobile,
        architecture: readString('architecture'),
        bitness: readString('bitness'),
        model: readString('model'),
        platform: readString('platform'),
        platformVersion: readString('platformVersion'),
        uaFullVersion: readString('uaFullVersion'),
      };
    } catch {
      return null;
    }
  }

  // ========== Canvas ==========

  private async collectCanvasFingerprint(): Promise<string | null> {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('SvoeFoto fingerprint \uD83C\uDFA8', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('Canvas FP test', 4, 45);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgb(255, 0, 255)';
      ctx.beginPath();
      ctx.arc(50, 50, 50, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgb(0, 255, 255)';
      ctx.beginPath();
      ctx.arc(100, 50, 50, 0, Math.PI * 2);
      ctx.closePath();
      ctx.fill();

      return await this.sha256(canvas.toDataURL());
    } catch {
      return null;
    }
  }

  // ========== WebGL ==========

  private async collectWebGLFingerprint(): Promise<WebGLSignals | null> {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl || !(gl instanceof WebGLRenderingContext)) return null;

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
      const extensions = gl.getSupportedExtensions() || [];
      const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
      const maxViewportDims = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array);
      const shadingLanguageVersion = gl.getParameter(gl.SHADING_LANGUAGE_VERSION) as string;

      const raw = [renderer, vendor, extensions.join(','), maxTextureSize, maxViewportDims.join(','), shadingLanguageVersion].join('|');
      const hash = await this.sha256(raw);

      return { renderer, vendor, extensions, maxTextureSize, maxViewportDims, shadingLanguageVersion, hash };
    } catch {
      return null;
    }
  }

  // ========== Audio ==========

  private async collectAudioFingerprint(): Promise<string | null> {
    try {
      if (typeof OfflineAudioContext === 'undefined') return null;

      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const oscillator = ctx.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.setValueAtTime(10000, ctx.currentTime);

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-50, ctx.currentTime);
      compressor.knee.setValueAtTime(40, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0, ctx.currentTime);
      compressor.release.setValueAtTime(0.25, ctx.currentTime);

      oscillator.connect(compressor);
      compressor.connect(ctx.destination);
      oscillator.start(0);

      const buffer = await ctx.startRendering();
      const data = buffer.getChannelData(0);
      let sum = 0;
      for (let i = 4500; i < 5000; i++) sum += Math.abs(data[i]);
      return await this.sha256(sum.toString());
    } catch {
      return null;
    }
  }

  // ========== Fonts ==========

  private collectFonts(): string[] {
    try {
      const baseFonts = ['monospace', 'sans-serif', 'serif'] as const;
      const testString = 'mmmmmmmmmmlli';
      const testSize = '72px';
      const span = document.createElement('span');
      span.style.position = 'absolute';
      span.style.left = '-9999px';
      span.style.fontSize = testSize;
      span.style.lineHeight = 'normal';
      span.textContent = testString;
      document.body.appendChild(span);

      // Measure base fonts
      const baseWidths: Record<string, number> = {};
      const baseHeights: Record<string, number> = {};
      for (const base of baseFonts) {
        span.style.fontFamily = base;
        baseWidths[base] = span.offsetWidth;
        baseHeights[base] = span.offsetHeight;
      }

      const detected: string[] = [];
      for (const font of this.TEST_FONTS) {
        let found = false;
        for (const base of baseFonts) {
          span.style.fontFamily = `'${font}', ${base}`;
          if (span.offsetWidth !== baseWidths[base] || span.offsetHeight !== baseHeights[base]) {
            found = true;
            break;
          }
        }
        if (found) detected.push(font);
      }

      document.body.removeChild(span);
      return detected;
    } catch {
      return [];
    }
  }

  // ========== Screen ==========

  private collectScreenSignals(): ScreenSignals {
    return {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelRatio: devicePixelRatio,
    };
  }

  // ========== Navigator ==========

  private collectNavigatorSignals(): NavigatorSignals {
    const nav = navigator as NavigatorSignals & Navigator & { deviceMemory?: number; pdfViewerEnabled?: boolean };
    return {
      userAgent: nav.userAgent,
      language: nav.language,
      languages: Array.from(nav.languages || []),
      platform: nav.platform,
      hardwareConcurrency: nav.hardwareConcurrency || 0,
      deviceMemory: nav.deviceMemory ?? null,
      maxTouchPoints: nav.maxTouchPoints || 0,
      vendor: nav.vendor,
      doNotTrack: nav.doNotTrack,
      cookieEnabled: nav.cookieEnabled,
      webdriver: !!(nav as unknown as Record<string, unknown>)['webdriver'],
      pluginsLength: nav.plugins?.length ?? 0,
      mimeTypesLength: nav.mimeTypes?.length ?? 0,
      pdfViewerEnabled: nav.pdfViewerEnabled ?? false,
    };
  }

  // ========== Timezone ==========

  private collectTimezone(): TimezoneSignals {
    return {
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffset: new Date().getTimezoneOffset(),
    };
  }

  // ========== Connection ==========

  private async collectConnectionInfo(): Promise<ConnectionSignals | null> {
    try {
      const conn = (navigator as unknown as Record<string, unknown>)['connection'] as
        { effectiveType?: string; downlink?: number; rtt?: number } | undefined;
      if (!conn) return null;
      return {
        effectiveType: conn.effectiveType || '',
        downlink: conn.downlink ?? null,
        rtt: conn.rtt ?? null,
      };
    } catch {
      return null;
    }
  }

  // ========== Storage ==========

  private async collectStorageQuota(): Promise<number | null> {
    try {
      if (!navigator.storage?.estimate) return null;
      const est = await navigator.storage.estimate();
      return est.quota ?? null;
    } catch {
      return null;
    }
  }

  // ========== Math ==========

  private collectMathFingerprint(): string {
    const values = [
      Math.tan(-1e300),
      Math.acos(0.123456789),
      Math.sinh(1),
      Math.log(2),
      Math.pow(Math.PI, -100),
    ];
    return values.map(v => v.toString()).join(',');
  }

  // ========== Performance ==========

  private collectPerformanceResolution(): number {
    try {
      const t0 = performance.now();
      const t1 = performance.now();
      return t1 - t0;
    } catch {
      return -1;
    }
  }

  // Battery API removed — deprecated in all browsers, always returned null

  // ========== Cache ==========

  private getCached(): FingerprintResult | null {
    try {
      const raw = localStorage.getItem(this.CACHE_KEY);
      if (!raw) return null;
      const entry: CacheEntry = JSON.parse(raw);
      if (Date.now() - entry.timestamp > this.CACHE_TTL) {
        localStorage.removeItem(this.CACHE_KEY);
        return null;
      }
      return entry.result;
    } catch {
      return null;
    }
  }

  private setCache(result: FingerprintResult): void {
    try {
      const entry: CacheEntry = { result, timestamp: Date.now() };
      localStorage.setItem(this.CACHE_KEY, JSON.stringify(entry));
    } catch { /* localStorage full or unavailable */ }
  }

  // ========== Local fallback ==========

  private async localFallback(signals: CollectedSignals): Promise<FingerprintResult> {
    const components = [
      signals.canvas ?? '',
      signals.webgl?.hash ?? '',
      signals.audio ?? '',
      signals.fonts.join(','),
      `${signals.screen.width}x${signals.screen.height}x${signals.screen.colorDepth}`,
      signals.navigator.userAgent,
      signals.navigator.language,
      signals.navigator.platform,
      String(signals.navigator.hardwareConcurrency),
      String(signals.navigator.deviceMemory ?? ''),
      String(signals.navigator.maxTouchPoints),
      signals.timezone.timezone,
      String(signals.timezone.timezoneOffset),
      signals.math,
      String(signals.storageQuota ?? ''),
    ];

    const hash = await this.sha256(components.join('|||'));
    const visitor_id = `fp_${hash.substring(0, 20)}`;

    const result: FingerprintResult = {
      visitor_id,
      confidence: 0.6,
      is_bot: signals.navigator.webdriver,
      request_id: crypto.randomUUID(),
    };

    this.setCache(result);
    return result;
  }

  // ========== SHA-256 ==========

  private async sha256(data: string): Promise<string> {
    const encoder = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
}
