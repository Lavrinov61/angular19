-- WhatsApp Gupshup BSP credentials
-- Заполняет credentials для channel_accounts whatsapp
-- Данные из Gupshup dashboard MagnusPhoto2

UPDATE channel_accounts
SET credentials = jsonb_build_object(
  'provider', 'gupshup',
  'apiKey', 'sk_3e275a81b349435c8e3e8fc90aceece0',
  'appName', 'MagnusPhoto2',
  'sourcePhone', '79014178668',
  'phoneNumberId', '650747481463572',
  'wabaId', '638985682536578'
),
health_check_ok = NULL,
health_check_error = NULL
WHERE channel::text = 'whatsapp'
  AND id = '9e622a16-a73b-4c97-ac43-3c0a7066acd7';
