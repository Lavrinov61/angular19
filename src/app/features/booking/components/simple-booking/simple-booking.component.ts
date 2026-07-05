import { Component, ChangeDetectionStrategy, inject, signal, computed, PLATFORM_ID, ElementRef, AfterViewInit, OnDestroy, NgZone } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatDividerModule } from '@angular/material/divider';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ADDRESSES, STUDIO_PHONE, STUDIO_PHONE_HREF, type StudioAddress } from '../../../../core/data/address.data';
import { Bitrix24BookingService, type BookingTimeSlot } from '../../../../core/services/bitrix24-booking.service';
import { SeoService } from '../../../../core/services/seo.service';
import { ReferralTrackingService } from '../../../../core/services/referral-tracking.service';
import { StudioAlertService } from '../../../../core/services/studio-alert.service';
import { environment } from '../../../../../environments/environment';
import { startWith, map } from 'rxjs';

interface SlotGroup {
  label: string;
  icon: string;
  slots: BookingTimeSlot[];
}

interface ServiceOption {
  id: string;
  label: string;
  icon: string;
}

interface BookingHeroPhotoSample {
  src: string;
  alt: string;
  label: string;
}

interface StoredContactData {
  name?: string;
  phone?: string;
}

interface YMapObject {
  destroy(): void;
  behaviors: {
    disable(name: string): void;
  };
  geoObjects: {
    add(obj: unknown): void;
  };
}

interface YPlacemarkObject {
  events: {
    add(name: string, cb: () => void): void;
  };
  options: {
    set(key: string, val: string): void;
  };
}

interface YMapsApi {
  ready(cb: () => void): void;
  Map: new (el: HTMLElement, opts: Record<string, unknown>) => YMapObject;
  Placemark: new (
    coords: number[],
    props: Record<string, string>,
    opts: Record<string, unknown>
  ) => YPlacemarkObject;
}

interface YMapsLoaderApi {
  ready(cb: () => void): void;
}

const STORAGE_KEY = 'svoe-foto-booking-contact';
const BOOKING_PHONE_CODE_LENGTH = 4;
const BOOKING_PHONE_CODE_RESEND_DELAY_SECONDS = 45;
const YANDEX_MAPS_SCRIPT_ID = 'svoe-foto-yandex-maps-api';

type BookingPhoneVerificationPhase = 'contact' | 'code';
type StudioAddressWithCoordinates = StudioAddress & { coordinates: NonNullable<StudioAddress['coordinates']> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredContactData(value: unknown): value is StoredContactData {
  if (!isRecord(value)) return false;
  const name = Reflect.get(value, 'name');
  const phone = Reflect.get(value, 'phone');
  return (name === undefined || typeof name === 'string')
    && (phone === undefined || typeof phone === 'string');
}

function hasStudioCoordinates(studio: StudioAddress): studio is StudioAddressWithCoordinates {
  return studio.coordinates !== undefined && studio.coordinates !== null;
}

function isYMapsApi(value: unknown): value is YMapsApi {
  if (!isRecord(value)) return false;
  return typeof Reflect.get(value, 'ready') === 'function'
    && typeof Reflect.get(value, 'Map') === 'function'
    && typeof Reflect.get(value, 'Placemark') === 'function';
}

function isYMapsLoaderApi(value: unknown): value is YMapsLoaderApi {
  if (!isRecord(value)) return false;
  return typeof Reflect.get(value, 'ready') === 'function';
}

// Маркетплейс-категории, запись только 18:00-19:30
const MARKETPLACE_SERVICE_IDS = new Set([
  'marketplace-photo', 'infographics', 'smm-content', 'selling-pack',
]);

const SERVICES: ServiceOption[] = [
  { id: 'photo-docs', label: 'Фото на документы', icon: 'badge' },
  { id: 'portrait', label: 'Портретное фото', icon: 'face_retouching_natural' },
  { id: 'marketplace-photo', label: 'Товарная съёмка', icon: 'camera_alt' },
  { id: 'infographics', label: 'Инфографика карточек', icon: 'analytics' },
  { id: 'smm-content', label: 'SMM-контент', icon: 'movie_creation' },
  { id: 'selling-pack', label: 'Продающий пакет', icon: 'shopping_bag' },
  { id: 'other', label: 'Другое', icon: 'more_horiz' },
];

const BOOKING_HERO_PHOTO_SAMPLES = [
  { src: '/assets/images/document-sample-passport-rf.webp', alt: 'Реальный пример фото на паспорт РФ', label: 'Паспорт РФ' },
  { src: '/assets/images/document-sample-zagranpassport.webp', alt: 'Реальный пример фото на загранпаспорт', label: 'Загранпаспорт' },
  { src: '/assets/images/document-sample-driving-license.webp', alt: 'Реальный пример фото на водительские права', label: 'Водительские права' },
] as const satisfies readonly BookingHeroPhotoSample[];

@Component({
  selector: 'app-simple-booking',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatDatepickerModule,
    MatProgressSpinnerModule,
    MatProgressBarModule,
    MatDividerModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!bookingSuccess()) {
      <div class="booking-page">

        <!-- ═══ HERO, только на шаге 1 ═══ -->
        @if (currentStep() === 1) {
          <section class="booking-hero">
            <div class="booking-shell booking-hero__inner">
              <div class="booking-hero__content">
                <p class="booking-kicker">Онлайн-запись</p>
                <h1>Запишитесь в студию без ожидания</h1>
                <p class="booking-hero__lead">
                  Выберите удобную студию, услугу, день и время. Мы подготовим слот заранее:
                  съёмка пройдёт быстро, а результат будет готов в срок.
                </p>

                <div class="booking-hero__actions">
                  <a
                    class="booking-primary-link"
                    [attr.href]="studioStepHref"
                    (click)="scrollToStudioStep($event)">
                    <mat-icon>event_available</mat-icon>
                    Выбрать студию
                  </a>
                  <a class="booking-secondary-link" [href]="studioPhoneHref">
                    <mat-icon>phone</mat-icon>
                    {{ studioPhone }}
                  </a>
                </div>

                <div class="booking-hero__metrics" aria-label="Преимущества онлайн-записи">
                  <div class="booking-metric">
                    <strong>5-15 мин</strong>
                    <span>съёмка в студии</span>
                  </div>
                  <div class="booking-metric">
                    <strong>Без очереди</strong>
                    <span>приоритет по записи</span>
                  </div>
                  <div class="booking-metric">
                    <strong>0 ₽</strong>
                    <span>предоплата не нужна</span>
                  </div>
                </div>
              </div>

              <div class="booking-hero__visual" aria-label="Реальные примеры фото на документы">
                <div class="booking-hero-samples">
                  @for (sample of bookingHeroPhotoSamples; track sample.src; let first = $first) {
                    <figure class="booking-hero-sample" [class.booking-hero-sample--primary]="first">
                      <img
                        [src]="sample.src"
                        [alt]="sample.alt"
                        loading="eager"
                        decoding="async">
                      <figcaption>{{ sample.label }}</figcaption>
                    </figure>
                  }
                </div>
                <div class="booking-hero-card booking-hero-card--time">
                  <mat-icon>schedule</mat-icon>
                  <div>
                    <span>Сегодня</span>
                    <strong>09:00-19:30</strong>
                  </div>
                </div>
                <div class="booking-hero-card booking-hero-card--route">
                  <mat-icon>verified</mat-icon>
                  <div>
                    <span>Подтверждение</span>
                    <strong>в пару кликов</strong>
                  </div>
                </div>
              </div>
            </div>
          </section>
        }

        <div class="booking-shell booking-flow-shell" [class.booking-flow-shell--compact]="currentStep() > 1">
          @if (currentStep() === 1) {
            <div class="booking-sheet-head">
              <p class="booking-kicker">Выберите студию</p>
              <h2>Где удобно сделать фото?</h2>
              <p>На карте отмечены ближайшие студии. После выбора откроются услуги, даты и свободные слоты.</p>
            </div>
          }

          @if (currentStep() > 1) {
            <div class="booking-step-intro">
              <p class="booking-kicker">Запись</p>
              <h2>Осталось несколько шагов</h2>
            </div>
          }

        <!-- ═══ Compact header, шаги 2-5 ═══ -->
        @if (currentStep() > 1) {
          <div class="header-compact">
            <span class="header-label">Онлайн-запись</span>
            <div class="progress-dots">
              @for (s of [1, 2, 3, 4, 5]; track s) {
                <span class="dot" [class.done]="s < currentStep()" [class.active]="s === currentStep()"></span>
              }
            </div>
          </div>
        }

        <!-- ═══ Сводка пройденных шагов ═══ -->
        @if (selectedStudio() && currentStep() > 1) {
          <div class="completed-chips">
            <div class="chip" (click)="editStep(1)" (keydown.enter)="editStep(1)" tabindex="0">
              <mat-icon>location_on</mat-icon>
              <span>{{ shortAddress(selectedStudio()!) }}</span>
              <mat-icon class="chip-edit">edit</mat-icon>
            </div>
            @if (selectedService() && currentStep() > 2) {
              <div class="chip" (click)="editStep(2)" (keydown.enter)="editStep(2)" tabindex="0">
                <mat-icon>{{ selectedServiceIcon() }}</mat-icon>
                <span>{{ selectedServiceLabel() }}</span>
                <mat-icon class="chip-edit">edit</mat-icon>
              </div>
            }
            @if (selectedDate() && currentStep() > 3) {
              <div class="chip" (click)="editStep(3)" (keydown.enter)="editStep(3)" tabindex="0">
                <mat-icon>event</mat-icon>
                <span>{{ formattedDate() }}</span>
                <mat-icon class="chip-edit">edit</mat-icon>
              </div>
            }
            @if (selectedTime() && currentStep() > 4) {
              <div class="chip" (click)="editStep(4)" (keydown.enter)="editStep(4)" tabindex="0">
                <mat-icon>schedule</mat-icon>
                <span>{{ selectedTime() }}</span>
                <mat-icon class="chip-edit">edit</mat-icon>
              </div>
            }
          </div>
        }

        <!-- ═══ Шаг 1: Студия ═══ -->
        @if (currentStep() === 1) {
          <section class="step studio-step" id="booking-step-studio">
            <div class="studios-layout">
              <div class="studios-grid">
                @for (studio of studios; track studio.id) {
                  <div class="studio-card"
                       [class.active]="selectedStudio()?.id === studio.id"
                       [class.selected]="selectedStudio()?.id === studio.id"
                       role="button"
                       [attr.aria-pressed]="selectedStudio()?.id === studio.id"
                       (click)="selectStudio(studio)"
                       (keydown.enter)="selectStudio(studio)"
                       (keydown.space)="$event.preventDefault(); selectStudio(studio)"
                       tabindex="0">
                    <div class="studio-header">
                      <div class="studio-icon-wrap">
                        <mat-icon>storefront</mat-icon>
                      </div>
                      <div class="studio-title">
                        <h3>{{ studio.name }}</h3>
                        @if (studio.landmark) {
                          <span class="studio-landmark">{{ studio.landmark }}</span>
                        }
                      </div>
                    </div>

                    <div class="studio-details">
                      <div class="studio-detail">
                        <mat-icon>location_on</mat-icon>
                        <span>{{ studio.address }}</span>
                      </div>
                      <div class="studio-detail">
                        <mat-icon>schedule</mat-icon>
                        <span>{{ studio.workHours }}</span>
                      </div>
                    </div>

                    <div class="studio-status-row">
                      @if (studioAlertService.getClosureForStudio(studio.id); as closure) {
                        <div class="studio-closure-notice">
                          <span>&#9888; {{ closure.reason || 'Не работает' }}@if (!closure.reason && closure.reopen_date) { до {{ formatReopenDate(closure.reopen_date) }}}</span>
                        </div>
                      } @else if (studioHasToday(studio.id)) {
                        <div class="studio-badge">
                          <mat-icon>event_available</mat-icon>
                          Есть на сегодня
                        </div>
                      } @else {
                        <div class="studio-badge">
                          <mat-icon>directions_walk</mat-icon>
                          Выберите удобное время
                        </div>
                      }
                    </div>

                    @if (studio.mapLinks) {
                      <div class="studio-nav">
                        @if (studio.mapLinks.yandex) {
                          <a class="studio-map-link"
                             [href]="studio.mapLinks.yandex"
                             target="_blank"
                             rel="noopener"
                             aria-label="Открыть маршрут в Яндекс Картах"
                             (click)="$event.stopPropagation()"
                             (keydown.enter)="$event.stopPropagation()"
                             (keydown.space)="$event.stopPropagation()">
                            <img src="/assets/static/services/yandex-maps-logo.svg"
                                 alt=""
                                 width="20"
                                 height="20"
                                 class="studio-map-logo">
                            <span>Яндекс</span>
                          </a>
                        }
                        @if (studio.mapLinks['2gis']) {
                          <a class="studio-map-link"
                             [href]="studio.mapLinks['2gis']"
                             target="_blank"
                             rel="noopener"
                             aria-label="Открыть маршрут в 2ГИС"
                             (click)="$event.stopPropagation()"
                             (keydown.enter)="$event.stopPropagation()"
                             (keydown.space)="$event.stopPropagation()">
                            <img src="/assets/static/services/2gis-logo.webp"
                                 alt=""
                                 width="20"
                                 height="20"
                                 class="studio-map-logo">
                            <span>2ГИС</span>
                          </a>
                        }
                        @if (studio.mapLinks.google) {
                          <a class="studio-map-link"
                             [href]="studio.mapLinks.google"
                             target="_blank"
                             rel="noopener"
                             aria-label="Открыть маршрут в Google Maps"
                             (click)="$event.stopPropagation()"
                             (keydown.enter)="$event.stopPropagation()"
                             (keydown.space)="$event.stopPropagation()">
                            <img src="/assets/static/services/google-maps-sign-logo.svg"
                                 alt=""
                                 width="20"
                                 height="20"
                                 class="studio-map-logo">
                            <span>Google</span>
                          </a>
                        }
                      </div>
                    }
                  </div>
                }
              </div>

              <div class="map-wrapper">
                <div class="map-frame">
                  <div class="map-container" id="booking-map">
                    @if (!mapReady()) {
                      <div class="map-placeholder">
                        <mat-spinner diameter="32" />
                      </div>
                    }
                  </div>
                </div>
              </div>
            </div>
          </section>
        }

        <!-- ═══ Шаг 2: Услуга ═══ -->
        @if (currentStep() === 2) {
          <section class="step">
            <button mat-button class="back-btn" (click)="editStep(1)">
              <mat-icon>arrow_back</mat-icon> Назад
            </button>
            <h2 class="step-title">Какая услуга?</h2>
            <div class="service-grid">
              @for (svc of serviceOptions; track svc.id) {
                <button class="service-chip"
                        [class.selected]="selectedService() === svc.id"
                        (click)="selectService(svc.id)">
                  <div class="service-icon-wrap">
                    <mat-icon>{{ svc.icon }}</mat-icon>
                  </div>
                  <span class="service-label">{{ svc.label }}</span>
                  <mat-icon class="service-arrow">chevron_right</mat-icon>
                </button>
              }
            </div>
            @if (isMarketplaceService()) {
              <div class="marketplace-hint">
                <mat-icon>schedule</mat-icon>
                <span>Маркетплейс-услуги: запись только вечером <strong>18:00-19:30</strong></span>
              </div>
            }
          </section>
        }

        <!-- ═══ Шаг 3: Дата ═══ -->
        @if (currentStep() === 3) {
          <section class="step">
            <button mat-button class="back-btn" (click)="editStep(2)">
              <mat-icon>arrow_back</mat-icon> Назад
            </button>
            <div class="step-header">
              <h2 class="step-title">Выберите дату</h2>
              <button mat-stroked-button class="quick-btn" (click)="findNearestSlot()" [disabled]="findingNearest()">
                @if (findingNearest()) {
                  <mat-spinner diameter="16" />
                } @else {
                  <mat-icon>bolt</mat-icon>
                }
                Ближайшее
              </button>
            </div>
            <div class="calendar-wrap">
              <mat-calendar [minDate]="minDate"
                [maxDate]="maxDate"
                [dateFilter]="dateFilter"
                [selected]="selectedDate()"
                (selectedChange)="onDateChange($event)" />
            </div>
          </section>
        }

        <!-- ═══ Шаг 4: Время ═══ -->
        @if (currentStep() === 4) {
          <section class="step">
            <button mat-button class="back-btn" (click)="editStep(3)">
              <mat-icon>arrow_back</mat-icon> Назад
            </button>
            <h2 class="step-title">Выберите время</h2>

            @if (loadingSlots()) {
              <div class="loading">
                <mat-spinner diameter="32" />
              </div>
            } @else if (groupedSlots().length === 0) {
              <div class="empty-slots">
                <mat-icon>event_busy</mat-icon>
                <p>Нет свободных слотов на эту дату</p>
                <button mat-stroked-button (click)="editStep(3)">Выбрать другой день</button>
              </div>
            } @else {
              @for (group of groupedSlots(); track group.label) {
                <div class="slot-group">
                  <div class="slot-group-header">
                    <mat-icon>{{ group.icon }}</mat-icon>
                    {{ group.label }}
                  </div>
                  <div class="slots-grid">
                    @for (slot of group.slots; track slot.time) {
                      <button class="slot-chip"
                              [class.selected]="selectedTime() === slot.time"
                              (click)="selectTime(slot.time)">
                        {{ slot.time }}
                      </button>
                    }
                  </div>
                </div>
              }
            }
          </section>
        }

        <!-- ═══ Шаг 5: Контакт + Подтверждение ═══ -->
        @if (currentStep() === 5) {
          <section class="step">
            <button mat-button class="back-btn" (click)="editStep(4)">
              <mat-icon>arrow_back</mat-icon> Назад
            </button>
            <h2 class="step-title">Подтверждение</h2>

            <div class="confirm-layout">
              <div class="confirm-left">
                <div class="final-summary">
                  <div class="summary-row">
                    <mat-icon>location_on</mat-icon>
                    <div>
                      <span class="summary-label">Студия</span>
                      <span class="summary-value">{{ shortAddress(selectedStudio()!) }}</span>
                    </div>
                  </div>
                  <div class="summary-row">
                    <mat-icon>{{ selectedServiceIcon() }}</mat-icon>
                    <div>
                      <span class="summary-label">Услуга</span>
                      <span class="summary-value">{{ selectedServiceLabel() }}</span>
                    </div>
                  </div>
                  <div class="summary-row">
                    <mat-icon>event</mat-icon>
                    <div>
                      <span class="summary-label">Дата и время</span>
                      <span class="summary-value">{{ formattedDate() }}, {{ selectedTime() }}</span>
                    </div>
                  </div>
                </div>

                <p class="submit-hint desktop-only">Бесплатно. Отменить или перенести, в один клик.</p>
              </div>

              <div class="confirm-right">
                @if (phoneVerificationPhase() === 'contact') {
                  <form [formGroup]="contactForm" class="contact-form">
                    <mat-form-field appearance="outline" class="full-width">
                      <mat-label>Ваше имя</mat-label>
                      <input matInput formControlName="name" autocomplete="name">
                      @if (contactForm.controls.name.touched && contactForm.controls.name.hasError('minlength')) {
                        <mat-hint class="hint-error">Минимум 2 символа</mat-hint>
                      }
                    </mat-form-field>

                    <mat-form-field appearance="outline" class="full-width">
                      <mat-label>Телефон</mat-label>
                      <input matInput
                             formControlName="phone"
                             type="tel"
                             inputmode="tel"
                             autocomplete="tel"
                             placeholder="+7 (___) ___-__-__"
                             (input)="onPhoneInput($event)">
                      @if (contactForm.controls.phone.touched && contactForm.controls.phone.invalid) {
                        <mat-hint class="hint-error">Введите номер полностью</mat-hint>
                      }
                    </mat-form-field>

                    @if (selectedService() === 'other') {
                      <mat-form-field appearance="outline" class="full-width">
                        <mat-label>Какая услуга?</mat-label>
                        <input matInput formControlName="comment" placeholder="Опишите, что вам нужно">
                      </mat-form-field>
                    }
                  </form>

                  <button mat-flat-button
                          color="primary"
                          class="submit-btn"
                          [disabled]="!canRequestPhoneCode()"
                          (click)="submitBooking()">
                    @if (requestingPhoneCode()) {
                      <mat-spinner diameter="20" />
                    } @else {
                      <ng-container>
                        <mat-icon>phone_in_talk</mat-icon>
                        Получить код звонком
                      </ng-container>
                    }
                  </button>
                } @else {
                  <div class="verification-panel">
                    <button mat-button class="verification-change-btn" (click)="changePhoneForVerification()">
                      <mat-icon>arrow_back</mat-icon>
                      Изменить номер
                    </button>

                    <div class="verification-call">
                      <span class="verification-call-icon">
                        <mat-icon>phone_in_talk</mat-icon>
                      </span>
                      <div>
                        <h3>Код из звонка</h3>
                        <p>{{ phoneVerificationPhone() }}</p>
                      </div>
                    </div>

                    <mat-form-field appearance="outline" class="full-width code-field">
                      <mat-label>Код</mat-label>
                      <input matInput
                             class="verification-code-input"
                             [value]="phoneVerificationCode()"
                             type="text"
                             inputmode="numeric"
                             autocomplete="one-time-code"
                             maxlength="4"
                             (input)="onVerificationCodeInput($event)">
                    </mat-form-field>

                    <div class="verification-meta">
                      @if (phoneCodeSecondsLeft() > 0) {
                        <span>Действует {{ formatCountdown(phoneCodeSecondsLeft()) }}</span>
                      } @else {
                        <span class="hint-error">Код истёк</span>
                      }
                    </div>

                    <button mat-flat-button
                            color="primary"
                            class="submit-btn"
                            [disabled]="!canVerifyBookingCode()"
                            (click)="submitBooking()">
                      @if (submitting()) {
                        <mat-spinner diameter="20" />
                      } @else {
                        <ng-container>
                          <mat-icon>event_available</mat-icon>
                          Подтвердить запись
                        </ng-container>
                      }
                    </button>

                    <button mat-stroked-button
                            class="resend-code-btn"
                            [disabled]="requestingPhoneCode() || phoneCodeResendSecondsLeft() > 0"
                            (click)="resendBookingPhoneCode()">
                      @if (requestingPhoneCode()) {
                        <mat-spinner diameter="18" />
                      } @else if (phoneCodeResendSecondsLeft() > 0) {
                        <ng-container>
                          <mat-icon>schedule</mat-icon>
                          Повторно через {{ phoneCodeResendSecondsLeft() }} сек
                        </ng-container>
                      } @else {
                        <ng-container>
                          <mat-icon>call</mat-icon>
                          Позвонить ещё раз
                        </ng-container>
                      }
                    </button>
                  </div>
                }

                <p class="submit-hint mobile-only">Бесплатно. Отменить или перенести, в один клик.</p>

                @if (submitError()) {
                  <p class="error-msg">{{ submitError() }}</p>
                }
              </div>
            </div>
          </section>
        }
        </div>
      </div>
    } @else {
      <!-- ═══ УСПЕХ ═══ -->
      <div class="booking-page booking-page--success">
        <div class="booking-shell success-shell">
          <div class="success-screen">
          <div class="success-icon-wrap">
            <mat-icon>check_circle</mat-icon>
          </div>
          <h2>Вы записаны!</h2>
          <p class="success-sub">Ждём вас точно в назначенное время, без очередей</p>

          <div class="success-details">
            <div class="detail-row">
              <mat-icon>location_on</mat-icon>
              <span>{{ selectedStudio()!.address }}</span>
            </div>
            <div class="detail-row">
              <mat-icon>event</mat-icon>
              <span>{{ formattedDate() }}, {{ selectedTime() }}</span>
            </div>
            <div class="detail-row">
              <mat-icon>{{ selectedServiceIcon() }}</mat-icon>
              <span>{{ selectedServiceLabel() }}</span>
            </div>
          </div>

          <div class="success-btns">
            <button mat-flat-button color="primary" (click)="addToCalendar()">
              <mat-icon>event_available</mat-icon>
              Добавить в календарь
            </button>

            @if (selectedStudio()?.coordinates) {
              <a mat-flat-button
                 class="navigate-btn"
                 [href]="getNavigationUrl()"
                 target="_blank">
                <mat-icon>navigation</mat-icon>
                Как добраться?
              </a>
            }
          </div>

          <mat-divider />

          <div class="success-footer">
            <p>Перенести или отменить, напишите нам:</p>
            <div class="messenger-row">
              <a mat-stroked-button
                 href="https://t.me/FmagnusBot"
                 target="_blank"
                 class="messenger-btn telegram">
                <mat-icon svgIcon="channel-telegram" />
                Telegram
              </a>
              <a mat-stroked-button
                 href="https://max.ru/id262603741214_bot"
                 target="_blank"
                 class="messenger-btn max">
                <mat-icon svgIcon="channel-max" />
                МАКС
              </a>
            </div>
            <a mat-button [href]="studioPhoneHref" class="phone-link">
              <mat-icon>phone</mat-icon>
              {{ studioPhone }}
            </a>
          </div>

          @if (suggestRegistration()) {
            <div class="suggest-lk">
              <h3>Сохраните историю ваших записей</h3>
              <p>Создайте личный кабинет, видите все ваши записи, накапливаете бонусы.</p>
              <div class="suggest-lk-btns">
                <a mat-flat-button color="primary" routerLink="/register">
                  <mat-icon>person_add</mat-icon>
                  Зарегистрироваться
                </a>
                <a mat-stroked-button routerLink="/login">
                  Уже есть аккаунт
                </a>
              </div>
            </div>
          }

          <div class="success-nav">
            <button mat-button routerLink="/">На главную</button>
            <button mat-stroked-button (click)="resetBooking()">Новая запись</button>
          </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    /* ── Host-level Material overrides ── */
    :host {
      --mdc-linear-progress-active-indicator-color: var(--ed-accent, #f59e0b);
      --mdc-linear-progress-track-color: var(--ed-surface-container-high, #222222);
      --mat-datepicker-calendar-container-background-color: var(--ed-surface-container, #1a1a1a);
      --mat-datepicker-calendar-container-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-datepicker-calendar-date-selected-state-background-color: var(--ed-accent, #f59e0b);
      --mat-datepicker-calendar-date-selected-state-text-color: var(--ed-on-accent, #0a0a0a);
      --mat-datepicker-calendar-date-today-outline-color: var(--ed-accent-dim, #d97706);
      --mat-datepicker-calendar-date-hover-state-background-color: var(--ed-surface-container-high, #222222);
      --mat-datepicker-calendar-header-text-color: var(--ed-on-surface-variant, #a0a0a0);
      --mat-datepicker-calendar-period-button-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-datepicker-calendar-navigation-button-icon-color: var(--ed-on-surface-variant, #a0a0a0);
      --mat-datepicker-calendar-date-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-datepicker-calendar-body-label-text-color: var(--ed-on-surface-variant, #a0a0a0);
      --mat-datepicker-calendar-date-disabled-state-text-color: var(--ed-on-surface-muted, #666666);
      --mdc-outlined-text-field-outline-color: var(--ed-outline, #3a3a3a);
      --mdc-outlined-text-field-hover-outline-color: var(--ed-on-surface-variant, #a0a0a0);
      --mdc-outlined-text-field-focus-outline-color: var(--ed-accent, #f59e0b);
      --mdc-outlined-text-field-label-text-color: var(--ed-on-surface-variant, #a0a0a0);
      --mdc-outlined-text-field-focus-label-text-color: var(--ed-accent, #f59e0b);
      --mdc-outlined-text-field-input-text-color: var(--ed-on-surface, #f5f5f5);
      --mdc-outlined-text-field-caret-color: var(--ed-accent, #f59e0b);
      --mat-form-field-outlined-outline-color: var(--ed-outline, #3a3a3a);
      --mat-form-field-outlined-hover-outline-color: var(--ed-on-surface-variant, #a0a0a0);
      --mat-form-field-outlined-focus-outline-color: var(--ed-accent, #f59e0b);
      --mat-form-field-outlined-label-text-color: var(--ed-on-surface-variant, #a0a0a0);
      --mat-form-field-outlined-hover-label-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-form-field-outlined-focus-label-text-color: var(--ed-accent, #f59e0b);
      --mat-form-field-outlined-input-text-color: var(--ed-on-surface, #f5f5f5);
      --mat-form-field-outlined-input-text-placeholder-color: var(--ed-on-surface-muted, #666666);
      --mat-form-field-outlined-caret-color: var(--ed-accent, #f59e0b);
      --mat-form-field-disabled-input-text-placeholder-color: var(--ed-on-surface-muted, #666666);
      --mat-form-field-container-text-color: var(--ed-on-surface, #f5f5f5);
      --mdc-circular-progress-active-indicator-color: var(--ed-accent, #f59e0b);
    }

    /* ═══ Page container ═══ */
    .booking-page {
      max-width: 520px;
      margin: 0 auto;
      padding: 16px;
      padding-bottom: 48px;
    }

    /* ═══ HERO, editorial headline ═══ */
    .hero {
      text-align: center;
      padding: 32px 0 24px;
      animation: heroReveal 0.7s var(--ed-ease-out) both;
    }

    @keyframes heroReveal {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .hero-eyebrow {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--ed-accent, #f59e0b);
      margin-bottom: 20px;
    }

    .eyebrow-line {
      display: block;
      width: 32px;
      height: 1px;
      background: var(--ed-accent-dim, #d97706);
    }

    .hero-title {
      font-family: var(--ed-font-display);
      font-size: 2rem;
      font-weight: 700;
      line-height: 1.15;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0 0 16px;
    }

    .hero-accent {
      color: var(--ed-accent, #f59e0b);
    }

    .hero-desc {
      font-size: 0.95rem;
      line-height: 1.6;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 auto 28px;
      max-width: 400px;
    }

    /* Value strip, 3 cards */
    .value-strip {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      text-align: left;
      margin-bottom: 24px;
    }

    .value-card {
      display: grid;
      grid-template-columns: auto 1fr;
      grid-template-rows: auto auto;
      column-gap: 12px;
      padding: 14px 16px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: var(--ed-border-radius-lg);
      transition: border-color 0.3s ease;

      &:hover { border-color: rgba(245, 158, 11, 0.2); }

      .value-num {
        grid-row: 1 / 3;
        align-self: center;
        font-family: var(--ed-font-display);
        font-size: 1.5rem;
        font-weight: 700;
        color: var(--ed-accent-dim, #d97706);
        opacity: 0.5;
        line-height: 1;
      }

      strong {
        font-size: 0.9rem;
        font-weight: 600;
        color: var(--ed-on-surface, #f5f5f5);
        line-height: 1.3;
      }

      span:last-child {
        font-size: 0.8rem;
        color: var(--ed-on-surface-variant, #a0a0a0);
        line-height: 1.4;
      }
    }

    /* Guarantee strip */
    .guarantee-strip {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .guarantee-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--ed-on-surface-variant, #a0a0a0);

      mat-icon {
        font-size: 15px;
        width: 15px;
        height: 15px;
        color: var(--ed-success, #22c55e);
      }
    }

    .guarantee-dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--ed-on-surface-muted, #666666);
    }

    /* Section divider */
    .section-divider {
      display: flex;
      align-items: center;
      gap: 16px;
      margin: 28px 0 20px;

      &::before, &::after {
        content: '';
        flex: 1;
        height: 1px;
        background: linear-gradient(90deg, transparent, var(--ed-outline, #3a3a3a), transparent);
      }
    }

    .divider-label {
      font-family: var(--ed-font-display);
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      color: var(--ed-on-surface-variant, #a0a0a0);
      white-space: nowrap;
    }

    /* ═══ Compact header (steps 2-5) ═══ */
    .header-compact {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 0 16px;
    }

    .header-label {
      font-family: var(--ed-font-display);
      font-size: 1rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .progress-dots {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--ed-surface-container-high, #222222);
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      transition: all 0.3s ease;

      &.done {
        background: var(--ed-accent, #f59e0b);
        border-color: var(--ed-accent, #f59e0b);
        width: 8px;
        height: 8px;
      }

      &.active {
        background: transparent;
        border-color: var(--ed-accent, #f59e0b);
        width: 10px;
        height: 10px;
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.3);
      }
    }

    /* ═══ Completed chips ═══ */
    .completed-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 16px;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 10px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 20px;
      font-size: 0.8rem;
      color: var(--ed-on-surface, #f5f5f5);
      cursor: pointer;
      transition: all 0.2s ease;

      &:hover {
        border-color: rgba(245, 158, 11, 0.3);
        background: var(--ed-surface-container-high, #222222);
      }

      &:active { transform: scale(0.97); }

      mat-icon {
        font-size: 15px;
        width: 15px;
        height: 15px;
        color: var(--ed-accent, #f59e0b);
      }

      .chip-edit {
        font-size: 13px;
        width: 13px;
        height: 13px;
        color: var(--ed-on-surface-muted, #666666);
        margin-left: 2px;
        opacity: 0;
        transition: opacity 0.15s ease;
      }

      &:hover .chip-edit { opacity: 1; }
    }

    /* ═══ Back button ═══ */
    .back-btn {
      font-size: 0.85rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      padding: 0 8px;
      margin: 0 0 4px -8px;
      height: 36px;

      mat-icon { font-size: 18px; width: 18px; height: 18px; }
    }

    /* ═══ Steps ═══ */
    .step {
      margin-bottom: 24px;
      animation: stepIn 0.35s var(--ed-ease-out) both;
    }

    @keyframes stepIn {
      from { opacity: 0; transform: translateY(12px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .step-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
      flex-wrap: wrap;

      .step-title { margin: 0; }
    }

    .step-title {
      font-family: var(--ed-font-display);
      font-size: 1.3rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--ed-on-surface, #f5f5f5);
      margin: 0 0 16px;
    }

    .quick-btn {
      font-size: 0.8rem;
      height: 36px;
      border-radius: 18px !important;
      white-space: nowrap;
      border-color: var(--ed-outline, #3a3a3a) !important;
      color: var(--ed-on-surface, #f5f5f5) !important;

      mat-icon { font-size: 18px; width: 18px; height: 18px; color: var(--ed-accent, #f59e0b); }
      mat-spinner { display: inline-block; }
    }

    /* ═══ Studio layout (desktop: 2-col) ═══ */
    .studio-layout { display: block; }
    .confirm-layout { display: block; }

    /* ═══ Map ═══ */
    .map-container {
      width: 100%;
      height: 240px;
      border-radius: var(--ed-border-radius-lg);
      overflow: hidden;
      border: 1px solid var(--ed-outline, #3a3a3a);
      margin-bottom: 12px;
      position: relative;
    }

    .map-placeholder {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--ed-surface-container, #1a1a1a);
      z-index: 1;
    }

    /* ═══ Studio list ═══ */
    .studio-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .studio-option {
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      border-radius: var(--ed-border-radius-lg);
      padding: 14px 16px;
      cursor: pointer;
      transition: all 0.25s ease;
      background: var(--ed-surface-container, #1a1a1a);

      &:hover {
        border-color: rgba(255, 255, 255, 0.12);
        background: var(--ed-surface-container-high, #222222);
      }

      &:active { transform: scale(0.98); }

      &.selected {
        border-color: var(--ed-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.06);
        box-shadow: 0 0 0 1px var(--ed-accent, #f59e0b), 0 4px 16px rgba(245, 158, 11, 0.1);
      }
    }

    .studio-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .studio-left { flex: 1; min-width: 0; }

    .studio-name-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 2px;
    }

    .studio-name {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .today-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.68rem;
      font-weight: 600;
      color: var(--ed-success, #22c55e);
      background: rgba(34, 197, 94, 0.1);
      border: 1px solid rgba(34, 197, 94, 0.2);
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .closed-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.68rem;
      font-weight: 600;
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.1);
      border: 1px solid rgba(251, 191, 36, 0.2);
      padding: 2px 8px;
      border-radius: 10px;
      white-space: nowrap;
    }

    .today-pulse {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ed-success, #22c55e);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.8); }
    }

    .studio-addr {
      font-size: 0.8rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
    }

    .studio-hours {
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 0.75rem;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-top: 4px;

      mat-icon { font-size: 14px; width: 14px; height: 14px; }
    }

    .studio-arrow {
      flex-shrink: 0;
      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--ed-on-surface-muted, #666666);
        transition: color 0.2s ease;
      }

      &.studio-check mat-icon {
        color: var(--ed-accent, #f59e0b);
      }
    }

    /* ═══ Service chips ═══ */
    .service-grid {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .service-chip {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 16px;
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      border-radius: var(--ed-border-radius-lg);
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.95rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.25s ease;
      text-align: left;

      &:hover {
        border-color: rgba(255, 255, 255, 0.12);
        background: var(--ed-surface-container-high, #222222);
      }

      &:active { transform: scale(0.98); }

      &.selected {
        border-color: var(--ed-accent, #f59e0b);
        background: rgba(245, 158, 11, 0.06);
        box-shadow: 0 0 0 1px var(--ed-accent, #f59e0b);

        .service-icon-wrap { background: var(--ed-accent, #f59e0b); }
        .service-icon-wrap mat-icon { color: var(--ed-on-accent, #0a0a0a); }
      }
    }

    .service-icon-wrap {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: rgba(245, 158, 11, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: background 0.25s ease;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--ed-accent, #f59e0b);
        transition: color 0.25s ease;
      }
    }

    .service-label { flex: 1; }

    .service-arrow {
      font-size: 20px !important;
      width: 20px !important;
      height: 20px !important;
      color: var(--ed-on-surface-muted, #666666);
    }

    /* ═══ Calendar ═══ */
    .calendar-wrap {
      border: 1px solid var(--ed-outline, #3a3a3a);
      border-radius: var(--ed-border-radius-lg);
      overflow: hidden;
      background: var(--ed-surface-container, #1a1a1a);
    }

    /* ═══ Loading / Empty ═══ */
    .loading { display: flex; justify-content: center; padding: 32px; }

    .empty-slots {
      text-align: center;
      padding: 28px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: var(--ed-border-radius-lg);

      mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--ed-on-surface-muted, #666666); }
      p { color: var(--ed-on-surface-variant, #a0a0a0); margin: 8px 0 16px; font-size: 0.9rem; }
    }

    /* ═══ Time slots ═══ */
    .slot-group { margin-bottom: 20px; &:last-child { margin-bottom: 0; } }

    .slot-group-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin-bottom: 10px;

      mat-icon { font-size: 16px; width: 16px; height: 16px; color: var(--ed-accent-dim, #d97706); }
    }

    .slots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
      gap: 8px;
    }

    .slot-chip {
      padding: 10px 4px;
      border: 1.5px solid var(--ed-outline, #3a3a3a);
      border-radius: 12px;
      background: var(--ed-surface-container, #1a1a1a);
      color: var(--ed-on-surface, #f5f5f5);
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s ease;
      text-align: center;

      &:hover {
        border-color: var(--ed-on-surface-variant, #a0a0a0);
        background: var(--ed-surface-container-high, #222222);
      }

      &:active { transform: scale(0.95); }

      &.selected {
        background: var(--ed-accent, #f59e0b);
        color: var(--ed-on-accent, #0a0a0a);
        border-color: var(--ed-accent, #f59e0b);
        box-shadow: 0 2px 12px rgba(245, 158, 11, 0.3);
      }
    }

    /* ═══ Step 5: Summary & Form ═══ */
    .final-summary {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: var(--ed-border-radius-lg);
      margin-bottom: 20px;
    }

    .summary-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
        color: var(--ed-accent, #f59e0b);
        margin-top: 2px;
        flex-shrink: 0;
      }

      div { display: flex; flex-direction: column; }

      .summary-label {
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--ed-on-surface-variant, #a0a0a0);
      }

      .summary-value {
        font-size: 0.9rem;
        color: var(--ed-on-surface, #f5f5f5);
        font-weight: 500;
      }
    }

    .contact-form { display: flex; flex-direction: column; }
    .full-width { width: 100%; }

    .hint-error { color: var(--ed-error, #ef4444) !important; }

    .verification-panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .verification-change-btn {
      align-self: flex-start;
      height: 32px;
      padding: 0 4px !important;
      color: var(--ed-accent, #f59e0b) !important;
      font-size: 0.82rem;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .verification-call {
      display: flex;
      gap: 12px;
      align-items: center;
      min-height: 56px;

      h3 {
        margin: 0 0 2px;
        font-family: var(--ed-font-display);
        font-size: 1.05rem;
        font-weight: 700;
        text-transform: uppercase;
        color: var(--ed-on-surface, #f5f5f5);
      }

      p {
        margin: 0;
        color: var(--ed-on-surface-variant, #a0a0a0);
        font-size: 0.9rem;
      }
    }

    .verification-call-icon {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: rgba(245, 158, 11, 0.12);
      color: var(--ed-accent, #f59e0b);

      mat-icon {
        font-size: 24px;
        width: 24px;
        height: 24px;
      }
    }

    .code-field { margin-top: 2px; }

    .verification-code-input {
      text-align: center;
      font-size: 1.25rem !important;
      font-weight: 700 !important;
      font-variant-numeric: tabular-nums;
    }

    .verification-meta {
      min-height: 20px;
      text-align: center;
      color: var(--ed-on-surface-muted, #666666);
      font-size: 0.78rem;
      margin-top: -6px;
    }

    .resend-code-btn {
      width: 100%;
      height: 44px;
      border-radius: 22px !important;
      color: var(--ed-on-surface-variant, #a0a0a0) !important;
      border-color: var(--ed-outline, #3a3a3a) !important;

      mat-icon {
        font-size: 18px;
        width: 18px;
        height: 18px;
      }
    }

    .submit-btn {
      width: 100%;
      height: 52px;
      font-size: 1rem;
      font-weight: 600;
      border-radius: 26px !important;
      margin-top: 4px;
      background: var(--ed-accent, #f59e0b) !important;
      color: var(--ed-on-accent, #0a0a0a) !important;
      box-shadow: 0 4px 20px rgba(245, 158, 11, 0.2);
      transition: all 0.25s ease;
      gap: 8px;

      &:hover {
        background: var(--ed-accent-hover, #fbbf24) !important;
        box-shadow: 0 6px 32px rgba(245, 158, 11, 0.3);
        transform: translateY(-1px);
      }

      &:active { transform: translateY(0); }

      &:disabled {
        background: var(--ed-surface-container-high, #222222) !important;
        color: var(--ed-on-surface-muted, #666666) !important;
        box-shadow: none;
        transform: none;
      }

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .submit-hint {
      text-align: center;
      font-size: 0.78rem;
      color: var(--ed-on-surface-muted, #666666);
      margin: 10px 0 0;
    }

    .error-msg {
      color: var(--ed-error, #ef4444);
      text-align: center;
      font-size: 0.875rem;
      margin: 12px 0 0;
    }

    /* ═══ Success screen ═══ */
    .success-screen {
      text-align: center;
      padding-top: 24px;
      animation: stepIn 0.4s var(--ed-ease-out) both;
    }

    .success-icon-wrap {
      width: 72px;
      height: 72px;
      margin: 0 auto 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(34, 197, 94, 0.1);
      border: 2px solid rgba(34, 197, 94, 0.25);
      animation: successPop 0.5s 0.2s var(--ed-ease-out) both;

      mat-icon { font-size: 40px; width: 40px; height: 40px; color: var(--ed-success, #22c55e); }
    }

    @keyframes successPop {
      from { opacity: 0; transform: scale(0.7); }
      to { opacity: 1; transform: scale(1); }
    }

    .success-screen h2 {
      margin: 0 0 4px;
      font-family: var(--ed-font-display);
      font-size: 1.5rem;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--ed-on-surface, #f5f5f5);
    }

    .success-sub {
      color: var(--ed-on-surface-variant, #a0a0a0);
      margin: 0 0 24px;
      font-size: 0.9rem;
    }

    .success-details {
      display: flex;
      flex-direction: column;
      gap: 8px;
      text-align: left;
      padding: 16px;
      background: var(--ed-surface-container, #1a1a1a);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: var(--ed-border-radius-lg);
      margin-bottom: 20px;
    }

    .detail-row {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.9rem;
      color: var(--ed-on-surface, #f5f5f5);

      mat-icon { font-size: 20px; width: 20px; height: 20px; color: var(--ed-accent, #f59e0b); }
    }

    .success-btns {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-bottom: 20px;

      button, a { width: 100%; }
    }

    .navigate-btn {
      background: var(--ed-accent, #f59e0b) !important;
      color: var(--ed-on-accent, #0a0a0a) !important;
    }

    .success-footer {
      padding: 16px 0;
      text-align: center;

      p { color: var(--ed-on-surface-variant, #a0a0a0); margin: 0 0 12px; font-size: 0.85rem; }
    }

    .messenger-row { display: flex; gap: 8px; justify-content: center; margin-bottom: 8px; }
    .messenger-btn { flex: 1; max-width: 160px; font-size: 0.85rem; }
    .messenger-btn.telegram { color: #0088cc !important; border-color: #0088cc !important; }
    .messenger-btn.max { color: #f77d05 !important; border-color: #f77d05 !important; }
    .phone-link { font-size: 0.85rem; color: var(--ed-on-surface-variant, #a0a0a0); }
    .success-nav { display: flex; justify-content: center; gap: 8px; padding-top: 8px; }

    .suggest-lk {
      margin: 20px 0 16px;
      padding: 20px;
      border-radius: 12px;
      background: rgba(var(--ed-primary-rgb, 59, 130, 246), 0.08);
      border: 1px solid rgba(var(--ed-primary-rgb, 59, 130, 246), 0.2);
      text-align: center;

      h3 {
        margin: 0 0 6px;
        font-size: 1rem;
        font-weight: 600;
        color: var(--ed-on-surface, #f5f5f5);
      }

      p {
        margin: 0 0 14px;
        font-size: 0.85rem;
        color: var(--ed-on-surface-muted, #999);
      }
    }

    .suggest-lk-btns {
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .marketplace-hint {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 14px;
      padding: 10px 14px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.25);
      font-size: 0.83rem;
      color: #d97706;

      mat-icon { font-size: 18px; width: 18px; height: 18px; flex-shrink: 0; }
      strong { color: #92400e; }
    }

    /* ═══ Visibility helpers ═══ */
    .desktop-only { display: none; }
    .mobile-only { display: block; }

    /* ═══ Responsive: tablet 600px+ ═══ */
    @media (min-width: 600px) {
      .booking-page { padding: 24px; max-width: 640px; }

      .hero { padding: 40px 0 28px; }
      .hero-title { font-size: 2.4rem; }
      .hero-desc { font-size: 1rem; max-width: 460px; }

      .value-strip {
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
      }

      .value-card {
        grid-template-columns: 1fr;
        text-align: center;
        padding: 16px 12px;

        .value-num { grid-row: auto; margin-bottom: 4px; }
      }

      .map-container { height: 300px; }

      .service-grid {
        flex-direction: row;
        flex-wrap: wrap;
      }

      .service-chip { flex: 1; min-width: 160px; }
    }

    /* ═══ Responsive: desktop 840px+ ═══ */
    @media (min-width: 840px) {
      .booking-page {
        max-width: 800px;
        padding: 32px;
        padding-bottom: 60px;
      }

      .hero { padding: 48px 0 32px; }
      .hero-title { font-size: 2.8rem; }
      .hero-desc { font-size: 1.05rem; max-width: 520px; }

      .eyebrow-line { width: 48px; }

      .value-strip { gap: 16px; }
      .value-card { padding: 20px 16px; }

      .guarantee-strip { gap: 16px; }
      .guarantee-item { font-size: 0.85rem; }

      .section-divider { margin: 36px 0 24px; }

      /* Studio: map + list side by side */
      .studio-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
        align-items: start;
      }

      .map-container {
        height: 100%;
        min-height: 280px;
        margin-bottom: 0;
      }

      .studio-list { gap: 10px; }

      /* Calendar wider */
      .calendar-wrap { max-width: 400px; }

      /* Slots grid wider */
      .slots-grid {
        grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
      }

      /* Step 5: two columns */
      .confirm-layout {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        align-items: start;
      }

      .final-summary { margin-bottom: 12px; }

      .desktop-only { display: block; }
      .mobile-only { display: none; }

      .submit-btn { max-width: 100%; }

      /* Success wider */
      .success-screen { max-width: 600px; margin: 0 auto; }

      .success-btns {
        flex-direction: row;
        button, a { flex: 1; }
      }
    }

    /* ═══ Responsive: wide desktop 1080px+ ═══ */
    @media (min-width: 1080px) {
      .booking-page {
        max-width: 960px;
        padding: 40px;
      }

      .hero { padding: 56px 0 36px; }
      .hero-title { font-size: 3.2rem; letter-spacing: 0.03em; }
      .hero-desc { font-size: 1.1rem; max-width: 560px; line-height: 1.7; }

      .value-card {
        padding: 24px 20px;

        strong { font-size: 0.95rem; }
        span:last-child { font-size: 0.85rem; }
      }

      .studio-layout {
        grid-template-columns: 1.2fr 1fr;
        gap: 20px;
      }

      .map-container { min-height: 320px; border-radius: 20px; }

      .step-title { font-size: 1.5rem; }

      .confirm-layout {
        grid-template-columns: 1fr 1.1fr;
        gap: 32px;
      }

      .success-screen { max-width: 700px; }
    }

    /* ═══ Alfa-like booking redesign overrides ═══ */
    :host {
      --booking-red: #ef3124;
      --booking-red-dark: #d82318;
      --booking-black: #07070a;
      --booking-ink: #151517;
      --booking-muted: #646971;
      --booking-soft: #f2f3f5;
      --booking-soft-strong: #e8eaee;
      --booking-line: #dfe2e8;
      --booking-success: #08a652;
      --booking-radius-xl: 40px;
      --booking-radius-lg: 28px;
      --booking-radius-md: 16px;
      --booking-radius-sm: 8px;
      --booking-shadow: 0 22px 70px rgba(15, 17, 21, 0.12);
      --mat-datepicker-calendar-container-background-color: #ffffff;
      --mat-datepicker-calendar-container-text-color: var(--booking-ink);
      --mat-datepicker-calendar-date-selected-state-background-color: var(--booking-red);
      --mat-datepicker-calendar-date-selected-state-text-color: #ffffff;
      --mat-datepicker-calendar-date-today-outline-color: var(--booking-red);
      --mat-datepicker-calendar-date-hover-state-background-color: #f4f5f7;
      --mat-datepicker-calendar-header-text-color: var(--booking-muted);
      --mat-datepicker-calendar-period-button-text-color: var(--booking-ink);
      --mat-datepicker-calendar-navigation-button-icon-color: var(--booking-ink);
      --mat-datepicker-calendar-date-text-color: var(--booking-ink);
      --mat-datepicker-calendar-body-label-text-color: var(--booking-muted);
      --mat-datepicker-calendar-date-disabled-state-text-color: #b6bbc4;
      --mdc-outlined-text-field-outline-color: var(--booking-line);
      --mdc-outlined-text-field-hover-outline-color: #aeb4bf;
      --mdc-outlined-text-field-focus-outline-color: var(--booking-red);
      --mdc-outlined-text-field-label-text-color: var(--booking-muted);
      --mdc-outlined-text-field-focus-label-text-color: var(--booking-red);
      --mdc-outlined-text-field-input-text-color: var(--booking-ink);
      --mdc-outlined-text-field-caret-color: var(--booking-red);
      --mat-form-field-outlined-outline-color: var(--booking-line);
      --mat-form-field-outlined-hover-outline-color: #aeb4bf;
      --mat-form-field-outlined-focus-outline-color: var(--booking-red);
      --mat-form-field-outlined-label-text-color: var(--booking-muted);
      --mat-form-field-outlined-hover-label-text-color: var(--booking-ink);
      --mat-form-field-outlined-focus-label-text-color: var(--booking-red);
      --mat-form-field-outlined-input-text-color: var(--booking-ink);
      --mat-form-field-outlined-input-text-placeholder-color: var(--booking-muted);
      --mat-form-field-outlined-caret-color: var(--booking-red);
      --mat-form-field-disabled-input-text-placeholder-color: #9aa1ad;
      --mat-form-field-container-text-color: var(--booking-ink);
      --mdc-circular-progress-active-indicator-color: var(--booking-red);
    }

    .booking-page {
      width: 100%;
      max-width: none;
      margin: 0;
      padding: 0 0 72px;
      overflow-x: clip;
      background: var(--booking-soft);
      color: var(--booking-ink);
    }

    .booking-page * {
      box-sizing: border-box;
    }

    .booking-shell {
      width: min(calc(100% - 48px), 1120px);
      margin: 0 auto;
    }

    .booking-hero {
      position: relative;
      overflow: hidden;
      min-height: 620px;
      padding: 72px 0 128px;
      background: var(--booking-black);
      color: #ffffff;
      isolation: isolate;
    }

    .booking-hero::after {
      content: '';
      position: absolute;
      inset: auto 0 0;
      height: 96px;
      background: var(--booking-soft);
      z-index: -1;
    }

    .booking-hero__inner {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 430px;
      gap: 72px;
      align-items: center;
    }

    .booking-hero__content {
      max-width: 610px;
    }

    .booking-kicker {
      margin: 0;
      color: var(--booking-red);
      font-size: 0.86rem;
      font-weight: 800;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .booking-hero h1 {
      margin: 18px 0 22px;
      color: #ffffff;
      font-size: 4.3rem;
      font-weight: 900;
      line-height: 0.96;
      letter-spacing: 0;
      text-transform: none;
      text-wrap: balance;
    }

    .booking-hero__lead {
      max-width: 560px;
      margin: 0;
      color: rgba(255, 255, 255, 0.72);
      font-size: 1.12rem;
      line-height: 1.65;
    }

    .booking-hero__actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-top: 34px;
    }

    .booking-primary-link,
    .booking-secondary-link {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      min-height: 52px;
      padding: 0 24px;
      border-radius: 12px;
      font-size: 0.98rem;
      font-weight: 800;
      line-height: 1;
      letter-spacing: 0;
      text-decoration: none;
      transition: transform 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }

    .booking-primary-link {
      background: var(--booking-red);
      color: #ffffff;
      box-shadow: 0 12px 28px rgba(239, 49, 36, 0.26);
    }

    .booking-secondary-link {
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: #2d2f36;
      color: #ffffff;
    }

    .booking-primary-link:hover,
    .booking-secondary-link:hover {
      transform: translateY(-1px);
    }

    .booking-primary-link mat-icon,
    .booking-secondary-link mat-icon {
      width: 20px;
      height: 20px;
      font-size: 20px;
    }

    .booking-hero__metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 10px;
      max-width: 610px;
      margin-top: 38px;
    }

    .booking-metric {
      min-height: 92px;
      padding: 18px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: var(--booking-radius-sm);
      background: rgba(255, 255, 255, 0.06);
    }

    .booking-metric strong {
      display: block;
      color: #ffffff;
      font-size: 1.15rem;
      font-weight: 900;
      line-height: 1.1;
      letter-spacing: 0;
    }

    .booking-metric span {
      display: block;
      margin-top: 8px;
      color: rgba(255, 255, 255, 0.62);
      font-size: 0.9rem;
      line-height: 1.35;
    }

    .booking-hero__visual {
      position: relative;
      min-height: 500px;
      padding: 34px;
      border-radius: 36px;
      overflow: hidden;
      background: linear-gradient(145deg, #f7f7f8 0%, #e7e9ed 100%);
      box-shadow: 0 30px 90px rgba(0, 0, 0, 0.36);
    }

    .booking-hero__visual::before {
      content: '';
      position: absolute;
      inset: 18px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 26px;
      pointer-events: none;
      z-index: 2;
    }

    .booking-hero-samples {
      position: relative;
      z-index: 1;
      display: grid;
      grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.92fr);
      gap: 14px;
      height: 100%;
      min-height: 432px;
      align-items: stretch;
    }

    .booking-hero-sample {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
      margin: 0;
      padding: 10px;
      border-radius: 18px;
      background: #ffffff;
      box-shadow: 0 14px 34px rgba(15, 16, 19, 0.12);
    }

    .booking-hero-sample--primary {
      grid-row: span 2;
      align-self: stretch;
    }

    .booking-hero-sample img {
      display: block;
      width: 100%;
      aspect-ratio: 3 / 2;
      border-radius: 12px;
      object-fit: cover;
      object-position: center;
      background: #ffffff;
    }

    .booking-hero-sample--primary img {
      min-height: 314px;
      flex: 1 1 auto;
    }

    .booking-hero-sample figcaption {
      color: var(--booking-ink);
      font-size: 0.86rem;
      font-weight: 900;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .booking-hero-card {
      position: absolute;
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 190px;
      padding: 14px 16px;
      border: 1px solid rgba(255, 255, 255, 0.16);
      border-radius: var(--booking-radius-sm);
      background: rgba(15, 16, 19, 0.9);
      color: #ffffff;
      box-shadow: 0 16px 44px rgba(0, 0, 0, 0.3);
      backdrop-filter: blur(10px);
    }

    .booking-hero-card mat-icon {
      width: 24px;
      height: 24px;
      font-size: 24px;
      color: var(--booking-red);
    }

    .booking-hero-card span,
    .booking-hero-card strong {
      display: block;
      letter-spacing: 0;
    }

    .booking-hero-card span {
      color: rgba(255, 255, 255, 0.62);
      font-size: 0.78rem;
      line-height: 1.2;
    }

    .booking-hero-card strong {
      margin-top: 4px;
      color: #ffffff;
      font-size: 0.95rem;
      font-weight: 900;
      line-height: 1.15;
    }

    .booking-hero-card--time {
      top: 34px;
      left: 28px;
    }

    .booking-hero-card--route {
      right: 28px;
      bottom: 34px;
    }

    .booking-flow-shell {
      position: relative;
      z-index: 3;
      margin-top: -72px;
      padding: 44px;
      border-radius: var(--booking-radius-xl) var(--booking-radius-xl) 0 0;
      background: #ffffff;
      box-shadow: var(--booking-shadow);
    }

    .booking-flow-shell--compact {
      margin-top: 28px;
      border-radius: var(--booking-radius-xl);
    }

    .booking-sheet-head,
    .booking-step-intro {
      display: grid;
      gap: 10px;
      max-width: 640px;
      margin-bottom: 28px;
    }

    .booking-sheet-head h2,
    .booking-step-intro h2 {
      margin: 0;
      color: var(--booking-ink);
      font-size: 2.75rem;
      font-weight: 900;
      line-height: 1.02;
      letter-spacing: 0;
      text-wrap: balance;
    }

    .booking-sheet-head p:last-child {
      margin: 0;
      color: var(--booking-muted);
      font-size: 1rem;
      line-height: 1.55;
    }

    .header-compact {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      width: 100%;
      padding: 12px 14px;
      margin: 0 0 18px;
      border: 1px solid var(--booking-line);
      border-radius: 14px;
      background: var(--booking-soft);
    }

    .header-label {
      color: var(--booking-ink);
      font-size: 0.9rem;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: none;
    }

    .progress-dots {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .dot {
      width: 46px;
      height: 6px;
      border-radius: 999px;
      background: #cfd3dc;
      border: 0;
    }

    .dot.done,
    .dot.active {
      width: 46px;
      height: 6px;
      border-radius: 999px;
      background: var(--booking-red);
      box-shadow: none;
    }

    .completed-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 18px;
    }

    .chip {
      min-height: 42px;
      padding: 8px 12px;
      border: 1px solid var(--booking-line);
      border-radius: 999px;
      background: #ffffff;
      color: var(--booking-ink);
      box-shadow: none;
    }

    .chip mat-icon {
      color: var(--booking-red);
    }

    .chip .chip-edit {
      color: #9aa1ad;
    }

    .step {
      padding: 28px;
      border: 1px solid var(--booking-line);
      border-radius: var(--booking-radius-lg);
      background: var(--booking-soft);
      color: var(--booking-ink);
      box-shadow: none;
      animation: none;
    }

    .step + .step {
      margin-top: 20px;
    }

    .step-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 20px;
    }

    .step-title {
      margin: 0 0 22px;
      color: var(--booking-ink);
      font-size: 2rem;
      font-weight: 900;
      line-height: 1.08;
      letter-spacing: 0;
      text-transform: none;
    }

    .step-header .step-title {
      margin-bottom: 0;
    }

    .back-btn,
    .quick-btn {
      color: var(--booking-ink) !important;
      font-weight: 800;
      letter-spacing: 0;
    }

    .back-btn mat-icon,
    .quick-btn mat-icon {
      color: var(--booking-red);
    }

    .studio-step {
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
    }

    .studios-layout {
      display: grid;
      gap: 22px;
      align-items: start;
    }

    @media (min-width: 980px) {
      .studios-layout {
        grid-template-columns: minmax(0, 0.95fr) minmax(380px, 1.05fr);
        gap: 28px;
      }
    }

    .studios-grid {
      display: grid;
      gap: 14px;
    }

    .studio-card {
      display: grid;
      gap: 18px;
      padding: 20px;
      border: 1px solid var(--booking-line);
      border-radius: 32px;
      background: #ffffff;
      color: var(--booking-ink);
      box-shadow: 0 18px 48px rgba(13, 15, 20, 0.08);
      cursor: pointer;
      transition:
        border-color 180ms ease,
        box-shadow 180ms ease,
        transform 180ms ease;
    }

    .studio-card.active,
    .studio-card.selected {
      border-color: var(--booking-red);
      background: #ffffff;
      box-shadow:
        0 0 0 1px var(--booking-red),
        0 22px 64px rgba(13, 15, 20, 0.14);
    }

    .studio-card:hover {
      transform: translateY(-1px);
      box-shadow: 0 22px 64px rgba(13, 15, 20, 0.14);
    }

    .studio-card:focus-visible {
      outline: 3px solid color-mix(in srgb, var(--booking-red) 28%, transparent);
      outline-offset: 3px;
    }

    .studio-header {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }

    .studio-icon-wrap {
      display: inline-flex;
      width: 48px;
      height: 48px;
      align-items: center;
      justify-content: center;
      border-radius: 18px;
      background: var(--booking-red);
      color: #ffffff;
    }

    .studio-icon-wrap mat-icon {
      width: 24px;
      height: 24px;
      font-size: 24px;
    }

    .studio-title {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .studio-title h3 {
      margin: 0;
      color: var(--booking-ink);
      font-size: 20px;
      font-weight: 950;
      line-height: 1.08;
      letter-spacing: 0;
    }

    .studio-landmark {
      color: var(--booking-muted);
      font-size: 14px;
      font-weight: 700;
      line-height: 1.3;
    }

    .studio-details {
      display: grid;
      gap: 10px;
    }

    .studio-detail {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      gap: 9px;
      align-items: start;
    }

    .studio-detail mat-icon {
      width: 22px;
      height: 22px;
      color: var(--booking-red);
      font-size: 21px;
      line-height: 22px;
    }

    .studio-detail span {
      color: #22252d;
      font-size: 15px;
      font-weight: 750;
      line-height: 1.35;
    }

    .studio-status-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }

    .studio-badge,
    .studio-closure-notice {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 7px 11px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 900;
      line-height: 1.2;
    }

    .studio-badge {
      background: rgba(239, 49, 36, 0.1);
      color: var(--booking-red-dark);
    }

    .studio-badge mat-icon {
      width: 17px;
      height: 17px;
      color: var(--booking-red);
      font-size: 17px;
    }

    .studio-closure-notice {
      border: 1px solid rgba(239, 49, 36, 0.2);
      background: rgba(239, 49, 36, 0.08);
      color: var(--booking-red-dark);
    }

    .studio-nav {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .studio-map-link {
      display: inline-flex;
      min-width: 0;
      min-height: 42px;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid var(--booking-line);
      border-radius: 999px;
      background: #f7f8fa;
      color: var(--booking-ink);
      font-size: 13px;
      font-weight: 900;
      line-height: 1.2;
      text-decoration: none;
      transition:
        border-color 180ms ease,
        background 180ms ease,
        color 180ms ease;
    }

    .studio-map-link:hover {
      border-color: var(--booking-red);
      background: rgba(239, 49, 36, 0.1);
      color: var(--booking-red-dark);
    }

    .studio-map-logo {
      display: block;
      width: 20px;
      height: 20px;
      flex: 0 0 auto;
      object-fit: contain;
    }

    .map-wrapper {
      min-width: 0;
    }

    @media (min-width: 980px) {
      .map-wrapper {
        position: sticky;
        top: 88px;
      }
    }

    .map-frame {
      position: relative;
      min-height: 360px;
      overflow: hidden;
      border: 1px solid var(--booking-line);
      border-radius: 32px;
      background: #ffffff;
      box-shadow: 0 18px 48px rgba(13, 15, 20, 0.08);
    }

    @media (min-width: 980px) {
      .map-frame {
        min-height: 560px;
      }
    }

    .map-frame .map-container {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      min-height: 0;
      margin: 0;
      border: 0;
      border-radius: 0;
      overflow: hidden;
      background: #ffffff;
      box-shadow: none;
    }

    .map-frame .map-placeholder {
      position: absolute;
      inset: 0;
      z-index: 1;
      display: grid;
      place-items: center;
      min-height: 0;
      background: #ffffff;
    }

    .service-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .service-chip {
      min-height: 96px;
      padding: 18px;
      border: 1px solid var(--booking-line);
      border-radius: var(--booking-radius-sm);
      background: #ffffff;
      color: var(--booking-ink);
      box-shadow: none;
    }

    .service-chip:hover {
      border-color: #b9bec8;
      transform: translateY(-1px);
    }

    .service-chip.selected {
      border-color: var(--booking-red);
      background: #fff4f2;
      box-shadow: 0 0 0 3px rgba(239, 49, 36, 0.1);
    }

    .service-icon-wrap {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border-radius: var(--booking-radius-sm);
      background: var(--booking-soft);
      color: var(--booking-red);
    }

    .service-chip.selected .service-icon-wrap {
      background: var(--booking-red);
      color: #ffffff;
    }

    .service-label {
      color: var(--booking-ink);
      font-size: 1rem;
      font-weight: 900;
      line-height: 1.2;
      letter-spacing: 0;
    }

    .service-arrow {
      color: #9ca3af;
    }

    .service-chip.selected .service-arrow {
      color: var(--booking-red);
    }

    .marketplace-hint {
      margin-top: 14px;
      padding: 14px 16px;
      border: 1px solid #ffd4cf;
      border-radius: var(--booking-radius-sm);
      background: #fff4f2;
      color: #4b2320;
    }

    .marketplace-hint mat-icon {
      color: var(--booking-red);
    }

    .calendar-wrap {
      max-width: 520px;
      margin: 0;
      padding: 18px;
      border: 1px solid var(--booking-line);
      border-radius: var(--booking-radius-sm);
      background: #ffffff;
      color: var(--booking-ink);
      box-shadow: none;
    }

    .loading {
      display: grid;
      place-items: center;
      min-height: 220px;
      color: var(--booking-red);
    }

    .slot-group {
      margin-top: 18px;
    }

    .slot-group:first-of-type {
      margin-top: 0;
    }

    .slot-group-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
      color: var(--booking-muted);
      font-size: 0.92rem;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: none;
    }

    .slot-group-header mat-icon {
      color: var(--booking-red);
    }

    .slots-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
      gap: 10px;
    }

    .slot-chip {
      min-height: 50px;
      border: 1px solid var(--booking-line);
      border-radius: var(--booking-radius-sm);
      background: #ffffff;
      color: var(--booking-ink);
      font-weight: 900;
      letter-spacing: 0;
      box-shadow: none;
    }

    .slot-chip:hover {
      border-color: #b9bec8;
      transform: translateY(-1px);
    }

    .slot-chip.selected {
      border-color: var(--booking-red);
      background: var(--booking-red);
      color: #ffffff;
      box-shadow: 0 10px 22px rgba(239, 49, 36, 0.2);
    }

    .empty-slots,
    .final-summary,
    .verification-panel {
      border: 1px solid var(--booking-line);
      border-radius: var(--booking-radius-sm);
      background: #ffffff;
      color: var(--booking-ink);
      box-shadow: none;
    }

    .empty-slots {
      padding: 34px 20px;
    }

    .empty-slots mat-icon {
      color: var(--booking-red);
    }

    .confirm-layout {
      display: grid;
      grid-template-columns: minmax(0, 0.92fr) minmax(360px, 1.08fr);
      gap: 22px;
      align-items: start;
    }

    .final-summary {
      margin: 0;
      padding: 18px;
    }

    .summary-row {
      border-bottom: 1px solid var(--booking-line);
      color: var(--booking-ink);
    }

    .summary-row:last-child {
      border-bottom: 0;
    }

    .summary-row mat-icon {
      color: var(--booking-red);
    }

    .summary-label {
      color: var(--booking-muted);
      font-size: 0.78rem;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: none;
    }

    .summary-value {
      color: var(--booking-ink);
      font-size: 0.98rem;
      font-weight: 900;
      line-height: 1.3;
      letter-spacing: 0;
    }

    .contact-form {
      display: grid;
      gap: 12px;
      padding: 18px;
      border: 1px solid var(--booking-line);
      border-radius: var(--booking-radius-sm);
      background: #ffffff;
    }

    .full-width {
      width: 100%;
    }

    .hint-error,
    .error-msg {
      color: var(--booking-red-dark);
    }

    .verification-panel {
      padding: 18px;
    }

    .verification-change-btn {
      color: var(--booking-ink) !important;
      font-weight: 800;
      letter-spacing: 0;
    }

    .verification-call {
      padding: 16px;
      border-radius: var(--booking-radius-sm);
      background: var(--booking-soft);
      color: var(--booking-ink);
    }

    .verification-call-icon {
      background: var(--booking-red);
      color: #ffffff;
    }

    .verification-call h3 {
      color: var(--booking-ink);
      letter-spacing: 0;
    }

    .verification-call p,
    .verification-meta,
    .submit-hint {
      color: var(--booking-muted);
    }

    .verification-code-input {
      color: var(--booking-ink);
      font-weight: 900;
      letter-spacing: 0;
    }

    .submit-btn,
    .resend-code-btn,
    .success-btns button,
    .success-btns a,
    .suggest-lk-btns a {
      min-height: 52px;
      border-radius: 12px !important;
      font-weight: 900 !important;
      letter-spacing: 0 !important;
      text-transform: none;
    }

    .submit-btn.mat-mdc-unelevated-button,
    .success-btns .mat-mdc-unelevated-button,
    .suggest-lk-btns .mat-mdc-unelevated-button {
      --mdc-filled-button-container-color: var(--booking-red);
      --mdc-filled-button-label-text-color: #ffffff;
      background: var(--booking-red) !important;
      color: #ffffff !important;
      box-shadow: 0 12px 26px rgba(239, 49, 36, 0.2);
    }

    .submit-btn.mat-mdc-unelevated-button:disabled {
      background: #cfd3dc !important;
      color: #ffffff !important;
      box-shadow: none;
    }

    .resend-code-btn,
    .suggest-lk-btns .mat-mdc-outlined-button {
      border-color: var(--booking-line) !important;
      color: var(--booking-ink) !important;
      background: #ffffff !important;
    }

    .error-msg {
      padding: 12px 14px;
      border-radius: var(--booking-radius-sm);
      background: #fff0ee;
      font-weight: 800;
    }

    .booking-page--success {
      display: grid;
      place-items: start center;
      min-height: calc(100vh - 84px);
      padding-top: 48px;
      background: var(--booking-black);
    }

    .success-shell {
      max-width: 760px;
    }

    .success-screen {
      max-width: none;
      margin: 0;
      padding: 38px;
      border: 0;
      border-radius: var(--booking-radius-lg);
      background: #ffffff;
      color: var(--booking-ink);
      box-shadow: 0 30px 100px rgba(0, 0, 0, 0.3);
    }

    .success-icon-wrap {
      background: #e6f7ed;
      color: var(--booking-success);
    }

    .success-screen h2 {
      color: var(--booking-ink);
      font-size: 2.5rem;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: none;
    }

    .success-sub,
    .success-footer,
    .suggest-lk p {
      color: var(--booking-muted);
    }

    .success-details,
    .suggest-lk {
      border: 1px solid var(--booking-line);
      border-radius: var(--booking-radius-sm);
      background: var(--booking-soft);
    }

    .detail-row {
      color: var(--booking-ink);
    }

    .detail-row mat-icon {
      color: var(--booking-red);
    }

    .navigate-btn {
      --mdc-filled-button-container-color: var(--booking-black);
      background: var(--booking-black) !important;
      color: #ffffff !important;
    }

    .messenger-btn,
    .phone-link,
    .success-nav button {
      color: var(--booking-ink) !important;
      letter-spacing: 0 !important;
    }

    .suggest-lk h3 {
      color: var(--booking-ink);
      letter-spacing: 0;
    }

    .desktop-only {
      display: block;
    }

    .mobile-only {
      display: none;
    }

    @media (max-width: 1020px) {
      .booking-hero {
        min-height: auto;
        padding: 56px 0 112px;
      }

      .booking-hero__inner {
        grid-template-columns: 1fr;
        gap: 40px;
      }

      .booking-hero h1 {
        max-width: 760px;
        font-size: 3.25rem;
      }

      .booking-hero__visual {
        min-height: 360px;
      }

      .booking-hero-samples {
        min-height: 300px;
      }

      .booking-flow-shell {
        padding: 34px;
      }

      .studio-layout,
      .confirm-layout {
        grid-template-columns: 1fr;
      }

      .studio-list {
        max-height: none;
        padding-right: 0;
      }
    }

    @media (max-width: 720px) {
      .booking-shell {
        width: min(calc(100% - 28px), 1120px);
      }

      .booking-hero {
        padding: 42px 0 92px;
      }

      .booking-hero h1 {
        font-size: 2.55rem;
        line-height: 1;
      }

      .booking-hero__lead {
        font-size: 1rem;
      }

      .booking-hero__actions,
      .booking-hero__metrics {
        grid-template-columns: 1fr;
      }

      .booking-hero__actions {
        display: grid;
      }

      .booking-primary-link,
      .booking-secondary-link {
        width: 100%;
      }

      .booking-hero__metrics {
        display: grid;
      }

      .booking-hero__visual {
        min-height: 320px;
        padding: 18px;
        border-radius: 26px;
      }

      .booking-hero-samples {
        grid-template-columns: 1fr;
        min-height: 0;
      }

      .booking-hero-sample--primary {
        grid-row: auto;
      }

      .booking-hero-sample--primary img {
        min-height: 0;
      }

      .booking-hero-card {
        min-width: 0;
        max-width: calc(100% - 36px);
        padding: 12px;
      }

      .booking-hero-card--time {
        top: 18px;
        left: 18px;
      }

      .booking-hero-card--route {
        right: 18px;
        bottom: 18px;
      }

      .booking-hero-card {
        position: static;
        margin-top: 12px;
      }

      .booking-flow-shell {
        margin-top: -56px;
        padding: 24px 16px 20px;
        border-radius: 30px 30px 0 0;
      }

      .booking-flow-shell--compact {
        margin-top: 16px;
        border-radius: 24px;
      }

      .booking-sheet-head h2,
      .booking-step-intro h2 {
        font-size: 2rem;
      }

      .header-compact {
        align-items: flex-start;
        flex-direction: column;
      }

      .progress-dots {
        width: 100%;
      }

      .dot,
      .dot.done,
      .dot.active {
        flex: 1 1 0;
        width: auto;
      }

      .step {
        padding: 18px;
        border-radius: 20px;
      }

      .step-header {
        align-items: stretch;
        flex-direction: column;
      }

      .step-title {
        font-size: 1.65rem;
      }

      .map-container,
      .map-placeholder {
        min-height: 330px;
      }

      .service-grid {
        grid-template-columns: 1fr;
      }

      .calendar-wrap {
        padding: 10px;
      }

      .slots-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .desktop-only {
        display: none;
      }

      .mobile-only {
        display: block;
      }

      .success-screen {
        padding: 24px 18px;
      }

      .success-screen h2 {
        font-size: 2rem;
      }

      .booking-hero-sample:nth-child(n + 3) {
        display: none;
      }
    }

  `,
})
export class SimpleBookingComponent implements AfterViewInit, OnDestroy {
  private fb = inject(FormBuilder);
  private bookingService = inject(Bitrix24BookingService);
  private seoService = inject(SeoService);
  private referralTracking = inject(ReferralTrackingService);
  private platformId = inject(PLATFORM_ID);
  private elRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private ngZone = inject(NgZone);
  protected studioAlertService = inject(StudioAlertService);

  constructor() {
    this.seoService.setAllMetaData(
      'Онлайн-запись, без очереди, точно в своё время | Своё Фото',
      'Запишитесь онлайн и получите приоритет в очереди. Съёмка 5-15 минут, результат за 30 минут. Индивидуальный подход, ручная обработка. Бесплатно, без предоплаты.',
      undefined,
      '/booking',
      'онлайн запись, фотостудия, запись к фотографу, Ростов-на-Дону, фото на документы, портретная съёмка, без очереди'
    );
  }

  readonly studios = ADDRESSES;
  readonly studioPhone = STUDIO_PHONE;
  readonly studioPhoneHref = STUDIO_PHONE_HREF;
  protected readonly bookingHeroPhotoSamples = BOOKING_HERO_PHOTO_SAMPLES;
  protected readonly studioStepFragment = 'booking-step-studio';
  protected readonly studioStepHref = `/booking#${this.studioStepFragment}`;
  readonly serviceOptions = SERVICES;
  readonly minDate = new Date();
  readonly maxDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  readonly selectedStudio = signal<StudioAddress | null>(null);
  readonly selectedService = signal<string | null>(null);
  readonly selectedDate = signal<Date | null>(null);
  readonly selectedTime = signal<string | null>(null);
  readonly loadingSlots = signal(false);
  readonly availableSlots = signal<BookingTimeSlot[]>([]);
  readonly submitting = signal(false);
  readonly requestingPhoneCode = signal(false);
  readonly phoneVerificationPhase = signal<BookingPhoneVerificationPhase>('contact');
  readonly phoneVerificationCode = signal('');
  readonly phoneVerificationPhone = signal<string | null>(null);
  readonly phoneCodeSecondsLeft = signal(0);
  readonly phoneCodeResendSecondsLeft = signal(0);
  readonly submitError = signal<string | null>(null);
  readonly bookingSuccess = signal(false);
  readonly suggestRegistration = signal(false);
  readonly mapReady = signal(false);
  readonly findingNearest = signal(false);
  readonly todayAvailability = signal<ReadonlyMap<string, boolean>>(new Map<string, boolean>());

  readonly selectedStudioClosure = computed(() => {
    const studio = this.selectedStudio();
    if (!studio) return null;
    return this.studioAlertService.getClosureForStudio(studio.id);
  });

  private mapInstance: YMapObject | null = null;
  private placemarks = new Map<string, YPlacemarkObject>();
  private phoneCodeTimer: ReturnType<typeof setInterval> | null = null;
  private phoneCodeExpiresAt = 0;
  private phoneCodeResendAt = 0;
  private phoneCodeRequestSeq = 0;
  private destroyed = false;

  readonly contactForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
    phone: ['', [Validators.required, Validators.pattern(/^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/)]],
    comment: [''],
  });

  private readonly formValid = toSignal(
    this.contactForm.statusChanges.pipe(
      startWith(this.contactForm.status),
      map(status => status === 'VALID')
    ),
    { initialValue: false }
  );

  readonly currentStep = computed(() => {
    if (this.selectedTime()) return 5;
    if (this.selectedDate()) return 4;
    if (this.selectedService()) return 3;
    if (this.selectedStudio()) return 2;
    return 1;
  });

  readonly progressValue = computed(() => {
    return (this.currentStep() / 5) * 100;
  });

  readonly canSubmit = computed(() =>
    this.selectedStudio() !== null &&
    this.selectedService() !== null &&
    this.selectedDate() !== null &&
    this.selectedTime() !== null &&
    this.formValid()
  );

  readonly canRequestPhoneCode = computed(() =>
    this.canSubmit() &&
    !this.requestingPhoneCode() &&
    !this.submitting()
  );

  readonly canVerifyBookingCode = computed(() =>
    this.canSubmit() &&
    this.phoneVerificationCode().length === BOOKING_PHONE_CODE_LENGTH &&
    this.phoneCodeSecondsLeft() > 0 &&
    !this.requestingPhoneCode() &&
    !this.submitting()
  );

  readonly formattedDate = computed(() => {
    const date = this.selectedDate();
    if (!date) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateMidnight = new Date(date);
    dateMidnight.setHours(0, 0, 0, 0);

    const datePart = new Intl.DateTimeFormat('ru-RU', {
      day: 'numeric',
      month: 'long',
    }).format(date);

    if (dateMidnight.getTime() === today.getTime()) return `Сегодня, ${datePart}`;
    if (dateMidnight.getTime() === tomorrow.getTime()) return `Завтра, ${datePart}`;

    return new Intl.DateTimeFormat('ru-RU', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
    }).format(date);
  });

  readonly groupedSlots = computed((): SlotGroup[] => {
    const slots = this.availableSlots();
    if (!slots.length) return [];

    const morning: BookingTimeSlot[] = [];
    const afternoon: BookingTimeSlot[] = [];
    const evening: BookingTimeSlot[] = [];

    for (const slot of slots) {
      const hour = parseInt(slot.time.split(':')[0], 10);
      if (hour < 12) morning.push(slot);
      else if (hour < 16) afternoon.push(slot);
      else evening.push(slot);
    }

    const groups: SlotGroup[] = [];
    if (morning.length) groups.push({ label: 'Утро', icon: 'wb_sunny', slots: morning });
    if (afternoon.length) groups.push({ label: 'День', icon: 'light_mode', slots: afternoon });
    if (evening.length) groups.push({ label: 'Вечер', icon: 'nights_stay', slots: evening });
    return groups;
  });

  readonly dateFilter = (d: Date | null): boolean => {
    if (!d) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (d < today) return false;
    const studio = this.selectedStudio();
    // Блокируем даты, когда студия закрыта
    if (studio && this.studioAlertService.isStudioClosedOnDate(studio.id, d)) {
      return false;
    }
    // Блокируем сегодня, если нет свободных слотов для выбранной студии
    if (d.getTime() === today.getTime()) {
      if (studio) {
        return this.todayAvailability().get(studio.id) ?? true;
      }
    }
    return true;
  };

  selectedServiceLabel(): string {
    const svc = this.serviceOptions.find(s => s.id === this.selectedService());
    return svc?.label ?? '';
  }

  selectedServiceIcon(): string {
    const svc = this.serviceOptions.find(s => s.id === this.selectedService());
    return svc?.icon ?? 'photo_camera';
  }

  isMarketplaceService(): boolean {
    const svc = this.selectedService();
    return !!svc && MARKETPLACE_SERVICE_IDS.has(svc);
  }

  ngAfterViewInit(): void {
    if (isPlatformBrowser(this.platformId)) {
      this.loadYandexMaps();
      this.restoreContactData();
      this.checkTodayAvailability();
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.mapInstance) {
      try {
        this.mapInstance.destroy();
      } catch { /* ignore */ }
    }
    this.stopPhoneCodeTimer();
  }

  shortAddress(studio: StudioAddress): string {
    return studio.address.replace(/^г\.\s*Ростов-на-Дону,\s*/i, '');
  }

  shortHours(studio: StudioAddress): string {
    const match = studio.workHours.match(/(\d{2}:\d{2}\s*-\s*\d{2}:\d{2})/);
    if (match) {
      const hasWeekends = studio.workHours.toLowerCase().includes('воскресенье');
      return hasWeekends ? `${match[1]}, без выходных` : match[1];
    }
    return studio.workHours;
  }

  studioHasToday(studioId: string): boolean {
    return this.todayAvailability().get(studioId) ?? false;
  }

  protected scrollToStudioStep(event: Event): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const studioStep = this.elRef.nativeElement.querySelector<HTMLElement>(`#${this.studioStepFragment}`);
    if (!studioStep) return;

    event.preventDefault();
    studioStep.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  selectStudio(studio: StudioAddress): void {
    this.selectedStudio.set(studio);
    this.highlightMarker(studio.id);
    // Если уже была выбрана дата, перезагрузим слоты
    if (this.selectedDate()) {
      this.loadSlots();
    }
    this.scrollToTop();
  }

  selectService(serviceId: string): void {
    this.selectedService.set(serviceId);
    this.scrollToTop();
  }

  onDateChange(date: Date | null): void {
    if (!date) return;
    this.selectedDate.set(date);
    this.selectedTime.set(null);
    this.loadSlots();
    this.scrollToTop();
  }

  selectTime(time: string): void {
    this.selectedTime.set(time);
    this.scrollToTop();
    // Автофокус на поле "Имя" на шаге 5
    setTimeout(() => this.focusNameInput(), 350);
  }

  editStep(step: number): void {
    // Сбрасываем выбор начиная с этого шага
    if (step <= 1) {
      this.selectedStudio.set(null);
      this.selectedService.set(null);
      this.selectedDate.set(null);
      this.selectedTime.set(null);
      this.availableSlots.set([]);
    } else if (step <= 2) {
      this.selectedService.set(null);
      this.selectedDate.set(null);
      this.selectedTime.set(null);
      this.availableSlots.set([]);
    } else if (step <= 3) {
      this.selectedDate.set(null);
      this.selectedTime.set(null);
      this.availableSlots.set([]);
    } else if (step <= 4) {
      this.selectedTime.set(null);
    }
    if (step <= 4) {
      this.resetPhoneVerification();
    }
    this.scrollToTop();
  }

  findNearestSlot(): void {
    const studio = this.selectedStudio();
    if (!studio) return;

    this.findingNearest.set(true);
    const today = new Date();
    this.tryDateForNearest(today, studio, 0);
  }

  onPhoneInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    let digits = input.value.replace(/\D/g, '');

    if (digits.startsWith('8') || digits.startsWith('7')) {
      digits = digits.substring(1);
    }
    digits = digits.substring(0, 10);

    let formatted = '+7';
    if (digits.length > 0) formatted += ` (${digits.substring(0, 3)}`;
    if (digits.length >= 3) formatted += `)`;
    if (digits.length > 3) formatted += ` ${digits.substring(3, 6)}`;
    if (digits.length > 6) formatted += `-${digits.substring(6, 8)}`;
    if (digits.length > 8) formatted += `-${digits.substring(8, 10)}`;

    this.contactForm.controls.phone.setValue(formatted);
    input.value = formatted;
    if (this.phoneVerificationPhase() === 'code') {
      this.resetPhoneVerification();
    }
  }

  onVerificationCodeInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    const input = event.target;
    const code = input.value.replace(/\D/g, '').slice(0, BOOKING_PHONE_CODE_LENGTH);
    if (input.value !== code) {
      input.value = code;
    }
    this.phoneVerificationCode.set(code);
    this.submitError.set(null);
  }

  submitBooking(): void {
    if (this.phoneVerificationPhase() === 'contact') {
      this.requestBookingPhoneCode();
      return;
    }

    this.createBookingWithPhoneCode();
  }

  changePhoneForVerification(): void {
    this.resetPhoneVerification();
    this.submitError.set(null);
    setTimeout(() => this.focusNameInput(), 0);
  }

  resendBookingPhoneCode(): void {
    if (this.requestingPhoneCode() || this.phoneCodeResendSecondsLeft() > 0) return;
    this.requestBookingPhoneCode();
  }

  formatCountdown(seconds: number): string {
    const safeSeconds = Math.max(0, seconds);
    const minutes = Math.floor(safeSeconds / 60);
    const rest = String(safeSeconds % 60).padStart(2, '0');
    return `${minutes}:${rest}`;
  }

  private requestBookingPhoneCode(): void {
    if (!this.canSubmit()) {
      this.contactForm.markAllAsTouched();
      return;
    }

    if (!this.ensureCurrentBookingIsBookable()) return;

    this.requestingPhoneCode.set(true);
    this.submitError.set(null);
    this.phoneVerificationCode.set('');
    this.saveContactData();

    const phone = this.contactForm.controls.phone.value;
    const requestSeq = ++this.phoneCodeRequestSeq;

    this.bookingService.requestPhoneCode(phone).subscribe({
      next: (result) => {
        if (requestSeq !== this.phoneCodeRequestSeq) return;
        this.requestingPhoneCode.set(false);
        if (!result.success) {
          this.submitError.set(result.error || 'Не удалось запустить звонок с кодом');
          return;
        }

        this.phoneVerificationPhase.set('code');
        this.phoneVerificationPhone.set(phone);
        this.startPhoneCodeTimer(result.expiresIn ?? 120);
        this.scrollToTop();
      },
      error: () => {
        if (requestSeq !== this.phoneCodeRequestSeq) return;
        this.requestingPhoneCode.set(false);
        this.submitError.set('Не удалось запустить звонок с кодом. Попробуйте позже.');
      },
    });
  }

  private createBookingWithPhoneCode(): void {
    if (!this.canVerifyBookingCode()) return;

    if (!this.ensureCurrentBookingIsBookable()) return;

    const studio = this.selectedStudio()!;
    const date = this.selectedDate()!;
    this.submitting.set(true);
    this.submitError.set(null);

    const time = this.selectedTime()!;

    this.saveContactData();

    const clientName = this.contactForm.value.name!;
    const clientPhone = this.contactForm.value.phone!;
    const comment = this.contactForm.value.comment || '';
    const serviceLabel = this.selectedServiceLabel();
    const serviceName = comment ? `${serviceLabel} (${comment})` : serviceLabel;

    const partnerPromoCode = this.referralTracking.getPartnerCode() || undefined;
    const svc = this.selectedService();
    const serviceCategorySlug = svc && MARKETPLACE_SERVICE_IDS.has(svc) ? svc : undefined;

    this.bookingService.createBooking({
      studio: studio.id,
      date: this.formatDateISO(date),
      time,
      clientName,
      clientPhone,
      serviceName,
      serviceCategorySlug,
      partnerPromoCode,
      phoneCode: this.phoneVerificationCode(),
    }).subscribe({
      next: (result) => {
        this.submitting.set(false);
        if (result.success) {
          // Clear partner referral code after successful booking
          this.referralTracking.clear();
          this.resetPhoneVerification();
          this.bookingSuccess.set(true);
          this.suggestRegistration.set(result.suggestRegistration ?? false);
          this.scrollToTop();
        } else {
          this.submitError.set(result.error || 'Ошибка при создании записи');
        }
      },
      error: () => {
        this.submitting.set(false);
        this.submitError.set('Не удалось создать запись. Попробуйте позже.');
      },
    });
  }

  private ensureCurrentBookingIsBookable(): boolean {
    const studio = this.selectedStudio();
    const date = this.selectedDate();
    if (!studio || !date || !this.selectedTime()) return false;

    if (this.studioAlertService.isStudioClosedOnDate(studio.id, date)) {
      this.submitError.set('В выбранную дату перерыв. Выберите другой день или запишитесь на Соборный 21!');
      return false;
    }

    return true;
  }

  private startPhoneCodeTimer(expiresInSeconds: number): void {
    this.stopPhoneCodeTimer();

    const safeExpiresInSeconds = Math.max(1, expiresInSeconds);
    const now = Date.now();
    this.phoneCodeExpiresAt = now + safeExpiresInSeconds * 1000;
    this.phoneCodeResendAt = now + Math.min(BOOKING_PHONE_CODE_RESEND_DELAY_SECONDS, safeExpiresInSeconds) * 1000;
    this.updatePhoneCodeTimerState();

    if (!isPlatformBrowser(this.platformId)) return;

    this.ngZone.runOutsideAngular(() => {
      this.phoneCodeTimer = setInterval(() => {
        this.ngZone.run(() => this.updatePhoneCodeTimerState());
      }, 1000);
    });
  }

  private updatePhoneCodeTimerState(): void {
    const now = Date.now();
    const secondsLeft = Math.max(0, Math.ceil((this.phoneCodeExpiresAt - now) / 1000));
    const resendSecondsLeft = Math.max(0, Math.ceil((this.phoneCodeResendAt - now) / 1000));

    this.phoneCodeSecondsLeft.set(secondsLeft);
    this.phoneCodeResendSecondsLeft.set(resendSecondsLeft);

    if (secondsLeft === 0 && resendSecondsLeft === 0) {
      this.stopPhoneCodeTimer();
    }
  }

  private stopPhoneCodeTimer(): void {
    if (!this.phoneCodeTimer) return;
    clearInterval(this.phoneCodeTimer);
    this.phoneCodeTimer = null;
  }

  private resetPhoneVerification(): void {
    this.phoneCodeRequestSeq += 1;
    this.stopPhoneCodeTimer();
    this.phoneVerificationPhase.set('contact');
    this.phoneVerificationCode.set('');
    this.phoneVerificationPhone.set(null);
    this.phoneCodeSecondsLeft.set(0);
    this.phoneCodeResendSecondsLeft.set(0);
    this.phoneCodeExpiresAt = 0;
    this.phoneCodeResendAt = 0;
    this.requestingPhoneCode.set(false);
  }

  addToCalendar(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    const studio = this.selectedStudio()!;
    const date = this.selectedDate()!;
    const time = this.selectedTime()!;
    const [hours, minutes] = time.split(':').map(Number);

    const start = new Date(date);
    start.setHours(hours, minutes, 0, 0);
    const slot = this.availableSlots().find(s => s.time === time);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + (slot?.duration ?? 30));

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SvoeFoto//Booking//RU',
      'BEGIN:VEVENT',
      `DTSTART:${this.toICSDate(start)}`,
      `DTEND:${this.toICSDate(end)}`,
      `SUMMARY:${this.selectedServiceLabel()}, ${studio.name}`,
      `LOCATION:${studio.address}`,
      `DESCRIPTION:Запись в фотостудию "Своё Фото"\\nТелефон: ${STUDIO_PHONE}`,
      'STATUS:CONFIRMED',
      `UID:booking-${Date.now()}@svoefoto.ru`,
      'BEGIN:VALARM',
      'TRIGGER:-PT1H',
      'ACTION:DISPLAY',
      'DESCRIPTION:Напоминание: запись в фотостудию через 1 час',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'booking.ics';
    a.click();
    URL.revokeObjectURL(url);
  }

  getNavigationUrl(): string {
    const studio = this.selectedStudio();
    if (!studio) return '#';
    // Ссылка на Яндекс Карты, открывает точку студии
    if (studio.mapLinks?.yandex) return studio.mapLinks.yandex;
    if (!studio.coordinates) return '#';
    return `https://yandex.ru/maps/?pt=${studio.coordinates.lng},${studio.coordinates.lat}&z=17`;
  }

  resetBooking(): void {
    this.selectedStudio.set(null);
    this.selectedService.set(null);
    this.selectedDate.set(null);
    this.selectedTime.set(null);
    this.bookingSuccess.set(false);
    this.submitError.set(null);
    this.resetPhoneVerification();
    this.contactForm.reset();
    this.restoreContactData();
    this.scrollToTop();
  }

  // --- localStorage ---

  private saveContactData(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const data = {
        name: this.contactForm.value.name || '',
        phone: this.contactForm.value.phone || '',
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch { /* ignore */ }
  }

  private restoreContactData(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data: unknown = JSON.parse(raw);
      if (!isStoredContactData(data)) return;
      if (data.name) this.contactForm.controls.name.setValue(data.name);
      if (data.phone) this.contactForm.controls.phone.setValue(data.phone);
    } catch { /* ignore */ }
  }

  // --- Today availability ---

  private checkTodayAvailability(): void {
    const todayStr = this.formatDateISO(new Date());
    for (const studio of this.studios) {
      this.bookingService.getSlots(todayStr, undefined, studio.id).subscribe({
        next: (slots) => {
          const now = new Date();
          const hasAvailable = slots
            .filter(s => s.available)
            .some(s => {
              const [h, m] = s.time.split(':').map(Number);
              return h > now.getHours() || (h === now.getHours() && m > now.getMinutes());
            });
          this.todayAvailability.update(m => {
            const next = new Map(m);
            next.set(studio.id, hasAvailable);
            return next;
          });
        },
      });
    }
  }

  // --- Nearest slot ---

  private tryDateForNearest(date: Date, studio: StudioAddress, attempt: number): void {
    if (attempt >= 14) {
      this.findingNearest.set(false);
      return;
    }

    const checkDate = new Date(date);
    checkDate.setDate(checkDate.getDate() + attempt);
    const dateStr = this.formatDateISO(checkDate);

    this.bookingService.getSlots(dateStr, undefined, studio.id).subscribe({
      next: (slots) => {
        // Дедупликация по времени
        const seen = new Set<string>();
        const available = slots.filter(s => s.available).filter(s => {
          if (seen.has(s.time)) return false;
          seen.add(s.time);
          return true;
        });
        const now = new Date();
        const isToday = checkDate.toDateString() === now.toDateString();
        const filtered = isToday
          ? available.filter(s => {
              const [h, m] = s.time.split(':').map(Number);
              return h > now.getHours() || (h === now.getHours() && m > now.getMinutes());
            })
          : available;

        if (filtered.length > 0) {
          this.selectedDate.set(checkDate);
          this.availableSlots.set(filtered);
          // Не ставим selectedTime, показываем шаг 4, чтобы пользователь видел все варианты
          this.loadingSlots.set(false);
          this.findingNearest.set(false);
          this.scrollToTop();
        } else {
          this.tryDateForNearest(date, studio, attempt + 1);
        }
      },
      error: () => {
        this.tryDateForNearest(date, studio, attempt + 1);
      },
    });
  }

  // --- Focus ---

  private focusNameInput(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    if (this.contactForm.value.name) return;
    try {
      const nameEl = this.elRef.nativeElement.querySelector<HTMLInputElement>('input[formcontrolname="name"]');
      nameEl?.focus();
    } catch { /* ignore */ }
  }

  // --- Yandex Maps ---

  private loadYandexMaps(): void {
    this.mapReady.set(false);

    const apiKey = environment.yandexMaps.apiKey.trim();
    if (apiKey.length === 0) {
      this.markMapUnavailable();
      return;
    }

    const existingYMaps = Reflect.get(window, 'ymaps');

    if (isYMapsLoaderApi(existingYMaps)) {
      existingYMaps.ready(() => this.initMap());
      return;
    }

    const existingScript = document.getElementById(YANDEX_MAPS_SCRIPT_ID);
    if (existingScript instanceof HTMLScriptElement) {
      existingScript.addEventListener('load', () => this.handleYandexMapsScriptLoaded(), { once: true });
      existingScript.addEventListener('error', () => this.markMapUnavailable(), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = YANDEX_MAPS_SCRIPT_ID;
    script.src = this.getYandexMapsScriptUrl(apiKey);
    script.async = true;
    script.onload = () => this.handleYandexMapsScriptLoaded();
    script.onerror = () => this.markMapUnavailable();
    document.head.appendChild(script);
  }

  private getYandexMapsScriptUrl(apiKey: string): string {
    const url = new URL('https://api-maps.yandex.ru/2.1/');
    url.searchParams.set('lang', 'ru_RU');
    url.searchParams.set('apikey', apiKey);

    return url.toString();
  }

  private handleYandexMapsScriptLoaded(): void {
    const loadedYMaps = Reflect.get(window, 'ymaps');
    if (isYMapsLoaderApi(loadedYMaps)) {
      loadedYMaps.ready(() => this.initMap());
      return;
    }

    this.markMapUnavailable();
  }

  private initMap(): void {
    if (this.destroyed) return;

    const loadedYMaps = Reflect.get(window, 'ymaps');
    if (!isYMapsApi(loadedYMaps)) {
      this.markMapUnavailable();
      return;
    }

    if (this.mapInstance) {
      this.markMapReady();
      return;
    }

    const mapEl = this.elRef.nativeElement.querySelector<HTMLElement>('#booking-map');
    if (!mapEl) return;

    const studiosWithCoordinates = this.studios.filter(hasStudioCoordinates);
    const coords: [number, number][] = studiosWithCoordinates.map(studio => [
      studio.coordinates.lat,
      studio.coordinates.lng,
    ]);
    if (coords.length === 0) {
      this.markMapUnavailable();
      return;
    }

    const centerLat = coords.reduce((sum, c) => sum + c[0], 0) / coords.length;
    const centerLng = coords.reduce((sum, c) => sum + c[1], 0) / coords.length;

    try {
      const mapObj = new loadedYMaps.Map(mapEl, {
        center: [centerLat, centerLng],
        zoom: 13,
        controls: ['zoomControl'],
      });
      this.mapInstance = mapObj;

      mapObj.behaviors.disable('scrollZoom');

      for (const studio of studiosWithCoordinates) {
        const placemark = new loadedYMaps.Placemark(
          [studio.coordinates.lat, studio.coordinates.lng],
          {
            balloonContentHeader: studio.name,
            balloonContentBody: this.shortAddress(studio),
            hintContent: studio.name,
          },
          { preset: 'islands#blueCircleDotIcon' }
        );

        placemark.events.add('click', () => {
          this.ngZone.run(() => this.selectStudio(studio));
        });

        mapObj.geoObjects.add(placemark);
        this.placemarks.set(studio.id, placemark);
      }
    } catch {
      this.markMapUnavailable();
      return;
    }

    this.markMapReady();
  }

  private markMapReady(): void {
    if (this.destroyed) return;
    this.ngZone.run(() => {
      this.mapReady.set(true);
    });
  }

  private markMapUnavailable(): void {
    if (this.destroyed) return;
    this.ngZone.run(() => {
      this.mapReady.set(true);
    });
  }

  private highlightMarker(studioId: string): void {
    for (const [id, pm] of this.placemarks) {
      pm.options.set('preset', id === studioId ? 'islands#redCircleDotIcon' : 'islands#blueCircleDotIcon');
    }
  }

  // --- Utils ---

  private loadSlots(): void {
    const date = this.selectedDate();
    const studio = this.selectedStudio();
    if (!date) return;

    if (studio && this.studioAlertService.isStudioClosedOnDate(studio.id, date)) {
      this.availableSlots.set([]);
      this.loadingSlots.set(false);
      return;
    }

    this.loadingSlots.set(true);
    this.availableSlots.set([]);

    const svc = this.selectedService();
    const serviceCategorySlug = svc && MARKETPLACE_SERVICE_IDS.has(svc) ? svc : undefined;

    this.bookingService.getSlots(
      this.formatDateISO(date),
      undefined,
      studio?.id,
      serviceCategorySlug,
    ).subscribe({
      next: (slots) => {
        let available = slots.filter(s => s.available);

        // Дедупликация по времени (API может вернуть слоты от нескольких ресурсов)
        const seen = new Set<string>();
        available = available.filter(s => {
          if (seen.has(s.time)) return false;
          seen.add(s.time);
          return true;
        });

        const now = new Date();
        if (date.toDateString() === now.toDateString()) {
          available = available.filter(s => {
            const [h, m] = s.time.split(':').map(Number);
            return h > now.getHours() || (h === now.getHours() && m > now.getMinutes());
          });
        }

        this.availableSlots.set(available);
        this.loadingSlots.set(false);
      },
      error: () => {
        this.availableSlots.set([]);
        this.loadingSlots.set(false);
      },
    });
  }

  private scrollToTop(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => {
      // In app layout the real scroll container is mat-sidenav-content, not window.
      const scrollContainer =
        this.elRef.nativeElement.closest<HTMLElement>('mat-sidenav-content')
        ?? document.querySelector<HTMLElement>('.mat-drawer-content');

      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
    }, 50);
  }

  private formatDateISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private toICSDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const h = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${y}${m}${d}T${h}${min}00`;
  }

  protected formatReopenDate(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  }
}
