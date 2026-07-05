/**
 * Service Inference — чистый классификатор/нормализатор услуг (без БД).
 *
 * Превращает сырой признак заказа/чека/переписки в нормализованный
 * `service_slug` + грубую `category`. Используется тремя путями:
 *   - `normalizeServiceOption(item)` — позиции заказа `photo_print_orders.items[]`
 *     (приоритет slug → format/paperType → name).
 *   - `normalizeProductName(name)` — `pos_receipt_items.product_name` и chat `displayService`.
 *   - `classifyServiceText(text)` — Tier2 inference по тексту переписки клиента.
 *
 * Все правила (`SERVICE_RULES`) — module-level: regex компилируются один раз
 * при загрузке модуля, а не на каждый вызов (P1-6). Маппинг slug/слов выверен
 * по живой БД (реальные slug — латинское `km-` + кириллица), а не по англо-догадкам.
 *
 * Категории и их приоритет (`CATEGORY_PRIORITY`):
 *   document_photo > polygraphy > photo_print > copy > scan > lamination > binding > retouch > other.
 * Порядок ПРАВИЛ (`SERVICE_RULES`) — отдельный first-match-wins список, где
 * специфичное стоит раньше общего (document_photo раньше photo_print раньше copy).
 */

export interface ServiceMatch {
  /** Нормализованный slug категории ('document_photo' … 'other'). */
  slug: string;
  /** Грубая категория (совпадает со slug для основных услуг) или null, если не услуга. */
  category: string | null;
  /** Уверенность 0..1: факт-нормализация = 1.0, текстовый inference 0.4..0.8. */
  confidence: number;
  /** true, если текст содержит отказ/негацию («не печатайте», «вернуть деньги»). */
  negated: boolean;
  /** true, если удалось определить услугу (не 'other', не addon, не пусто). */
  matched: boolean;
}

/**
 * Приоритет категории для детерминированного выбора primary-услуги (P0-4).
 * Меньше число — выше приоритет. Основная услуга всегда бьёт доп (retouch).
 */
export const CATEGORY_PRIORITY: Readonly<Record<string, number>> = Object.freeze({
  document_photo: 1,
  polygraphy: 2,
  photo_print: 3,
  copy: 4,
  scan: 5,
  lamination: 6,
  binding: 7,
  retouch: 8,
  other: 9,
});

/** Slug-категории основных услуг (для валидации/итерации). */
export type ServiceCategory = keyof typeof CATEGORY_PRIORITY;

interface ServiceRule {
  /** slug категории (= ключ CATEGORY_PRIORITY). */
  readonly slug: string;
  readonly category: string;
  /** базовая уверенность для текстового совпадения по этому правилу. */
  readonly confidence: number;
  /** паттерны по slug/name/тексту — first-match-wins внутри правила. */
  readonly patterns: RegExp[];
}

/**
 * Правила в порядке приоритета (first-match-wins, специфичное раньше общего).
 * Regex с флагами `iu` (кириллица + латиница, регистронезависимо).
 *
 * ⚠️ ВАЖНО про «фото» и «документ»:
 *  - document_photo матчит только связку с «фото» (`фото…документ`, `на паспорт`,
 *    «личное дело» и пр.) — НЕ голое «документ», иначе «печать-документа» (copy)
 *    утечёт сюда.
 *  - copy проверяется ПОСЛЕ document_photo, поэтому «А4 печать документа» (без «фото»)
 *    корректно уходит в copy, а «Фото на документы» — в document_photo.
 *  - copy проверяется ДО photo_print, поэтому «ксерокопия-фото-цветная» (содержит
 *    «фото») становится copy, а не photo_print.
 */
export const SERVICE_RULES: readonly ServiceRule[] = Object.freeze([
  {
    slug: 'document_photo',
    category: 'document_photo',
    confidence: 0.8,
    patterns: [
      // slug (латинские — ASCII \b работает корректно)
      /\bpassport-rf\b/i,
      /\bzagran/i,
      /\bpassport-zagran\b/i,
      /\bvoditelskie-prava\b/i,
      /\bvoennyj-bilet\b/i,
      /\blichnoe-delo\b/i,
      /\buniform\b/i,
      /\bmedknizhka\b/i,
      /\bphoto-(license|military|pass)\b/i,
      /\bvisa\b/i,
      /км-фото-на-паспорт/i,
      /фото-документ/i,
      // name / текст (всегда в связке с «фото» / именем документа).
      // ВАЖНО: \b на кириллице в V8 не работает (ASCII word-boundary), поэтому
      // границы слов задаём lookaround по классу [а-яёa-z0-9].
      /фото.{0,6}документ/i,
      /документ.{0,6}фото/i,
      /(?<![а-яёa-z])паспорт/i,
      /загранпаспорт|на\s+загран/i,
      /на\s+визу|(?<![а-яёa-z])виз[аыу](?![а-яё])|шенген/i,
      /водительск|вод\.?\s*прав|на\s+права/i,
      /военн.{0,4}билет/i,
      /личное\s+дело/i,
      /(?<![а-яёa-z])снилс/i,
      /пропуск/i,
      /мед\.?\s*книжк/i,
      /удостоверен/i,
    ],
  },
  {
    slug: 'retouch',
    category: 'retouch',
    confidence: 0.6,
    patterns: [
      // slug (processing-none ИСКЛЮЧЁН — см. isAddonSlug)
      /\bprocessing-(max|extended|basic)\b/i,
      /\bretouch\b/i,
      /\bstudio-retouch/i,
      /км-реставрация/i,
      // name / текст
      /ретуш/i,
      /реставрац/i,
      /(?<![а-яёa-z])обработк/i,
      /облагород/i,
    ],
  },
  {
    slug: 'binding',
    category: 'binding',
    confidence: 0.7,
    patterns: [
      /\bfile-sleeve\b/i,
      /перепл[её]т/i,
      /файлик/i,
      /(?<![а-яёa-z])папк/i,
      /брошюр/i,
      /(?<![а-яёa-z])сшив/i,
      /пружин/i,
    ],
  },
  {
    slug: 'scan',
    category: 'scan',
    confidence: 0.8,
    patterns: [/\bscan-/i, /сканир|(?<![а-яёa-z])скан(?![а-яё])/i],
  },
  {
    slug: 'lamination',
    category: 'lamination',
    confidence: 0.8,
    patterns: [/ламин/i, /\blamin/i],
  },
  {
    // Специфичные copy-сигналы — выше photo_print (чтобы «ксерокопия-фото» → copy).
    // Голый формат «А4/А3» вынесен в отдельное правило ниже photo_print, иначе
    // «Фотопечать А4» жадно ловилась бы как copy (формат — не услуга, а признак).
    slug: 'copy',
    category: 'copy',
    confidence: 0.6,
    patterns: [
      // slug
      /ксерокопи/i,
      /печать-документа/i,
      /\bcopy-/i,
      /на-самоклеющейся-бумаге/i,
      // name / текст
      /печать\s+документ/i,
      /самоклей|самоклеющ/i,
      /(?<![а-яёa-z])копи/i,
    ],
  },
  {
    slug: 'polygraphy',
    category: 'polygraphy',
    confidence: 0.7,
    patterns: [
      /визитк/i,
      /фла[ейя]ер/i,
      /листовк/i,
      /(?<![а-яёa-z])бан(н)?ер/i,
      /плакат/i,
      /наклейк/i,
      /буклет/i,
      /календар/i,
    ],
  },
  {
    slug: 'photo_print',
    category: 'photo_print',
    confidence: 0.6,
    patterns: [
      // slug
      /км-фото-\d/i,
      /\bportrait-\d/i,
      /\bportrait-photo\b/i,
      // name / текст
      /полароид|polaroid/i,
      /фоторамк/i,
      /фотопечат|фото\s*печат/i,
      /распечат.{0,8}фото/i,
      /печать\s+фото/i,
      /портретн/i,
      /снимок/i,
      /фото\s*\d+\s*[xхx×]\s*\d+/i,
      /(?<!\d)\d+\s*[xхx×]\s*\d+(?!\d)/i,
    ],
  },
  {
    // Fallback: голый формат «А4/А3/А2» → copy (печать документа на формате).
    // Стоит ПОСЛЕ photo_print, поэтому «Фотопечать А4» уже стала photo_print,
    // а «А4 Печать до 15%» / «Печать А4 ч/б» (без фото-сигнала) корректно → copy.
    slug: 'copy',
    category: 'copy',
    confidence: 0.5,
    patterns: [/(?<![а-яёa-z0-9])[аa][234](?![а-яё0-9])/i],
  },
]);

/** Slug допов/опций — НЕ услуги (атрибуция не создаётся). */
const ADDON_SLUGS = new Set<string>([
  'processing-none',
  'cropping',
  'cutting',
  'border',
  'margins',
  'medals-overlay',
  'text-layout',
  'portrait-retouch-option',
]);

/**
 * true, если slug — доп/опция (cropping, cutting, border, margins, medals-overlay,
 * text-layout, portrait-retouch-option), а не самостоятельная услуга.
 *
 * ⚠️ Среди `processing-*` addon только `processing-none` (отказ от обработки).
 * `processing-max|extended|basic` — РЕАЛЬНАЯ услуга retouch (P0-3), НЕ addon.
 * Поэтому проверяем точные slug, а не префикс `processing-`.
 */
export function isAddonSlug(slug: string | null | undefined): boolean {
  if (!slug) return false;
  return ADDON_SLUGS.has(slug.trim().toLowerCase());
}

/** Пустой/несовпавший результат (не услуга). */
function noMatch(negated = false): ServiceMatch {
  return { slug: 'other', category: null, confidence: 0, negated, matched: false };
}

/**
 * Прогон строки по SERVICE_RULES (first-match-wins).
 * @param confidence если задан — переопределяет базовую уверенность правила
 *   (для факт-нормализации = 1.0, для текста — базовая из правила).
 */
function matchRules(text: string, confidence?: number): ServiceMatch | null {
  // Точное имя целевой категории (например item.type='document_photo') — прямое
  // совпадение, минуя словарь. 'other' исключён (это «не услуга»).
  const exact = text.trim().toLowerCase();
  if (exact !== 'other' && Object.prototype.hasOwnProperty.call(CATEGORY_PRIORITY, exact)) {
    return {
      slug: exact,
      category: exact,
      confidence: confidence ?? 1.0,
      negated: false,
      matched: true,
    };
  }

  for (const rule of SERVICE_RULES) {
    for (const re of rule.patterns) {
      if (re.test(text)) {
        return {
          slug: rule.slug,
          category: rule.category,
          confidence: confidence ?? rule.confidence,
          negated: false,
          matched: true,
        };
      }
    }
  }
  return null;
}

/**
 * Нормализация позиции заказа `items[]`.
 * Приоритет: slug → format/paperType(→photo_print) → service → type → name.
 * (P0-2 + ветка service/type для chat-заказов вида {service:'Фото на документы (Стандарт)'},
 * у которых нет slug/format/name — иначе attributeOrder вернул бы noMatch.)
 * Addon-slug → matched=false (не услуга). Несовпавшее → 'other'.
 */
export function normalizeServiceOption(item: {
  slug?: string | null;
  service?: string | null;
  type?: string | null;
  name?: string | null;
  format?: string | null;
  paperType?: string | null;
}): ServiceMatch {
  const slug = item.slug?.trim();

  if (slug) {
    if (isAddonSlug(slug)) return noMatch();
    const bySlug = matchRules(slug, 1.0);
    if (bySlug) return bySlug;
    // slug есть, но не распознан правилами — не падаем в name, помечаем other
    return noMatch();
  }

  // format-ветка (P0-2): «10x15», «10x15_matte», «20x30» или наличие paperType → photo_print
  const format = item.format?.trim();
  const paperType = item.paperType?.trim();
  if ((format && /^\d+\s*[xх×]\s*\d+/iu.test(format)) || paperType) {
    return {
      slug: 'photo_print',
      category: 'photo_print',
      confidence: 1.0,
      negated: false,
      matched: true,
    };
  }

  // service/type/name — человекочитаемые поля, прогоняем через тот же словарь.
  // chat-заказы кладут displayService в item.service (без slug/name).
  for (const field of [item.service, item.type, item.name]) {
    const value = field?.trim();
    if (value) {
      const byText = matchRules(value, 1.0);
      if (byText) return byText;
    }
  }

  return noMatch();
}

/**
 * Нормализация человекочитаемого названия (pos `product_name`,
 * chat `displayService`). Тот же словарь, факт-уверенность 1.0.
 */
export function normalizeProductName(name: string | null | undefined): ServiceMatch {
  const text = name?.trim();
  if (!text) return noMatch();
  return matchRules(text, 1.0) ?? noMatch();
}

// --- Tier2 inference по тексту переписки --------------------------------------

// Негация/отказ: совпадение → услуга НЕ засчитывается, помечаем negated.
// Границу перед «не» задаём lookbehind по кириллице (V8 \b не работает на ней).
const NEGATION_PATTERNS: RegExp[] = [
  /(?<![а-яё])не\s+(надо|нужно|нужен|нужна|печат|распечат|делайте|делать|делаем)/i,
  /(?<![а-яё])не\s+[а-яё]*\s*печат/i,
  /передум/i,
  /отмен(а|и|ить|ите|яю|или)/i,
  /верн(уть|ите)\s+деньг|возврат\s+денег|вернуть\s+средств/i,
  /(?<![а-яё])отказ(ыва)?/i,
];

/**
 * Stopword-guard: одиночные служебные фразы (приветствия, благодарности,
 * адрес/время работы, оплата) → пусто. Совпадение на ВСЮ нормализованную
 * строку целиком (после удаления вложений) считается мусором.
 */
const STOPWORD_FULL_PATTERNS: RegExp[] = [
  /^(привет|здравствуй(те)?|добрый\s+(день|вечер|утро)|доброе\s+утро|спасибо|благодарю|пожалуйста|ок(ей)?|хорошо|отлично|понятно|ясно|да|нет|угу|ага)[\s!.)…]*$/iu,
  /^(где\s+вы|адрес|режим\s+работы|время\s+работы|во\s+сколько|когда\s+работаете|вы\s+работаете).*/iu,
  /^(сколько\s+(будет|стоит|к\s+оплате)|какая\s+цена|цена\??|оплат(а|ил|или|ить)).*$/iu,
  /^(жду|ждём|спасибо.*связь|обратн.*связь|до\s+свидания|всего\s+доброго)[\s!.)…]*$/iu,
];

/** Метки вложений/служебные токены, не несущие текста услуги. */
const ATTACHMENT_PATTERNS: RegExp[] = [
  // [Фото], [Документ] file.pdf, [Файл: ...]. Класс исключает И ']', И '['
  // (`[^\][]`) — иначе на непарных '[' regex даёт катастрофический backtracking
  // (O(n²), ReDoS); линейная форма отрабатывает за 1мс даже на 200КБ.
  /\[[^\][]*\]/gu,
  /📷|📎|📄|🖼️/gu, // эмодзи-маркеры вложений (альтернация: 🖼️ = combined char)
];

/** Убрать метки вложений/эмодзи и схлопнуть пробелы. */
function stripNoise(text: string): string {
  let t = text;
  for (const re of ATTACHMENT_PATTERNS) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Потолок длины входа classifyServiceText (ReDoS guard, P2-1, defence-in-depth).
 * Основную ReDoS-уязвимость закрывает линейный ATTACHMENT-regex (см. выше); этот
 * cap — второй слой, чтобы любой regex работал на ограниченном входе.
 * Порог 100000 ВЫШЕ реального максимума агрегата visitor-текста по беседе
 * (измерено на живой БД: max=86293, p99=11357), поэтому текущие классификации
 * НЕ меняются (перепрогон бэкфилла не нужен), а pathological-вход усечён.
 */
const MAX_INFERENCE_INPUT = 100000;

/** Строка — это URL и больше ничего значимого. */
function isUrlOnly(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return /^(https?:\/\/\S+|www\.\S+)$/iu.test(t) || /^\S+@\S+\.\S+$/u.test(t);
}

// «обработка»/«ретушь» без иной услуги в тексте — слабый сигнал (доп).
// \w в u-режиме ASCII-only, поэтому кириллический хвост добираем явно [а-яё]*.
const WEAK_RETOUCH_ONLY = /^[^а-яёa-z0-9]*(обработк[а-яё]*|ретуш[а-яё]*)[^а-яёa-z0-9]*$/i;

/**
 * Tier2 inference по тексту клиентского сообщения. Возвращает массив совпадений
 * (мультиуслуга в одном сообщении). Анти-мусор (P3 §3.4):
 *  - вложения/эмодзи вырезаются;
 *  - URL/email-only → пусто;
 *  - stopword-guard (привет/спасибо/адрес/оплата) → пусто;
 *  - негация (не печатайте/передумал/вернуть деньги) → negated, услуга не засчитывается;
 *  - «обработка»/«ретушь» в одиночку → confidence 0.4 (слабый доп-сигнал).
 */
export function classifyServiceText(text: string | null | undefined): ServiceMatch[] {
  if (!text) return [];
  // ReDoS guard (P2-1): усечь вход ДО любых regex. Порог > реального максимума → данные не меняются.
  const capped = String(text).slice(0, MAX_INFERENCE_INPUT);
  const cleaned = stripNoise(capped);
  if (!cleaned || cleaned.length < 2) return [];

  if (isUrlOnly(cleaned)) return [];

  const negated = NEGATION_PATTERNS.some((re) => re.test(cleaned));
  if (negated) {
    return [{ slug: 'other', category: null, confidence: 0, negated: true, matched: false }];
  }

  if (STOPWORD_FULL_PATTERNS.some((re) => re.test(cleaned))) return [];

  // «обработка»/«ретушь» в одиночку — слабый сигнал (доп, не основная услуга)
  if (WEAK_RETOUCH_ONLY.test(cleaned)) {
    return [{ slug: 'retouch', category: 'retouch', confidence: 0.4, negated: false, matched: true }];
  }

  // Собираем все категории, которые встречаются (мультиуслуга), порядок = приоритет правил.
  const seen = new Set<string>();
  const matches: ServiceMatch[] = [];
  for (const rule of SERVICE_RULES) {
    if (seen.has(rule.slug)) continue;
    for (const re of rule.patterns) {
      if (re.test(cleaned)) {
        seen.add(rule.slug);
        matches.push({
          slug: rule.slug,
          category: rule.category,
          confidence: rule.confidence,
          negated: false,
          matched: true,
        });
        break;
      }
    }
  }

  return matches;
}
