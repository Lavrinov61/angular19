import { SERVICES, ServiceDoc } from './services.data';

export interface ServiceCategory {
  id: string;
  title: string;
  icon: string;
  displayCategories: string[];
}

export const SERVICE_CATEGORIES: ServiceCategory[] = [
  {
    id: 'photo',
    title: 'Фотосъёмка',
    icon: 'photo_camera',
    displayCategories: ['documents', 'portraits'],
  },
  {
    id: 'print',
    title: 'Печать и сувениры',
    icon: 'print',
    displayCategories: ['print'],
  },
  {
    id: 'technical',
    title: 'Офисные услуги',
    icon: 'content_copy',
    displayCategories: ['technical'],
  },
  {
    id: 'retouch',
    title: 'Обработка',
    icon: 'auto_fix_high',
    displayCategories: ['retouch', 'restoration'],
  },
  {
    id: 'online',
    title: 'Онлайн-услуги',
    icon: 'language',
    displayCategories: ['online'],
  },
  {
    id: 'business',
    title: 'Для бизнеса',
    icon: 'store',
    displayCategories: ['business'],
  },
];

export interface ServiceCategoryWithItems extends ServiceCategory {
  items: ServiceDoc[];
}

export function getServiceCategoriesWithItems(): ServiceCategoryWithItems[] {
  return SERVICE_CATEGORIES.map(cat => ({
    ...cat,
    items: SERVICES.filter(s => s.displayCategory && cat.displayCategories.includes(s.displayCategory)),
  }));
}
