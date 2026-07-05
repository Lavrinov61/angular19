import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import type {
  AccountAccessInfoApiResponse,
  AccountSubscriptionKind,
  GiftPromoApiResponse,
  OfferApiResponse,
  PlansApiResponse,
} from '../models/subscription-offer.models';

@Injectable({ providedIn: 'root' })
export class SubscriptionOfferApiService {
  private readonly http = inject(HttpClient);

  getPlans() {
    return this.http.get<PlansApiResponse>('/api/subscriptions/plans');
  }

  sendOffer(planId: string, chatSessionId: string) {
    return this.http.post<OfferApiResponse>('/api/subscriptions/offer', {
      plan_id: planId,
      chat_session_id: chatSessionId,
    });
  }

  sendGift(planId: string, chatSessionId: string) {
    return this.http.post<GiftPromoApiResponse>('/api/subscriptions/gift-promos', {
      plan_id: planId,
      chat_session_id: chatSessionId,
    });
  }

  sendAccountAccessInfo(accountType: AccountSubscriptionKind, chatSessionId: string) {
    return this.http.post<AccountAccessInfoApiResponse>('/api/subscriptions/account-access-info', {
      account_type: accountType,
      chat_session_id: chatSessionId,
    });
  }
}
