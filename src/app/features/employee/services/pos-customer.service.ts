import { Injectable, inject, signal, DestroyRef } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { debounceTime, switchMap, catchError, EMPTY } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { PosApiService } from './pos-api.service';
import { PosService } from './pos.service';

@Injectable({ providedIn: 'root' })
export class PosCustomerService {
  private readonly posApi = inject(PosApiService);
  private readonly posService = inject(PosService);
  private readonly destroyRef = inject(DestroyRef);

  readonly customerPhone = signal('');
  readonly customerLoading = signal(false);

  constructor() {
    toObservable(this.customerPhone).pipe(
      debounceTime(300),
      switchMap(phone => {
        const cleaned = phone.replace(/\D/g, '');
        if (cleaned.length < 10) {
          this.posService.setCustomer(null);
          return EMPTY;
        }
        this.customerLoading.set(true);
        return this.posApi.lookupCustomer(cleaned).pipe(
          catchError(() => {
            this.posService.setCustomer({ phone: cleaned });
            this.customerLoading.set(false);
            return EMPTY;
          }),
        );
      }),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(data => {
      this.posService.setCustomer({
        phone: this.customerPhone().replace(/\D/g, ''),
        name: data.customer_name ?? undefined,
        loyalty: data.loyalty ?? undefined,
        subscription: data.subscription ? {
          id: data.subscription.id,
          plan_name: data.subscription.plan_name,
          credits: data.subscription.credits,
        } : undefined,
        studentDiscount: data.student_discount ?? null,
      });
      this.customerLoading.set(false);
    });
  }

  clear(): void {
    this.customerPhone.set('');
    this.posService.setCustomer(null);
  }
}
