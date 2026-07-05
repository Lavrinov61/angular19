import { Injectable, inject, signal, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { tap, catchError, of, timeout } from 'rxjs';

interface FingerprintSecretResponse {
  secret: string;
  key_id: string;
}

@Injectable({ providedIn: 'root' })
export class FingerprintSecretService {
  private readonly http = inject(HttpClient);
  private readonly platformId = inject(PLATFORM_ID);
  private readonly _secret = signal<string | null>(null);

  readonly secret = this._secret.asReadonly();

  async load(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      await firstValueFrom(
        this.http.get<FingerprintSecretResponse>('/api/fingerprint/secret').pipe(
          timeout({ first: 5000, with: () => of({ secret: '', key_id: '' }) }),
          tap(r => this._secret.set(r.secret)),
          catchError(() => of(null)),
        ),
      );
    } catch {
      // не падать bootstrap
    }
  }
}
