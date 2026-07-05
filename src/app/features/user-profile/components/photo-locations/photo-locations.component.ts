import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { catchError, map, of } from 'rxjs';

import { LoggerService } from '../../../../core/services/logger.service';

type PickupLocationStatus = 'open' | 'closed' | 'maintenance';
type StudioStatusTone = 'success' | 'warning';
type StudioVisual = 'default' | 'soborny' | 'barrikadnaya';

interface PickupLocationHour {
  readonly dayOfWeek: number;
  readonly startTime: string;
  readonly endTime: string;
  readonly isOpen: boolean;
}

interface PickupLocation {
  readonly id: string;
  readonly studioId: string;
  readonly name: string;
  readonly address: string | null;
  readonly description?: string | null;
  readonly amenities?: readonly string[] | null;
  readonly status: string | null;
  readonly statusMessage: string | null;
  readonly statusUntil: string | null;
  readonly workHours: string | null;
  readonly hours: readonly PickupLocationHour[];
}

interface PickupLocationsResponse {
  readonly success: boolean;
  readonly data: readonly PickupLocation[];
}

interface StudioBranch {
  readonly id: string;
  readonly studioId: string;
  readonly name: string;
  readonly address: string;
  readonly hasAddress: boolean;
  readonly schedule: string;
  readonly status: PickupLocationStatus;
  readonly statusLabel: string;
  readonly statusTone: StudioStatusTone;
  readonly description: string | null;
  readonly mapUrl: string | null;
  readonly services: readonly string[];
  readonly visual: StudioVisual;
}

interface StudiosState {
  readonly loading: boolean;
  readonly studios: readonly StudioBranch[];
  readonly error: string | null;
}

const PICKUP_LOCATIONS_URL = '/api/studios/pickup-locations';
const UNKNOWN_ADDRESS_LABEL = 'Адрес уточняется';
const UNKNOWN_HOURS_LABEL = 'Часы работы уточните в чате';

const INITIAL_STUDIOS_STATE: StudiosState = {
  loading: true,
  studios: [],
  error: null,
};

function nonEmptyText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function normalizeStatus(value: string | null): PickupLocationStatus {
  return value === 'closed' || value === 'maintenance' ? value : 'open';
}

function statusLabel(location: PickupLocation, status: PickupLocationStatus): string {
  const message = nonEmptyText(location.statusMessage);

  if (status === 'closed') {
    return message ?? 'Временно не работает';
  }

  if (status === 'maintenance') {
    return message ?? 'Технический перерыв';
  }

  return 'Работает по расписанию';
}

function mapUrl(address: string | null): string | null {
  if (!address) return null;
  return `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
}

function resolveStudioVisual(id: string, name: string): StudioVisual {
  const lookup = `${id} ${name}`.toLowerCase();

  if (lookup.includes('soborn') || lookup.includes('собор')) {
    return 'soborny';
  }

  if (lookup.includes('barrikad') || lookup.includes('баррикад')) {
    return 'barrikadnaya';
  }

  return 'default';
}

function cleanServices(amenities: readonly string[] | null | undefined): readonly string[] {
  const result: string[] = [];

  for (const service of amenities ?? []) {
    const label = service.trim();
    if (label && !result.includes(label)) {
      result.push(label);
    }
  }

  return result;
}

function mapStudio(location: PickupLocation): StudioBranch {
  const address = nonEmptyText(location.address);
  const status = normalizeStatus(location.status);

  return {
    id: location.id,
    studioId: location.studioId,
    name: location.name,
    address: address ?? UNKNOWN_ADDRESS_LABEL,
    hasAddress: address !== null,
    schedule: nonEmptyText(location.workHours) ?? UNKNOWN_HOURS_LABEL,
    status,
    statusLabel: statusLabel(location, status),
    statusTone: status === 'open' ? 'success' : 'warning',
    description: nonEmptyText(location.description),
    mapUrl: mapUrl(address),
    services: cleanServices(location.amenities),
    visual: resolveStudioVisual(location.id, location.name),
  };
}

function studioCountLabel(count: number): string {
  if (count === 0) return 'Студии в Ростове';

  const mod100 = count % 100;
  const mod10 = count % 10;
  const noun = mod100 >= 11 && mod100 <= 14
    ? 'студий'
    : mod10 === 1
      ? 'студия'
      : mod10 >= 2 && mod10 <= 4
        ? 'студии'
        : 'студий';

  return `${count} ${noun} в Ростове`;
}

@Component({
  selector: 'app-photo-locations',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatSnackBarModule,
  ],
  templateUrl: './photo-locations.component.html',
  styleUrls: ['./photo-locations.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhotoLocationsComponent {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  private readonly snackBar = inject(MatSnackBar);
  private readonly http = inject(HttpClient);
  private readonly log = inject(LoggerService).createChild('PhotoLocationsComponent');

  private readonly studiosState = toSignal(
    this.http.get<PickupLocationsResponse>(PICKUP_LOCATIONS_URL).pipe(
      map((response): StudiosState => ({
        loading: false,
        studios: response.success ? response.data.map(mapStudio) : [],
        error: response.success ? null : 'Не удалось загрузить студии из базы',
      })),
      catchError((error: unknown) => {
        const reason = error instanceof Error ? error.message : 'unknown';
        this.log.warn('Не удалось загрузить студии из базы', { reason });

        return of<StudiosState>({
          loading: false,
          studios: [],
          error: 'Не удалось загрузить студии из базы',
        });
      }),
    ),
    { initialValue: INITIAL_STUDIOS_STATE },
  );

  protected readonly studios = computed(() => this.studiosState().studios);
  protected readonly isLoading = computed(() => this.studiosState().loading);
  protected readonly loadError = computed(() => this.studiosState().error);
  protected readonly summary = computed(() => [
    { icon: 'storefront', label: studioCountLabel(this.studios().length) },
    { icon: 'print', label: 'Печать и фото' },
    { icon: 'schedule', label: 'Актуальное расписание' },
  ] as const);

  protected readonly serviceHighlights = [
    {
      icon: 'badge',
      title: 'Фото на документы',
      text: 'Подскажем формат, проверим кадр и подготовим файл под нужные требования.',
    },
    {
      icon: 'print',
      title: 'Печать документов',
      text: 'А4, студенческие материалы, заявления и файлы из личного кабинета.',
    },
    {
      icon: 'inventory_2',
      title: 'Получение заказов',
      text: 'Забирайте готовые фото и распечатки в ближайшей удобной студии.',
    },
  ] as const;

  bookStudio(studio: StudioBranch): void {
    const queryParams: Record<string, string> = {
      studio: studio.id,
    };

    if (studio.hasAddress) {
      queryParams['address'] = studio.address;
    }

    void this.router.navigate(['/booking'], {
      queryParams,
    });
  }

  copyAddress(studio: StudioBranch): void {
    if (!studio.hasAddress) {
      this.snackBar.open('Адрес студии не указан', 'OK', { duration: 3000 });
      return;
    }

    const clipboard = this.document.defaultView?.navigator.clipboard;

    if (!clipboard) {
      this.snackBar.open(studio.address, 'Адрес', { duration: 4000 });
      return;
    }

    clipboard.writeText(studio.address)
      .then(() => {
        this.snackBar.open('Адрес скопирован', 'OK', { duration: 2500 });
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : 'unknown';
        this.log.warn('Не удалось скопировать адрес студии', { studioId: studio.id, reason });
        this.snackBar.open(studio.address, 'Адрес', { duration: 4000 });
      });
  }

  openMap(studio: StudioBranch): void {
    if (!studio.mapUrl) {
      this.snackBar.open('Адрес студии не указан', 'OK', { duration: 3000 });
      return;
    }

    this.document.defaultView?.open(studio.mapUrl, '_blank', 'noopener,noreferrer');
  }
}
