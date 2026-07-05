import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * HTTP-клиент account-first активации подарочной подписки.
 *
 * Namespace /api/subscriptions/gift-activation/. Сессия, httpOnly cookie
 * gift_activation_sid: auth-token.interceptor.ts автоматически ставит
 * withCredentials на все /api/* запросы, поэтому cookie едет сама. Используем
 * Angular HttpClient (не голый fetch), чтобы интерцептор сработал.
 *
 * Поток (Shape B, совпадает с backend gift-activation.routes.ts):
 *   start         → создать сессию, отправить voice+email коды
 *   verifyEmail   → подтвердить 4-значный email-код (обязателен всегда)
 *   verifyPhone   → подтвердить 4-значный voice-код (опускается при недозвоне)
 *   finalize      → создать/продлить подписку + (если телефон подтверждён) логин
 *   resend        → переслать код по каналу (для email допускается смена адреса)
 */

export interface GiftStartRequest {
  promo_code: string;
  full_name: string;
  /** YYYY-MM-DD, опционально. */
  date_of_birth?: string;
  phone: string;
  email: string;
  consent: true;
  policy_version: string;
}

export interface GiftStartResponse {
  activation_token: string;
  maskedPhone: string;
  maskedEmail: string;
  voice: { expiresIn: number };
  email: { expiresIn: number };
  resendCooldownSec: number;
  /** false → звонок не запущен, сразу подтверждение по email. */
  voiceSent: boolean;
}

/** Ответ verify-email / verify-phone. */
export interface GiftCodeVerifiedResponse {
  emailVerified?: boolean;
  phoneVerified?: boolean;
  canFinalize: boolean;
}

export interface GiftFinalizeRequest {
  /** true при недозвоне, завершение без подтверждения телефона. */
  viaEmailOnly: boolean;
}

export interface GiftVerifyUser {
  id: string;
  email?: string;
  display_name?: string;
  [key: string]: unknown;
}

export interface GiftVerifySubscription {
  id: string;
  plan_name: string;
  current_period_end: string;
  status: string;
  /** 'created' → новая подписка, 'extended' → продлена существующая. */
  mode: 'created' | 'extended';
}

export interface GiftFinalizeResponse {
  user: GiftVerifyUser;
  account: { already_existed: boolean };
  subscription: GiftVerifySubscription;
  isNewUser: boolean;
  phone_verified: boolean;
  /**
   * true → телефон не подтверждён (ветка «только по email»): бэк НЕ выдал
   * токены логина, нужно войти отдельно по номеру телефона. Подписка при этом
   * уже активирована.
   */
  requiresPhoneLogin?: boolean;
  /** email уже привязан к другому аккаунту. */
  emailLinkedElsewhere?: boolean;
  /** Присутствуют только когда requiresPhoneLogin !== true. */
  accessToken?: string;
  refreshToken?: string;
}

export type GiftResendChannel = 'voice' | 'email';

export interface GiftResendRequest {
  channel: GiftResendChannel;
  /** Новый email при пересылке email-кода (patch email). */
  email?: string;
}

export interface GiftResendResponse {
  voice?: { expiresIn: number };
  email?: { expiresIn: number };
  resendCooldownSec: number;
  maskedEmail?: string;
}

const BASE = '/api/subscriptions/gift-activation';

@Injectable({ providedIn: 'root' })
export class GiftActivationService {
  private readonly http = inject(HttpClient);

  /** Шаг 2: распознан gift → создаём сессию активации, шлём voice+email коды. */
  start(body: GiftStartRequest): Observable<GiftStartResponse> {
    return this.http.post<GiftStartResponse>(`${BASE}/start`, body);
  }

  /** Подтвердить email-код (обязателен всегда). */
  verifyEmail(code: string): Observable<GiftCodeVerifiedResponse> {
    return this.http.post<GiftCodeVerifiedResponse>(`${BASE}/verify-email`, { code });
  }

  /** Подтвердить voice-код (пропускается при недозвоне). */
  verifyPhone(code: string): Observable<GiftCodeVerifiedResponse> {
    return this.http.post<GiftCodeVerifiedResponse>(`${BASE}/verify-phone`, { code });
  }

  /** Финализация: создать/продлить подписку + (если телефон подтверждён) логин. */
  finalize(body: GiftFinalizeRequest): Observable<GiftFinalizeResponse> {
    return this.http.post<GiftFinalizeResponse>(`${BASE}/finalize`, body);
  }

  /** Повторная отправка кода по каналу (voice|email). */
  resend(body: GiftResendRequest): Observable<GiftResendResponse> {
    return this.http.post<GiftResendResponse>(`${BASE}/resend`, body);
  }

  /** Сменить email и переслать код (resend channel=email + новый email). */
  patchEmail(email: string): Observable<GiftResendResponse> {
    return this.http.post<GiftResendResponse>(`${BASE}/resend`, {
      channel: 'email',
      email,
    } satisfies GiftResendRequest);
  }
}
