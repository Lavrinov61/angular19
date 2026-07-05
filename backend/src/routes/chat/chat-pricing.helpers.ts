/**
 * Chat pricing helpers — утилиты ценообразования для чат-бота.
 *
 * Phase 2: мигрировано с service-pricing.ts на pricing-engine.service.ts.
 * Все ценовые функции теперь async (данные из DB).
 */

import {
  buildServiceOptionsFromDB,
  getServicePriceFromDB,
  calculateTotalForSelectedOptions,
  getCategoryBySlug,
  type DeliveryMethodParam,
} from '../../services/pricing-engine.service.js';
import type { BotButton, BotCard, BotInteractive, BotMessageResult } from './chat-shared.js';

export type { BotButton, BotInteractive, BotMessageResult };

interface ChatPendingOrderData {
  readonly [key: string]: unknown;
}

/** Построить структурированную карточку заказа из текстового summary и кнопок. */
export function buildOrderCard(content: string, buttons: BotButton[], title = 'Итог заказа'): BotCard {
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^•\s*/, '').replace(/\*\*/g, ''));

  const items = lines
    .filter(line => line.includes(':'))
    .map(line => {
      const separator = line.indexOf(':');
      return {
        label: line.slice(0, separator).trim(),
        value: line.slice(separator + 1).trim(),
      };
    })
    .filter(item => item.label && item.value);

  const priceMatch = content.match(/\*\*(\d+\s*₽)\*\*|\b(\d+\s*₽)\b/);
  const price = priceMatch?.[1] || priceMatch?.[2];

  return {
    title,
    subtitle: 'Проверьте детали перед следующим шагом',
    icon: 'receipt_long',
    items,
    price,
    buttons,
  };
}

// ============================================================================
// Документы и размеры (статические — не зависят от цен)
// ============================================================================

export const DOCUMENT_TYPES: BotButton[] = [
  { id: 'passport_rf', label: 'Паспорт РФ', icon: 'badge', value: 'Паспорт РФ', color: '#667eea' },
  { id: 'zagran', label: 'Загранпаспорт', icon: 'flight', value: 'Загранпаспорт', color: '#764ba2' },
  { id: 'visa', label: 'Виза', icon: 'public', value: 'Виза', color: '#11998e' },
  { id: 'driver', label: 'Водительское', icon: 'directions_car', value: 'Водительское удостоверение', color: '#f093fb' },
  { id: 'student', label: 'Студенческий', icon: 'school', value: 'Студенческий билет', color: '#4facfe' },
  { id: 'work_pass', label: 'Пропуск', icon: 'work', value: 'Пропуск на работу', color: '#43e97b' },
  { id: 'military', label: 'Военный билет', icon: 'military_tech', value: 'Военный билет', color: '#fa709a' },
  { id: 'other', label: 'Другой документ', icon: 'description', value: 'Другой документ', color: '#a8a8a8' },
];

// ============================================================================
// Кнопки тарифов (async — из DB через pricing engine)
// ============================================================================

/** Кэш кнопок: isReturning → BotButton[] */
let _cachedOptions: { returning: BotButton[]; new: BotButton[] } | null = null;
let _cacheTimestamp = 0;
const BUTTON_CACHE_TTL = 60_000; // 60s — синхронно с pricing engine cache

/** Получить SERVICE_OPTIONS с учётом статуса клиента (промо только для новых) */
export async function getServiceOptionsForCustomer(isReturning: boolean): Promise<BotButton[]> {
  const now = Date.now();
  if (_cachedOptions && now - _cacheTimestamp < BUTTON_CACHE_TTL) {
    return isReturning ? _cachedOptions.returning : _cachedOptions.new;
  }

  const [newOptions, returningOptions] = await Promise.all([
    buildServiceOptionsFromDB(false),
    buildServiceOptionsFromDB(true),
  ]);

  _cachedOptions = {
    new: newOptions as BotButton[],
    returning: returningOptions as BotButton[],
  };
  _cacheTimestamp = now;

  return isReturning ? _cachedOptions.returning : _cachedOptions.new;
}

/**
 * Извлечь цену из тарифа — использует pricing engine (DB).
 * @param deliveryMethod — способ получения (определяет колонку цены)
 */
export async function extractPrice(
  tariff: string,
  isReturning = false,
  deliveryMethod: DeliveryMethodParam = 'electronic',
): Promise<number> {
  const { firstPrice } = await getServicePriceFromDB(tariff, isReturning, deliveryMethod);
  return firstPrice;
}

/** Форматировать расшифровку цены: "700₽ × 2 фото = **1400₽**" */
export function formatPriceBreakdown(total: number, firstPrice: number, nextPrice: number, photoCount: number): string {
  if (photoCount <= 1) return `**${total}₽**`;
  const hasDiscount = firstPrice < nextPrice;
  if (!hasDiscount) return `${firstPrice}₽ × ${photoCount} фото = **${total}₽**`;
  if (photoCount === 2) return `${firstPrice}₽ + ${nextPrice}₽ = **${total}₽**`;
  return `${firstPrice}₽ + ${nextPrice}₽ × ${photoCount - 1} = **${total}₽**`;
}

/** Форматировать название позиции: "Без обработки" → "Фото на документы (без обработки)" */
export function formatServiceDescription(tariff: string): string {
  const cleaned = tariff.replace(/\s*\(\d+₽\)$/, '').trim();
  return `Фото на документы (${cleaned.toLowerCase()})`;
}

/**
 * Сформировать кнопки для подтверждённого заказа (печать или электронный вид).
 * @param isReturningCustomer — true если клиент уже использовал стартовое промо
 * @param deliveryMethod — способ получения для ценообразования
 */
export async function buildOrderConfirmedButtons(
  tariff: string,
  document?: string,
  orderNumber?: number,
  photoCount = 1,
  isReturningCustomer = false,
  deliveryMethod: DeliveryMethodParam = 'electronic',
): Promise<BotButton[]> {
  const { firstPrice, nextPrice } = await getServicePriceFromDB(tariff, isReturningCustomer, deliveryMethod);

  const count = Math.max(photoCount, 1);
  const hasDiscount = firstPrice < nextPrice;
  const price = hasDiscount
    ? firstPrice + nextPrice * (count - 1)
    : firstPrice * count;

  const orderData = { price, firstPrice, nextPrice, photoCount: count, tariff, document };

  return [
    {
      id: 'online_print_yes',
      label: '🖨 Да, печать (+200₽)',
      icon: 'print',
      value: 'online_print_yes',
      color: '#667eea',
      data: orderData,
    },
    {
      id: 'online_print_no',
      label: '📱 Нет, только электронный вид',
      icon: 'smartphone',
      value: 'online_print_no',
      color: '#11998e',
      data: orderData,
    },
    { id: 'add_comment', label: '✏️ Добавить пожелания', icon: 'edit', value: 'add_wishes', color: '#667eea' },
    { id: 'order_more', label: '📷 Заказать ещё', icon: 'add_photo_alternate', value: 'order_photo', color: '#11998e' },
    { id: 'edit_order', label: '◀ Изменить документ', icon: 'arrow_back', value: 'document_select', color: '#a8a8a8' },
  ];
}

/** Создать кнопку оплаты через CloudPayments Widget (данные для фронтенда) */
export function buildWidgetPaymentButton(orderId: string, price: number, description: string): BotButton {
  return {
    id: 'pay_online_widget',
    label: `💳 Оплатить онлайн ${price}₽`,
    icon: 'credit_card',
    value: 'pay_online_widget',
    color: '#22c55e',
    data: { orderId, price, description },
  };
}

/**
 * Сформировать итоговое сообщение и кнопки оплаты из выбранных опций (новый flow).
 * Вызывает calculateTotalForSelectedOptions() для расчёта суммы.
 * Возвращает текст с детализацией, total и кнопки оплаты.
 */
export async function buildOrderSummaryFromOptions(params: {
  categorySlug: string;
  selectedOptions: Record<string, string[]>;
  selectedDoc: string | null;
  photoCount: number;
  uploadedPhotoCount?: number;
  overrideTotal?: number;
  isReturning: boolean;
  deliveryMethod?: DeliveryMethodParam;
  orderNumber?: number;
}): Promise<{ text: string; total: number; buttons: BotButton[] }> {
  const {
    categorySlug, selectedOptions, selectedDoc, photoCount,
    uploadedPhotoCount, overrideTotal,
    isReturning, deliveryMethod = 'electronic',
  } = params;

  // Если цена передана с конфигуратора — используем её напрямую, без пересчёта
  const total = overrideTotal != null
    ? overrideTotal
    : (await calculateTotalForSelectedOptions({
        categorySlug, selectedOptions, isReturning, deliveryMethod, photoCount,
      })).total;

  // Строим читаемое описание заказа
  const lines: string[] = ['📋 **Ваш заказ:**'];
  if (selectedDoc) lines.push(`• Документ: **${selectedDoc}**`);

  // Получаем категорию для имён групп и опций
  const category = await getCategoryBySlug(categorySlug);
  let tariffDesc = category?.name || 'Фото на документы';
  const tariffParts: string[] = [];

  if (category) {
    for (const [groupSlug, slugs] of Object.entries(selectedOptions)) {
      if (!slugs || slugs.length === 0) continue;
      const group = category.optionGroups.find(g => g.slug === groupSlug);
      if (!group) continue;

      const optNames = slugs.map(slug => {
        const opt = group.options.find(o => o.slug === slug);
        return opt?.name || slug;
      }).filter(Boolean);

      // Пропускаем "Обычная (30 мин)" — бесплатно и очевидно
      const visibleNames = optNames.filter(n => n !== 'Обычная (30 мин)');
      if (visibleNames.length > 0) {
        lines.push(`• ${group.name}: **${visibleNames.join(', ')}**`);
        tariffParts.push(...visibleNames);
      }
    }
  }

  const displayPhotoCount = uploadedPhotoCount ?? photoCount;
  if (displayPhotoCount > 1) lines.push(`• Фото: **${displayPhotoCount} шт.** (на выбор)`);
  lines.push(`• Итого: **${total}₽**`);

  if (tariffParts.length > 0) {
    tariffDesc = `Фото на документы (${tariffParts.join(', ')})`;
  }

  // Определяем delivery_method для кнопки оплаты
  const hasDelivery = (selectedOptions['extras'] || []).includes('print-delivery');
  const payDeliveryMethod = hasDelivery ? 'postal' : deliveryMethod;

  const pendingOrderData: ChatPendingOrderData = {
    categorySlug,
    price: total,
    tariff: tariffDesc,
    document: selectedDoc || '',
    photoCount: uploadedPhotoCount ?? photoCount,
    delivery_method: payDeliveryMethod,
    selectedOptions,
  };

  const buttons: BotButton[] = [
    {
      id: 'pay_order_btn',
      label: `💳 Оплатить ${total}₽`,
      icon: 'credit_card',
      value: 'pay_order',
      color: '#22c55e',
      data: pendingOrderData,
    },
    {
      id: 'add_comment',
      label: '✏️ Добавить пожелания',
      icon: 'edit',
      value: 'add_wishes',
      color: '#667eea',
    },
    {
      id: 'order_more',
      label: '📷 Заказать ещё',
      icon: 'add_photo_alternate',
      value: 'order_photo',
      color: '#11998e',
    },
    {
      id: 'edit_document',
      label: '◀ Изменить документ',
      icon: 'arrow_back',
      value: 'document_select',
      color: '#a8a8a8',
    },
  ];

  return { text: lines.join('\n'), total, buttons };
}

/**
 * Генерация шага выбора копий с учётом полей и обрезки
 */
export function buildCopiesStep(
  size: string, unitPrice: number, photosCount: number,
  printType: string, borders: string, cuttingPrice: number
): BotMessageResult {
  const typeLabel = printType ? ` (${printType})` : '';
  const bordersIcon = borders === 'с полями' ? '🔲' : '🖼';
  const cutNote = cuttingPrice > 0 ? `\n✂️ Обрезка: **+${cuttingPrice}₽/шт.**` : '';
  const effectivePrice = unitPrice + cuttingPrice;
  const printData = { size, unitPrice: effectivePrice, photosCount, printType, borders, cuttingPrice, basePrintPrice: unitPrice };

  return {
    content: `✅ **${size} см**${typeLabel} — ${unitPrice}₽/шт.\n${bordersIcon} ${borders}${cutNote}\n📷 Фото: **${photosCount} шт.**\n\nСколько копий каждого фото?`,
    interactive: {
      type: 'buttons',
      step: 'studio_print_copies',
      buttons: [
        { id: 'cp_1', label: `1 копия — ${photosCount * effectivePrice}₽`, icon: 'looks_one', value: 'studio_copies_1', color: '#667eea', data: { ...printData, copies: 1, total: photosCount * effectivePrice } },
        { id: 'cp_2', label: `2 копии — ${photosCount * effectivePrice * 2}₽`, icon: 'looks_two', value: 'studio_copies_2', color: '#11998e', data: { ...printData, copies: 2, total: photosCount * effectivePrice * 2 } },
        { id: 'cp_3', label: `3 копии — ${photosCount * effectivePrice * 3}₽`, icon: 'looks_3', value: 'studio_copies_3', color: '#f093fb', data: { ...printData, copies: 3, total: photosCount * effectivePrice * 3 } },
        { id: 'cp_5', label: `5 копий — ${photosCount * effectivePrice * 5}₽`, icon: 'looks_5', value: 'studio_copies_5', color: '#fa709a', data: { ...printData, copies: 5, total: photosCount * effectivePrice * 5 } },
        { id: 'cp_10', label: `10 копий — ${photosCount * effectivePrice * 10}₽`, icon: 'filter_9_plus', value: 'studio_copies_10', color: '#4facfe', data: { ...printData, copies: 10, total: photosCount * effectivePrice * 10 } },
        { id: 'cp_custom', label: '✏️ Своё количество', icon: 'edit', value: 'studio_copies_custom', color: '#6c757d', data: printData },
        { id: 'back_borders', label: '◀ Назад', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
      ],
    },
  };
}
