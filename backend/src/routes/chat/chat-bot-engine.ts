/**
 * chat-bot-engine.ts — Interactive bot engine: button click handlers + contextual text input.
 * Extracted from visitor-chat.routes.ts (lines 3046-5278).
 */

import { pool } from '../../database/db.js';
import { validateAddress, calculateDeliveryCost } from '../../services/delivery.service.js';
import { getServicePriceFromDB, getCategoryBySlug, buildOptionGroupButtons, buildFeatureCardsText } from '../../services/pricing-engine.service.js';
import { getKonturPrices, findPriceNum } from '../../services/kontur-prices.service.js';
import { handleFinalizeOrder, findNearestProduction, normalizePhone, proceedAfterPhone } from './chat-order.service.js';
import {
  getStudiosEffectiveStatus,
  STUDIO_SHORT_LABELS,
  isStudioLabelOpen,
  resolveOpenProductionLabel,
} from '../../services/studio-status.service.js';
import { getSessionContext, updateSessionContext, isReturningBasicCustomer } from './chat-context.service.js';
import {
  buildCopiesStep, getServiceOptionsForCustomer, extractPrice, buildOrderConfirmedButtons,
  formatPriceBreakdown, DOCUMENT_TYPES, buildOrderCard, buildOrderSummaryFromOptions
} from './chat-pricing.helpers.js';
import type { BotButton, BotMessageResult } from './chat-shared.js';

import { createLogger } from '../../utils/logger.js';

const logger = createLogger('chat-bot-engine');

interface ChatButtonData {
  readonly [key: string]: unknown;
}

interface ChatConversationMetadataPatch {
  [key: string]: unknown;
}

interface StoredInteractiveButton {
  value?: string;
  data?: ChatButtonData;
}

/** value кнопки самовывоза по location_code физической точки. */
const PICKUP_VALUE_BY_LOCATION: Record<string, string> = {
  soborny: 'pickup_soborny',
};

/**
 * Кнопки самовывоза только по ОТКРЫТЫМ публичным точкам (+ доставка/назад).
 * Постоянно закрытые исторические точки не входят в STUDIO_SHORT_LABELS.
 */
async function buildPickupButtons(): Promise<BotButton[]> {
  const studios = await getStudiosEffectiveStatus();
  const buttons: BotButton[] = [];
  for (const code of ['soborny']) {
    const studio = studios.find(s => s.location_code === code);
    if (studio && studio.status === 'open') {
      buttons.push({
        id: PICKUP_VALUE_BY_LOCATION[code],
        label: `📍 ${STUDIO_SHORT_LABELS[code]}`,
        icon: 'location_on',
        value: PICKUP_VALUE_BY_LOCATION[code],
        color: '#764ba2',
      });
    }
  }
  buttons.push({ id: 'delivery_home', label: '🚚 Доставка на дом', icon: 'local_shipping', value: 'delivery_home', color: '#11998e' });
  buttons.push({ id: 'back_to_order_confirmed', label: '◀ Назад к заказу', icon: 'arrow_back', value: 'back_to_order_confirmed', color: '#a8a8a8' });
  return buttons;
}

/**
 * Ответ при клике по самовывозу в ВРЕМЕННО ЗАКРЫТОЙ точке (например устаревшая
 * кнопка из старого сообщения): объясняем и предлагаем открытые точки заново.
 */
async function buildPickupClosedResult(closedLabel: string): Promise<BotMessageResult> {
  const studios = await getStudiosEffectiveStatus();
  const closed = studios.find(s => s.location_code && STUDIO_SHORT_LABELS[s.location_code] === closedLabel);
  const note = closed?.status_message || `${closedLabel} временно закрыта.`;
  return {
    content: `⚠️ ${note}\n\n📍 Выберите другую точку получения:`,
    interactive: { type: 'buttons', step: 'pickup_select', buttons: await buildPickupButtons() },
  };
}

export async function handleInteractiveResponse(buttonValue: string, sessionId: string, buttonData?: ChatButtonData): Promise<BotMessageResult | null> {
  switch (buttonValue) {
    // ===================== ОПЛАТА: для online — спросить про печать, для studio — точку получения =====================
    case 'pay_order': {
      // Сохраняем данные заказа в метаданные сессии для последующего использования
      if (buttonData) {
        await pool.query(
          `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify({ pendingOrder: buttonData }), sessionId]
        );
      }

      const price = buttonData?.['price'] || 0;
      const service = buttonData?.['service'] || buttonData?.['tariff'] || 'Заказ';

      // Phase 2: определяем delivery_method из buttonData или из сессии
      // Если в buttonData явно указан delivery_method — используем его
      // Для studio-сервисов (дизайн, печать, сувениры) delivery_method = 'pickup'
      const explicitDelivery = buttonData?.['delivery_method'] as string | undefined;
      let deliveryMethod = explicitDelivery;

      if (!deliveryMethod) {
        // Fallback: определяем из entry_context или channel (backward compat)
        const sessionRes = await pool.query(
          `SELECT channel, entry_context FROM conversations WHERE id = $1`,
          [sessionId]
        );
        const row = sessionRes.rows[0];
        const entryDelivery = row?.entry_context?.delivery;
        const channel = row?.channel || 'studio';

        if (entryDelivery) {
          deliveryMethod = entryDelivery;
        } else if (channel === 'online') {
          // Online сессии — показать выбор (электронный вид / печать)
          deliveryMethod = undefined; // покажем выбор
        } else {
          // Studio — показать выбор точки
          deliveryMethod = 'pickup';
        }
      }

      if (deliveryMethod === 'pickup') {
        // Самовывоз: выбор точки получения (только открытые точки).
        return {
          content: `📋 **${service}** — **${price}₽**\n\n📍 Где вы заберёте заказ?`,
          interactive: {
            type: 'buttons',
            step: 'pickup_select',
            buttons: await buildPickupButtons(),
          },
        };
      }

      if (deliveryMethod === 'electronic') {
        // Электронный вид — сразу финализация
        return handleFinalizeOrder(sessionId, { pickup: 'Электронный вид (без печати)', production: 'Онлайн' });
      }

      if (deliveryMethod === 'postal') {
        // Доставка — запросить адрес
        const postalMeta: ChatConversationMetadataPatch = { printAddon: true, printPrice: 200, deliveryStep: 'online_awaiting_address' };
        if (buttonData?.['price']) postalMeta['pendingOrder'] = buttonData;
        await pool.query(
          `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
          [JSON.stringify(postalMeta), sessionId]
        );
        return {
          content: `📋 **${service}** — **${price}₽**\n\n📍 Укажите адрес доставки (город, улица, дом, квартира):`,
          interactive: {
            type: 'buttons',
            step: 'online_awaiting_address',
            buttons: [
              { id: 'online_cancel_print', label: '◀ Назад', icon: 'arrow_back', value: 'online_cancel_print', color: '#a8a8a8' },
            ],
          },
        };
      }

      // Не указан delivery_method → спросить (online-сценарий: электронный/печать)
      return {
        content: `📋 **${service}** — **${price}₽**\n\n🖨 Нужен печатный вид? (+200₽)\n\nМы напечатаем и доставим готовые фото.`,
        interactive: {
          type: 'buttons',
          step: 'online_print_ask',
          buttons: [
            { id: 'online_print_yes', label: '🖨 Да, нужна печать (+200₽)', icon: 'print', value: 'online_print_yes', color: '#667eea' },
            { id: 'online_print_no', label: '📱 Нет, только электронный вид', icon: 'smartphone', value: 'online_print_no', color: '#11998e' },
            { id: 'back_to_order_confirmed', label: '◀ Назад', icon: 'arrow_back', value: 'back_to_order_confirmed', color: '#a8a8a8' },
          ],
        },
      };
    }

    // ===================== LEGACY: закрытая точка 2-я Баррикадная 4 =====================
    case 'pickup_barrikadnaya': {
      return {
        content: '⚠️ Точка на 2-й Баррикадной закрыта.\n\n📍 Выберите другую точку получения:',
        interactive: { type: 'buttons', step: 'pickup_select', buttons: await buildPickupButtons() },
      };
    }

    // ===================== САМОВЫВОЗ: Соборный 21 =====================
    case 'pickup_soborny': {
      if (!(await isStudioLabelOpen('Соборный 21'))) {
        return buildPickupClosedResult('Соборный 21');
      }
      return handleFinalizeOrder(sessionId, { pickup: 'Соборный 21', production: 'Соборный 21' });
    }

    // ===================== ДОСТАВКА НА ДОМ =====================
    case 'delivery_home': {
      // Сохраняем что выбрана доставка, ожидаем адрес
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"deliveryStep": "awaiting_address"}'::jsonb WHERE id = $1`,
        [sessionId]
      );
      return {
        content: `🚚 **Доставка на дом**\n\nНапишите адрес доставки (улица, дом, квартира):`,
        interactive: {
          type: 'buttons',
          step: 'delivery_awaiting_address',
          buttons: [
            { id: 'cancel_delivery', label: '◀ Назад к выбору', icon: 'arrow_back', value: 'cancel_delivery', color: '#a8a8a8' },
          ],
        },
      };
    }

    // ===================== ОНЛАЙН: печатный вид — ДА =====================
    case 'online_print_yes': {
      // Сохраняем что нужна печать, +200₽, ждём адрес. Обновляем pendingOrder если есть buttonData
      const printMeta: ChatConversationMetadataPatch = { printAddon: true, printPrice: 200, deliveryStep: 'online_awaiting_address' };
      if (buttonData?.['price']) {
        printMeta['pendingOrder'] = buttonData;
      }
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify(printMeta), sessionId]
      );
      return {
        content: `🖨 Отлично! Печатный вид (+200₽) добавлен.\n\n📍 Укажите адрес доставки (город, улица, дом, квартира):`,
        interactive: {
          type: 'buttons',
          step: 'online_awaiting_address',
          buttons: [
            { id: 'online_cancel_print', label: '◀ Назад', icon: 'arrow_back', value: 'online_cancel_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    // ===================== ОНЛАЙН: печатный вид — НЕТ =====================
    case 'online_print_no': {
      // Только электронный вид — завершаем заказ без доставки
      const noMeta: ChatConversationMetadataPatch = { printAddon: false };
      if (buttonData?.['price']) {
        noMeta['pendingOrder'] = buttonData;
      }
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify(noMeta), sessionId]
      );
      return handleFinalizeOrder(sessionId, { pickup: 'Электронный вид (без печати)', production: 'Онлайн' });
    }

    // ===================== ОНЛАЙН: отмена печати — назад к выбору =====================
    case 'online_cancel_print': {
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) - 'printAddon' - 'printPrice' - 'deliveryStep' - 'deliveryAddress' - 'deliveryPostalCode' - 'deliveryCost' - 'deliveryDaysMin' - 'deliveryDaysMax' WHERE id = $1`,
        [sessionId]
      );
      const metaRes2 = await pool.query(`SELECT metadata FROM conversations WHERE id = $1`, [sessionId]);
      const pendingOrder2 = metaRes2.rows[0]?.metadata?.pendingOrder;
      const price2 = pendingOrder2?.price || 0;
      const tariff2 = pendingOrder2?.tariff || 'Заказ';
      const document2 = pendingOrder2?.document || '';
      const photoCount2 = (pendingOrder2?.photoCount as number) || 1;
      const fp2 = (pendingOrder2?.firstPrice as number) || price2;
      const np2 = (pendingOrder2?.nextPrice as number) || price2;
      const priceText2 = formatPriceBreakdown(price2, fp2, np2, photoCount2);
      return {
        content: `📋 **Ваш заказ:**\n• Документ: **${document2}**\n• Тариф: **${tariff2}**\n• Сумма: ${priceText2}\n\n🖨 **Нужен печатный вид?** (+200₽)\nМы напечатаем и доставим готовые фото Почтой России.`,
        interactive: {
          type: 'buttons',
          step: 'order_confirmed',
          buttons: [
            {
              id: 'online_print_yes',
              label: '🖨 Да, печать (+200₽)',
              icon: 'print',
              value: 'online_print_yes',
              color: '#667eea',
              data: pendingOrder2,
            },
            {
              id: 'online_print_no',
              label: '📱 Нет, только электронный вид',
              icon: 'smartphone',
              value: 'online_print_no',
              color: '#11998e',
              data: pendingOrder2,
            },
            { id: 'add_comment', label: '✏️ Добавить пожелания', icon: 'edit', value: 'add_wishes', color: '#667eea' },
            { id: 'order_more', label: '📷 Заказать ещё', icon: 'add_photo_alternate', value: 'order_photo', color: '#11998e' },
            { id: 'edit_document', label: '◀ Изменить документ', icon: 'arrow_back', value: 'document_select', color: '#a8a8a8' },
          ],
        },
      };
    }

    // ===================== ОНЛАЙН: подтверждение адреса доставки =====================
    case 'online_confirm_address': {
      const metaAddrRes = await pool.query(`SELECT metadata, visitor_phone FROM conversations WHERE id = $1`, [sessionId]);
      const addrMeta = metaAddrRes.rows[0]?.metadata || {};
      const addrPhone = metaAddrRes.rows[0]?.visitor_phone || null;
      const confirmedAddress = addrMeta.deliveryAddress || '';
      const confirmedCost = addrMeta.deliveryCost || 0;
      return handleFinalizeOrder(sessionId, {
        pickup: `Доставка: ${confirmedAddress}`,
        production: 'Онлайн + печать',
        deliveryAddress: confirmedAddress,
        deliveryPostalCode: addrMeta.deliveryPostalCode,
        deliveryCost: confirmedCost,
        deliveryDaysMin: addrMeta.deliveryDaysMin,
        deliveryDaysMax: addrMeta.deliveryDaysMax,
      }, { metadata: addrMeta, visitor_phone: addrPhone });
    }

    // ===================== ОНЛАЙН: изменить адрес доставки =====================
    case 'online_change_address': {
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) - 'deliveryAddress' - 'deliveryPostalCode' - 'deliveryCost' - 'deliveryDaysMin' - 'deliveryDaysMax' || '{"deliveryStep": "online_awaiting_address"}'::jsonb WHERE id = $1`,
        [sessionId]
      );
      return {
        content: `📍 Укажите адрес доставки (город, улица, дом, квартира):`,
        interactive: {
          type: 'buttons',
          step: 'online_awaiting_address',
          buttons: [
            { id: 'online_cancel_print', label: '◀ Назад', icon: 'arrow_back', value: 'online_cancel_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Отмена доставки — возврат к выбору точки
    // ===================== ПРОПУСТИТЬ ТЕЛЕФОН =====================
    case 'skip_phone': {
      // Помечаем что телефон был спрошен (чтобы не зациклиться)
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"phoneAsked": true}'::jsonb WHERE id = $1`,
        [sessionId]
      );
      return proceedAfterPhone(sessionId);
    }

    case 'cancel_delivery': {
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) - 'deliveryStep' - 'deliveryAddress' WHERE id = $1`,
        [sessionId]
      );
      // Восстанавливаем данные заказа из метаданных
      const metaRes = await pool.query(`SELECT metadata FROM conversations WHERE id = $1`, [sessionId]);
      const pendingOrder = metaRes.rows[0]?.metadata?.pendingOrder;
      const price = pendingOrder?.price || 0;
      const service = pendingOrder?.service || pendingOrder?.tariff || 'Заказ';
      return {
        content: `📋 **${service}** — **${price}₽**\n\n📍 Где вы заберёте заказ?`,
        interactive: {
          type: 'buttons',
          step: 'pickup_select',
          buttons: await buildPickupButtons(),
        },
      };
    }

    case 'back_to_order_confirmed': {
      const backCtx = await getSessionContext(sessionId);
      const isReturningBack = await isReturningBasicCustomer(sessionId);
      const backSOpts = backCtx.selectedOptions || {};
      const hasNewFlow = Object.values(backSOpts).some((options) => Array.isArray(options) && options.length > 0);

      if (hasNewFlow) {
        const { text, buttons } = await buildOrderSummaryFromOptions({
          categorySlug: backCtx.categorySlug || 'photo-docs',
          selectedOptions: backSOpts,
          selectedDoc: backCtx.selectedDoc,
          photoCount: backCtx.photoCount,
          isReturning: isReturningBack,
        });
        return {
          content: text,
          interactive: {
            type: 'cards',
            step: 'order_confirmed',
            buttons,
            cards: [buildOrderCard(text, buttons)],
          },
        };
      }

      const tariff = backCtx.selectedTariff || '';
      const doc = backCtx.selectedDoc || '';
      const buttons = await buildOrderConfirmedButtons(
        tariff,
        doc,
        backCtx.orderNumber,
        backCtx.photoCount,
        isReturningBack,
      );
      const orderData = buttons[0]?.data || {};
      const price = (orderData['price'] as number) || await extractPrice(tariff, isReturningBack);
      const fp = (orderData['firstPrice'] as number) || price;
      const np = (orderData['nextPrice'] as number) || price;
      const priceText = formatPriceBreakdown(price, fp, np, backCtx.photoCount);

      return {
        content: `📋 **Ваш заказ:**\n• Документ: **${doc || '—'}**\n• Тариф: **${tariff || '—'}**\n• Фото: ${backCtx.photoCount} шт.\n• Сумма: ${priceText}\n\n🖨 **Нужен печатный вид?** (+200₽)`,
        interactive: {
          type: 'cards',
          step: 'order_confirmed',
          buttons,
          cards: [buildOrderCard(`📋 **Ваш заказ:**\n• Документ: **${doc || '—'}**\n• Тариф: **${tariff || '—'}**\n• Фото: ${backCtx.photoCount} шт.\n• Сумма: ${priceText}`, buttons)],
        },
      };
    }

    case 'order_photo':
    case 'choose_document':
    case 'document_select':
      // Сбрасываем апгрейд тарифа при начале нового заказа
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) - 'upgradedTariff' WHERE id = $1`,
        [sessionId]
      );
      // Обновляем кэш контекста: order_photo сбрасывает цикл заказа
      if (buttonValue === 'order_photo') {
        await pool.query(
          `UPDATE conversations SET context = jsonb_build_object(
            'hasPhoto', false, 'photoCount', 0, 'selectedDoc', null, 'selectedTariff', null,
            'orderCycles', COALESCE((context->>'orderCycles')::int, 0) + 1,
            'orderNumber', GREATEST(1, COALESCE((context->>'orderCycles')::int, 0) + 1)
          ) WHERE id = $1`,
          [sessionId]
        );
      }
      return {
        content: 'На какой документ вам нужно фото? Выберите из списка:',
        interactive: {
          type: 'document_select',
          step: 'document_select',
          buttons: [
            ...DOCUMENT_TYPES,
            { id: 'back_menu', label: '◀ Назад', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ],
        }
      };

    case 'view_prices': {
      const isReturningPrices = await isReturningBasicCustomer(sessionId);
      return {
        content: 'Выберите подходящий тариф:',
        interactive: {
          type: 'buttons',
          step: 'service_select',
          buttons: [
            ...await getServiceOptionsForCustomer(isReturningPrices),
            { id: 'back_menu', label: '◀ Назад', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ],
        }
      };
    }

    case 'view_examples':
      return {
        content: 'Посмотрите наши работы на странице:\n🔗 **svoefoto.ru/foto-na-document**\n\nТам есть раздел «До/После» с примерами по разным документам.\n\nХотите заказать?',
        interactive: {
          type: 'buttons',
          step: 'after_examples',
          buttons: [
            { id: 'yes_order', label: '✅ Да, хочу заказать', icon: 'check_circle', value: 'order_photo', color: '#667eea' },
            { id: 'back_menu', label: '◀ Назад', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ]
        }
      };

    case 'ask_question':
      return {
        content: 'Задайте ваш вопрос — мы ответим или подключим сотрудника. Вы также можете спросить:\n\n• Сколько времени занимает обработка?\n• Какие требования к фото?\n• Как оплатить?',
        interactive: {
          type: 'buttons',
          step: 'after_question',
          buttons: [
            { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ]
        }
      };

    // ===================== ДРУГИЕ УСЛУГИ =====================

    case 'other_services':
      return {
        content: 'Выберите категорию услуг:',
        interactive: {
          type: 'buttons',
          step: 'other_services',
          buttons: [
            { id: 'svc_neuro', label: '🧠 Нейрофотосессия — от 450₽', icon: 'psychology', value: 'svc_neuro', color: '#11998e' },
            { id: 'svc_restore', label: '🖼 Реставрация фото — от 450₽', icon: 'history', value: 'svc_restore', color: '#f093fb' },
            { id: 'svc_infographics', label: '📊 Инфографика для маркетплейсов', icon: 'analytics', value: 'svc_infographics', color: '#4facfe' },
            { id: 'svc_social', label: '📱 Оформление соцсетей', icon: 'share', value: 'svc_social', color: '#a18cd1' },
            { id: 'svc_polygraphy', label: '🖨 Дизайн полиграфии', icon: 'print', value: 'svc_polygraphy', color: '#fa709a' },
            { id: 'svc_vector', label: '✏️ Векторизация и иллюстрации', icon: 'gesture', value: 'svc_vector', color: '#ff9a9e' },
            { id: 'back_menu', label: '◀ Назад', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ]
        }
      };

    case 'svc_neuro':
      return {
        content: '🧠 **Нейрофотосессия** — AI-генерация уникальных образов по вашему фото:\n\n• Минимальный: 1 фото, 1 образ — **450₽**\n• Стандарт: 4 фото, 1 образ — **990₽**\n• Полный: 10–15 фото, 2–3 образа — **3000₽**\n\nОтправьте фото и укажите желаемый образ — мы сделаем!',
        interactive: {
          type: 'buttons',
          step: 'svc_detail',
          buttons: [
            { id: 'order_neuro', label: '✅ Хочу заказать', icon: 'check_circle', value: 'order_custom_service', color: '#11998e' },
            { id: 'back_services', label: '◀ Другие услуги', icon: 'arrow_back', value: 'other_services', color: '#a8a8a8' },
          ]
        }
      };

    case 'svc_restore':
      return {
        content: '🖼 **Реставрация фотографий** — восстановление старых и повреждённых снимков:\n\n• Простая (царапины, пятна) — **от 450₽**\n• Средняя (цвет, детали) — **от 900₽**\n• Сложная (полная реконструкция) — **от 1800₽**\n\nОтправьте фото — мы оценим сложность и назовём точную цену.',
        interactive: {
          type: 'buttons',
          step: 'svc_detail',
          buttons: [
            { id: 'order_restore', label: '✅ Отправить фото для оценки', icon: 'check_circle', value: 'order_custom_service', color: '#f093fb' },
            { id: 'back_services', label: '◀ Другие услуги', icon: 'arrow_back', value: 'other_services', color: '#a8a8a8' },
          ]
        }
      };

    case 'svc_infographics':
      return {
        content: '📊 **Инфографика для маркетплейсов** — карточки для WB и Ozon:\n\n• Главный слайд (обложка) — **от 1000₽**\n• Полная карточка (5–7 слайдов) — **от 3000₽**\n• Пакет 5 карточек — **от 12 000₽**\n• Комбо: фото + инфографика — **от 4000₽/артикул**\n\nРасскажите о товаре — подберём лучший вариант.',
        interactive: {
          type: 'buttons',
          step: 'svc_detail',
          buttons: [
            { id: 'order_infographics', label: '✅ Хочу заказать', icon: 'check_circle', value: 'order_custom_service', color: '#4facfe' },
            { id: 'back_services', label: '◀ Другие услуги', icon: 'arrow_back', value: 'other_services', color: '#a8a8a8' },
          ]
        }
      };

    case 'svc_social':
      return {
        content: '📱 **Оформление соцсетей** — дизайн для ВК, Instagram, YouTube:\n\n• ВКонтакте базовое (обложка, аватар) — **от 5000₽**\n• ВКонтакте полное (+меню, шаблоны) — **от 10 000₽**\n• Instagram комплект — **от 15 000₽**\n• YouTube/RuTube оформление — **от 8000₽**\n\nРасскажите о проекте — предложим решение.',
        interactive: {
          type: 'buttons',
          step: 'svc_detail',
          buttons: [
            { id: 'order_social', label: '✅ Хочу заказать', icon: 'check_circle', value: 'order_custom_service', color: '#a18cd1' },
            { id: 'back_services', label: '◀ Другие услуги', icon: 'arrow_back', value: 'other_services', color: '#a8a8a8' },
          ]
        }
      };

    case 'svc_polygraphy':
      return {
        content: '🖨 **Дизайн полиграфии** — макеты для печати:\n\n• Визитка — **от 1500₽**\n• Листовка / Флаер — **от 2000₽**\n• Буклет (2–3 сгиба) — **от 4000₽**\n• Меню для кафе — **от 5000₽**\n• Прайс-лист — **от 3000₽**\n\nВсе макеты готовы к печати в любой типографии.',
        interactive: {
          type: 'buttons',
          step: 'svc_detail',
          buttons: [
            { id: 'order_polygraphy', label: '✅ Хочу заказать', icon: 'check_circle', value: 'order_custom_service', color: '#fa709a' },
            { id: 'back_services', label: '◀ Другие услуги', icon: 'arrow_back', value: 'other_services', color: '#a8a8a8' },
          ]
        }
      };

    case 'svc_vector':
      return {
        content: '✏️ **Векторизация и иллюстрации:**\n\n• Перевод логотипа в вектор — **от 1000₽**\n• Сложная векторизация — **от 2000₽**\n• Набор иконок (10 шт.) — **от 3000₽**\n• Иллюстрация / Персонаж — **от 3000₽**',
        interactive: {
          type: 'buttons',
          step: 'svc_detail',
          buttons: [
            { id: 'order_vector', label: '✅ Хочу заказать', icon: 'check_circle', value: 'order_custom_service', color: '#ff9a9e' },
            { id: 'back_services', label: '◀ Другие услуги', icon: 'arrow_back', value: 'other_services', color: '#a8a8a8' },
          ]
        }
      };

    case 'order_custom_service':
      return {
        content: 'Отлично! Опишите, что вам нужно, или отправьте файлы/фото прямо в чат.\n\nНаш сотрудник подключится и обсудит детали с вами.',
        interactive: {
          type: 'buttons',
          step: 'custom_order',
          buttons: [
            { id: 'back_services', label: '◀ Другие услуги', icon: 'arrow_back', value: 'other_services', color: '#a8a8a8' },
            { id: 'back_menu', label: '◀ Главное меню', icon: 'home', value: 'main_menu', color: '#a8a8a8' },
          ]
        }
      };

    case 'add_wishes': {
      // Новый flow: просто спрашиваем текстовые пожелания
      return {
        content: 'Напишите пожелания к обработке 👇\n\nНапример: убрать родинку, причёску аккуратнее, другой цвет фона.',
        interactive: {
          type: 'buttons',
          step: 'wishes_text',
          buttons: [
            { id: 'skip_wishes', label: '👌 Без пожеланий', icon: 'check', value: 'skip_upsell', color: '#a8a8a8' },
            { id: 'back_to_order_confirmed', label: '◀ Назад к заказу', icon: 'arrow_back', value: 'back_to_order_confirmed', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'skip_upsell': {
      // После добавления пожеланий — показываем итог заказа
      const skipCtx = await getSessionContext(sessionId);
      const isReturningSkip = await isReturningBasicCustomer(sessionId);

      // Новый flow: selectedOptions
      const skipSOpts = skipCtx.selectedOptions || {};
      if (Object.values(skipSOpts).some((options) => Array.isArray(options) && options.length > 0)) {
        const { text, buttons } = await buildOrderSummaryFromOptions({
          categorySlug: skipCtx.categorySlug || 'photo-docs',
          selectedOptions: skipSOpts,
          selectedDoc: skipCtx.selectedDoc,
          photoCount: skipCtx.photoCount,
          isReturning: isReturningSkip,
        });
        return {
          content: `Хорошо! 👌\n\n${text}`,
          interactive: {
            type: 'cards',
            step: 'order_confirmed',
            buttons,
            cards: [buildOrderCard(text, buttons)],
          },
        };
      }

      // Старый flow: selectedTariff
      const skipTariff = skipCtx.selectedTariff || '';
      const skipButtons = await buildOrderConfirmedButtons(skipTariff, skipCtx.selectedDoc || '', skipCtx.orderNumber, skipCtx.photoCount, isReturningSkip);
      const skipOrderData = skipButtons[0].data || {};
      const skipPrice = (skipOrderData['price'] as number) || await extractPrice(skipTariff, isReturningSkip);
      const skipFp = (skipOrderData['firstPrice'] as number) || skipPrice;
      const skipNp = (skipOrderData['nextPrice'] as number) || skipPrice;
      const skipPriceText = formatPriceBreakdown(skipPrice, skipFp, skipNp, skipCtx.photoCount);

      return {
        content: `Хорошо! 👌\n\n📋 **Ваш заказ:**\n• Документ: **${skipCtx.selectedDoc || '—'}**\n• Тариф: **${skipTariff}**\n• Фото: ${skipCtx.photoCount} шт.\n• Сумма: ${skipPriceText}\n\n🖨 **Нужен печатный вид?** (+200₽)`,
        interactive: {
          type: 'cards',
          step: 'order_confirmed',
          buttons: skipButtons,
          cards: [buildOrderCard(`📋 **Ваш заказ:**\n• Документ: **${skipCtx.selectedDoc || '—'}**\n• Тариф: **${skipTariff}**\n• Фото: ${skipCtx.photoCount} шт.\n• Сумма: ${skipPriceText}`, skipButtons)],
        },
      };
    }

    case 'add_wishes_text':
      return {
        content: 'Напишите ваши пожелания к заказу — мы обязательно учтём при обработке 👇\n\nНапример: убрать родинку, сделать причёску аккуратнее, другой цвет фона.',
      };

    case 'send_photo':
      return {
        content: 'Отправьте ваше фото прямо сюда 📷\n\n**Советы для хорошего фото:**\n• Снимайте при естественном свете (у окна)\n• Держите камеру на уровне глаз\n• Смотрите прямо в объектив\n• Фон — желательно однотонный',
      };

    case 'add_to_cart': {
      const serviceId = buttonData?.['serviceId'] as string;
      if (!serviceId) return null;

      // Импортируем каталог из ai-actions
      const { CART_SERVICES } = await import('../../data/ai-actions.js');
      const svc = CART_SERVICES[serviceId];
      if (!svc) return null;

      // Phase 2: определяем delivery_method из сессии
      const sessionRes2 = await pool.query(
        `SELECT channel, entry_context FROM conversations WHERE id = $1`,
        [sessionId],
      );
      const row2 = sessionRes2.rows[0];
      const deliveryHint = row2?.entry_context?.delivery || (row2?.channel === 'studio' ? 'pickup' : 'electronic');
      const isStudioPrice = deliveryHint === 'pickup';

      // Для returning-клиентов: для basic действует обычная цена вместо стартового промо
      const isReturningCart = await isReturningBasicCustomer(sessionId);
      let price = isStudioPrice ? svc.studioPrice : svc.onlinePrice;
      const nextPrice = isStudioPrice ? (svc.nextStudioPrice ?? svc.studioPrice) : (svc.nextOnlinePrice ?? svc.onlinePrice);
      if (isReturningCart && !isStudioPrice && svc.nextOnlinePrice && price < svc.nextOnlinePrice) {
        price = svc.nextOnlinePrice;
      }

      return {
        content: `✅ **${svc.name}** — **${price}₽** добавлено в корзину!`,
        interactive: {
          type: 'buttons',
          step: 'cart_added',
          cartData: { name: svc.name, price, nextPrice, icon: svc.icon, serviceId },
          buttons: [
            { id: 'open_cart', label: `🛒 ${svc.name} — ${price}₽`, icon: 'shopping_cart', value: 'open_cart', color: '#22c55e' },
            { id: 'add_more', label: '➕ Ещё услуга', icon: 'add', value: 'main_menu', color: '#4facfe' },
          ],
        },
      };
    }

    case 'open_cart':
      {
        const sessionRes = await pool.query(
          `SELECT channel, entry_context FROM conversations WHERE id = $1`,
          [sessionId],
        );
        const row = sessionRes.rows[0];
        const isStudio = row?.entry_context?.delivery === 'pickup' || row?.channel === 'studio';
        const menuValue = isStudio ? 'studio_main_menu' : 'main_menu';

      return {
        content: '🛒 Открываю корзину...',
        interactive: {
          type: 'buttons',
          step: 'cart_opened',
          buttons: [
            { id: 'open_cart_btn', label: '🛒 Корзина', icon: 'shopping_cart', value: 'open_cart', color: '#22c55e' },
            { id: 'back_menu', label: '◀ В меню', icon: 'arrow_back', value: menuValue, color: '#a8a8a8' },
          ],
        },
      };
      }

    case 'main_menu':
      return {
        content: 'Чем могу помочь?',
        interactive: {
          type: 'buttons',
          step: 'main_menu',
          buttons: [
            { id: 'order_photo', label: '📷 Фото на документы', icon: 'photo_camera', value: 'order_photo', color: '#667eea' },
            { id: 'other_services', label: '🎨 Другие услуги', icon: 'design_services', value: 'other_services', color: '#11998e' },
            { id: 'view_prices', label: '💰 Цены на фото', icon: 'payments', value: 'view_prices', color: '#f093fb' },
            { id: 'ask_question', label: '❓ Задать вопрос', icon: 'help_outline', value: 'ask_question', color: '#4facfe' },
          ]
        }
      };

    // ===================== STUDIO CHANNEL =====================

    case 'studio_main_menu':
      return {
        content: 'Чем могу помочь?',
        interactive: {
          type: 'buttons',
          step: 'studio_main_menu',
          buttons: [
            { id: 'studio_book', label: '📅 Записаться онлайн', icon: 'event', value: 'studio_book_online', color: '#667eea' },
            { id: 'studio_route', label: '🗺 Проложить маршрут', icon: 'directions', value: 'studio_get_directions', color: '#11998e' },
            { id: 'studio_call', label: '📞 Позвонить', icon: 'phone', value: 'studio_call', color: '#4facfe' },
            { id: 'studio_print_docs', label: '🖨 Печать документов', icon: 'print', value: 'studio_print_docs', color: '#fa709a' },
            { id: 'studio_print_photos', label: '📸 Печать фотографий', icon: 'photo_library', value: 'studio_print_photos', color: '#a18cd1' },
            { id: 'studio_design', label: '🎨 Визитки и сувениры', icon: 'design_services', value: 'studio_order_design', color: '#f093fb' },
            { id: 'studio_question', label: '❓ Задать вопрос', icon: 'help_outline', value: 'ask_question', color: '#a8a8a8' },
          ]
        }
      };

    case 'studio_book_online':
      return {
        content: '📅 **Записаться в студию «Своё Фото»**\n\nВы можете записаться онлайн через наш сайт или прямо здесь в чате — просто напишите на какую услугу и когда хотите записаться!\n\nИли позвоните нам:\n📞 **8 (901) 417-86-68**\n\n⏰ Работаем: Пн–Вс 09:00–19:30',
        interactive: {
          type: 'buttons',
          step: 'studio_booking',
          buttons: [
            { id: 'book_link', label: '📅 Записаться на сайте', icon: 'event', value: 'open_link', color: '#667eea', url: '/booking' },
            { id: 'studio_call_btn', label: '📞 Позвонить', icon: 'phone', value: 'studio_call', color: '#4facfe' },
            { id: 'back_studio', label: '◀ Назад', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ]
        }
      };

    case 'studio_get_directions':
      return {
        content: '🗺 **Как добраться в студию «Своё Фото»**\n\n**📍 Пер. Соборный 21**\nЕжедневно 09:00–19:30\n\nВыберите навигатор:',
        interactive: {
          type: 'buttons',
          step: 'studio_directions',
          buttons: [
            { id: 'map_yandex', label: '🗺 Яндекс Карты', icon: 'map', value: 'open_link', color: '#fc3f1d', url: 'https://yandex.ru/maps/-/CHaIjZP9' },
            { id: 'map_2gis', label: '🗺 2ГИС', icon: 'map', value: 'open_link', color: '#1da838', url: 'https://2gis.ru/rostov-on-don/firm/70000001006548410' },
            { id: 'back_studio', label: '◀ Назад', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ]
        }
      };

    case 'studio_call':
      return {
        content: '📞 **Позвоните нам:**\n\n☎️ **8 (901) 417-86-68**\n\n⏰ Работаем: Пн–Вс 09:00–19:30\n\nМы всегда рады ответить на ваши вопросы!',
        interactive: {
          type: 'buttons',
          step: 'studio_call_info',
          buttons: [
            { id: 'call_link', label: '📞 Позвонить сейчас', icon: 'phone', value: 'open_link', color: '#4facfe', url: 'tel:+79014178668' },
            { id: 'back_studio', label: '◀ Назад', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ]
        }
      };

    case 'studio_print_docs': {
      // Реальные цены из Контур Маркет
      const docPrices = await getKonturPrices();
      const bwA4 = findPriceNum(docPrices, 'А4 Печать документа') || 10;
      const colorA4 = findPriceNum(docPrices, 'А4 Печать документа цветная') || 15;
      const bwA3 = findPriceNum(docPrices, 'А3 печать документа') || 17;
      const scanPrice = findPriceNum(docPrices, 'Сканирование') || 50;
      const copyA4 = findPriceNum(docPrices, 'А4 Ксерокопия') || 10;
      const copyA4color = findPriceNum(docPrices, 'А4 Ксерокопия Цветная') || 15;
      const copyA3 = findPriceNum(docPrices, 'А3 Ксерокопия') || 17;
      const lam = findPriceNum(docPrices, 'Ламинирование') || 100;
      const selfAdhesive = findPriceNum(docPrices, 'Самоклеющейся') || 80;

      return {
        content: `🖨 **Печать документов** — быстро и качественно:\n\n• Ч/б печать А4 — **${bwA4}₽/стр.**\n• Цветная печать А4 — **${colorA4}₽/стр.**\n• Ч/б печать А3 — **${bwA3}₽/стр.**\n• Ксерокопия А4 ч/б — **${copyA4}₽/стр.**\n• Ксерокопия А4 цвет — **${copyA4color}₽/стр.**\n• Ксерокопия А3 — **${copyA3}₽/стр.**\n• Сканирование — **${scanPrice}₽**\n• Ламинирование — **${lam}₽**\n• На самоклеющейся бумаге — **${selfAdhesive}₽**\n\n📍 Приходите в любую нашу студию!`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_docs_info',
          buttons: [
            { id: 'studio_book_btn', label: '📅 Записаться', icon: 'event', value: 'studio_book_online', color: '#667eea' },
            { id: 'studio_route_btn', label: '🗺 Проложить маршрут', icon: 'directions', value: 'studio_get_directions', color: '#11998e' },
            { id: 'back_studio', label: '◀ Назад', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_print_photos': {
      // Реальные цены из Контур Маркет
      const photoPrices = await getKonturPrices();
      const p10x15 = findPriceNum(photoPrices, 'Фото 10x15 премиум') || 20;
      const p15x20 = findPriceNum(photoPrices, 'Фото 15x20 премиум') || 49;
      const p20x30 = findPriceNum(photoPrices, 'Фото 20x30 премиум') || 117;
      const p30x40 = findPriceNum(photoPrices, '30x40 печать фото') || 450;
      const p40x50 = findPriceNum(photoPrices, '40x50 печать фото') || 600;
      const pDoc = findPriceNum(photoPrices, 'Фото на документы') || findPriceNum(photoPrices, 'Фото на паспорт') || 700;
      const canvas30 = findPriceNum(photoPrices, 'Печать на холсте 30x40') || 2200;
      const pMemorial = findPriceNum(photoPrices, 'Фото на памятник') || 1000;

      return {
        content: `📸 **Печать фотографий** — профессиональное качество:\n\n• 10×15 см — **${p10x15}₽/шт.**\n• 15×20 см — **${p15x20}₽/шт.**\n• 20×30 см — **${p20x30}₽/шт.**\n• 30×40 см — **${p30x40}₽/шт.**\n• 40×50 см — **${p40x50}₽/шт.**\n• Фото на документы — **${pDoc}₽** (комплект)\n• Фото на памятник — **${pMemorial}₽**\n• Печать на холсте — **от ${canvas30}₽**\n\n📍 Принесите фото на флешке или отправьте прямо в чат!`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_photos_info',
          buttons: [
            { id: 'studio_upload_photo', label: '📷 Отправить фото в чат', icon: 'add_photo_alternate', value: 'studio_upload_more', color: '#667eea' },
            { id: 'studio_book_btn', label: '📅 Записаться', icon: 'event', value: 'studio_book_online', color: '#11998e' },
            { id: 'studio_route_btn', label: '🗺 Проложить маршрут', icon: 'directions', value: 'studio_get_directions', color: '#4facfe' },
            { id: 'back_studio', label: '◀ Назад', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_order_design': {
      // Реальные цены из Контур Маркет (обновлены)
      const designPrices = await getKonturPrices();
      const vizDesign = findPriceNum(designPrices, 'Дизайн визитки') || 500;
      const vizBumaga = findPriceNum(designPrices, 'Визитки (бумага) 100') || 600;
      const vizPlastic = findPriceNum(designPrices, 'Визитки (пластик)') || 1000;
      const flyerDesign = findPriceNum(designPrices, 'Дизайн листовки') || 1000;
      const brochureDesign = findPriceNum(designPrices, 'Дизайн буклета') || 2000;
      const menuDesign = findPriceNum(designPrices, 'Дизайн меню') || 2500;
      const pricelistDesign = findPriceNum(designPrices, 'Дизайн прайс') || 1000;
      const printMug = findPriceNum(designPrices, 'Печать на кружках') || 390;
      const printTshirt = findPriceNum(designPrices, 'Печать на футболке') || 590;

      return {
        content: '🎨 **Дизайн, визитки и сувениры:**\n\nВыберите, что вам нужно:',
        interactive: {
          type: 'buttons',
          step: 'studio_design_menu',
          buttons: [
            { id: 'design_viz', label: `💼 Дизайн визитки — ${vizDesign}₽`, icon: 'badge', value: 'studio_design_viz', color: '#667eea' },
            { id: 'design_card', label: `🖨 Визитки бумага 100 шт. — ${vizBumaga}₽`, icon: 'print', value: 'studio_design_cards', color: '#11998e' },
            { id: 'design_plastic', label: `💳 Визитки пластик 50 шт. — ${vizPlastic}₽`, icon: 'credit_card', value: 'studio_design_plastic', color: '#a18cd1' },
            { id: 'design_flyer', label: `📄 Дизайн листовки — ${flyerDesign}₽`, icon: 'description', value: 'studio_design_flyer', color: '#f093fb' },
            { id: 'design_brochure', label: `📖 Дизайн буклета — ${brochureDesign}₽`, icon: 'menu_book', value: 'studio_design_brochure', color: '#fa709a' },
            { id: 'design_menu', label: `🍽 Дизайн меню — ${menuDesign}₽`, icon: 'restaurant_menu', value: 'studio_design_menu_item', color: '#4facfe' },
            { id: 'design_pricelist', label: `📋 Дизайн прайс-листа — ${pricelistDesign}₽`, icon: 'list_alt', value: 'studio_design_pricelist', color: '#22c55e' },
            { id: 'design_mug', label: `☕ Печать на кружках — ${printMug}₽`, icon: 'coffee', value: 'studio_print_mug', color: '#f093fb' },
            { id: 'design_tshirt', label: `👕 Печать на футболке — ${printTshirt}₽`, icon: 'checkroom', value: 'studio_print_tshirt', color: '#fa709a' },
            { id: 'back_studio', label: '◀ Назад', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ]
        }
      };
    }

    // Дизайн-услуги из Контур Маркет (новые)
    case 'studio_design_viz':
    case 'studio_design_flyer':
    case 'studio_design_brochure':
    case 'studio_design_menu_item':
    case 'studio_design_pricelist': {
      const designServiceMap: Record<string, { konturKey: string; label: string; fallbackPrice: number; desc: string }> = {
        'studio_design_viz': { konturKey: 'Дизайн визитки', label: 'Дизайн визитки', fallbackPrice: 500, desc: 'Разработка макета визитки. Отправьте логотип и контактные данные — мы подготовим дизайн!' },
        'studio_design_flyer': { konturKey: 'Дизайн листовки', label: 'Дизайн листовки/флаера', fallbackPrice: 1000, desc: 'Разработка дизайна листовки или флаера. Опишите задачу — мы предложим дизайн!' },
        'studio_design_brochure': { konturKey: 'Дизайн буклета', label: 'Дизайн буклета', fallbackPrice: 2000, desc: 'Разработка дизайна буклета. Расскажите о проекте — подберём формат!' },
        'studio_design_menu_item': { konturKey: 'Дизайн меню', label: 'Дизайн меню для кафе', fallbackPrice: 2500, desc: 'Дизайн меню для кафе/ресторана. Пришлите текст меню — мы оформим в стильный макет!' },
        'studio_design_pricelist': { konturKey: 'Дизайн прайс', label: 'Дизайн прайс-листа', fallbackPrice: 1000, desc: 'Разработка дизайна прайс-листа. Отправьте список услуг/товаров — мы оформим!' },
      };
      const ds = designServiceMap[buttonValue] || designServiceMap['studio_design_viz'];
      const dsPrices = await getKonturPrices();
      const dsPrice = findPriceNum(dsPrices, ds.konturKey) || ds.fallbackPrice;

      return {
        content: `🎨 **${ds.label}** — **${dsPrice}₽**\n\n${ds.desc}`,
        interactive: {
          type: 'buttons',
          step: 'studio_design_detail',
          buttons: [
            { id: 'pay_design', label: `💳 Оплатить ${dsPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: dsPrice, tariff: ds.label, service: ds.label, delivery_method: 'pickup' } },
            { id: 'back_design', label: '◀ Назад', icon: 'arrow_back', value: 'studio_order_design', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_design_cards': {
      const cardPrices = await getKonturPrices();
      const cardPrice = findPriceNum(cardPrices, 'Визитки (бумага) 100') || 600;
      return {
        content: `💼 **Визитки на бумаге — 100 шт.** — **${cardPrice}₽**\n\nМы разработаем дизайн и напечатаем визитки.\n\nОтправьте логотип и контактные данные — мы подготовим макет!`,
        interactive: {
          type: 'buttons',
          step: 'studio_design_detail',
          buttons: [
            { id: 'pay_cards', label: `💳 Оплатить ${cardPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: cardPrice, tariff: 'Визитки (бумага) 100 шт.', service: 'Визитки на бумаге 100 шт.', delivery_method: 'pickup' } },
            { id: 'back_design', label: '◀ Назад', icon: 'arrow_back', value: 'studio_order_design', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_design_plastic': {
      const plasticPrices = await getKonturPrices();
      const plasticPrice = findPriceNum(plasticPrices, 'Визитки (пластик)') || 1000;
      return {
        content: `💳 **Визитки на пластике — 50 шт.** — **${plasticPrice}₽**\n\nПремиальные пластиковые визитки.\n\nОтправьте логотип и контактные данные!`,
        interactive: {
          type: 'buttons',
          step: 'studio_design_detail',
          buttons: [
            { id: 'pay_plastic', label: `💳 Оплатить ${plasticPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: plasticPrice, tariff: 'Визитки (пластик) 50 шт.', service: 'Визитки на пластике 50 шт.', delivery_method: 'pickup' } },
            { id: 'back_design', label: '◀ Назад', icon: 'arrow_back', value: 'studio_order_design', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_design_samples': {
      const samplesPrices = await getKonturPrices();
      const samplesPrice = findPriceNum(samplesPrices, 'Визитки (образцы)') || 100;
      return {
        content: `📋 **Образцы визиток — 2 шт.** — **${samplesPrice}₽**\n\nПробная печать перед заказом тиража.`,
        interactive: {
          type: 'buttons',
          step: 'studio_design_detail',
          buttons: [
            { id: 'pay_samples', label: `💳 Оплатить ${samplesPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: samplesPrice, tariff: 'Визитки (образцы) 2 шт.', service: 'Образцы визиток 2 шт.', delivery_method: 'pickup' } },
            { id: 'back_design', label: '◀ Назад', icon: 'arrow_back', value: 'studio_order_design', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_print_mug': {
      const mugPrices = await getKonturPrices();
      const mugPrice = findPriceNum(mugPrices, 'Печать на кружках') || 390;
      return {
        content: `☕ **Печать на кружках** — **${mugPrice}₽**\n\nПерсонализированная кружка с вашим дизайном или фото.\n\nОтправьте изображение в чат!`,
        interactive: {
          type: 'buttons',
          step: 'studio_design_detail',
          buttons: [
            { id: 'pay_mug', label: `💳 Оплатить ${mugPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: mugPrice, tariff: 'Печать на кружках', service: 'Печать на кружке', delivery_method: 'pickup' } },
            { id: 'back_design', label: '◀ Назад', icon: 'arrow_back', value: 'studio_order_design', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_print_tshirt': {
      const tshirtPrices = await getKonturPrices();
      const tshirtPrice = findPriceNum(tshirtPrices, 'Печать на футболке') || 590;
      return {
        content: `👕 **Печать на футболке** — **${tshirtPrice}₽**\n\nВаш дизайн или фото на футболке.\n\nОтправьте изображение в чат!`,
        interactive: {
          type: 'buttons',
          step: 'studio_design_detail',
          buttons: [
            { id: 'pay_tshirt', label: `💳 Оплатить ${tshirtPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: tshirtPrice, tariff: 'Печать на футболке', service: 'Печать на футболке', delivery_method: 'pickup' } },
            { id: 'back_design', label: '◀ Назад', icon: 'arrow_back', value: 'studio_order_design', color: '#a8a8a8' },
          ]
        }
      };
    }

    case 'studio_print_card': {
      const cardPrintPrices = await getKonturPrices();
      const cardPrintPrice = findPriceNum(cardPrintPrices, 'Печать на карточке') || 120;
      return {
        content: `🃏 **Печать на карточке** — **${cardPrintPrice}₽**\n\nПерсонализированная карточка с вашим дизайном.`,
        interactive: {
          type: 'buttons',
          step: 'studio_design_detail',
          buttons: [
            { id: 'pay_card_print', label: `💳 Оплатить ${cardPrintPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: cardPrintPrice, tariff: 'Печать на карточке', service: 'Печать на карточке', delivery_method: 'pickup' } },
            { id: 'back_design', label: '◀ Назад', icon: 'arrow_back', value: 'studio_order_design', color: '#a8a8a8' },
          ]
        }
      };
    }

    // ===================== STUDIO PHOTO ACTIONS (после загрузки фото) =====================

    case 'studio_upload_more':
      return {
        content: '📷 Отлично! Загрузите ещё фото прямо в чат.\n\nПосле загрузки я предложу выбрать действие для каждого.',
        interactive: undefined,
      };

    case 'studio_photo_print': {
      const pp = await getKonturPrices();
      // Подсчитаем фото в сессии
      const pcRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
        [sessionId]
      );
      const pc = parseInt(pcRes.rows[0].cnt, 10);

      // Показываем минимальные цены (Премиум дешевле Супер)
      const p10x15min = findPriceNum(pp, 'Фото 10x15 премиум') || 20;
      const p15x20min = findPriceNum(pp, 'Фото 15x20 премиум') || 49;
      const p20x30min = findPriceNum(pp, 'Фото 20x30 премиум') || 117;
      const p30x40 = findPriceNum(pp, '30x40 печать фото') || 450;
      const p40x50 = findPriceNum(pp, '40x50 печать фото') || 600;

      return {
        content: `🖨 **Печать фотографий**\n\n📷 Загружено фото: **${pc} шт.**\n\nВыберите размер печати:`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_size',
          buttons: [
            { id: 'ps_10x15', label: `10×15 см — от ${p10x15min}₽/шт.`, icon: 'photo_size_select_small', value: 'studio_psize_10x15', color: '#667eea' },
            { id: 'ps_15x20', label: `15×20 см — от ${p15x20min}₽/шт.`, icon: 'photo_size_select_large', value: 'studio_psize_15x20', color: '#11998e' },
            { id: 'ps_20x30', label: `20×30 см — от ${p20x30min}₽/шт.`, icon: 'photo', value: 'studio_psize_20x30', color: '#f093fb' },
            { id: 'ps_30x40', label: `30×40 см — ${p30x40}₽/шт.`, icon: 'panorama', value: 'studio_psize_30x40', color: '#fa709a' },
            { id: 'ps_40x50', label: `40×50 см — ${p40x50}₽/шт.`, icon: 'crop_free', value: 'studio_psize_40x50', color: '#a18cd1' },
            { id: 'ps_custom', label: '📐 Другой размер', icon: 'aspect_ratio', value: 'studio_psize_custom', color: '#4facfe' },
            { id: 'back_photo_action', label: '◀ Назад', icon: 'arrow_back', value: 'studio_photo_action_back', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Размеры 10x15, 15x20, 20x30 — есть выбор Премиум/Супер
    case 'studio_psize_10x15':
    case 'studio_psize_15x20':
    case 'studio_psize_20x30': {
      const sizeTypeMap: Record<string, { size: string; sizeKey: string }> = {
        'studio_psize_10x15': { size: '10×15', sizeKey: '10x15' },
        'studio_psize_15x20': { size: '15×20', sizeKey: '15x20' },
        'studio_psize_20x30': { size: '20×30', sizeKey: '20x30' },
      };
      const stInfo = sizeTypeMap[buttonValue] || sizeTypeMap['studio_psize_10x15'];
      const ptPrices = await getKonturPrices();
      const premPrice = findPriceNum(ptPrices, `Фото ${stInfo.sizeKey} премиум`) || 20;
      const superPrice = findPriceNum(ptPrices, `Фото ${stInfo.sizeKey} супер`) || 36;

      return {
        content: `📷 Размер: **${stInfo.size} см**\n\nВыберите тип бумаги:`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_type',
          buttons: [
            { id: 'pt_premium', label: `⭐ Премиум — ${premPrice}₽/шт.`, icon: 'star', value: `studio_ptype_${stInfo.sizeKey}_premium`, color: '#667eea', data: { size: stInfo.size, type: 'Премиум', unitPrice: premPrice, konturKey: `Фото ${stInfo.sizeKey} премиум` } },
            { id: 'pt_super', label: `💎 Супер — ${superPrice}₽/шт.`, icon: 'diamond', value: `studio_ptype_${stInfo.sizeKey}_super`, color: '#f093fb', data: { size: stInfo.size, type: 'Супер', unitPrice: superPrice, konturKey: `Фото ${stInfo.sizeKey} супер` } },
            { id: 'back_size', label: '◀ Другой размер', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Размеры 30x40, 40x50 — только один тип, сразу к копиям
    case 'studio_psize_30x40':
    case 'studio_psize_40x50': {
      const sizeMapLarge: Record<string, { size: string; konturKey: string; fallbackPrice: number }> = {
        'studio_psize_30x40': { size: '30×40', konturKey: '30x40 печать фото', fallbackPrice: 450 },
        'studio_psize_40x50': { size: '40×50', konturKey: '40x50 печать фото', fallbackPrice: 600 },
      };
      const sizeInfo = sizeMapLarge[buttonValue] || sizeMapLarge['studio_psize_30x40'];
      const pricesPrint = await getKonturPrices();
      const unitPrice = findPriceNum(pricesPrint, sizeInfo.konturKey) || sizeInfo.fallbackPrice;

      // Считаем фото
      const pcRes2 = await pool.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
        [sessionId]
      );
      const photosCnt = parseInt(pcRes2.rows[0].cnt, 10);

      const lgData = { size: sizeInfo.size, unitPrice, photosCount: photosCnt, printType: '' };
      return {
        content: `✅ Размер: **${sizeInfo.size} см** — **${unitPrice}₽/шт.**\n\n📷 Загружено фото: **${photosCnt} шт.**\n\nКак печатать?`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_borders',
          buttons: [
            { id: 'br_without', label: '🖼 Без полей — фото на весь лист', icon: 'fullscreen', value: 'studio_borders_without', color: '#667eea', data: { ...lgData, borders: 'без полей' } },
            { id: 'br_with', label: '🔲 С полями — фото целиком, белые края', icon: 'border_all', value: 'studio_borders_with', color: '#11998e', data: { ...lgData, borders: 'с полями' } },
            { id: 'back_size', label: '◀ Другой размер', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Обработка выбора типа бумаги (Премиум/Супер) — переход к выбору полей
    case 'studio_ptype_10x15_premium':
    case 'studio_ptype_10x15_super':
    case 'studio_ptype_15x20_premium':
    case 'studio_ptype_15x20_super':
    case 'studio_ptype_20x30_premium':
    case 'studio_ptype_20x30_super': {
      // Парсим размер и тип из value: studio_ptype_10x15_premium
      const ptParts = buttonValue.replace('studio_ptype_', '').split('_');
      const ptType = ptParts.pop() === 'super' ? 'Супер' : 'Премиум';
      const ptSizeKey = ptParts.join('_'); // 10x15
      const ptSizeDisplay = ptSizeKey.replace('x', '×');
      const ptKonturKey = `Фото ${ptSizeKey} ${ptType === 'Супер' ? 'супер' : 'премиум'}`;

      const ptPrices = await getKonturPrices();
      const ptUnitPrice = findPriceNum(ptPrices, ptKonturKey) || (ptType === 'Супер' ? 36 : 20);

      // Считаем фото
      const ptPhotosRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
        [sessionId]
      );
      const ptPhotos = parseInt(ptPhotosRes.rows[0].cnt, 10);

      // Проверяем, был ли нестандартный размер (customSize в data предыдущего шага)
      let ptCustomSize = '';
      const ptPrevMsgs = await pool.query(
        `SELECT metadata FROM messages
         WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
         ORDER BY created_at DESC LIMIT 3`,
        [sessionId]
      );
      for (const row of ptPrevMsgs.rows) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          const btns = meta?.interactive?.buttons;
          if (btns) {
            const ptBtn = btns.find((b: StoredInteractiveButton) => b.value === buttonValue && b.data?.['customSize']);
            if (ptBtn) {
              ptCustomSize = ptBtn.data.customSize as string;
              break;
            }
          }
        } catch { /* skip */ }
      }

      const ptData = { size: ptSizeDisplay, unitPrice: ptUnitPrice, photosCount: ptPhotos, printType: ptType, customSize: ptCustomSize };

      // Если нестандартный размер — сразу спрашиваем про обрезку (поля бессмысленны)
      if (ptCustomSize && ptCustomSize !== ptSizeDisplay) {
        const cutPricePerPrint = 10;
        return {
          content: `✅ Размер: **${ptSizeDisplay} см** | Тип: **${ptType}** — **${ptUnitPrice}₽/шт.**\n\n✂️ Ваш размер **${ptCustomSize} см** — печатается на формате **${ptSizeDisplay} см**.\n\nОбрезать до ${ptCustomSize} см? Стоимость: **${cutPricePerPrint}₽/шт.**`,
          interactive: {
            type: 'buttons',
            step: 'studio_print_cutting',
            buttons: [
              { id: 'cut_yes', label: `✂️ Да, обрезать до ${ptCustomSize} (+${cutPricePerPrint}₽/шт.)`, icon: 'content_cut', value: 'studio_cut_yes', color: '#f093fb', data: { ...ptData, borders: '', cuttingPrice: cutPricePerPrint } },
              { id: 'cut_no', label: `📐 Нет, оставить ${ptSizeDisplay} см`, icon: 'check_box_outline_blank', value: 'studio_cut_no', color: '#667eea', data: { ...ptData, borders: '', cuttingPrice: 0 } },
              { id: 'back_type', label: '◀ Другой тип', icon: 'arrow_back', value: `studio_psize_${ptSizeKey}`, color: '#a8a8a8' },
            ],
          },
        };
      }

      // Стандартный размер — спрашиваем про поля
      return {
        content: `✅ Размер: **${ptSizeDisplay} см** | Тип: **${ptType}** — **${ptUnitPrice}₽/шт.**\n\nКак печатать?`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_borders',
          buttons: [
            { id: 'br_without', label: '🖼 Без полей — фото на весь лист', icon: 'fullscreen', value: 'studio_borders_without', color: '#667eea', data: { ...ptData, borders: 'без полей' } },
            { id: 'br_with', label: '🔲 С полями — фото целиком, белые края', icon: 'border_all', value: 'studio_borders_with', color: '#11998e', data: { ...ptData, borders: 'с полями' } },
            { id: 'back_type', label: '◀ Другой тип', icon: 'arrow_back', value: `studio_psize_${ptSizeKey}`, color: '#a8a8a8' },
          ],
        },
      };
    }

    // ========== Обработка выбора полей ==========
    case 'studio_borders_with':
    case 'studio_borders_without': {
      // Достаём данные из кнопки (data в metadata предыдущего сообщения)
      const brMsgs = await pool.query(
        `SELECT metadata FROM messages
         WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
         ORDER BY created_at DESC LIMIT 3`,
        [sessionId]
      );
      let brSize = '10×15';
      let brUnitPrice = 20;
      let brPhotos = 1;
      let brPrintType = '';
      let brBorders = buttonValue === 'studio_borders_with' ? 'с полями' : 'без полей';

      for (const row of brMsgs.rows) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          const btns = meta?.interactive?.buttons;
          if (btns) {
            const dataBtn = btns.find((b: StoredInteractiveButton) => b.data?.['size'] && b.data?.['unitPrice'] && b.value?.startsWith('studio_borders_'));
            if (dataBtn) {
              brSize = dataBtn.data.size as string;
              brUnitPrice = dataBtn.data.unitPrice as number;
              brPhotos = (dataBtn.data.photosCount as number) || 1;
              brPrintType = (dataBtn.data.printType as string) || '';
              break;
            }
          }
        } catch { /* skip */ }
      }

      // Поля выбраны — сразу к копиям (обрезка сюда не попадает, она обрабатывается до полей)
      return buildCopiesStep(brSize, brUnitPrice, brPhotos, brPrintType, brBorders, 0);
    }

    // ========== Обработка обрезки ==========
    case 'studio_cut_yes': {
      // Обрезка — сразу к копиям (поля не нужны, фото будет обрезано до нужного размера)
      const cutYesMsgs = await pool.query(
        `SELECT metadata FROM messages
         WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
         ORDER BY created_at DESC LIMIT 3`,
        [sessionId]
      );
      let cySize = '10×15'; let cyPrice = 20; let cyPhotos = 1; let cyType = ''; let cyCutPrice = 10;
      for (const row of cutYesMsgs.rows) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          const btns = meta?.interactive?.buttons;
          if (btns) {
            const dataBtn = btns.find((b: StoredInteractiveButton) => b.data?.['size'] && b.value === 'studio_cut_yes');
            if (dataBtn) {
              cySize = dataBtn.data.size as string;
              cyPrice = dataBtn.data.unitPrice as number;
              cyPhotos = (dataBtn.data.photosCount as number) || 1;
              cyType = (dataBtn.data.printType as string) || '';
              cyCutPrice = (dataBtn.data.cuttingPrice as number) || 10;
              break;
            }
          }
        } catch { /* skip */ }
      }
      return buildCopiesStep(cySize, cyPrice, cyPhotos, cyType, '', cyCutPrice);
    }

    case 'studio_cut_no': {
      // Без обрезки → оставляем стандартный формат → спрашиваем про поля
      const cutNoMsgs = await pool.query(
        `SELECT metadata FROM messages
         WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
         ORDER BY created_at DESC LIMIT 3`,
        [sessionId]
      );
      let cnSize = '10×15'; let cnPrice = 20; let cnPhotos = 1; let cnType = '';
      for (const row of cutNoMsgs.rows) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          const btns = meta?.interactive?.buttons;
          if (btns) {
            const dataBtn = btns.find((b: StoredInteractiveButton) => b.data?.['size'] && b.value === 'studio_cut_no');
            if (dataBtn) {
              cnSize = dataBtn.data.size as string;
              cnPrice = dataBtn.data.unitPrice as number;
              cnPhotos = (dataBtn.data.photosCount as number) || 1;
              cnType = (dataBtn.data.printType as string) || '';
              break;
            }
          }
        } catch { /* skip */ }
      }
      const cnTypeLabel = cnType ? ` (${cnType})` : '';
      const cnData = { size: cnSize, unitPrice: cnPrice, photosCount: cnPhotos, printType: cnType };
      return {
        content: `📐 Печатаем на формате **${cnSize} см**${cnTypeLabel} — **${cnPrice}₽/шт.**\n\nКак печатать?`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_borders',
          buttons: [
            { id: 'br_without', label: '🖼 Без полей — фото на весь лист', icon: 'fullscreen', value: 'studio_borders_without', color: '#667eea', data: { ...cnData, borders: 'без полей' } },
            { id: 'br_with', label: '🔲 С полями — фото целиком, белые края', icon: 'border_all', value: 'studio_borders_with', color: '#11998e', data: { ...cnData, borders: 'с полями' } },
            { id: 'back_size', label: '◀ Другой размер', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_psize_custom':
      return {
        content: '📐 **Нестандартный размер**\n\nВведите размер в сантиметрах, например: `13x18` или `50x70`\n\nБот автоматически подберёт ближайший подходящий формат и рассчитает стоимость.',
        interactive: {
          type: 'buttons',
          step: 'studio_input_custom_size',
          buttons: [
            { id: 'back_size', label: '◀ Стандартные размеры', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };

    case 'studio_copies_custom': {
      // Достаём данные о размере/цене из последнего выбора (включая borders/cutting)
      const ccLastMsg = await pool.query(
        `SELECT metadata FROM messages
         WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
         ORDER BY created_at DESC LIMIT 5`,
        [sessionId]
      );
      let ccSize = '10×15';
      let ccUnitPrice = 20;
      let ccPhotos = 1;
      let ccPrintType = '';
      let ccBorders = '';
      let ccCuttingPrice = 0;
      let ccBasePrintPrice = 20;
      for (const row of ccLastMsg.rows) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          const btns = meta?.interactive?.buttons;
          if (btns) {
            const dataBtn = btns.find((b: StoredInteractiveButton) => b.data?.['size'] && b.data?.['unitPrice'] && (b.value?.startsWith('studio_copies_') || b.value === 'studio_copies_custom'));
            if (dataBtn) {
              ccSize = dataBtn.data.size;
              ccUnitPrice = dataBtn.data.unitPrice;
              ccPhotos = dataBtn.data.photosCount || 1;
              ccPrintType = dataBtn.data.printType || '';
              ccBorders = dataBtn.data.borders || '';
              ccCuttingPrice = dataBtn.data.cuttingPrice || 0;
              ccBasePrintPrice = dataBtn.data.basePrintPrice || ccUnitPrice;
              break;
            }
          }
        } catch { /* skip */ }
      }
      const ccTypeLabel = ccPrintType ? ` (${ccPrintType})` : '';
      const ccBordersInfo = ccBorders ? ` | ${ccBorders}` : '';
      const ccCutInfo = ccCuttingPrice > 0 ? ` | +${ccCuttingPrice}₽ обрезка` : '';
      return {
        content: `✏️ **Введите количество копий**\n\n📷 Размер: **${ccSize} см**${ccTypeLabel}${ccBordersInfo}${ccCutInfo} — **${ccUnitPrice}₽/шт.**\n📷 Фото: **${ccPhotos} шт.**\n\nВведите число (например: \`7\` или \`25\`):`,
        interactive: {
          type: 'buttons',
          step: 'studio_input_copies',
          buttons: [
            { id: 'back_copies', label: '◀ Стандартное количество', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_copies_1':
    case 'studio_copies_2':
    case 'studio_copies_3':
    case 'studio_copies_5':
    case 'studio_copies_10': {
      // Парсим кол-во копий из value
      const copiesMap: Record<string, number> = {
        'studio_copies_1': 1, 'studio_copies_2': 2, 'studio_copies_3': 3,
        'studio_copies_5': 5, 'studio_copies_10': 10,
      };
      const copies = copiesMap[buttonValue] || 1;

      // Получаем данные из кнопки (data) — теперь включает borders + cuttingPrice
      const lastSizeMsg = await pool.query(
        `SELECT metadata FROM messages
         WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
         ORDER BY created_at DESC LIMIT 5`,
        [sessionId]
      );

      let printSize = '10×15';
      let unitPrice = 20; // effectivePrice (уже с обрезкой)
      let basePrintPrice = 20;
      let printType = '';
      let borders = '';
      let cuttingPrice = 0;
      for (const row of lastSizeMsg.rows) {
        try {
          const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
          const btns = meta?.interactive?.buttons;
          if (btns) {
            const sizeBtn = btns.find((b: StoredInteractiveButton) => b.data?.['size'] && b.data?.['unitPrice'] && b.value?.startsWith('studio_copies_'));
            if (sizeBtn) {
              printSize = sizeBtn.data.size;
              unitPrice = sizeBtn.data.unitPrice;
              basePrintPrice = sizeBtn.data.basePrintPrice || unitPrice;
              printType = sizeBtn.data.printType || '';
              borders = sizeBtn.data.borders || '';
              cuttingPrice = sizeBtn.data.cuttingPrice || 0;
              break;
            }
          }
        } catch { /* skip */ }
      }

      // Подсчёт фото
      const pcRes3 = await pool.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
        [sessionId]
      );
      const photos = parseInt(pcRes3.rows[0].cnt, 10);
      const total = photos * unitPrice * copies;
      const totalPrints = photos * copies;
      const enhancePerPrint = 10; // +10₽ за улучшение качества за каждый отпечаток
      const enhancedTotal = total + totalPrints * enhancePerPrint;
      const typeLabel = printType ? ` (${printType})` : '';
      const bordersLine = borders ? `\n• Печать: **${borders}**` : '';
      const cutLine = cuttingPrice > 0 ? `\n• Обрезка: **+${cuttingPrice}₽/шт.**` : '';
      const priceBreakdown = cuttingPrice > 0
        ? `\n• Печать: **${basePrintPrice}₽** + обрезка: **${cuttingPrice}₽** = **${unitPrice}₽/шт.**`
        : `\n• Цена за шт.: **${unitPrice}₽**`;

      const commonData = { tariff: `Печать ${printSize}${typeLabel}`, copies, size: printSize, photosCount: photos, unitPrice, printType, borders, cuttingPrice, delivery_method: 'pickup' };

      return {
        content: `📋 **Ваш заказ на печать:**\n\n• Размер: **${printSize} см**${typeLabel}${bordersLine}${cutLine}\n• Фотографий: **${photos} шт.**\n• Копий каждого: **${copies}**\n• Всего отпечатков: **${totalPrints} шт.**${priceBreakdown}\n\n💰 **Итого: ${total}₽**\n✨ С улучшением качества: **${enhancedTotal}₽** (+${enhancePerPrint}₽/шт.)`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_confirm',
          buttons: [
            { id: 'pay_studio_print', label: `💳 Оплатить ${total}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { ...commonData, price: total, service: `Печать фото ${printSize}${typeLabel} × ${copies} копий${borders ? ', ' + borders : ''}${cuttingPrice > 0 ? ', с обрезкой' : ''}` } },
            { id: 'pay_enhanced', label: `✨ С улучшением — ${enhancedTotal}₽`, icon: 'auto_awesome', value: 'pay_order', color: '#667eea', data: { ...commonData, price: enhancedTotal, enhanced: true, enhancePerPrint, service: `Печать фото ${printSize}${typeLabel} × ${copies} копий, улучшение качества${borders ? ', ' + borders : ''}${cuttingPrice > 0 ? ', с обрезкой' : ''}` } },
            { id: 'add_more_photos', label: '📷 Загрузить ещё фото', icon: 'add_photo_alternate', value: 'studio_upload_more', color: '#4facfe' },
            { id: 'change_copies', label: '🔄 Изменить кол-во', icon: 'edit', value: 'studio_photo_print', color: '#667eea' },
            { id: 'back_studio_menu', label: '◀ В меню', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_photo_retouch': {
      // Реальные позиции из Контур Маркет: "Ретушь Базовая" 700₽, "Ретушь Профессиональная" 900₽, "Ретушь Премиальная" 1400₽
      const retouchPrices = await getKonturPrices();
      const rtBasic = findPriceNum(retouchPrices, 'Ретушь Базовая') || findPriceNum(retouchPrices, 'Ретушь') || 700;
      const rtPro = findPriceNum(retouchPrices, 'Ретушь Профессиональная') || 900;
      const rtPremium = findPriceNum(retouchPrices, 'Ретушь Премиальная') || 1400;

      return {
        content: '✨ **Ретушь фотографий**\n\nСерия снимков, выбор лучшего, несколько вариантов обработки и правки до полного одобрения.\n\nВыберите уровень ретуши:',
        interactive: {
          type: 'buttons',
          step: 'studio_retouch_level',
          buttons: [
            { id: 'rt_basic', label: `✨ Базовая — ${rtBasic}₽`, icon: 'auto_fix_normal', value: 'studio_retouch_basic', color: '#667eea', data: { level: 'Ретушь Базовая', price: rtBasic } },
            { id: 'rt_pro', label: `💫 Профессиональная — ${rtPro}₽`, icon: 'auto_fix_high', value: 'studio_retouch_pro', color: '#f093fb', data: { level: 'Ретушь Профессиональная', price: rtPro } },
            { id: 'rt_premium', label: `👑 Премиальная — ${rtPremium}₽`, icon: 'diamond', value: 'studio_retouch_premium', color: '#fa709a', data: { level: 'Ретушь Премиальная', price: rtPremium } },
            { id: 'back_photo_action', label: '◀ Назад', icon: 'arrow_back', value: 'studio_photo_action_back', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_retouch_basic':
    case 'studio_retouch_pro':
    case 'studio_retouch_premium': {
      // Реальные позиции из Контур Маркет
      const retouchServiceMap: Record<string, { konturKey: string; level: string; fallbackPrice: number; desc: string }> = {
        'studio_retouch_basic': { konturKey: 'Ретушь Базовая', level: 'Ретушь Базовая', fallbackPrice: 700, desc: 'Серия снимков, выбор лучшего фото, несколько вариантов обработки, правки до полного одобрения' },
        'studio_retouch_pro': { konturKey: 'Ретушь Профессиональная', level: 'Ретушь Профессиональная', fallbackPrice: 900, desc: 'Расширенная обработка: глубокая ретушь кожи, коррекция фигуры, работа с фоном, художественная цветокоррекция' },
        'studio_retouch_premium': { konturKey: 'Ретушь Премиальная', level: 'Ретушь Премиальная', fallbackPrice: 1400, desc: 'Максимальный уровень: полная художественная обработка, авторский стиль, неограниченные правки' },
      };
      const rt = retouchServiceMap[buttonValue] || retouchServiceMap['studio_retouch_basic'];
      const rtPrices = await getKonturPrices();
      const rtPrice = findPriceNum(rtPrices, rt.konturKey) || rt.fallbackPrice;

      // Подсчёт фото
      const rtPhotosRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
        [sessionId]
      );
      const rtPhotos = parseInt(rtPhotosRes.rows[0].cnt, 10);

      return {
        content: `✨ **${rt.level}** — **${rtPrice}₽**\n\n${rt.desc}\n\n• Загружено фото: **${rtPhotos} шт.** (вы выберете лучшую)\n\n💰 **Итого: ${rtPrice}₽**\n\n⏱ Срок: 1–3 рабочих дня\n♻️ Правки — бесплатно до полного одобрения`,
        interactive: {
          type: 'buttons',
          step: 'studio_retouch_confirm',
          buttons: [
            { id: 'pay_retouch', label: `💳 Оплатить ${rtPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: rtPrice, tariff: rt.level, service: rt.level, photosCount: rtPhotos, delivery_method: 'pickup' } },
            { id: 'add_wishes_rt', label: '✏️ Добавить пожелания', icon: 'edit', value: 'add_wishes', color: '#667eea' },
            { id: 'add_more_rt', label: '📷 Загрузить ещё фото', icon: 'add_photo_alternate', value: 'studio_upload_more', color: '#4facfe' },
            { id: 'back_retouch', label: '◀ Другой уровень', icon: 'arrow_back', value: 'studio_photo_retouch', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_photo_restore': {
      // Реальные цены из Контур Маркет
      const restPrices = await getKonturPrices();
      const restSimple = findPriceNum(restPrices, 'Реставрация фото (простая)') || 900;
      const restMedium = findPriceNum(restPrices, 'Реставрация фото (средняя)') || 1600;
      const restHard = findPriceNum(restPrices, 'Реставрация фото (сложная)') || 2800;
      const restPro = findPriceNum(restPrices, 'Реставрация фото (профи)') || 4000;
      const restGrav = findPriceNum(restPrices, 'Реставрация фото (под гравировку)') || 2000;

      return {
        content: `🔄 **Реставрация фотографий**\n\nВосстановим старые, повреждённые или выцветшие фото:\n\nВыберите сложность:`,
        interactive: {
          type: 'buttons',
          step: 'studio_restore_level',
          buttons: [
            { id: 'rest_simple', label: `🌟 Простая — ${restSimple}₽`, icon: 'healing', value: 'studio_restore_simple', color: '#667eea', data: { level: 'Простая реставрация', price: restSimple, desc: 'Царапины, пятна, лёгкие повреждения' } },
            { id: 'rest_medium', label: `💫 Средняя — ${restMedium}₽`, icon: 'auto_fix_high', value: 'studio_restore_medium', color: '#11998e', data: { level: 'Средняя реставрация', price: restMedium, desc: 'Трещины, утраченные фрагменты, выцветание' } },
            { id: 'rest_hard', label: `🔧 Сложная — ${restHard}₽`, icon: 'construction', value: 'studio_restore_hard', color: '#f093fb', data: { level: 'Сложная реставрация', price: restHard, desc: 'Сильные повреждения, отсутствующие части, раскрашивание' } },
            { id: 'rest_pro', label: `👑 Профи — ${restPro}₽`, icon: 'diamond', value: 'studio_restore_pro', color: '#fa709a', data: { level: 'Профи-реставрация', price: restPro, desc: 'Полное восстановление из тяжёлого состояния, художественная доработка' } },
            { id: 'rest_grav', label: `🪦 Под гравировку — ${restGrav}₽`, icon: 'image', value: 'studio_restore_grav', color: '#4facfe', data: { level: 'Реставрация под гравировку', price: restGrav, desc: 'Подготовка фото для гравировки на памятник' } },
            { id: 'back_photo_action', label: '◀ Назад', icon: 'arrow_back', value: 'studio_photo_action_back', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_restore_simple':
    case 'studio_restore_medium':
    case 'studio_restore_hard':
    case 'studio_restore_pro':
    case 'studio_restore_grav': {
      const restoreServiceMap: Record<string, { konturKey: string; level: string; fallbackPrice: number; desc: string }> = {
        'studio_restore_simple': { konturKey: 'Реставрация фото (простая)', level: 'Простая реставрация', fallbackPrice: 900, desc: 'Царапины, пятна, лёгкие повреждения' },
        'studio_restore_medium': { konturKey: 'Реставрация фото (средняя)', level: 'Средняя реставрация', fallbackPrice: 1600, desc: 'Трещины, утраченные фрагменты, выцветание' },
        'studio_restore_hard': { konturKey: 'Реставрация фото (сложная)', level: 'Сложная реставрация', fallbackPrice: 2800, desc: 'Сильные повреждения, отсутствующие части, раскрашивание' },
        'studio_restore_pro': { konturKey: 'Реставрация фото (профи)', level: 'Профи-реставрация', fallbackPrice: 4000, desc: 'Полное восстановление, художественная доработка' },
        'studio_restore_grav': { konturKey: 'Реставрация фото (под гравировку)', level: 'Реставрация под гравировку', fallbackPrice: 2000, desc: 'Подготовка фото для гравировки на памятник' },
      };
      const rs = restoreServiceMap[buttonValue] || restoreServiceMap['studio_restore_simple'];
      const rsPrices = await getKonturPrices();
      const rsPrice = findPriceNum(rsPrices, rs.konturKey) || rs.fallbackPrice;

      return {
        content: `🔄 **${rs.level}** — **${rsPrice}₽**\n\n${rs.desc}\n\n📷 Фото уже загружено!\n⏱ Срок: 2–5 рабочих дней\n♻️ Правки — бесплатно до полного одобрения`,
        interactive: {
          type: 'buttons',
          step: 'studio_restore_confirm',
          buttons: [
            { id: 'pay_restore', label: `💳 Оплатить ${rsPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: rsPrice, tariff: rs.level, service: rs.level, delivery_method: 'pickup' } },
            { id: 'add_wishes_restore', label: '✏️ Описать повреждения', icon: 'edit', value: 'add_wishes', color: '#667eea' },
            { id: 'back_restore', label: '◀ Другая сложность', icon: 'arrow_back', value: 'studio_photo_restore', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_photo_docs': {
      // Реальные цены из Контур Маркет
      const docPr = await getKonturPrices();
      const docPricePassport = findPriceNum(docPr, 'Фото на паспорт') || 700;
      const docPriceZagran = findPriceNum(docPr, 'Фото на загран') || 700;
      const docPriceOther = findPriceNum(docPr, 'Фото на другие документы') || 700;
      const docPriceSroch = findPriceNum(docPr, 'Срочные фото на документы') || 900;

      return {
        content: `📄 **Фото на документы** — от **${docPricePassport}₽** (комплект)\n\n📷 Фото загружено! Укажите, на какой документ:`,
        interactive: {
          type: 'document_select',
          step: 'studio_doc_select',
          buttons: [
            ...DOCUMENT_TYPES,
            { id: 'back_photo_action', label: '◀ Назад', icon: 'arrow_back', value: 'studio_photo_action_back', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_photo_canvas': {
      // Реальные цены из Контур Маркет: "Печать на холсте 30x40" 2200₽, "50x70" 3400₽, "70x100" 4300₽
      const canvasPr = await getKonturPrices();
      const cv30x40 = findPriceNum(canvasPr, 'Печать на холсте 30x40') || 2200;
      const cv50x70 = findPriceNum(canvasPr, 'Печать на холсте 50x70') || 3400;
      const cv70x100 = findPriceNum(canvasPr, 'Печать на холсте 70x100') || 4300;

      return {
        content: `🖼 **Печать на холсте** — премиальный подарок!\n\n📷 Фото уже загружено! Выберите размер:`,
        interactive: {
          type: 'buttons',
          step: 'studio_canvas_size',
          buttons: [
            { id: 'cv_30x40', label: `30×40 см — ${cv30x40}₽`, icon: 'crop_portrait', value: 'studio_canvas_order_30x40', color: '#667eea', data: { size: '30×40', price: cv30x40 } },
            { id: 'cv_50x70', label: `50×70 см — ${cv50x70}₽`, icon: 'crop_landscape', value: 'studio_canvas_order_50x70', color: '#11998e', data: { size: '50×70', price: cv50x70 } },
            { id: 'cv_70x100', label: `70×100 см — ${cv70x100}₽`, icon: 'crop_free', value: 'studio_canvas_order_70x100', color: '#f093fb', data: { size: '70×100', price: cv70x100 } },
            { id: 'back_photo_action', label: '◀ Назад', icon: 'arrow_back', value: 'studio_photo_action_back', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_canvas_order_30x40':
    case 'studio_canvas_order_50x70':
    case 'studio_canvas_order_70x100': {
      const canvasOrderMap: Record<string, { size: string; konturKey: string; fallbackPrice: number }> = {
        'studio_canvas_order_30x40': { size: '30×40', konturKey: 'Печать на холсте 30x40', fallbackPrice: 2200 },
        'studio_canvas_order_50x70': { size: '50×70', konturKey: 'Печать на холсте 50x70', fallbackPrice: 3400 },
        'studio_canvas_order_70x100': { size: '70×100', konturKey: 'Печать на холсте 70x100', fallbackPrice: 4300 },
      };
      const cv = canvasOrderMap[buttonValue] || canvasOrderMap['studio_canvas_order_30x40'];
      const cvPrices = await getKonturPrices();
      const cvPrice = findPriceNum(cvPrices, cv.konturKey) || cv.fallbackPrice;

      return {
        content: `🖼 **Печать на холсте ${cv.size} см** — **${cvPrice}₽**\n\n📷 Фото загружено!\n⏱ Срок изготовления: 2–3 рабочих дня\n\nОплатите онлайн или добавьте пожелания по обработке.`,
        interactive: {
          type: 'buttons',
          step: 'studio_canvas_confirm',
          buttons: [
            { id: 'pay_canvas', label: `💳 Оплатить ${cvPrice}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { price: cvPrice, tariff: `Печать на холсте ${cv.size}`, service: `Печать на холсте ${cv.size}`, delivery_method: 'pickup' } },
            { id: 'add_wishes_cv', label: '✏️ Добавить пожелания', icon: 'edit', value: 'add_wishes', color: '#667eea' },
            { id: 'back_canvas', label: '◀ Другой размер', icon: 'arrow_back', value: 'studio_photo_canvas', color: '#a8a8a8' },
          ],
        },
      };
    }

    case 'studio_photo_action_back': {
      // Возврат к выбору действия с фото
      const pcBack = await pool.query(
        `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
        [sessionId]
      );
      const photosBack = parseInt(pcBack.rows[0].cnt, 10);

      return {
        content: `📷 У вас загружено **${photosBack} фото**.\n\nВыберите, что сделать:`,
        interactive: {
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

    default:
      break;
  }

  // Получаем контекст сессии (загружал ли фото, что уже выбрал)
  const ctx = await getSessionContext(sessionId);
  // Проверяем промо-статус клиента (единожды для всех ветвей ниже)
  const isReturningBtn = await isReturningBasicCustomer(sessionId);

  // Проверяем, был ли выбран документ
  const selectedDoc = DOCUMENT_TYPES.find(d => d.value === buttonValue);
  if (selectedDoc) {
    // Обновляем кэш контекста с выбранным документом
    await updateSessionContext(sessionId, { selectedDoc: selectedDoc.value });

    const docSOpts = ctx.selectedOptions || {};
    const hasProcessingLevel = (docSOpts['processing-level']?.length ?? 0) > 0;

    // НОВЫЙ FLOW: опции уже выбраны + есть фото → итог заказа
    if (hasProcessingLevel && ctx.hasPhoto) {
      const { text, buttons } = await buildOrderSummaryFromOptions({
        categorySlug: 'photo-docs',
        selectedOptions: docSOpts,
        selectedDoc: selectedDoc.value,
        photoCount: ctx.photoCount,
        isReturning: isReturningBtn,
      });
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ pendingOrder: { price: 0, tariff: '', document: selectedDoc.value, selectedOptions: docSOpts } }), sessionId]
      );
      return {
        content: `Отлично, **${selectedDoc.value}** ✅\n\n${text}`,
        interactive: {
          type: 'cards',
          step: 'order_confirmed',
          buttons,
          cards: [buildOrderCard(text, buttons)],
        },
      };
    }

    // НОВЫЙ FLOW: опции выбраны, фото нет → просим загрузить
    if (hasProcessingLevel) {
      return {
        content: `Отлично, **${selectedDoc.value}** ✅\n\nТеперь отправьте ваше фото прямо в чат 📷\n\n**Советы для хорошего фото:**\n• Снимайте при естественном свете\n• Камера на уровне глаз\n• Смотрите в объектив\n• Однотонный фон`,
        interactive: {
          type: 'buttons',
          step: 'waiting_photo',
          buttons: [
            { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ],
        },
      };
    }

    // СТАРЫЙ FLOW: тариф выбран + фото — подтверждаем заказ
    if (ctx.selectedTariff && ctx.hasPhoto) {
      const buttons = await buildOrderConfirmedButtons(ctx.selectedTariff, selectedDoc.value, ctx.orderNumber, ctx.photoCount, isReturningBtn);
      const orderData = buttons[0].data || {};
      const price = (orderData['price'] as number) || await extractPrice(ctx.selectedTariff, isReturningBtn);
      const fp = (orderData['firstPrice'] as number) || price;
      const np = (orderData['nextPrice'] as number) || price;
      const priceText = formatPriceBreakdown(price, fp, np, ctx.photoCount);
      const discountNote = fp < np ? `\n\n🎉 **Акция:** первое фото — ${fp}₽! Каждое следующее — ${np}₽` : '';
      return {
        content: `Отлично, **${selectedDoc.value}** ✅\n\n📋 **Ваш заказ оформлен!**\n• Документ: **${selectedDoc.value}**\n• Тариф: **${ctx.selectedTariff}**\n• Фото: ${ctx.photoCount} шт.\n• Сумма: ${priceText}${discountNote}\n\nОплатите заказ онлайн или наш сотрудник свяжется с вами для уточнения деталей.`,
        interactive: {
          type: 'cards',
          step: 'order_confirmed',
          buttons,
          cards: [buildOrderCard(`📋 **Ваш заказ оформлен!**\n• Документ: **${selectedDoc.value}**\n• Тариф: **${ctx.selectedTariff}**\n• Фото: ${ctx.photoCount} шт.\n• Сумма: ${priceText}`, buttons)],
        },
      };
    }

    // СТАРЫЙ FLOW: тариф выбран, фото нет — просим фото
    if (ctx.selectedTariff) {
      return {
        content: `Отлично, **${selectedDoc.value}** ✅\nТариф: **${ctx.selectedTariff}** ✅\n\nТеперь отправьте ваше фото прямо в чат 📷\n\n**Советы для хорошего фото:**\n• Снимайте при естественном свете\n• Камера на уровне глаз\n• Смотрите в объектив\n• Однотонный фон`,
        interactive: {
          type: 'buttons',
          step: 'waiting_photo',
          buttons: [
            { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ],
        },
      };
    }

    // НОВЫЙ FLOW: ничего не выбрано → показываем карточки + кнопки processing-level из DB
    const category = await getCategoryBySlug('photo-docs');
    const plGroup = category?.optionGroups.find(g => g.slug === 'processing-level');
    const featureCards = plGroup
      ? buildFeatureCardsText(plGroup.options, [], 'online', isReturningBtn, 'single')
      : '';
    const processingButtons = await buildOptionGroupButtons('photo-docs', 'processing-level', [], [], isReturningBtn);
    return {
      content: `Отлично, **${selectedDoc.value}** ✅\n\nВыберите уровень обработки:${featureCards ? `\n\n${featureCards}` : ''}`,
      interactive: {
        type: 'buttons',
        step: 'option_processing-level',
        buttons: [
          ...processingButtons,
          { id: 'back_doc', label: '◀ Назад к документам', icon: 'arrow_back', value: 'order_photo', color: '#a8a8a8' },
        ],
      },
    };
  }

  // Проверяем, был ли выбран тариф
  const serviceOpts = await getServiceOptionsForCustomer(isReturningBtn);
  const selectedService = serviceOpts.find(s => s.value === buttonValue);
  if (selectedService) {
    // Обновляем кэш контекста с выбранным тарифом
    await updateSessionContext(sessionId, { selectedTariff: selectedService.value });
    // Если фото И документ уже есть — подтверждаем заказ
    if (ctx.hasPhoto && ctx.selectedDoc) {
      const buttons = await buildOrderConfirmedButtons(selectedService.value, ctx.selectedDoc, ctx.orderNumber, ctx.photoCount, isReturningBtn);
      const orderData = buttons[0].data || {};
      const price = (orderData['price'] as number) || await extractPrice(selectedService.value, isReturningBtn);
      const fp = (orderData['firstPrice'] as number) || price;
      const np = (orderData['nextPrice'] as number) || price;
      const priceText = formatPriceBreakdown(price, fp, np, ctx.photoCount);
      const discountNote = fp < np
        ? `\n\n🎉 **Акция:** первое фото — ${fp}₽! Каждое следующее — ${np}₽`
        : '';
      return {
        content: `Вы выбрали: **${selectedService.value}** ✅\n\n📋 **Ваш заказ оформлен!**\n• Документ: **${ctx.selectedDoc}**\n• Тариф: **${selectedService.value}**\n• Фото: ${ctx.photoCount} шт.\n• Сумма: ${priceText}${discountNote}\n\nОплатите заказ онлайн или наш сотрудник свяжется с вами для уточнения деталей.`,
        interactive: {
          type: 'cards',
          step: 'order_confirmed',
          buttons,
          cards: [buildOrderCard(`📋 **Ваш заказ оформлен!**\n• Документ: **${ctx.selectedDoc}**\n• Тариф: **${selectedService.value}**\n• Фото: ${ctx.photoCount} шт.\n• Сумма: ${priceText}`, buttons)],
        }
      };
    }

    // Фото есть, документ нет — просим выбрать документ
    if (ctx.hasPhoto) {
      return {
        content: `Вы выбрали: **${selectedService.value}** ✅\n\nТеперь укажите, на какой документ нужно фото:`,
        interactive: {
          type: 'document_select',
          step: 'document_select',
          buttons: [
            ...DOCUMENT_TYPES,
            { id: 'back_menu', label: '◀ Назад', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ],
        }
      };
    }

    // Документ есть, фото нет — просим загрузить фото
    if (ctx.selectedDoc) {
      return {
        content: `Вы выбрали: **${selectedService.value}** ✅\nДокумент: **${ctx.selectedDoc}** ✅\n\nТеперь отправьте ваше фото прямо в чат 📷\n\n**Советы для хорошего фото:**\n• Снимайте при естественном свете\n• Камера на уровне глаз\n• Смотрите в объектив\n• Однотонный фон`,
        interactive: {
          type: 'buttons',
          step: 'waiting_photo',
          buttons: [
            { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
          ]
        }
      };
    }

    // Ни фото, ни документа — просим загрузить фото (документ спросим после)
    return {
      content: `Вы выбрали: **${selectedService.value}** ✅\n\nТеперь отправьте ваше фото прямо в чат 📷\n\n**Советы для хорошего фото:**\n• Снимайте при естественном свете\n• Камера на уровне глаз\n• Смотрите в объектив\n• Однотонный фон`,
      interactive: {
        type: 'buttons',
        step: 'waiting_photo',
        buttons: [
          { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
        ]
      }
    };
  }

  // ============================================================================
  // НОВЫЙ FLOW: multi-step option handlers
  // ============================================================================

  // Шаг 2: выбор processing-level
  if (buttonValue.startsWith('option_processing-level_')) {
    const slug = buttonValue.replace('option_processing-level_', '');
    const newSelectedOptions = { ...(ctx.selectedOptions || {}), 'processing-level': [slug] };
    await updateSessionContext(sessionId, { selectedOptions: newSelectedOptions });
    return proceedToNextOptionGroup(sessionId, 'processing-level', newSelectedOptions, isReturningBtn);
  }

  // Шаг 3: выбор speed (single-select)
  if (buttonValue.startsWith('option_speed_') && !buttonValue.includes('_toggle_')) {
    const slug = buttonValue.replace('option_speed_', '');
    const newSelectedOptions = { ...(ctx.selectedOptions || {}), 'speed': [slug] };
    await updateSessionContext(sessionId, { selectedOptions: newSelectedOptions });
    return proceedToNextOptionGroup(sessionId, 'speed', newSelectedOptions, isReturningBtn);
  }

  // Пропуск speed
  if (buttonValue === 'skip_speed') {
    return proceedToNextOptionGroup(sessionId, 'speed', ctx.selectedOptions || {}, isReturningBtn);
  }

  // Шаг 4: extras toggle (multi-select)
  if (buttonValue.includes('_toggle_')) {
    const parts = buttonValue.split('_toggle_');
    const slug = parts[1] || '';
    const current = ctx.selectedOptions || {};
    const currentExtras = current['extras'] || [];
    const newExtras = currentExtras.includes(slug)
      ? currentExtras.filter(s => s !== slug)
      : [...currentExtras, slug];
    const newSelectedOptions = { ...current, 'extras': newExtras };
    await updateSessionContext(sessionId, { selectedOptions: newSelectedOptions });
    // Перерисовываем extras шаг с обновлёнными toggle (без повторных описаний)
    return buildOptionStepMsg(sessionId, 'extras', newSelectedOptions, isReturningBtn, false);
  }

  // Завершение extras (Done / Skip)
  if (buttonValue === 'option_extras_done' || buttonValue === 'skip_extras') {
    return proceedToNextOptionGroup(sessionId, 'extras', ctx.selectedOptions || {}, isReturningBtn);
  }

  return null;
}

// ============================================================================
// Helper: показать шаг опции
// ============================================================================

async function buildOptionStepMsg(
  sessionId: string,
  groupSlug: string,
  selectedOptions: Record<string, string[]>,
  isReturning: boolean,
  showDescriptions = true,
): Promise<BotMessageResult> {
  const category = await getCategoryBySlug('photo-docs');
  if (!category) return { content: 'Ошибка загрузки настроек.' };

  const group = category.optionGroups.find(g => g.slug === groupSlug);
  if (!group) return { content: 'Ошибка: группа опций не найдена.' };

  // Определяем исключённые опции на основе правил
  const selectedAll = Object.values(selectedOptions).flat();
  const excludedSlugs: string[] = [];

  for (const rule of category.rules) {
    if (rule.rule_type === 'excludes') {
      // source выбран → target в этой группе → скрыть target
      if (selectedAll.includes(rule.source_option_slug) &&
          group.options.some(o => o.slug === rule.target_option_slug)) {
        excludedSlugs.push(rule.target_option_slug);
      }
      // target выбран (в другой группе) → source в этой группе → скрыть source
      if (selectedAll.includes(rule.target_option_slug) &&
          group.options.some(o => o.slug === rule.source_option_slug)) {
        excludedSlugs.push(rule.source_option_slug);
      }
    }
    if (rule.rule_type === 'requires') {
      // source требует target — если target не удовлетворён, скрываем source в текущей группе
      if (group.options.some(o => o.slug === rule.source_option_slug)) {
        const targetGroup = category.optionGroups.find(g =>
          g.options.some(o => o.slug === rule.target_option_slug)
        );
        const satisfied = targetGroup?.options.some(o =>
          selectedAll.includes(o.slug) && o.satisfies_requires
        ) ?? false;
        if (!satisfied) {
          excludedSlugs.push(rule.source_option_slug);
        }
      }
    }
  }

  const selectedSlugs = selectedOptions[groupSlug] || [];
  const optButtons = await buildOptionGroupButtons(
    'photo-docs', groupSlug, selectedSlugs, excludedSlugs, isReturning
  );

  const featureCards = showDescriptions
    ? buildFeatureCardsText(
        group.options, excludedSlugs, 'online', isReturning,
        group.selection_type as 'single' | 'multi',
      )
    : '';

  let content: string;
  const extraButtons: BotButton[] = [];

  if (groupSlug === 'speed') {
    content = featureCards
      ? `⏱ **Скорость выполнения:**\n\n${featureCards}`
      : '⏱ **Скорость выполнения:**';
    if (!group.is_required) {
      extraButtons.push({ id: 'skip_speed', label: '⏭ Пропустить', icon: 'skip_next', value: 'skip_speed', color: '#a8a8a8' });
    }
  } else if (groupSlug === 'extras') {
    content = featureCards
      ? `🎁 **Дополнительные опции** (можно выбрать несколько):\n\n${featureCards}`
      : '🎁 **Дополнительные опции** (можно выбрать несколько):';
    extraButtons.push({ id: 'option_extras_done', label: '✅ Готово', icon: 'check_circle', value: 'option_extras_done', color: '#22c55e' });
    if (!group.is_required) {
      extraButtons.push({ id: 'skip_extras', label: '⏭ Пропустить', icon: 'skip_next', value: 'skip_extras', color: '#a8a8a8' });
    }
  } else {
    content = featureCards
      ? `Выберите **${group.name}**:\n\n${featureCards}`
      : `Выберите **${group.name}**:`;
  }

  return {
    content,
    interactive: {
      type: 'buttons',
      step: `option_${groupSlug}`,
      buttons: [...optButtons, ...extraButtons],
    },
  };
}

// ============================================================================
// Helper: перейти к следующей группе опций
// ============================================================================

async function proceedToNextOptionGroup(
  sessionId: string,
  fromGroup: string,
  selectedOptions: Record<string, string[]>,
  isReturning: boolean,
): Promise<BotMessageResult> {
  const ORDER = ['processing-level', 'speed', 'extras'];
  const idx = ORDER.indexOf(fromGroup);
  let current = { ...selectedOptions };

  for (let i = idx + 1; i < ORDER.length; i++) {
    const nextGroup = ORDER[i];

    if (nextGroup === 'speed') {
      // Если выбран basic → urgent исключён → только normal (0₽) → авто-пропускаем
      const processingSelected = current['processing-level'] || [];
      if (processingSelected.includes('basic')) {
        current = { ...current, 'speed': ['normal'] };
        await updateSessionContext(sessionId, { selectedOptions: current });
        continue;
      }
    }

    // Показываем шаг этой группы
    return buildOptionStepMsg(sessionId, nextGroup, current, isReturning);
  }

  // Все группы пройдены → просим загрузить фото
  return {
    content: `Отличный выбор! ✅\n\nТеперь отправьте ваше фото прямо в чат 📷\n\n**Советы для хорошего фото:**\n• Снимайте при естественном свете\n• Камера на уровне глаз\n• Смотрите в объектив\n• Однотонный фон`,
    interactive: {
      type: 'buttons',
      step: 'waiting_photo',
      buttons: [
        { id: 'back_menu', label: '◀ Назад в меню', icon: 'arrow_back', value: 'main_menu', color: '#a8a8a8' },
      ],
    },
  };
}

/**
 * Контекстная обработка текстового ввода.
 * Проверяет, ожидает ли бот ввод от клиента (количество копий, нестандартный размер).
 * Если да — обрабатывает ввод интеллектуально и возвращает результат.
 */
export async function handleContextualTextInput(content: string, sessionId: string): Promise<BotMessageResult | null> {
  // Получаем последний шаг бота
  const lastBotMsg = await pool.query(
    `SELECT metadata FROM messages
     WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId]
  );

  if (lastBotMsg.rows.length === 0) return null;

  let lastStep: string | null = null;
  try {
    const meta = typeof lastBotMsg.rows[0].metadata === 'string'
      ? JSON.parse(lastBotMsg.rows[0].metadata)
      : lastBotMsg.rows[0].metadata;
    lastStep = meta?.interactive?.step || null;
  } catch { return null; }

  if (!lastStep) return null;

  // ====== Обработка ввода номера телефона ======
  if (lastStep === 'ask_phone') {
    const phone = normalizePhone(content);
    if (!phone) {
      return {
        content: '⚠️ Не удалось распознать номер. Введите в формате `+7XXXXXXXXXX` или `8XXXXXXXXXX`, или нажмите «Пропустить».',
        interactive: {
          type: 'buttons',
          step: 'ask_phone',
          buttons: [
            { id: 'skip_phone', label: '⏩ Пропустить', icon: 'skip_next', value: 'skip_phone', color: '#a8a8a8' },
            { id: 'back_to_order_confirmed', label: '◀ Назад к заказу', icon: 'arrow_back', value: 'back_to_order_confirmed', color: '#a8a8a8' },
          ],
        },
      };
    }
    // Сохраняем телефон в сессию + помечаем phoneAsked
    await pool.query(
      `UPDATE conversations SET visitor_phone = $1, metadata = COALESCE(metadata, '{}'::jsonb) || '{"phoneAsked": true}'::jsonb WHERE id = $2`,
      [phone, sessionId]
    );
    // Fire-and-forget: auto-link session to client by phone
    import('../../services/client-context.service.js').then(m =>
      m.autoLinkSessionToClient(sessionId)
    ).catch(err => logger.error('[bot-engine] autoLink error', { error: String(err) }));
    return proceedAfterPhone(sessionId);
  }

  // ====== Обработка ввода количества копий ======
  if (lastStep === 'studio_input_copies') {
    const trimmed = content.trim();
    const copies = parseInt(trimmed, 10);

    if (isNaN(copies) || copies < 1 || copies > 999) {
      return {
        content: '⚠️ Введите корректное число от 1 до 999.\n\nНапример: `7` или `25`',
        interactive: {
          type: 'buttons',
          step: 'studio_input_copies',
          buttons: [
            { id: 'back_copies', label: '◀ Стандартное количество', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Достаём данные о размере/цене из предыдущих сообщений бота (включая borders/cutting)
    const prevMsgs = await pool.query(
      `SELECT metadata FROM messages
       WHERE conversation_id = $1 AND sender_type = 'bot' AND metadata IS NOT NULL
       ORDER BY created_at DESC LIMIT 10`,
      [sessionId]
    );

    let printSize = '10×15';
    let unitPrice = 20;
    let photosCount = 1;
    let printType = '';
    let tiBorders = '';
    let tiCuttingPrice = 0;
    let tiBasePrintPrice = 20;

    for (const row of prevMsgs.rows) {
      try {
        const meta = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
        const btns = meta?.interactive?.buttons;
        if (btns) {
          const dataBtn = btns.find((b: StoredInteractiveButton) => b.data?.['size'] && b.data?.['unitPrice'] && (b.value?.startsWith('studio_copies_') || b.value === 'studio_copies_custom'));
          if (dataBtn) {
            printSize = dataBtn.data.size;
            unitPrice = dataBtn.data.unitPrice as number;
            photosCount = (dataBtn.data.photosCount as number) || 1;
            printType = (dataBtn.data.printType as string) || '';
            tiBorders = (dataBtn.data.borders as string) || '';
            tiCuttingPrice = (dataBtn.data.cuttingPrice as number) || 0;
            tiBasePrintPrice = (dataBtn.data.basePrintPrice as number) || unitPrice;
            break;
          }
        }
      } catch { /* skip */ }
    }

    const total = photosCount * unitPrice * copies;
    const totalPrints = photosCount * copies;
    const enhancePerPrint = 10;
    const enhancedTotal = total + totalPrints * enhancePerPrint;
    const typeLabel = printType ? ` (${printType})` : '';
    const tiBordersLine = tiBorders ? `\n• Печать: **${tiBorders}**` : '';
    const tiCutLine = tiCuttingPrice > 0 ? `\n• Обрезка: **+${tiCuttingPrice}₽/шт.**` : '';
    const tiPriceBreakdown = tiCuttingPrice > 0
      ? `\n• Печать: **${tiBasePrintPrice}₽** + обрезка: **${tiCuttingPrice}₽** = **${unitPrice}₽/шт.**`
      : `\n• Цена за шт.: **${unitPrice}₽**`;

    const commonData2 = { tariff: `Печать ${printSize}${typeLabel}`, copies, size: printSize, photosCount, unitPrice, printType, borders: tiBorders, cuttingPrice: tiCuttingPrice, delivery_method: 'pickup' };

    return {
      content: `📋 **Ваш заказ на печать:**\n\n• Размер: **${printSize} см**${typeLabel}${tiBordersLine}${tiCutLine}\n• Фотографий: **${photosCount} шт.**\n• Копий каждого: **${copies}**\n• Всего отпечатков: **${totalPrints} шт.**${tiPriceBreakdown}\n\n💰 **Итого: ${total}₽**\n✨ С улучшением качества: **${enhancedTotal}₽** (+${enhancePerPrint}₽/шт.)`,
      interactive: {
        type: 'buttons',
        step: 'studio_print_confirm',
        buttons: [
          { id: 'pay_studio_print', label: `💳 Оплатить ${total}₽`, icon: 'credit_card', value: 'pay_order', color: '#22c55e', data: { ...commonData2, price: total, service: `Печать фото ${printSize}${typeLabel} × ${copies} копий${tiBorders ? ', ' + tiBorders : ''}${tiCuttingPrice > 0 ? ', с обрезкой' : ''}` } },
          { id: 'pay_enhanced', label: `✨ С улучшением — ${enhancedTotal}₽`, icon: 'auto_awesome', value: 'pay_order', color: '#667eea', data: { ...commonData2, price: enhancedTotal, enhanced: true, enhancePerPrint, service: `Печать фото ${printSize}${typeLabel} × ${copies} копий, улучшение качества${tiBorders ? ', ' + tiBorders : ''}${tiCuttingPrice > 0 ? ', с обрезкой' : ''}` } },
          { id: 'add_more_photos', label: '📷 Загрузить ещё фото', icon: 'add_photo_alternate', value: 'studio_upload_more', color: '#4facfe' },
          { id: 'change_copies', label: '🔄 Изменить кол-во', icon: 'edit', value: 'studio_photo_print', color: '#667eea' },
          { id: 'back_studio_menu', label: '◀ В меню', icon: 'arrow_back', value: 'studio_main_menu', color: '#a8a8a8' },
        ],
      },
    };
  }

  // ====== Обработка ввода нестандартного размера ======
  if (lastStep === 'studio_input_custom_size') {
    const trimmed = content.trim();

    // Парсим размер: поддерживаем форматы "13x18", "13×18", "13 18", "13*18", "13х18"
    const sizeMatch = trimmed.match(/(\d+)\s*[xхX×\*\s]\s*(\d+)/);

    if (!sizeMatch) {
      return {
        content: '⚠️ Не удалось распознать размер. Введите в формате `ШxВ`, например:\n\n`13x18` или `50x70`',
        interactive: {
          type: 'buttons',
          step: 'studio_input_custom_size',
          buttons: [
            { id: 'back_size', label: '◀ Стандартные размеры', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    const w = parseInt(sizeMatch[1], 10);
    const h = parseInt(sizeMatch[2], 10);
    // Нормализуем: меньшее × большее
    const dimW = Math.min(w, h);
    const dimH = Math.max(w, h);
    const customSize = `${dimW}×${dimH}`;

    // Таблица стандартных размеров с Контур Маркет ключами
    const standardSizes = [
      { w: 10, h: 15, konturKeyPremium: 'Фото 10x15 премиум', konturKeySuper: 'Фото 10x15 супер', fallbackPremium: 20, fallbackSuper: 36, hasTypes: true },
      { w: 15, h: 20, konturKeyPremium: 'Фото 15x20 премиум', konturKeySuper: 'Фото 15x20 супер', fallbackPremium: 49, fallbackSuper: 70, hasTypes: true },
      { w: 20, h: 30, konturKeyPremium: 'Фото 20x30 премиум', konturKeySuper: 'Фото 20x30 супер', fallbackPremium: 117, fallbackSuper: 160, hasTypes: true },
      { w: 30, h: 40, konturKey: '30x40 печать фото', fallbackPrice: 450, hasTypes: false },
      { w: 40, h: 50, konturKey: '40x50 печать фото', fallbackPrice: 600, hasTypes: false },
    ];

    // Найти ближайший стандартный размер (>= введённому)
    // Площадь введённого
    const inputArea = dimW * dimH;
    let bestMatch = standardSizes[standardSizes.length - 1]; // по умолчанию максимальный

    for (const ss of standardSizes) {
      const stdArea = ss.w * ss.h;
      if (stdArea >= inputArea) {
        bestMatch = ss;
        break;
      }
    }

    const prices = await getKonturPrices();
    const matchedSize = `${bestMatch.w}×${bestMatch.h}`;

    // Считаем фото
    const csPhotoRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = $1 AND message_type = 'image' AND sender_type = 'visitor' AND deleted_at IS NULL`,
      [sessionId]
    );
    const csPhotos = parseInt(csPhotoRes.rows[0].cnt, 10);

    const isCustom = customSize !== matchedSize;

    if (bestMatch.hasTypes && 'konturKeyPremium' in bestMatch) {
      // Есть выбор Премиум/Супер — сначала тип бумаги, потом поля → [обрезка] → копии
      const premPrice = findPriceNum(prices, bestMatch.konturKeyPremium!) || bestMatch.fallbackPremium!;
      const superPrice = findPriceNum(prices, bestMatch.konturKeySuper!) || bestMatch.fallbackSuper!;
      const sizeKey = `${bestMatch.w}x${bestMatch.h}`;

      const sizeNote = isCustom
        ? `\n\n💡 Ваш размер **${customSize} см** — печатается на формате **${matchedSize} см**.`
        : '';

      return {
        content: `📷 Размер: **${matchedSize} см**${sizeNote}\n\n📷 Фото: **${csPhotos} шт.**\n\nВыберите тип бумаги:`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_type',
          buttons: [
            { id: 'pt_premium', label: `⭐ Премиум — ${premPrice}₽/шт.`, icon: 'star', value: `studio_ptype_${sizeKey}_premium`, color: '#667eea', data: { size: matchedSize, type: 'Премиум', unitPrice: premPrice, konturKey: bestMatch.konturKeyPremium, customSize: isCustom ? customSize : '' } },
            { id: 'pt_super', label: `💎 Супер — ${superPrice}₽/шт.`, icon: 'diamond', value: `studio_ptype_${sizeKey}_super`, color: '#f093fb', data: { size: matchedSize, type: 'Супер', unitPrice: superPrice, konturKey: bestMatch.konturKeySuper, customSize: isCustom ? customSize : '' } },
            { id: 'back_size', label: '◀ Другой размер', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    } else {
      // Один тип (30×40, 40×50)
      const csUnitPrice = findPriceNum(prices, bestMatch.konturKey!) || bestMatch.fallbackPrice!;

      const sizeNote = isCustom
        ? `\n\n💡 Ваш размер **${customSize} см** — печатается на формате **${matchedSize} см**.`
        : '';
      const csData = { size: matchedSize, unitPrice: csUnitPrice, photosCount: csPhotos, printType: '', customSize: isCustom ? customSize : '' };

      // Нестандартный размер → сразу обрезка; стандартный → поля
      if (isCustom) {
        const cutPricePerPrint = 10;
        return {
          content: `✅ Размер: **${matchedSize} см** — **${csUnitPrice}₽/шт.**${sizeNote}\n\nОбрезать до ${customSize} см? Стоимость: **${cutPricePerPrint}₽/шт.**`,
          interactive: {
            type: 'buttons',
            step: 'studio_print_cutting',
            buttons: [
              { id: 'cut_yes', label: `✂️ Да, обрезать до ${customSize} (+${cutPricePerPrint}₽/шт.)`, icon: 'content_cut', value: 'studio_cut_yes', color: '#f093fb', data: { ...csData, borders: '', cuttingPrice: cutPricePerPrint } },
              { id: 'cut_no', label: `📐 Нет, оставить ${matchedSize} см`, icon: 'check_box_outline_blank', value: 'studio_cut_no', color: '#667eea', data: { ...csData, borders: '', cuttingPrice: 0 } },
              { id: 'back_size', label: '◀ Другой размер', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
            ],
          },
        };
      }

      return {
        content: `✅ Размер: **${matchedSize} см** — **${csUnitPrice}₽/шт.**\n\nКак печатать?`,
        interactive: {
          type: 'buttons',
          step: 'studio_print_borders',
          buttons: [
            { id: 'br_without', label: '🖼 Без полей — фото на весь лист', icon: 'fullscreen', value: 'studio_borders_without', color: '#667eea', data: { ...csData, borders: 'без полей' } },
            { id: 'br_with', label: '🔲 С полями — фото целиком, белые края', icon: 'border_all', value: 'studio_borders_with', color: '#11998e', data: { ...csData, borders: 'с полями' } },
            { id: 'back_size', label: '◀ Другой размер', icon: 'arrow_back', value: 'studio_photo_print', color: '#a8a8a8' },
          ],
        },
      };
    }
  }

  // ====== Онлайн: ввод адреса доставки (печатный вид) — DaData + Почта России ======
  if (lastStep === 'online_awaiting_address') {
    const address = content.trim();
    if (address.length < 5) {
      return {
        content: '⚠️ Пожалуйста, укажите полный адрес (город, улица, дом, квартира).',
        interactive: {
          type: 'buttons',
          step: 'online_awaiting_address',
          buttons: [
            { id: 'online_cancel_print', label: '◀ Назад', icon: 'arrow_back', value: 'online_cancel_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Валидация адреса через DaData Standardization API
    const validated = await validateAddress(address);

    if (!validated) {
      // DaData недоступен — принимаем адрес как есть, доставка 200₽
      await pool.query(
        `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ deliveryAddress: address, deliveryCost: 200, deliveryStep: 'completed' }), sessionId]
      );
      return handleFinalizeOrder(sessionId, {
        pickup: `Доставка: ${address}`,
        production: 'Онлайн + печать',
        deliveryAddress: address,
        deliveryCost: 200,
      });
    }

    if (!validated.postalCode) {
      // Нет почтового индекса — адрес неполный или невалидный
      return {
        content: `⚠️ Не удалось распознать адрес.\n\nУкажите полный адрес с городом, улицей, домом и квартирой.`,
        interactive: {
          type: 'buttons',
          step: 'online_awaiting_address',
          buttons: [
            { id: 'online_cancel_print', label: '◀ Назад', icon: 'arrow_back', value: 'online_cancel_print', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Адрес валиден — рассчитываем стоимость доставки через Почту России
    let deliveryInfo = '';
    let deliveryCost = 0;
    let deliveryDaysMin = 0;
    let deliveryDaysMax = 0;

    if (validated.postalCode) {
      // Для чат-заказов (фото на документы с печатью) — 1 лист 10×15
      const printItems = [{ format: 'document', quantity: 1 }];
      const tariffResult = await calculateDeliveryCost(validated.postalCode, undefined, printItems);
      if (tariffResult) {
        deliveryCost = tariffResult.costWithNds;
        deliveryDaysMin = tariffResult.daysMin;
        deliveryDaysMax = tariffResult.daysMax;
        deliveryInfo = `\n🚚 Доставка Почтой России: **${deliveryCost}₽**\n📅 Срок: **${deliveryDaysMin}–${deliveryDaysMax} дней**`;
      } else {
        // Почта России не ответила — фиксированная стоимость
        deliveryCost = 200;
        deliveryInfo = `\n🚚 Доставка: **${deliveryCost}₽**`;
      }
    }

    // Сохраняем валидированный адрес и стоимость доставки
    await pool.query(
      `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({
        deliveryAddress: validated.result,
        deliveryPostalCode: validated.postalCode,
        deliveryCity: validated.city,
        deliveryRegion: validated.region,
        deliveryStreet: validated.streetWithType,
        deliveryHouse: validated.house,
        deliveryFlat: validated.flat,
        deliveryCost,
        deliveryDaysMin,
        deliveryDaysMax,
        deliveryStep: 'awaiting_confirm',
      }), sessionId]
    );

    return {
      content: `📍 **Адрес доставки:**\n${validated.result}${validated.postalCode ? `\n📮 Индекс: ${validated.postalCode}` : ''}${deliveryInfo}\n\nВсё верно?`,
      interactive: {
        type: 'buttons',
        step: 'online_address_confirm',
        buttons: [
          { id: 'online_confirm_address', label: '✅ Подтвердить', icon: 'check', value: 'online_confirm_address', color: '#22c55e' },
          { id: 'online_change_address', label: '✏️ Изменить адрес', icon: 'edit', value: 'online_change_address', color: '#667eea' },
          { id: 'online_cancel_print', label: '◀ Назад', icon: 'arrow_back', value: 'online_cancel_print', color: '#a8a8a8' },
        ],
      },
    };
  }

  // ====== Доставка: ввод адреса ======
  if (lastStep === 'delivery_awaiting_address') {
    const address = content.trim();
    if (address.length < 5) {
      return {
        content: '⚠️ Пожалуйста, укажите полный адрес (улица, дом, квартира).',
        interactive: {
          type: 'buttons',
          step: 'delivery_awaiting_address',
          buttons: [
            { id: 'cancel_delivery', label: '◀ Назад к выбору', icon: 'arrow_back', value: 'cancel_delivery', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Валидация адреса через DaData
    const validated = await validateAddress(address);
    const finalAddress = validated?.result || address;
    const postalCode = validated?.postalCode || '';

    // Расчёт стоимости доставки через Почту России (fallback 200₽)
    let deliveryCost = 200;
    let deliveryDaysMin = 0;
    let deliveryDaysMax = 0;
    let deliveryInfo = '';

    if (postalCode) {
      const tariffResult = await calculateDeliveryCost(postalCode);
      if (tariffResult) {
        deliveryCost = tariffResult.costWithNds;
        deliveryDaysMin = tariffResult.daysMin;
        deliveryDaysMax = tariffResult.daysMax;
        deliveryInfo = `\n🚚 Доставка Почтой России: **${deliveryCost}₽** (${deliveryDaysMin}–${deliveryDaysMax} дней)`;
      } else {
        deliveryInfo = `\n🚚 Доставка: **${deliveryCost}₽**`;
      }
    } else {
      deliveryInfo = `\n🚚 Доставка: **${deliveryCost}₽**`;
    }

    // Сохраняем адрес и стоимость доставки в метаданные, переходим к телефону
    await pool.query(
      `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({
        deliveryAddress: finalAddress,
        deliveryPostalCode: postalCode,
        deliveryCost,
        deliveryDaysMin,
        deliveryDaysMax,
        deliveryStep: 'awaiting_phone',
      }), sessionId]
    );

    return {
      content: `📍 Адрес доставки: **${finalAddress}**${postalCode ? `\n📮 Индекс: ${postalCode}` : ''}${deliveryInfo}\n\n📞 Укажите номер телефона для курьера:`,
      interactive: {
        type: 'buttons',
        step: 'delivery_awaiting_phone',
        buttons: [
          { id: 'cancel_delivery', label: '◀ Назад к выбору', icon: 'arrow_back', value: 'cancel_delivery', color: '#a8a8a8' },
        ],
      },
    };
  }

  // ====== Доставка: ввод телефона ======
  if (lastStep === 'delivery_awaiting_phone') {
    const phone = content.trim();
    // Базовая валидация: хотя бы 7 цифр
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) {
      return {
        content: '⚠️ Пожалуйста, введите корректный номер телефона.\n\nНапример: `+7 (901) 123-45-67` или `89011234567`',
        interactive: {
          type: 'buttons',
          step: 'delivery_awaiting_phone',
          buttons: [
            { id: 'cancel_delivery', label: '◀ Назад к выбору', icon: 'arrow_back', value: 'cancel_delivery', color: '#a8a8a8' },
          ],
        },
      };
    }

    // Получаем адрес из метаданных (visitor_phone тоже — передадим в handleFinalizeOrder)
    const metaRes = await pool.query(
      `SELECT metadata, visitor_phone FROM conversations WHERE id = $1`,
      [sessionId]
    );
    const metadata = metaRes.rows[0]?.metadata || {};
    const visitorPhone = metaRes.rows[0]?.visitor_phone || null;
    const deliveryAddress = metadata.deliveryAddress || '';

    // Определяем ближайшую точку производства; если она временно закрыта —
    // подменяем на открытую (заказ не должен уехать в закрытую студию).
    const production = await resolveOpenProductionLabel(findNearestProduction(deliveryAddress));

    // Сохраняем телефон и завершаем шаг доставки
    await pool.query(
      `UPDATE conversations SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ deliveryPhone: phone, deliveryStep: 'completed', production }), sessionId]
    );

    // Передаём preloaded — избегаем повторного SELECT в handleFinalizeOrder
    const updatedMeta = { ...metadata, deliveryPhone: phone, deliveryStep: 'completed', production };
    return handleFinalizeOrder(sessionId, {
      pickup: `Доставка: ${deliveryAddress}`,
      production,
      deliveryAddress,
      deliveryPhone: phone,
    }, { metadata: updatedMeta, visitor_phone: visitorPhone });
  }

  // ====== Распознавание текстового выбора документа ======
  if (lastStep === 'document_select' || lastStep === 'document_after_photo') {
    const lower = content.toLowerCase().trim();
    const docKeywords: Array<{ keywords: string[]; value: string }> = [
      { keywords: ['паспорт', 'внутренн'], value: 'Паспорт РФ' },
      { keywords: ['загран', 'заграничн'], value: 'Загранпаспорт' },
      { keywords: ['виз'], value: 'Виза' },
      { keywords: ['водител', 'права', ' ву '], value: 'Водительское удостоверение' },
      { keywords: ['студенч', 'студак', 'студ.'], value: 'Студенческий билет' },
      { keywords: ['пропуск'], value: 'Пропуск на работу' },
      { keywords: ['военн', 'военник'], value: 'Военный билет' },
    ];

    const match = docKeywords.find(dk => dk.keywords.some(kw => lower.includes(kw)));
    if (match) {
      // Обновляем сообщение посетителя на каноническое значение
      await pool.query(
        `UPDATE messages SET content = $1
         WHERE id = (SELECT id FROM messages WHERE conversation_id = $2 AND sender_type = 'visitor' ORDER BY created_at DESC LIMIT 1)`,
        [match.value, sessionId]
      );
      // Обновляем кэш контекста с распознанным документом
      await updateSessionContext(sessionId, { selectedDoc: match.value });
      return handleInteractiveResponse(match.value, sessionId);
    }
    // Не распознано — пусть AI обработает
    return null;
  }

  // ====== Распознавание текстового выбора тарифа ======
  if (lastStep === 'service_select') {
    const lower = content.toLowerCase().trim();
    const tariffKeywords: Array<{ keywords: string[]; value: string }> = [
      { keywords: ['экспресс', 'базов', 'без обработк', 'минимальн', 'самый дешёв', 'самый дешев'], value: 'Базовая обработка (700₽)' },
      { keywords: ['профессиональн', 'расширенн', 'с обработк', 'стандарт', 'обработк'], value: 'Расширенная обработка (950₽)' },
      { keywords: ['премиум', 'максимальн', 'vip', 'вип'], value: 'Максимальная обработка (1 400₽)' },
      { keywords: ['все документ', 'все сразу', 'комплект', '4 комплект'], value: 'VIP «Все документы» (2 490₽)' },
    ];

    const match = tariffKeywords.find(tk => tk.keywords.some(kw => lower.includes(kw)));
    if (match) {
      await pool.query(
        `UPDATE messages SET content = $1
         WHERE id = (SELECT id FROM messages WHERE conversation_id = $2 AND sender_type = 'visitor' ORDER BY created_at DESC LIMIT 1)`,
        [match.value, sessionId]
      );
      // Обновляем кэш контекста с распознанным тарифом
      await updateSessionContext(sessionId, { selectedTariff: match.value });
      return handleInteractiveResponse(match.value, sessionId);
    }
    return null;
  }

  // Нет подходящего контекстного шага
  return null;
}
