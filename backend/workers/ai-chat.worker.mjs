#!/usr/bin/env node

/**
 * Standalone AI Chat Worker.
 * Runs in clean Node.js, OUTSIDE Angular SSR (esbuild).
 *
 * Сам грузит .env — не зависит от esbuild-бандла.
 *
 * Input (stdin JSON):
 *   { messages: [{role, text}], systemPrompt: string, actions?: Array }
 *
 * Output (stdout JSON):
 *   { success: true, result: { text: string, tokensUsed: number, inputTokens: number, outputTokens: number } }
 *   { success: false, error: string }
 *
 * Logs go to stderr.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ============================================================================
// Load .env самостоятельно (без dotenv — он может не стоять глобально)
// ============================================================================

function loadEnv() {
  try {
    const envPath = resolve(process.cwd(), 'backend/.env');
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // .env not found — rely on system env vars
  }
}

loadEnv();

// ============================================================================
// Config
// ============================================================================

const YANDEX_API_KEY = process.env.YANDEX_CLOUD_API_KEY || '';
const FOLDER_ID = process.env.YANDEX_CLOUD_FOLDER_ID || 'b1gttu8ne7l6jcpgn6cs';
const MODEL = process.env.YANDEX_CLOUD_MODEL || 'aliceai-llm/latest';
const ENDPOINT = 'https://ai.api.cloud.yandex.net/v1/responses';

function log(...args) {
  console.error('[AI-Worker]', ...args);
}

// ============================================================================
// Alice AI (OpenAI-compatible API) call
// ============================================================================

async function callYandexGPT(systemPrompt, messages) {
  if (!YANDEX_API_KEY) {
    throw new Error('YANDEX_CLOUD_API_KEY not found in backend/.env or environment');
  }

  // Конвертируем историю сообщений в формат OpenAI Responses API
  const inputMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.text,
  }));

  const body = {
    model: `gpt://${FOLDER_ID}/${MODEL}`,
    instructions: systemPrompt,
    input: inputMessages,
    temperature: 0.3,
    max_output_tokens: 500,
  };

  log(`Calling ${MODEL}, ${messages.length} messages in history`);
  const start = Date.now();

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Api-Key ${YANDEX_API_KEY}`,
      'Content-Type': 'application/json',
      'x-folder-id': FOLDER_ID,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AliceAI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const elapsed = Date.now() - start;

  // OpenAI Responses API формат: data.output_text или data.output[].content
  const text = data.output_text
    || data.output?.map(o => o.content?.map(c => c.text).join('')).join('')
    || '';

  if (!text) {
    throw new Error('AliceAI returned empty response');
  }

  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  const tokensUsed = inputTokens + outputTokens;

  log(`Response: ${text.length} chars, ${tokensUsed} tokens (in=${inputTokens}, out=${outputTokens}), ${elapsed}ms`);

  return { text: text.trim(), tokensUsed, inputTokens, outputTokens };
}

function formatActions(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return '';
  const lines = actions.map((action) => {
    const name = action?.name || 'unknown';
    const desc = action?.description || '';
    const params = action?.parameters?.properties
      ? Object.entries(action.parameters.properties)
        .map(([key, meta]) => {
          const enums = Array.isArray(meta.enum) ? ` (${meta.enum.join(', ')})` : '';
          return `${key}${enums}`;
        })
        .join('; ')
      : '';
    return `- ${name}${desc ? `: ${desc}` : ''}${params ? ` | params: ${params}` : ''}`;
  });
  return `\n\nДоступные действия:\n${lines.join('\n')}`;
}

function extractActionTag(text) {
  if (!text) return { text: '', action: null };
  const match = text.match(/\[ACTION:([a-z_]+)(?::([^\]]+))?\]\s*$/i);
  if (!match) {
    return { text: text.trim(), action: null };
  }
  const name = match[1];
  const param = match[2]?.trim();
  const cleaned = text.replace(match[0], '').trim();
  return { text: cleaned, action: { name, param } };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  let inputData = '';
  for await (const chunk of process.stdin) {
    inputData += chunk;
  }

  const input = JSON.parse(inputData);
  const { systemPrompt, messages, actions } = input;

  if (!systemPrompt) throw new Error('systemPrompt is required');
  if (!messages || !Array.isArray(messages)) throw new Error('messages array is required');

  const actionsPrompt = formatActions(actions);
  const result = await callYandexGPT(`${systemPrompt}${actionsPrompt}`, messages);

  const parsed = extractActionTag(result.text || '');

  process.stdout.write(JSON.stringify({
    success: true,
    result: {
      text: parsed.text,
      tokensUsed: result.tokensUsed,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      action: parsed.action,
    },
  }));
}

main().catch(err => {
  log('ERROR:', err.message);
  process.stdout.write(JSON.stringify({ success: false, error: err.message }));
  process.exit(1);
});
