/**
 * Фабрика провайдера типографий
 *
 * В будущем здесь будут конкретные реализации (PechatiRu, PrimaPrint и т.д.)
 * Сейчас возвращается mock-реализация на базе локальных цен.
 *
 * Контур.Маркет более не используется — весь POS собственный.
 * kontur-prices.service.ts подлежит удалению после полной миграции chat-bot-engine.ts
 */

export { type PrintingHouseProvider, type PrintProduct, type PrintSpecs, type PrintOrder, type PrintOrderStatus } from './provider.interface.js';
export { LocalPrintingHouseProvider } from './local.provider.js';
