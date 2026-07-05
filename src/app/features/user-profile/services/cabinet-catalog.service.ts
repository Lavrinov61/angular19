import { Injectable, computed } from '@angular/core';

import { SERVICES, type ServiceDoc } from '../../../core/data/services.data';

export interface CabinetCatalogItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  route: string;
  imageUrl: string | null;
  categoryId: string | null;
  categoryName: string;
  badge: string | null;
  favorite: boolean;
  sortOrder: number;
}

export interface CabinetCatalogGroup {
  title: string;
  items: CabinetCatalogItem[];
}

type ServiceDisplayCategory = NonNullable<ServiceDoc['displayCategory']>;

interface CabinetCatalogGroupDefinition {
  id: string;
  title: string;
  icon: string;
  order: number;
  categories: readonly ServiceDisplayCategory[];
}

const CABINET_CATALOG_GROUPS: readonly CabinetCatalogGroupDefinition[] = [
  {
    id: 'documents',
    title: 'Документы',
    icon: 'badge',
    order: 10,
    categories: ['documents'],
  },
  {
    id: 'print-office',
    title: 'Печать и офис',
    icon: 'print',
    order: 20,
    categories: ['print', 'technical'],
  },
  {
    id: 'shooting',
    title: 'Съёмка',
    icon: 'photo_camera',
    order: 30,
    categories: ['portraits', 'family', 'wedding', 'artistic', 'events', 'makeup'],
  },
  {
    id: 'retouch',
    title: 'Обработка фото',
    icon: 'auto_fix_high',
    order: 40,
    categories: ['retouch', 'restoration'],
  },
  {
    id: 'online',
    title: 'Онлайн',
    icon: 'language',
    order: 50,
    categories: ['online'],
  },
  {
    id: 'business',
    title: 'Для бизнеса',
    icon: 'business_center',
    order: 60,
    categories: ['business'],
  },
];

const FEATURED_SERVICE_IDS = [
  'foto-na-document',
  'pechat-foto',
  'pechat-dokumentov',
  'retush-online',
] as const;

const TAG_BADGES: Record<NonNullable<ServiceDoc['tag']>, string> = {
  popular: 'популярно',
  new: 'новое',
  sale: 'выгодно',
};

const PRICE_FORMATTER = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 0,
});

@Injectable({ providedIn: 'root' })
export class CabinetCatalogService {
  readonly loading = computed(() => false);
  readonly error = computed<string | null>(() => null);
  readonly items = computed(() => buildCabinetCatalogItems(SERVICES));
  readonly featuredItems = computed(() => buildCabinetFeaturedItems(this.items()));
  readonly groups = computed(() => buildCabinetCatalogGroups(this.items()));
}

export function buildCabinetCatalogItems(services: readonly ServiceDoc[]): CabinetCatalogItem[] {
  return services.flatMap((service, index) => {
    const group = resolveCatalogGroup(service);
    if (!group) {
      return [];
    }

    return [{
      id: service.id,
      title: service.title,
      description: buildDescription(service),
      icon: service.icon || group.icon,
      route: `/${service.slug}`,
      imageUrl: service.image || null,
      categoryId: group.id,
      categoryName: group.title,
      badge: service.tag ? TAG_BADGES[service.tag] : null,
      favorite: service.tag === 'popular' || isFeaturedService(service.id),
      sortOrder: group.order * 100 + index,
    }];
  });
}

export function buildCabinetFeaturedItems(items: readonly CabinetCatalogItem[]): CabinetCatalogItem[] {
  const byId = new Map(items.map(item => [item.id, item]));
  const curated = FEATURED_SERVICE_IDS.flatMap(id => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

  if (curated.length > 0) {
    return curated;
  }

  const fallback = items.filter(item => item.favorite || item.badge);
  return (fallback.length ? fallback : [...items]).slice(0, 6);
}

export function buildCabinetCatalogGroups(items: readonly CabinetCatalogItem[]): CabinetCatalogGroup[] {
  const groups = new Map<string, CabinetCatalogItem[]>();

  for (const item of items) {
    const list = groups.get(item.categoryName) ?? [];
    list.push(item);
    groups.set(item.categoryName, list);
  }

  return [...groups.entries()]
    .map(([title, groupItems]) => ({
      title,
      items: [...groupItems].sort(compareItems),
    }))
    .sort((a, b) => groupOrder(a.title) - groupOrder(b.title) || a.title.localeCompare(b.title, 'ru'));
}

function resolveCatalogGroup(service: ServiceDoc): CabinetCatalogGroupDefinition | null {
  const displayCategory = service.displayCategory;
  if (!displayCategory) {
    return null;
  }

  return CABINET_CATALOG_GROUPS.find(group => group.categories.includes(displayCategory)) ?? null;
}

function buildDescription(service: ServiceDoc): string {
  const parts = [
    formatPrice(service.price),
    service.features?.find(feature => feature.trim()),
  ].filter(isNonEmptyString);

  if (parts.length > 0) {
    return parts.join(' • ');
  }

  return compactText(service.description);
}

function formatPrice(price: number | undefined): string | null {
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  return `от ${PRICE_FORMATTER.format(Math.ceil(price))} ₽`;
}

function compactText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 96 ? `${trimmed.slice(0, 93).trim()}...` : trimmed;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFeaturedService(id: string): boolean {
  return FEATURED_SERVICE_IDS.some(featuredId => featuredId === id);
}

function groupOrder(title: string): number {
  return CABINET_CATALOG_GROUPS.find(group => group.title === title)?.order ?? Number.MAX_SAFE_INTEGER;
}

function compareItems(a: CabinetCatalogItem, b: CabinetCatalogItem): number {
  return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'ru');
}
