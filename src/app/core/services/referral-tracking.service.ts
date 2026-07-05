import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

const LS_PARTNER_REF_KEY = 'svf_partner_ref';
const LS_LOYALTY_REF_KEY = 'svf_loyalty_ref';
const LS_PROMO_KEY = 'svf_promo_code';
const TTL_DAYS = 30;

interface ReferralEntry {
  code: string;
  expiresAt: number; // timestamp ms
}

@Injectable({ providedIn: 'root' })
export class ReferralTrackingService {
  private readonly platformId = inject(PLATFORM_ID);

  /**
   * Reads referral params from current URL, saves them to localStorage with 30-day TTL,
   * then removes the params from the URL via replaceState.
   * SSR-safe: only runs in browser.
   */
  captureFromUrl(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref');
    const loyaltyRefCode = params.get('loyaltyRef');
    const promoCode = params.get('promo');
    const shouldCapturePromo = Boolean(promoCode) && !this.isSubscriptionsPath();

    if (refCode) {
      this.saveToKey(LS_PARTNER_REF_KEY, refCode);
      this.saveToKey(LS_LOYALTY_REF_KEY, refCode);
      params.delete('ref');
    }
    if (loyaltyRefCode) {
      this.saveToKey(LS_LOYALTY_REF_KEY, loyaltyRefCode);
      params.delete('loyaltyRef');
    }
    if (promoCode && shouldCapturePromo) {
      this.saveToKey(LS_PROMO_KEY, promoCode);
      params.delete('promo');
    }

    if (refCode || loyaltyRefCode || shouldCapturePromo) {
      // Clean URL without triggering navigation.
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      window.history.replaceState(window.history.state, '', newUrl);
    }
  }

  /** Returns the stored partner referral code if TTL is valid, otherwise null */
  getPartnerCode(): string | null {
    return this.readFromKey(LS_PARTNER_REF_KEY);
  }

  /** Returns the stored loyalty referral code if TTL is valid, otherwise null */
  getLoyaltyReferralCode(): string | null {
    return this.readFromKey(LS_LOYALTY_REF_KEY);
  }

  /** Returns the stored promo code if TTL is valid, otherwise null */
  getPromoCode(): string | null {
    return this.readFromKey(LS_PROMO_KEY);
  }

  /** Clears the stored referral code (call after successful order/booking) */
  clear(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(LS_PARTNER_REF_KEY);
  }

  /** Clears the stored loyalty referral code after it was applied or rejected */
  clearLoyaltyReferralCode(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(LS_LOYALTY_REF_KEY);
  }

  /** Clears the stored promo code (call after successful order/booking) */
  clearPromo(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    localStorage.removeItem(LS_PROMO_KEY);
  }

  private isSubscriptionsPath(): boolean {
    const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
    return normalizedPath === '/subscriptions';
  }

  private readFromKey(key: string): string | null {
    if (!isPlatformBrowser(this.platformId)) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry: ReferralEntry = JSON.parse(raw);
      if (Date.now() > entry.expiresAt) {
        localStorage.removeItem(key);
        return null;
      }
      return entry.code;
    } catch {
      return null;
    }
  }

  private saveToKey(key: string, code: string): void {
    const entry: ReferralEntry = {
      code: code.trim().toUpperCase(),
      expiresAt: Date.now() + TTL_DAYS * 24 * 60 * 60 * 1000,
    };
    localStorage.setItem(key, JSON.stringify(entry));
  }
}
