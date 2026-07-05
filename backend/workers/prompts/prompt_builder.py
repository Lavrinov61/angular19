"""
PromptBuilder — централизованная сборка промптов для AI-чат-бота.

Собирает финальный системный промпт из YAML-конфигов
под конкретную модель (gemini/yandex) и канал (online/studio/messenger).

Использование:
    from prompts.prompt_builder import build_system_prompt

    prompt = build_system_prompt(
        model='gemini',
        channel='online',
        context={'lastStep': 'document_select', ...},
        prices_text='Фото на документы: 100₽\\n...',
    )
"""

import os
import yaml

_DIR = os.path.dirname(os.path.abspath(__file__))
_cache: dict = {}

# Маппинг channel → ключ в channel_rules.yaml
_CHANNEL_MAP = {
    'online': 'website_online',
    'studio': 'website_studio',
    'messenger': 'messenger',
}


def _load(filename: str) -> dict:
    """Загрузить и закешировать YAML-файл."""
    if filename not in _cache:
        path = os.path.join(_DIR, filename)
        with open(path, 'r', encoding='utf-8') as f:
            _cache[filename] = yaml.safe_load(f)
    return _cache[filename]


def build_system_prompt(
    model: str,
    channel: str,
    context: dict | None = None,
    prices_text: str | None = None,
) -> str:
    """Собрать финальный системный промпт.

    Args:
        model: 'gemini' | 'yandex'
        channel: 'online' | 'studio' | 'messenger'
        context: Метаданные чата (lastStep, selectedDoc, ...) — опционально
        prices_text: Форматированные цены для Gemini (вшиваются в промпт)
    """
    kb = _load('knowledge_base.yaml')
    persona = _load('persona.yaml')
    channels = _load('channel_rules.yaml')

    channel_key = _CHANNEL_MAP.get(channel, 'messenger')
    ch = channels[channel_key]
    studio = kb['studio']

    parts: list[str] = []

    # ── 1. Роль ──────────────────────────────────────────────────────────
    role = persona['role'].format(
        studio_name=studio['name'],
        city_locative=studio.get('city_locative', studio['city']),
    )
    parts.append(f"Ты — {role}. Твоя главная цель — {persona['goal']}.")

    # ── 2. О нас ─────────────────────────────────────────────────────────
    locations = ', '.join(loc['name'] for loc in studio['locations'])
    parts.append(
        f"\nО нас:"
        f"\n- Студии: {locations}."
        f"\n- Режим: {studio['hours']}."
        f"\n- Тел: {studio['phone']}."
    )
    if ch.get('booking_capable'):
        parts.append(f"- Запись онлайн: через чат или на сайте {studio['booking_url']}")

    # ── 3. Стиль общения ────────────────────────────────────────────────
    style = persona['style']
    parts.append(
        f"\nКак общаться:"
        f"\n- Пиши {style['tone']}. {style['length']}."
        f"\n- {style['format']}."
        f"\n- Отвечай на {style['language']}."
    )

    # ── 4. Запреты (общие) ───────────────────────────────────────────────
    for p in persona['prohibitions']:
        parts.append(f"- {p}")

    # ── 5. Правила канала ────────────────────────────────────────────────
    parts.append(f"\n{ch['label']}:")
    for instruction in ch['instructions']:
        parts.append(f"- {instruction}")

    # ── 6. Правила по ценам ──────────────────────────────────────────────
    pr = kb['prices']
    parts.append("\nПравила по ценам:")
    parts.append("- Никогда не придумывай цены.")
    if pr['green_card_separate']:
        parts.append("- Грин-карта (Green Card) — отдельная услуга, не путай с обычным «фото на документы».")
    parts.append(f"- {pr['paper_types']['note']}")
    if channel_key == 'website_online':
        parts.append(f"- ОНЛАЙН: {pr['online_description']}")
    elif channel_key == 'website_studio':
        parts.append(f"- ОФЛАЙН: {pr['studio_description']}")
        parts.append(f"- При желании упомяни что есть онлайн-вариант дешевле.")
    parts.append("- Если позиции нет в прайсе — скажи «Сейчас уточню стоимость, одну секунду».")

    # ── 6.5. Доставка готового результата ─────────────────────────────────
    delivery = kb.get('delivery')
    if delivery:
        parts.append(f"\nГотовый результат:")
        if channel_key == 'website_online':
            parts.append(f"- {delivery['online']}")
        else:
            parts.append(f"- {delivery['studio']}")
        parts.append(f"- {delivery['never_say']}")

    # ── 7. Запись ────────────────────────────────────────────────────────
    if ch.get('booking_capable'):
        parts.append(f"\nЗапись:")
        parts.append(f"- {kb['services']['walk_in']}")
        parts.append(f"- {kb['services']['booking_note']}")

    # ── 8. Model-specific ────────────────────────────────────────────────
    if model == 'gemini':
        parts.extend(_build_gemini_section(ch, prices_text))
    elif model == 'yandex':
        parts.extend(_build_yandex_section(ch))

    # ── 9. Контекст чата ─────────────────────────────────────────────────
    if context:
        ctx = _build_context_section(context)
        if ctx:
            parts.append(ctx)

    return '\n'.join(parts)


def _build_gemini_section(ch: dict, prices_text: str | None) -> list[str]:
    """Секция для Gemini Flash Lite — строгие ограничения + цены в тексте."""
    gemini = _load('model_overrides/gemini.yaml')
    parts = [f"\n{gemini['preamble']}"]
    for rule in gemini['extra_prohibitions']:
        parts.append(f"- {rule}")
    parts.append(f"\n{gemini['response_format']}")

    if prices_text:
        parts.append(f"\n{gemini['price_injection_header']}")
        parts.append(prices_text)

    return parts


def _build_yandex_section(ch: dict) -> list[str]:
    """Секция для Yandex Alice AI — инструкции по tools."""
    yandex = _load('model_overrides/yandex.yaml')
    parts = ["\nИнструменты:"]

    if ch.get('has_ui_actions'):
        for hint in yandex['tool_instructions']:
            parts.append(f"- {hint}")
        if ch.get('booking_capable'):
            for bi in yandex['booking_instructions']:
                parts.append(f"- {bi}")
    else:
        for hint in yandex['messenger_tool_instructions']:
            parts.append(f"- {hint}")

    return parts


def _build_context_section(context: dict) -> str | None:
    """Секция контекста чата (передаётся из website caller)."""
    lines = []

    if context.get('channelLabel'):
        lines.append(f"Канал: {context['channelLabel']}")
    if context.get('lastStep'):
        lines.append(f"Текущий шаг: {context['lastStep']}")
    if context.get('selectedDoc'):
        lines.append(f"Выбранный документ: {context['selectedDoc']}")
    if context.get('selectedTariff'):
        lines.append(f"Выбранный тариф: {context['selectedTariff']}")
    if 'uploadedPhotos' in context:
        lines.append(f"Загружено фото: {context['uploadedPhotos']}")

    pending = context.get('pendingOrder')
    if pending and pending.get('price'):
        label = pending.get('service') or pending.get('tariff') or 'заказ'
        lines.append(f"Текущий заказ: {label} — {pending['price']}₽")
    else:
        lines.append("Текущий заказ: нет")

    if not lines:
        return None

    return "\nКонтекст чата:\n" + '\n'.join(lines)


def get_model_config(model: str) -> dict:
    """Получить параметры модели (temperature, max_tokens)."""
    if model == 'gemini':
        cfg = _load('model_overrides/gemini.yaml').get('model_config', {})
        return {
            'temperature': cfg.get('temperature', 0.2),
            'max_output_tokens': cfg.get('max_output_tokens', 400),
            'thinking_budget': cfg.get('thinking_budget', 0),
        }
    elif model == 'yandex':
        cfg = _load('model_overrides/yandex.yaml').get('model_config', {})
        return {
            'temperature': cfg.get('temperature', 0.3),
            'max_tokens': cfg.get('max_tokens', 500),
        }
    return {}
