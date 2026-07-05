#!/usr/bin/env python3
"""
AI Chat Worker — Gemini (primary) + Yandex AI Studio (fallback).

Gemini 2.5 Flash Lite: бесплатно 1500 req/day, через SOCKS5 proxy.
Yandex Alice AI LLM: платно, fallback при ошибках Gemini.

Промпты собираются из YAML-конфигов через prompts/prompt_builder.py.
Каждая модель получает оптимизированный промпт под свои возможности.

lookup_prices — выполняется внутри worker (данные из PostgreSQL).
Остальные tools (select_document, show_prices, ...) — возвращаются как action в caller.

Input (stdin JSON):
  NEW: { "messages": [...], "actions?": [...], "channel": str, "context?": {...} }
  LEGACY: { "systemPrompt": str, "messages": [...], "actions?": [...], "channel?": str }

Output (stdout JSON):
  { "success": true, "result": { "text": str, "tokensUsed": int, "inputTokens": int, "outputTokens": int, "provider": str, "action?": {"name": str, "param?": str} } }
  { "success": false, "error": str }
"""

import sys
import json
import os
import re
import time
import signal

# ─── Config ───────────────────────────────────────────────────────────────────

# Gemini (primary)
GEMINI_MODEL = 'gemini-2.5-flash-lite'
GEMINI_PROXY_HOST = '127.0.0.1'
GEMINI_PROXY_PORT = 1080

# Yandex (fallback)
YANDEX_FOLDER_ID = 'b1gttu8ne7l6jcpgn6cs'
YANDEX_MODEL_NAME = 'aliceai-llm'

# Shared
MAX_TOOL_ROUNDS = 3
TIMEOUT_SECONDS = 30

PRICE_OVERRIDES = {
    'Фото на документы (паспорт, загран, виза и др.)': 700,
    'Фото на Грин-карту (Green Card)': 900,
    'Портретная съёмка': 900,
}

DB_CONFIG = {
    'host': '127.0.0.1',
    'port': '5432',
    'dbname': 'multiplatform_publication',
    'user': 'bitrix_user',
    'password': 'test_password_123',
}

INTERNAL_TOOLS = {'lookup_prices'}

# lookup_prices JSON Schema (shared between Gemini and Yandex)
LOOKUP_PRICES_SCHEMA = {
    'type': 'object',
    'properties': {
        'category': {
            'type': 'string',
            'description': 'Категория: "фото на документы", "печать", "ретушь", "ламинация" и т.д. Пустая строка — все цены.',
        },
    },
}

LOOKUP_PRICES_DESCRIPTION = 'Получить актуальные цены на услуги фотостудии. Вызови когда клиент спрашивает о ценах или стоимости.'


# ─── Helpers ──────────────────────────────────────────────────────────────────

def log(msg):
    print(f'[AI-Worker] {msg}', file=sys.stderr, flush=True)


def load_env():
    """Load .env files for API key."""
    env_paths = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'),
        '/var/www/apimain/multiplatformpublic/.env',
    ]
    for env_path in env_paths:
        try:
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith('#') or '=' not in line:
                        continue
                    key, _, value = line.partition('=')
                    os.environ.setdefault(key.strip(), value.strip())
        except FileNotFoundError:
            pass


# ─── Prices (internal tool) ─────────────────────────────────────────────────

def fetch_prices(category=None, channel='studio'):
    """Fetch prices from PostgreSQL + channel-aware filtering."""
    import psycopg2

    prices = dict(PRICE_OVERRIDES)
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute("""
            SELECT data FROM market_data_cache
            WHERE cache_key LIKE 'prices_%%' AND cache_key != 'prices_None'
              AND jsonb_typeof(data) = 'object' AND data != '{}'::jsonb
            ORDER BY expires_at DESC LIMIT 1
        """)
        row = cur.fetchone()
        if row and row[0]:
            db_prices = row[0] if isinstance(row[0], dict) else json.loads(row[0])
            prices = {**db_prices, **PRICE_OVERRIDES}
        cur.close()
        conn.close()
    except Exception as e:
        log(f'DB error: {e}')

    if channel == 'online':
        prices = {k: v for k, v in prices.items()
                  if 'онлайн' in k.lower()
                  or 'фото на документы' not in k.lower()}
    else:
        prices = {k: v for k, v in prices.items()
                  if 'онлайн' not in k.lower()}

    if category:
        cat_lower = category.lower()
        prices = {k: v for k, v in prices.items() if cat_lower in k.lower()}

    return prices


def format_prices_response(category, channel):
    """Execute lookup_prices and return formatted string."""
    prices = fetch_prices(category if category else None, channel=channel)
    lines = [f'{name}: {round(price)}₽' for name, price in prices.items()]
    content = ', '.join(lines) if lines else 'Цены временно недоступны'
    log(f'lookup_prices(category={category!r}) → {len(lines)} items')
    return content


# ─── Yandex-specific helpers ─────────────────────────────────────────────────

def execute_internal_tool(tool_call, channel='studio'):
    """Execute an internal tool call (Yandex SDK format), return result dict."""
    func = tool_call.function
    if func.name == 'lookup_prices':
        category = func.arguments.get('category', '') if func.arguments else ''
        content = format_prices_response(category, channel)
        return {'name': 'lookup_prices', 'content': content}
    else:
        return {'name': func.name, 'content': json.dumps({'error': f'Unknown internal tool: {func.name}'})}


def build_tools(sdk, actions):
    """Build Yandex SDK tool list: internal lookup_prices + dynamic UI actions."""
    tools = []

    tools.append(sdk.tools.function(
        name='lookup_prices',
        description=LOOKUP_PRICES_DESCRIPTION,
        parameters=LOOKUP_PRICES_SCHEMA,
    ))

    for action in actions:
        name = action.get('name', '')
        if not name or name in INTERNAL_TOOLS:
            continue
        desc = action.get('description', '')
        params = action.get('parameters') or {'type': 'object', 'properties': {}}
        tools.append(sdk.tools.function(name=name, description=desc, parameters=params))

    return tools


def extract_text_tool_call(text, tool_names):
    """Extract tool calls that model output as text instead of SDK tool call."""
    if not text or not tool_names:
        return text, None

    names_re = '|'.join(re.escape(n) for n in tool_names)
    match = re.search(
        r'\[(' + names_re + r')\s*[\n{]([^\]]*)\]',
        text, re.IGNORECASE | re.DOTALL,
    )
    if match:
        name = match.group(1)
        raw_args = match.group(2).strip()
        param = None
        json_str = raw_args if raw_args.startswith('{') else '{' + raw_args
        try:
            args = json.loads(json_str)
            values = list(args.values())
            if len(values) == 1:
                param = str(values[0])
            elif values:
                param = json.dumps(args, ensure_ascii=False)
        except (json.JSONDecodeError, ValueError):
            param = raw_args if raw_args else None
        cleaned = text[:match.start()].strip()
        cleaned = re.sub(r'\s*$', '', cleaned)
        return cleaned, {'name': name, 'param': param}

    match = re.search(r'\[ACTION:([a-z_]+)(?::([^\]]+))?\]\s*$', text, re.IGNORECASE)
    if match and match.group(1) in tool_names:
        name = match.group(1)
        param = match.group(2).strip() if match.group(2) else None
        cleaned = text[:match.start()].strip()
        return cleaned, {'name': name, 'param': param}

    return text, None


def extract_ui_action(tool_call):
    """Extract a UI action from a Yandex SDK tool call → {name, param}."""
    func = tool_call.function
    args = func.arguments or {}

    param = None
    if args:
        values = list(args.values())
        if len(values) == 1:
            param = str(values[0])
        elif len(values) > 1:
            param = json.dumps(args, ensure_ascii=False)

    return {'name': func.name, 'param': param}


# ─── Gemini provider ─────────────────────────────────────────────────────────

def run_gemini(system_prompt, messages, channel, api_key, model_config=None):
    """Run chat via Gemini 2.5 Flash Lite (prices in prompt, no function calling).

    Промпт уже содержит цены (вшиты prompt_builder'ом).

    Returns dict: {text, tokensUsed, inputTokens, outputTokens}
    Raises on any error (caller handles fallback).
    """
    import httpx
    from google import genai
    from google.genai import types

    start = time.time()
    cfg = model_config or {}

    # SOCKS5 proxy via httpx (Gemini API is blocked in Russia)
    proxy_url = f'socks5://{GEMINI_PROXY_HOST}:{GEMINI_PROXY_PORT}'
    httpx_client = httpx.Client(proxy=proxy_url, timeout=25.0)

    client = genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(httpx_client=httpx_client),
    )

    config = types.GenerateContentConfig(
        system_instruction=system_prompt,
        temperature=cfg.get('temperature', 0.2),
        max_output_tokens=cfg.get('max_output_tokens', 400),
        thinking_config=types.ThinkingConfig(thinking_budget=cfg.get('thinking_budget', 0)),
    )

    # Convert messages to Gemini Content format
    contents = []
    for msg in messages:
        role = msg.get('role', 'user')
        text = msg.get('text', '')
        if not text:
            continue
        gemini_role = 'model' if role == 'assistant' else 'user'
        contents.append(types.Content(
            role=gemini_role,
            parts=[types.Part(text=text)],
        ))

    log(f'Calling {GEMINI_MODEL}, {len(messages)} messages, channel={channel}')

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=config,
        )

        total_input = 0
        total_output = 0
        if response.usage_metadata:
            total_input = response.usage_metadata.prompt_token_count or 0
            total_output = response.usage_metadata.candidates_token_count or 0

        if not response.candidates:
            raise ValueError('Gemini returned no candidates')

        candidate = response.candidates[0]
        if not candidate.content or not candidate.content.parts:
            raise ValueError('Gemini returned empty content')

        text_parts = [p.text for p in candidate.content.parts
                      if p.text and not getattr(p, 'thought', False)]
        raw_text = ' '.join(text_parts).strip()

        if not raw_text:
            raise ValueError('Gemini returned empty text')

        elapsed = round((time.time() - start) * 1000)
        total = total_input + total_output
        log(f'Gemini response: {len(raw_text)} chars, {total} tokens (in={total_input}, out={total_output}), {elapsed}ms')

        return {
            'text': raw_text,
            'tokensUsed': total,
            'inputTokens': total_input,
            'outputTokens': total_output,
        }
    finally:
        httpx_client.close()


# ─── Yandex provider ─────────────────────────────────────────────────────────

def run_yandex(system_prompt, messages, channel, actions=None, model_config=None):
    """Run chat via Yandex Alice AI LLM with function calling.

    Returns dict: {text, tokensUsed, inputTokens, outputTokens, action?}
    """
    from yandex_ai_studio_sdk import AIStudio

    start = time.time()
    cfg = model_config or {}

    api_key = os.environ.get('YANDEX_CLOUD_API_KEY', '')
    if not api_key:
        raise ValueError('YANDEX_CLOUD_API_KEY not set')

    actions = actions or []

    sdk = AIStudio(folder_id=YANDEX_FOLDER_ID, auth=api_key)

    tools = build_tools(sdk, actions)
    log(f'Built {len(tools)} Yandex tools: lookup_prices + {len(tools)-1} UI actions')

    model = sdk.models.completions(YANDEX_MODEL_NAME)
    model = model.configure(
        tools=tools,
        temperature=cfg.get('temperature', 0.3),
        max_tokens=cfg.get('max_tokens', 500),
    )

    sdk_messages = [{'role': 'system', 'text': system_prompt}]
    for msg in messages:
        sdk_messages.append({
            'role': msg.get('role', 'user'),
            'text': msg.get('text', ''),
        })

    total_input = 0
    total_output = 0

    ui_tool_names = {a.get('name') for a in actions if a.get('name') and a.get('name') not in INTERNAL_TOOLS}

    log(f'Calling {YANDEX_MODEL_NAME}, {len(messages)} messages, {len(tools)} tools, channel={channel}')

    for round_num in range(MAX_TOOL_ROUNDS + 1):
        result = model.run(sdk_messages)

        if result.usage:
            total_input += result.usage.input_text_tokens
            total_output += result.usage.completion_tokens

        if result.tool_calls:
            names = [tc.function.name for tc in result.tool_calls]
            log(f'Round {round_num}: tool calls = {names}')

            internal_calls = [tc for tc in result.tool_calls if tc.function.name in INTERNAL_TOOLS]
            ui_calls = [tc for tc in result.tool_calls if tc.function.name not in INTERNAL_TOOLS]

            if ui_calls:
                ui_action = extract_ui_action(ui_calls[0])
                text = (result.text or '').strip()

                elapsed = round((time.time() - start) * 1000)
                total = total_input + total_output
                log(f'UI action: {ui_action}, text: {len(text)} chars, {total} tokens, {elapsed}ms')

                return {
                    'text': text,
                    'tokensUsed': total,
                    'inputTokens': total_input,
                    'outputTokens': total_output,
                    'action': ui_action,
                }

            sdk_messages.append(result)
            tool_results = []
            for tc in internal_calls:
                tr = execute_internal_tool(tc, channel=channel)
                tool_results.append(tr)
            sdk_messages.append({'tool_results': tool_results})
            continue

        raw_text = (result.text or '').strip()
        if not raw_text:
            raise ValueError('Yandex model returned empty response')

        text, action = extract_text_tool_call(raw_text, ui_tool_names)

        elapsed = round((time.time() - start) * 1000)
        total = total_input + total_output
        log(f'Yandex response: {len(text)} chars, {total} tokens (in={total_input}, out={total_output}), {elapsed}ms')

        result_data = {
            'text': text,
            'tokensUsed': total,
            'inputTokens': total_input,
            'outputTokens': total_output,
        }
        if action:
            result_data['action'] = action
            log(f'Text-extracted action: {action}')

        return result_data

    raise ValueError(f'Yandex: max tool rounds ({MAX_TOOL_ROUNDS}) exceeded')


# ─── Main ─────────────────────────────────────────────────────────────────────

def _build_prompt_for_model(model_name, channel, context, legacy_prompt):
    """Собрать промпт для конкретной модели.

    Если legacy_prompt задан — используем его (backward compat).
    Иначе собираем через prompt_builder из YAML-конфигов.
    """
    if legacy_prompt:
        log(f'Using legacy systemPrompt ({len(legacy_prompt)} chars)')
        if model_name == 'gemini':
            # Legacy: вшиваем цены в конец (старое поведение)
            prices = fetch_prices(channel=channel)
            price_lines = [f'{name}: {round(price)}₽' for name, price in prices.items()]
            prices_block = '\n'.join(price_lines) if price_lines else 'Цены временно недоступны'
            return f'{legacy_prompt}\n\nАктуальные цены:\n{prices_block}'
        return legacy_prompt

    from prompts.prompt_builder import build_system_prompt

    prices_text = None
    if model_name == 'gemini':
        prices = fetch_prices(channel=channel)
        price_lines = [f'{name}: {round(price)}₽' for name, price in prices.items()]
        prices_text = '\n'.join(price_lines) if price_lines else 'Цены временно недоступны'
        log(f'Loaded {len(price_lines)} prices for channel={channel}')

    prompt = build_system_prompt(model_name, channel, context, prices_text)
    log(f'Built {model_name} prompt via YAML ({len(prompt)} chars), channel={channel}')
    return prompt


def _get_model_config(model_name, legacy_mode):
    """Получить параметры модели из YAML или defaults."""
    if legacy_mode:
        return {}  # Legacy: используем дефолты из run_gemini/run_yandex
    from prompts.prompt_builder import get_model_config
    return get_model_config(model_name)


def main():
    load_env()

    input_data = json.loads(sys.stdin.read())
    messages = input_data.get('messages', [])
    actions = input_data.get('actions', [])
    channel = input_data.get('channel', 'studio')
    context = input_data.get('context')
    legacy_prompt = input_data.get('systemPrompt', '').strip() or None

    if not messages:
        raise ValueError('messages are required')

    legacy_mode = legacy_prompt is not None
    if legacy_mode:
        log('Legacy mode: using caller-provided systemPrompt')

    result = None
    provider = None

    # 1. Try Gemini (free, better quality)
    gemini_api_key = os.environ.get('GEMINI_API_KEY', '')
    if gemini_api_key:
        try:
            gemini_prompt = _build_prompt_for_model('gemini', channel, context, legacy_prompt)
            gemini_config = _get_model_config('gemini', legacy_mode)
            result = run_gemini(gemini_prompt, messages, channel, gemini_api_key, gemini_config)
            provider = 'gemini'
        except Exception as e:
            log(f'Gemini failed: {e}, falling back to Yandex')

    # 2. No fallback — if Gemini failed, return error
    if result is None:
        raise ValueError('Gemini unavailable, no fallback configured')

    log(f'Provider: {provider}')
    result['provider'] = provider
    json.dump({'success': True, 'result': result}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda s, f: (_ for _ in ()).throw(TimeoutError('Worker timeout')))
    signal.alarm(TIMEOUT_SECONDS)

    try:
        main()
    except Exception as e:
        log(f'ERROR: {e}')
        json.dump({'success': False, 'error': str(e)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
