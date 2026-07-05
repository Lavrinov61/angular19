-- AI catalog aliases (v2) для базовых категорий, чтобы бот лучше матчил клиентские
-- формулировки на существующие категории каталога (text-поиск частичен без алиасов).
-- Источник истины — каталог; алиасы только помогают резолвить слова клиента.
-- ВАЖНО: slug='scan-services' (НЕ 'scan' — такой категории нет, был бы no-op).
-- Идемпотентно: || перезаписывает ключ ai_aliases только у указанных категорий.

UPDATE service_categories
   SET metadata = COALESCE(metadata, '{}'::jsonb)
     || jsonb_build_object('ai_aliases', jsonb_build_array(
          'фото на документы','фото на паспорт','фото 3х4','фото 3x4','фото на визу',
          'фото на загранпаспорт','фото на права','photo docs'))
     , updated_at = NOW()
 WHERE slug = 'photo-docs';

UPDATE service_categories
   SET metadata = COALESCE(metadata, '{}'::jsonb)
     || jsonb_build_object('ai_aliases', jsonb_build_array(
          'ксерокопия','ксерокс','копия','распечатать','распечатать документ',
          'печать документа','распечатка','напечатать','copy print'))
     , updated_at = NOW()
 WHERE slug = 'copy-print';

UPDATE service_categories
   SET metadata = COALESCE(metadata, '{}'::jsonb)
     || jsonb_build_object('ai_aliases', jsonb_build_array(
          'фотопечать','напечатать фото','печать фото','распечатать фото',
          '10х15','10x15','фото 10х15','photo print'))
     , updated_at = NOW()
 WHERE slug = 'photo-print-format';

UPDATE service_categories
   SET metadata = COALESCE(metadata, '{}'::jsonb)
     || jsonb_build_object('ai_aliases', jsonb_build_array(
          'скан','сканирование','отсканировать','сканировать','скан документа','scan'))
     , updated_at = NOW()
 WHERE slug = 'scan-services';
