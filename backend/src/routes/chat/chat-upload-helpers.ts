/**
 * chat-upload-helpers.ts — Shared helpers for chat upload routes.
 * Extracted from chat-upload.routes.ts during F107 deprecation cleanup.
 */

import { pool } from '../../database/db.js';
import type { BotInteractive } from './chat-shared.js';
import { getSessionContext, isReturningBasicCustomer, updateSessionContext } from './chat-context.service.js';
import { buildOrderConfirmedButtons, buildOrderCard, DOCUMENT_TYPES, extractPrice, getServiceOptionsForCustomer, formatPriceBreakdown, buildOrderSummaryFromOptions } from './chat-pricing.helpers.js';
import { getCategoryBySlug } from '../../services/pricing-engine.service.js';

export interface PostUploadBotResponse {
  botResponse: string;
  botInteractive: BotInteractive | null;
}

interface BundleOrderSelectedOption {
  option_slug: string;
  quantity?: number;
}

type BundleDeliveryMethod = 'electronic' | 'pickup' | 'postal';

interface UnknownObject {
  [key: string]: unknown;
}

interface GroupedBundleOptions {
  [groupSlug: string]: string[];
}

interface PostUploadSession {
  channel?: string | null;
  entry_context?: {
    delivery?: unknown;
  } | null;
}

export interface SubmitOrderBundlePayload {
  categorySlug?: string;
  selectedDoc?: string;
  selectedDocs?: string[];
  customerNote?: string;
  selectedOptions?: BundleOrderSelectedOption[];
  configuratorTotal?: number;
}

function isRecord(value: unknown): value is UnknownObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeBundleOption(item: unknown): BundleOrderSelectedOption | null {
  if (!isRecord(item)) return null;

  const optionSlug = item['option_slug'];
  if (typeof optionSlug !== 'string' || optionSlug.length === 0) return null;

  const quantity = item['quantity'];
  return {
    option_slug: optionSlug,
    quantity: typeof quantity === 'number' ? quantity : undefined,
  };
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

export function parseBundlePayload(raw: unknown): SubmitOrderBundlePayload {
  if (typeof raw !== 'string' || !raw.trim()) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const selectedOptions = Array.isArray(parsed['selectedOptions'])
      ? parsed['selectedOptions']
        .map(normalizeBundleOption)
        .filter((item): item is BundleOrderSelectedOption => item !== null)
      : [];

    return {
      categorySlug: typeof parsed['categorySlug'] === 'string' ? parsed['categorySlug'] : undefined,
      selectedDoc: typeof parsed['selectedDoc'] === 'string' ? parsed['selectedDoc'] : undefined,
      selectedDocs: Array.isArray(parsed['selectedDocs'])
        ? parsed['selectedDocs'].filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : undefined,
      customerNote: typeof parsed['customerNote'] === 'string' ? parsed['customerNote'] : undefined,
      selectedOptions,
      configuratorTotal: typeof parsed['configuratorTotal'] === 'number' ? parsed['configuratorTotal'] : undefined,
    };
  } catch {
    return {};
  }
}

export async function mapBundleSelectedOptionsByGroup(
  categorySlug: string,
  selectedOptions: BundleOrderSelectedOption[],
): Promise<GroupedBundleOptions> {
  if (!selectedOptions.length) return {};

  const category = await getCategoryBySlug(categorySlug);
  if (!category) return {};

  const optionToGroup = new Map<string, string>();
  for (const group of category.optionGroups) {
    for (const option of group.options) {
      optionToGroup.set(option.slug, group.slug);
    }
  }

  const grouped: GroupedBundleOptions = {};
  for (const selected of selectedOptions) {
    const groupSlug = optionToGroup.get(selected.option_slug);
    if (!groupSlug) continue;

    if (!grouped[groupSlug]) grouped[groupSlug] = [];
    if (!grouped[groupSlug].includes(selected.option_slug)) {
      grouped[groupSlug].push(selected.option_slug);
    }
  }

  return grouped;
}

export async function buildPostUploadBotResponse(
  sessionId: string,
  session: PostUploadSession,
  photoCount: number,
  uploadMode: 'single' | 'batch',
  categorySlug = 'photo-docs',
  caption?: string,
  configuratorTotal?: number,
): Promise<PostUploadBotResponse> {
  const ctx = await getSessionContext(sessionId);
  const { selectedDoc, selectedTariff, orderNumber, selectedOptions } = ctx;
  const isReturning = await isReturningBasicCustomer(sessionId);
  const hasNewFlowOptions = selectedOptions
    ? Object.values(selectedOptions).some((options) => Array.isArray(options) && options.length > 0)
    : false;

  const uploadPrefix = uploadMode === 'batch'
    ? `Загружено ${photoCount} фото!`
    : 'Фото получено!';

  if (categorySlug === 'voennaya-retush') {
    return {
      botResponse: `${uploadPrefix} 📸✅\n\nЗаявка по военной ретуши получена. Оператор уточнит форму, звание, знаки, медали, размер и срок, затем пришлет резюме заказа и стоимость до оплаты.`,
      botInteractive: null,
    };
  }

  if (selectedDoc && hasNewFlowOptions) {
    const hasDelivery = (selectedOptions['extras'] || []).includes('print-delivery');
    const payDeliveryMethod: BundleDeliveryMethod = hasDelivery ? 'postal' : (session.channel === 'studio' ? 'pickup' : 'electronic');
    const { text, total, buttons } = await buildOrderSummaryFromOptions({
      categorySlug,
      selectedOptions,
      selectedDoc,
      photoCount: 1,
      uploadedPhotoCount: photoCount,
      overrideTotal: configuratorTotal,
      isReturning,
      deliveryMethod: payDeliveryMethod,
    });

    const pendingOrderData = buttons[0]?.data || { price: total };
    await pool.query(
      `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ pendingOrder: pendingOrderData }), sessionId],
    );

    return {
      botResponse: `${uploadPrefix} 📸✅\n\n${text}`,
      botInteractive: {
        type: 'cards',
        step: 'order_confirmed',
        buttons,
        cards: [buildOrderCard(text, buttons)],
      },

    };
  }

  if (selectedDoc && selectedTariff) {
    const buttons = await buildOrderConfirmedButtons(selectedTariff, selectedDoc, orderNumber, 1, isReturning);
    const orderData = buttons[0].data || {};
    const price = readNumber(orderData['price']) ?? await extractPrice(selectedTariff, isReturning);
    const fp = readNumber(orderData['firstPrice']) ?? price;
    const np = readNumber(orderData['nextPrice']) ?? price;
    const priceText = formatPriceBreakdown(price, fp, np, 1);

    const pendingOrderData = { ...(buttons[0].data || { price, tariff: selectedTariff, document: selectedDoc }), photoCount };
    await pool.query(
      `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ pendingOrder: pendingOrderData }), sessionId],
    );

    const botResponse = uploadMode === 'single'
      ? `${uploadPrefix} 📸✅\n\n📋 **Ваш заказ оформлен!**\n• Документ: **${selectedDoc}**\n• Тариф: **${selectedTariff}**\n• Фото: ${photoCount} шт. (на выбор)\n• Сумма: ${priceText}\n\n🖨 **Нужен печатный вид?** (+200₽)\nМы напечатаем и доставим готовые фото Почтой России.`
      : `${uploadPrefix} 📸✅\n\n📋 **Ваш заказ оформлен!**\n• Документ: **${selectedDoc}**\n• Тариф: **${selectedTariff}**\n• Фото: ${photoCount} шт. (на выбор)\n• Сумма: ${priceText}`;

    return {
      botResponse,
      botInteractive: {
        type: 'cards',
        step: 'order_confirmed',
        buttons,
        cards: [buildOrderCard(botResponse, buttons)],
      },
    };
  }

  if (selectedDoc && !selectedTariff && !hasNewFlowOptions) {
    return {
      botResponse: `${uploadPrefix} 📸\n\nДокумент: **${selectedDoc}** ✅\nТеперь выберите тариф обработки:`,
      botInteractive: {
        type: 'buttons',
        step: 'service_select',
        buttons: [
          ...(await getServiceOptionsForCustomer(isReturning)),
          { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
        ],
      },
    };
  }

  if (selectedTariff && !selectedDoc) {
    return {
      botResponse: `${uploadPrefix} 📸\n\nТариф: **${selectedTariff}** ✅\nТеперь укажите, на какой документ нужно фото:`,
      botInteractive: {
        type: 'document_select',
        step: 'document_after_photo',
        buttons: [
          ...DOCUMENT_TYPES,
          { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
        ],
      },
    };
  }

  if (session.entry_context?.delivery === 'pickup' || session.channel === 'studio') {
    const botResponse = uploadMode === 'single'
      ? `📸 Фото #${photoCount} получено!\n\nВыберите, что сделать с фото:`
      : `📸 Загружено ${photoCount} фото!\n\nВыберите, что сделать с фото:`;

    return {
      botResponse,
      botInteractive: {
        type: 'buttons',
        step: 'studio_photo_action',
        buttons: [
          { id: 'sp_print', label: '🖨 Печать фотографий', icon: 'photo_prints', value: 'studio_photo_print', color: '#667eea' },
          { id: 'sp_retouch', label: '✨ Ретушь / обработка', icon: 'auto_fix_high', value: 'studio_photo_retouch', color: '#f093fb' },
          { id: 'sp_restore', label: '🔄 Реставрация фото', icon: 'healing', value: 'studio_photo_restore', color: '#11998e' },
          { id: 'sp_docs', label: '📄 Фото на документы', icon: 'badge', value: 'studio_photo_docs', color: '#fa709a' },
          { id: 'sp_canvas', label: '🖼 Печать на холсте', icon: 'wallpaper', value: 'studio_photo_canvas', color: '#a18cd1' },
          { id: 'back_studio_menu', label: '◀ В меню', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
        ],
      },
    };
  }

  return {
    botResponse: `${uploadPrefix} 📸\n\nТеперь укажите, на какой документ нужно фото:`,
    botInteractive: {
      type: 'document_select',
      step: 'document_after_photo',
      buttons: [
        ...DOCUMENT_TYPES,
        { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
      ],
    },
  };
}
