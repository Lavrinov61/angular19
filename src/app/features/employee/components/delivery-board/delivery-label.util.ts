/**
 * Печать сопроводиловки для курьера (HTML + window.print).
 *
 * Открывает отдельное окно с печатным листком (№ заказа, адрес получателя,
 * отправитель-студия, дата, QR с trackingUrl). QR генерируется библиотекой
 * `qrcode` (toDataURL, динамический импорт — SSR-safe). Если trackingUrl нет
 * или QR не сгенерировался — печатается текстовый трек/claim-номер.
 *
 * Backend-эндпоинт не нужен — все данные уже в /api/delivery/queue.
 */

export interface DeliveryLabelData {
  /** Человекочитаемый номер заказа (без префикса). */
  orderNumber: string;
  customerName: string;
  dropoffAddress: string | null;
  /** Имя зоны (для подсказки курьеру), опционально. */
  zone?: string | null;
  /** Ссылка трекинга Яндекса — кодируется в QR. */
  trackingUrl?: string | null;
  /** Идентификатор заявки Яндекса — fallback-текст, если нет QR. */
  claimId?: string | null;
  courierName?: string | null;
  courierPhone?: string | null;
}

const STUDIO_SENDER = 'Своё Фото (МагнусФото)';
const STUDIO_CONTACT = '+7 (901) 417-86-68 · svoefoto.ru';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function buildQrDataUrl(trackingUrl: string | null | undefined): Promise<string | null> {
  if (!trackingUrl) return null;
  try {
    const QRCode = await import('qrcode');
    return await QRCode.toDataURL(trackingUrl, {
      width: 200,
      margin: 1,
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    console.error('Delivery label QR generation failed', err);
    return null;
  }
}

function buildLabelHtml(data: DeliveryLabelData, qrDataUrl: string | null): string {
  const date = new Date().toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const address = data.dropoffAddress
    ? escapeHtml(data.dropoffAddress)
    : '<span class="muted">адрес не указан</span>';

  const qrBlock = qrDataUrl
    ? `<img class="qr" src="${qrDataUrl}" alt="QR трекинг" />`
    : data.trackingUrl
      ? `<div class="track-text">${escapeHtml(data.trackingUrl)}</div>`
      : data.claimId
        ? `<div class="track-text">Заявка: ${escapeHtml(data.claimId)}</div>`
        : '';

  const courier =
    data.courierName || data.courierPhone
      ? `<div class="row"><span class="lbl">Курьер</span><span class="val">${escapeHtml(
          [data.courierName, data.courierPhone].filter(Boolean).join(' · '),
        )}</span></div>`
      : '';

  const zone = data.zone
    ? `<div class="row"><span class="lbl">Зона</span><span class="val">${escapeHtml(data.zone)}</span></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Сопроводиловка ${escapeHtml(data.orderNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Roboto, Arial, sans-serif; margin: 0; padding: 12mm; color: #111; }
  .label { max-width: 105mm; margin: 0 auto; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 12px; }
  .order-no { font-size: 22px; font-weight: 800; letter-spacing: 0.5px; }
  .order-no small { display: block; font-size: 10px; font-weight: 500; color: #666; letter-spacing: 1px; }
  .date { font-size: 11px; color: #666; text-align: right; }
  .qr { width: 100px; height: 100px; }
  .section-title { font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: #888; margin: 14px 0 4px; }
  .recipient { font-size: 16px; font-weight: 700; }
  .address { font-size: 14px; margin-top: 2px; line-height: 1.35; }
  .row { display: flex; gap: 8px; font-size: 12px; margin-top: 6px; }
  .row .lbl { color: #888; min-width: 56px; }
  .row .val { font-weight: 600; }
  .sender { margin-top: 18px; border-top: 1px dashed #bbb; padding-top: 8px; font-size: 11px; color: #444; }
  .sender strong { display: block; font-size: 13px; color: #111; }
  .qr-wrap { display: flex; justify-content: center; margin-top: 16px; }
  .track-text { font-family: monospace; font-size: 11px; word-break: break-all; text-align: center; padding: 8px; border: 1px dashed #bbb; }
  .muted { color: #aaa; font-style: italic; }
  @media print { body { padding: 6mm; } @page { margin: 0; } }
</style>
</head>
<body>
  <div class="label">
    <div class="header">
      <div class="order-no"><small>ЗАКАЗ №</small>${escapeHtml(data.orderNumber)}</div>
      <div class="date">${escapeHtml(date)}</div>
    </div>

    <div class="section-title">Получатель</div>
    <div class="recipient">${escapeHtml(data.customerName || '—')}</div>
    <div class="address">${address}</div>
    ${zone}
    ${courier}

    <div class="sender">
      <div class="section-title" style="margin-top:0">Отправитель</div>
      <strong>${escapeHtml(STUDIO_SENDER)}</strong>
      ${escapeHtml(STUDIO_CONTACT)}
    </div>

    ${qrBlock ? `<div class="qr-wrap">${qrBlock}</div>` : ''}
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 150);
    });
  </script>
</body>
</html>`;
}

/**
 * Открывает окно печати сопроводиловки. Возвращает false, если окно не удалось
 * открыть (блокировщик попапов) — вызывающий код покажет тост.
 */
export async function printDeliveryLabel(data: DeliveryLabelData): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const qrDataUrl = await buildQrDataUrl(data.trackingUrl);
  const html = buildLabelHtml(data, qrDataUrl);

  const printWindow = window.open('', '_blank', 'width=480,height=720');
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  return true;
}
