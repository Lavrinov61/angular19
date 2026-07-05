import { describe, expect, it } from 'vitest';
import {
  CATEGORY_PRIORITY,
  classifyServiceText,
  isAddonSlug,
  normalizeProductName,
  normalizeServiceOption,
  SERVICE_RULES,
} from './service-inference.js';

describe('normalizeServiceOption — приоритет slug', () => {
  it('passport-rf → document_photo (факт 1.0)', () => {
    const m = normalizeServiceOption({ slug: 'passport-rf' });
    expect(m).toMatchObject({ slug: 'document_photo', category: 'document_photo', matched: true });
    expect(m.confidence).toBe(1.0);
  });

  it('km-а4-печать-документа → copy', () => {
    expect(normalizeServiceOption({ slug: 'km-а4-печать-документа' }).slug).toBe('copy');
  });

  it('km-фото-10x15-супер → photo_print', () => {
    expect(normalizeServiceOption({ slug: 'km-фото-10x15-супер' }).slug).toBe('photo_print');
  });

  it('km-а4-ксерокопия-фото-цветная → copy (НЕ photo_print, trap)', () => {
    expect(normalizeServiceOption({ slug: 'km-а4-ксерокопия-фото-цветная' }).slug).toBe('copy');
  });

  it('km-фото-на-паспорт → document_photo (НЕ photo_print)', () => {
    expect(normalizeServiceOption({ slug: 'km-фото-на-паспорт' }).slug).toBe('document_photo');
  });

  it('file-sleeve → binding', () => {
    expect(normalizeServiceOption({ slug: 'file-sleeve' }).slug).toBe('binding');
  });

  it('scan-manual → scan', () => {
    expect(normalizeServiceOption({ slug: 'scan-manual' }).slug).toBe('scan');
  });

  it('lamination → lamination', () => {
    expect(normalizeServiceOption({ slug: 'lamination' }).slug).toBe('lamination');
  });

  it('km-реставрация-фото-простая → retouch', () => {
    expect(normalizeServiceOption({ slug: 'km-реставрация-фото-простая' }).slug).toBe('retouch');
  });

  it('processing-max / studio-retouch-basic → retouch', () => {
    expect(normalizeServiceOption({ slug: 'processing-max' }).slug).toBe('retouch');
    expect(normalizeServiceOption({ slug: 'studio-retouch-basic' }).slug).toBe('retouch');
  });

  it('km-визитки-бумага-100-шт → polygraphy', () => {
    expect(normalizeServiceOption({ slug: 'km-визитки-бумага-100-шт' }).slug).toBe('polygraphy');
  });

  it('km-а4-на-самоклеющейся-бумаге → copy', () => {
    expect(normalizeServiceOption({ slug: 'km-а4-на-самоклеющейся-бумаге' }).slug).toBe('copy');
  });

  it('реальные document_photo-slug', () => {
    for (const slug of [
      'zagranpassport',
      'passport-zagran',
      'voditelskie-prava',
      'voennyj-bilet',
      'lichnoe-delo',
      'uniform',
      'medknizhka',
      'visa',
      'photo-license',
      'photo-military',
      'photo-pass',
      'km-а4-фото-документ',
    ]) {
      expect(normalizeServiceOption({ slug }).slug, slug).toBe('document_photo');
    }
  });

  it('portrait-10x15-super → photo_print', () => {
    expect(normalizeServiceOption({ slug: 'portrait-10x15-super' }).slug).toBe('photo_print');
  });
});

describe('normalizeServiceOption — addon-slug skip', () => {
  it.each([
    'processing-none',
    'cropping',
    'cutting',
    'border',
    'margins',
    'medals-overlay',
    'text-layout',
    'portrait-retouch-option',
  ])('%s → addon (matched=false)', (slug) => {
    const m = normalizeServiceOption({ slug });
    expect(m.matched).toBe(false);
    expect(m.category).toBeNull();
  });

  it('processing-none НЕ становится retouch', () => {
    expect(normalizeServiceOption({ slug: 'processing-none' }).slug).not.toBe('retouch');
    expect(isAddonSlug('processing-none')).toBe(true);
  });
});

describe('normalizeServiceOption — format/paperType ветка (P0-2)', () => {
  it('format 10x15_matte → photo_print', () => {
    expect(normalizeServiceOption({ format: '10x15_matte' }).slug).toBe('photo_print');
  });

  it('format 20x30 → photo_print', () => {
    expect(normalizeServiceOption({ format: '20x30' }).slug).toBe('photo_print');
  });

  it('format с кириллической х (20х30) → photo_print', () => {
    expect(normalizeServiceOption({ format: '20х30_super' }).slug).toBe('photo_print');
  });

  it('только paperType (без format) → photo_print', () => {
    expect(normalizeServiceOption({ paperType: 'glossy' }).slug).toBe('photo_print');
  });

  it('format/paperType вступают в силу только при пустом slug', () => {
    // slug приоритетнее: passport-rf бьёт format
    expect(normalizeServiceOption({ slug: 'passport-rf', format: '10x15' }).slug).toBe('document_photo');
  });
});

describe('normalizeServiceOption — fallback по name и other', () => {
  it('пустой item → other (matched=false)', () => {
    expect(normalizeServiceOption({}).matched).toBe(false);
  });

  it('нераспознанный slug → other, НЕ падает в name', () => {
    const m = normalizeServiceOption({ slug: 'whatever-unknown-xyz', name: 'Паспорт РФ' });
    expect(m.matched).toBe(false);
    expect(m.slug).toBe('other');
  });

  it('нет slug/format, но есть name → нормализуем name', () => {
    expect(normalizeServiceOption({ name: 'Паспорт РФ 3,5×4,5' }).slug).toBe('document_photo');
  });
});

describe('normalizeServiceOption — ветка service/type (chat-заказы)', () => {
  it('item.service «Фото на документы (Стандарт)» → document_photo', () => {
    expect(normalizeServiceOption({ service: 'Фото на документы (Стандарт)' }).slug).toBe('document_photo');
  });

  it('item.service «Фото на документы (Экспресс)» → document_photo', () => {
    expect(normalizeServiceOption({ service: 'Фото на документы (Экспресс)' }).slug).toBe('document_photo');
  });

  it('реальные item.service из chat-заказов', () => {
    expect(normalizeServiceOption({ service: 'Фото на паспорт РФ' }).slug).toBe('document_photo');
    expect(normalizeServiceOption({ service: 'А4 Печать документа' }).slug).toBe('copy');
    expect(normalizeServiceOption({ service: 'Фото на документы (фото на документы (экспресс))' }).slug).toBe('document_photo');
  });

  it('item.type как готовое имя категории → та же категория', () => {
    expect(normalizeServiceOption({ type: 'document_photo' }).slug).toBe('document_photo');
    expect(normalizeServiceOption({ type: 'photo_print' }).slug).toBe('photo_print');
  });

  it('service выигрывает у type, но проигрывает slug/format', () => {
    // slug приоритетнее service
    expect(normalizeServiceOption({ slug: 'passport-rf', service: 'Сканирование' }).slug).toBe('document_photo');
    // format приоритетнее service
    expect(normalizeServiceOption({ format: '10x15_matte', service: 'Сканирование' }).slug).toBe('photo_print');
    // service приоритетнее type
    expect(normalizeServiceOption({ service: 'Сканирование', type: 'photo_print' }).slug).toBe('scan');
  });

  it('распознанный confidence факт-нормализации = 1.0', () => {
    expect(normalizeServiceOption({ service: 'Фото на документы (Стандарт)' }).confidence).toBe(1.0);
  });

  it('нераспознанный service → other', () => {
    expect(normalizeServiceOption({ service: 'Печать на кружках' }).matched).toBe(false);
  });

  it('SMOKE: {slug:passport-rf} не изменился после правки', () => {
    const m = normalizeServiceOption({ slug: 'passport-rf' });
    expect(m).toMatchObject({ slug: 'document_photo', category: 'document_photo', matched: true });
    expect(m.confidence).toBe(1.0);
  });
});

describe('normalizeProductName — pos product_name / displayService', () => {
  it.each<[string, string]>([
    ['Паспорт РФ 3,5×4,5', 'document_photo'],
    ['Фото на загранпаспорт', 'document_photo'],
    ['Фото на права', 'document_photo'],
    ['Фото на визу', 'document_photo'],
    ['Фото для пропуска', 'document_photo'],
    ['Фото на военный билет', 'document_photo'],
    ['Личное дело 3×4', 'document_photo'],
    ['Медкнижка 3×4', 'document_photo'],
    ['Фото на документы', 'document_photo'],
    ['Фото на документы + ретушь', 'document_photo'],
    ['Фото на ветеранское удостоверение ', 'document_photo'],
    ['А4 Ксерокопия', 'copy'],
    ['А3 Ксерокопия', 'copy'],
    ['А4 Ксерокопия Фото Цветная', 'copy'],
    ['А4 Печать до 15%', 'copy'],
    ['А4 Печать документа', 'copy'],
    ['А4 на Самоклеющейся бумаге', 'copy'],
    ['Печать А4 ч/б', 'copy'],
    ['Базовая обработка', 'retouch'],
    ['Максимальная обработка', 'retouch'],
    ['Расширенная обработка', 'retouch'],
    ['Реставрация фото (сложная)', 'retouch'],
    [' ретушь ', 'retouch'],
    ['Сканирование', 'scan'],
    ['Ламинирование', 'lamination'],
    ['Переплёт пружиной пластиковой А4', 'binding'],
    ['папка', 'binding'],
    ['Файлик', 'binding'],
    ['Визитки (бумага) 100 шт.', 'polygraphy'],
    ['Печать наклейки', 'polygraphy'],
    ['Фото 10x15 премиум', 'photo_print'],
    ['В стиле Полароид', 'photo_print'],
    ['Фото в стиле полароид 14 шт', 'photo_print'],
    ['А4 фоторамка', 'photo_print'],
    ['фотопечать', 'photo_print'],
    ['Фотопечать А4', 'photo_print'],
    ['Печать фото 10x15', 'photo_print'],
    ['Портретная съёмка: Портретное фото', 'photo_print'],
  ])('«%s» → %s', (name, expected) => {
    expect(normalizeProductName(name).slug, name).toBe(expected);
  });

  it('пустая/служебная строка → other', () => {
    expect(normalizeProductName('').matched).toBe(false);
    expect(normalizeProductName('Минимальный чек').matched).toBe(false);
    expect(normalizeProductName('Оплата 570₽').matched).toBe(false);
  });

  it('«Печать на кружках» (сувенирка вне таксономии) → other', () => {
    expect(normalizeProductName('Печать на кружках').matched).toBe(false);
  });
});

describe('classifyServiceText — Tier2 inference', () => {
  it('«сделайте фото на паспорт» → document_photo', () => {
    const r = classifyServiceText('сделайте фото на паспорт');
    expect(r.some((m) => m.slug === 'document_photo')).toBe(true);
  });

  it('«На водительское удостоверение так можно?» → document_photo', () => {
    expect(classifyServiceText('На водительское удостоверение так можно?').some((m) => m.slug === 'document_photo')).toBe(true);
  });

  it('«распечатайте полароидом» → photo_print', () => {
    expect(classifyServiceText('распечатайте полароидом').some((m) => m.slug === 'photo_print')).toBe(true);
  });

  it('«Размер фотографий A5» / печать фото → photo_print', () => {
    expect(classifyServiceText('напечатайте фото 10x15').some((m) => m.slug === 'photo_print')).toBe(true);
  });

  it('«3 Банера» → polygraphy', () => {
    expect(classifyServiceText('3 Банера').some((m) => m.slug === 'polygraphy')).toBe(true);
  });

  it('«ламинация и подрезка по краям» → lamination', () => {
    expect(classifyServiceText('ламинация и подрезка по краям').some((m) => m.slug === 'lamination')).toBe(true);
  });

  it('confidence inferred-совпадений лежит в 0.4..0.8', () => {
    for (const m of classifyServiceText('напечатайте фото 10x15')) {
      expect(m.confidence).toBeGreaterThanOrEqual(0.4);
      expect(m.confidence).toBeLessThanOrEqual(0.8);
    }
  });

  it('мультиуслуга в одном сообщении (фото + ламинация)', () => {
    const slugs = classifyServiceText('напечатайте фото 10x15 и заламинируйте').map((m) => m.slug);
    expect(slugs).toContain('photo_print');
    expect(slugs).toContain('lamination');
  });
});

describe('classifyServiceText — негация (negated)', () => {
  it.each([
    'вторую фотку не печатайте',
    'не надо печатать',
    'я передумал',
    'отмените заказ',
    'верните деньги',
  ])('«%s» → negated, услуга не засчитана', (text) => {
    const r = classifyServiceText(text);
    expect(r).toHaveLength(1);
    expect(r[0]?.negated).toBe(true);
    expect(r[0]?.matched).toBe(false);
  });
});

describe('classifyServiceText — анти-мусор (stopword/URL/вложения)', () => {
  it.each([
    'Привет',
    'Спасибо!',
    'Здравствуйте',
    'Добрый день',
    'Отлично',
    'Жду обратной связи',
    'Сколько будет к оплате?',
    'Все оплатили✨',
    'Соборный 21',
    'Богдан',
    'Каленикова Анастасия',
  ])('«%s» → пусто', (text) => {
    expect(classifyServiceText(text)).toEqual([]);
  });

  it('URL-only → пусто', () => {
    expect(classifyServiceText('https://example.com/path?x=1')).toEqual([]);
    expect(classifyServiceText('www.svoefoto.ru')).toEqual([]);
  });

  it('email-only → пусто', () => {
    expect(classifyServiceText('client@mail.ru')).toEqual([]);
  });

  it('метка вложения [Документ] file.JPG не даёт document_photo', () => {
    expect(classifyServiceText('[Документ] IMG_2586.HEIC')).toEqual([]);
    expect(classifyServiceText('[Фото]')).toEqual([]);
    expect(classifyServiceText('[Файл: scan.pdf]')).toEqual([]);
    expect(classifyServiceText('📷 Фото 1/2')).toEqual([]);
  });

  it('пустой/короткий ввод → пусто', () => {
    expect(classifyServiceText('')).toEqual([]);
    expect(classifyServiceText(null)).toEqual([]);
    expect(classifyServiceText(undefined)).toEqual([]);
    expect(classifyServiceText('  ')).toEqual([]);
  });

  it('ReDoS guard: 50k открывающих скобок без зависания → []', () => {
    const start = Date.now();
    const result = classifyServiceText('['.repeat(50000));
    const elapsed = Date.now() - start;
    expect(result).toEqual([]);
    expect(elapsed).toBeLessThan(1000); // линейный bracket-regex → не O(n²)
  });

  it('ReDoS guard: 500k открывающих скобок (сценарий тикета 600КБ) отрабатывает быстро', () => {
    const start = Date.now();
    expect(classifyServiceText('['.repeat(500000))).toEqual([]);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('ReDoS guard: длинный валидный текст классифицируется быстро', () => {
    // услуга в начале текста — определяется; cap 100000 + линейный regex → без зависания
    const long = 'фото на паспорт ' + 'a'.repeat(60000);
    const start = Date.now();
    const slugs = classifyServiceText(long).map((m) => m.slug);
    expect(Date.now() - start).toBeLessThan(1000);
    expect(slugs).toContain('document_photo');
  });
});

describe('classifyServiceText — «обработка»/«ретушь» в одиночку = weak 0.4', () => {
  it.each(['обработка', 'Ретушь', 'ретушь'])('«%s» → retouch confidence 0.4', (text) => {
    const r = classifyServiceText(text);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ slug: 'retouch', confidence: 0.4, matched: true });
  });

  it('«обработка» внутри фразы с другой услугой НЕ режется до weak', () => {
    // «фото на паспорт ... обработка» — document_photo доминирует, retouch как доп
    const slugs = classifyServiceText('фото на паспорт и обработка').map((m) => m.slug);
    expect(slugs).toContain('document_photo');
  });
});

describe('isAddonSlug', () => {
  it.each(['processing-none', 'cropping', 'cutting', 'border', 'margins', 'medals-overlay', 'portrait-retouch-option'])(
    '%s → true',
    (slug) => {
      expect(isAddonSlug(slug)).toBe(true);
    },
  );

  // processing-max/extended/basic — это РЕАЛЬНАЯ услуга retouch (P0-3), НЕ addon
  it.each(['passport-rf', 'retouch', 'processing-max', 'processing-basic', 'file-sleeve', 'km-фото-10x15-супер'])(
    '%s → false',
    (slug) => {
      expect(isAddonSlug(slug)).toBe(false);
    },
  );

  it('пустое/undefined → false', () => {
    expect(isAddonSlug(null)).toBe(false);
    expect(isAddonSlug(undefined)).toBe(false);
    expect(isAddonSlug('')).toBe(false);
  });
});

describe('CATEGORY_PRIORITY & SERVICE_RULES — контракт для S3', () => {
  it('приоритет: document_photo бьёт photo_print бьёт copy бьёт retouch', () => {
    expect(CATEGORY_PRIORITY.document_photo).toBeLessThan(CATEGORY_PRIORITY.photo_print);
    expect(CATEGORY_PRIORITY.photo_print).toBeLessThan(CATEGORY_PRIORITY.copy);
    expect(CATEGORY_PRIORITY.copy).toBeLessThan(CATEGORY_PRIORITY.retouch);
    expect(CATEGORY_PRIORITY.other).toBe(9);
  });

  it('каждое правило ссылается на известную категорию из CATEGORY_PRIORITY', () => {
    for (const rule of SERVICE_RULES) {
      expect(CATEGORY_PRIORITY[rule.category], rule.category).toBeDefined();
    }
  });

  it('document_photo стоит в правилах раньше photo_print и copy (first-match-wins)', () => {
    const order = SERVICE_RULES.map((r) => r.slug);
    expect(order.indexOf('document_photo')).toBeLessThan(order.indexOf('photo_print'));
    expect(order.indexOf('copy')).toBeLessThan(order.indexOf('photo_print'));
  });
});
