import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';

/**
 * Координаты в формате Яндекс.Доставки: [долгота, широта].
 * Согласовано с backend-контрактом (30-architecture.md).
 */
export type LonLat = [number, number];

/** Причина недоступности курьерской доставки (нормализованные коды backend, delivery.routes). */
export type DeliveryUnavailableReason =
  | 'feature_disabled'
  | 'provider_unavailable'
  | 'out_of_zone'
  | 'address_required'
  | 'address_imprecise'
  | 'rate_limited'
  | (string & {});

/** Студия-отправитель (backend отдаёт идентификаторы, не человекочитаемое имя). */
export interface DeliverySourceStudio {
  studioId: string;
  locationCode: string;
}

/** Успешный расчёт зоны/цены доставки (delivery.routes /quote). */
export interface DeliveryQuoteAvailable {
  available: true;
  /** Номер зоны 1..4 */
  zone: number;
  /** Человекочитаемое имя зоны (напр. «Зона 1 (центр)») */
  zoneName: string;
  /** Зональная цена доставки в рублях (то, что попадёт в чек) */
  priceRub: number;
  /** Расстояние от студии до адреса, метры */
  distanceMeters: number;
  /** Студия-отправитель */
  sourceStudio: DeliverySourceStudio;
  /** Ориентировочное время доставки, минуты */
  etaMinutes: number;
  /** Минимальный заказ печати для этой зоны, рублей (0 — без ограничения) */
  minOrderRub: number;
  /** Проходит ли текущий заказ по минимальной сумме зоны */
  meetsMinOrder: boolean;
  /** Нормализованный адрес доставки (если backend его уточнил) */
  dropoffAddress?: string | null;
}

/** Доставка недоступна для адреса/настроек. */
export interface DeliveryQuoteUnavailable {
  available: false;
  reason: DeliveryUnavailableReason;
}

export type DeliveryQuote = DeliveryQuoteAvailable | DeliveryQuoteUnavailable;

interface DeliveryQuoteRequest {
  orderTotalRub?: number;
  address?: string;
  coordinates?: LonLat;
  parcel?: { weightGrams: number; quantity: number };
}

/** Нормализованный статус отправления (см. delivery_shipments в архитектуре). */
export type ShipmentStatus =
  | 'pending'
  | 'created'
  | 'courier_assigned'
  | 'picked_up'
  | 'in_transit'
  | 'delivered'
  | 'cancelled'
  | 'failed'
  | (string & {});

export interface DeliveryCourier {
  name: string;
  phone: string | null;
}

export interface DeliveryShipment {
  status: ShipmentStatus;
  rawStatus: string | null;
  /** ETA не персистится в shipment (приходит только в /quote) — всегда null. */
  etaMinutes: number | null;
  courier: DeliveryCourier | null;
  trackingUrl: string | null;
  needsAttention: boolean;
}

/**
 * Клиент API курьерской доставки (Яндекс.Доставка).
 *
 * Backend-контракт зафиксирован в 30-architecture.md. Когда фича выключена
 * (`DELIVERY_YANDEX_ENABLED=false`), `/quote` возвращает
 * `{ available:false, reason:'feature_disabled' }` — UI прячет опцию курьера.
 */
@Injectable({ providedIn: 'root' })
export class DeliveryService {
  private readonly http = inject(HttpClient);

  /**
   * Расчёт зоны и стоимости доставки по адресу/координатам.
   * Сетевые ошибки маппятся в `provider_unavailable`, чтобы UI не падал.
   */
  quote(request: DeliveryQuoteRequest): Observable<DeliveryQuote> {
    return this.http
      .post<DeliveryQuote>('/api/delivery/quote', request)
      .pipe(
        map((response) => response),
        catchError(() =>
          of<DeliveryQuoteUnavailable>({ available: false, reason: 'provider_unavailable' }),
        ),
      );
  }

  /** Статус отправления по заказу (для страницы трекинга). IDOR на стороне backend. */
  getShipment(orderId: string): Observable<DeliveryShipment | null> {
    return this.http
      .get<DeliveryShipment>(`/api/delivery/shipments/${encodeURIComponent(orderId)}`)
      .pipe(catchError(() => of(null)));
  }
}
