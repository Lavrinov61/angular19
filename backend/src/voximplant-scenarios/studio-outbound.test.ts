import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const scenarioSource = readFileSync(new URL('./studio-outbound.js', import.meta.url), 'utf8');
const configSource = readFileSync(new URL('../config/index.ts', import.meta.url), 'utf8');
const realtimeScenarioSource = scenarioSource.slice(
  scenarioSource.indexOf('function startServiceSurveyRealtime'),
);

function extractSingleQuotedConst(source: string, constName: string): string {
  const match = new RegExp(`const ${constName} = '([^']*)';`).exec(source)
    ?? new RegExp(`var ${constName} = '([^']*)';`).exec(source);
  expect(match).not.toBeNull();
  return match?.[1] ?? '';
}

function extractHandlerSource(eventName: string): string {
  const listenerStart = scenarioSource.indexOf(`addEventListener(${eventName}`);
  expect(listenerStart).toBeGreaterThanOrEqual(0);

  const listenerTail = scenarioSource.slice(listenerStart);
  const listenerEndMatch = /\n\s{6,8}\}\);/.exec(listenerTail);
  expect(listenerEndMatch).not.toBeNull();
  const listenerEnd = listenerStart + (listenerEndMatch?.index ?? 0);

  return scenarioSource.slice(listenerStart, listenerEnd);
}

describe('studio-outbound Grok realtime scenario', () => {
  it('keeps the survey call open after ordinary native Grok media playback ends', () => {
    expect(scenarioSource).not.toContain('hangupRequested');
    expect(scenarioSource).not.toContain('startHangupGrace');
    expect(scenarioSource).not.toContain('grok_hangup_complete');
    expect(scenarioSource).toContain('Grok.Events.WebSocketMediaEnded');
    expect(scenarioSource).not.toContain("finish('grok_media_ended'");
  });

  it('captures native Grok transcription events into the final transcript', () => {
    expect(scenarioSource).toContain('Grok.VoiceAgentAPIEvents.ResponseOutputAudioTranscriptDone');
    expect(scenarioSource).toContain('appendTranscriptFromGrokEvent');
    expect(scenarioSource).toContain("transcriptLines.push('Клиент: '");
    expect(scenarioSource).toContain("transcriptLines.push('Бот: '");
  });

  it('uses native Grok media clearing when xAI detects barge-in', () => {
    expect(scenarioSource).toContain('Grok.VoiceAgentAPIEvents.InputAudioBufferSpeechStarted');
    expect(scenarioSource).toContain('clearMediaBuffer');
    expect(scenarioSource).not.toContain("customEvent: 'barge_in'");
  });

  it('routes Grok realtime through the native Voximplant Grok client instead of our media bridge', () => {
    expect(scenarioSource).toContain('require(Modules.Grok)');
    expect(scenarioSource).toContain('Grok.createVoiceAgentAPIClient');
    expect(scenarioSource).toContain('VoxEngine.sendMediaBetween(customerCall, voiceAgentAPIClient)');
    expect(realtimeScenarioSource).not.toContain('realtimeBridgeUrl');
    expect(realtimeScenarioSource).not.toContain('VoxEngine.createWebSocket');
    expect(realtimeScenarioSource).not.toContain('WebSocketAudioEncoding.ULAW');
  });

  it('passes only Russian-language context to Grok realtime', () => {
    expect(scenarioSource).toContain('Разговор на русском');
    expect(configSource).toContain('Разговор на русском');
  });

  it('uses the xAI console voice id for Irina rather than a built-in voice name', () => {
    expect(scenarioSource).toContain("realtimeVoice ? String(data.realtimeVoice) : 'om17cury'");
    expect(configSource).toContain("realtimeVoice: process.env['VOXIMPLANT_SERVICE_SURVEY_REALTIME_VOICE'] || 'om17cury'");
  });

  it('keeps Grok realtime instructions as context and information, not a spoken script', () => {
    const configPrompt = extractSingleQuotedConst(configSource, 'DEFAULT_REALTIME_INSTRUCTIONS');
    const scenarioPrompt = extractSingleQuotedConst(scenarioSource, 'SERVICE_SURVEY_REALTIME_FALLBACK_INSTRUCTIONS');

    expect(configSource).toContain('Контекст: звонок от Своё Фото клиенту');
    expect(configSource).toContain('Причина звонка: узнать, нужна ли клиенту помощь по услугам');
    expect(configSource).toContain('Своё Фото: фото на документы, печать и дизайн');
    expect(scenarioSource).toContain('Контекст: звонок от Своё Фото клиенту');
    expect(scenarioSource).toContain('Причина звонка: узнать, нужна ли клиенту помощь по услугам');
    expect(scenarioSource).toContain('Своё Фото: фото на документы, печать и дизайн');
    expect(configPrompt).not.toContain('ИИ-помощник');
    expect(scenarioPrompt).not.toContain('ИИ-помощник');
    expect(configPrompt).not.toContain('человек ли ты');
    expect(scenarioPrompt).not.toContain('человек ли ты');
    expect(configPrompt).not.toContain('ты сам');
    expect(scenarioPrompt).not.toContain('ты сам');
    expect(configPrompt).not.toContain('Цель:');
    expect(scenarioPrompt).not.toContain('Цель:');
    expect(configSource).not.toContain('Я голосовой помощник студии Своё Фото');
    expect(scenarioSource).not.toContain('Я голосовой помощник студии Своё Фото');
    expect(configSource).not.toContain('Тебя зовут Ирина');
    expect(scenarioSource).not.toContain('Тебя зовут Ирина');
    expect(configSource).not.toContain('менеджер');
    expect(scenarioSource).not.toContain('менеджер');
    expect(configPrompt).not.toContain('впечатление');
    expect(scenarioPrompt).not.toContain('впечатление');
    expect(configPrompt).not.toContain('фотосесс');
    expect(scenarioPrompt).not.toContain('фотосесс');
    expect(configPrompt).not.toContain('после визита');
    expect(scenarioPrompt).not.toContain('после визита');
    expect(configPrompt).not.toContain('заказ');
    expect(scenarioPrompt).not.toContain('заказ');
  });

  it('does not hard-code a first realtime question or recording disclaimer', () => {
    expect(scenarioSource).not.toContain('SERVICE_SURVEY_REALTIME_GREETING');
    expect(scenarioSource).not.toContain('SERVICE_SURVEY_REALTIME_FIRST_TURN_TEXT');
    expect(configSource.toLowerCase()).not.toContain('как у вас всё прошло');
    expect(scenarioSource.toLowerCase()).not.toContain('как у вас всё прошло');
    expect(configSource).not.toContain('Начни');
    expect(scenarioSource).not.toContain('Начни');
    expect(configSource).not.toContain('звонок записывается');
    expect(scenarioSource).not.toContain('звонок записывается');
  });

  it('does not script realtime replies with conditional branches', () => {
    expect(configSource).not.toContain('Если клиент');
    expect(scenarioSource).not.toContain('Если клиент');
    expect(configSource).not.toContain('Если клиент переспросил');
    expect(scenarioSource).not.toContain('Если клиент переспросил');
    expect(configSource).not.toContain('Поняла, спасибо');
    expect(scenarioSource).not.toContain('Поняла, спасибо');
    expect(configSource).not.toContain('Не работай по скрипту');
    expect(scenarioSource).not.toContain('Не работай по скрипту');
    expect(configSource).not.toContain('не повторяй один вопрос');
    expect(scenarioSource).not.toContain('не повторяй один вопрос');
  });

  it('keeps the realtime prompt concise and avoids meta text that can leak into speech', () => {
    const configPrompt = extractSingleQuotedConst(configSource, 'DEFAULT_REALTIME_INSTRUCTIONS');
    const scenarioPrompt = extractSingleQuotedConst(scenarioSource, 'SERVICE_SURVEY_REALTIME_FALLBACK_INSTRUCTIONS');

    expect(configPrompt.length).toBeLessThan(350);
    expect(scenarioPrompt.length).toBeLessThan(350);
    expect(configPrompt).not.toContain('Это забота');
    expect(scenarioPrompt).not.toContain('Это забота');
    expect(configPrompt).not.toContain('Yes, Good, Could, Bot, Pitbull');
    expect(scenarioPrompt).not.toContain('Yes, Good, Could, Bot, Pitbull');
    expect(configPrompt).not.toContain('Говори быстро');
    expect(scenarioPrompt).not.toContain('Говори быстро');
    expect(configPrompt).not.toContain('Начни');
    expect(scenarioPrompt).not.toContain('Начни');
    expect(configPrompt).not.toContain('Говори ');
    expect(scenarioPrompt).not.toContain('Говори ');
    expect(configPrompt).not.toContain('Не работай');
    expect(scenarioPrompt).not.toContain('Не работай');
    expect(configPrompt).toContain('Контекст:');
    expect(scenarioPrompt).toContain('Контекст:');
  });

  it('starts native xAI Irina with a model-generated first response instead of Voximplant TTS or force message', () => {
    expect(realtimeScenarioSource).not.toContain('function playRealtimeGreetingThenStartBridge');
    expect(realtimeScenarioSource).not.toMatch(/customerCall\.say\(.*realtime/i);
    expect(realtimeScenarioSource).not.toContain("type: 'force_message'");
    expect(realtimeScenarioSource).not.toContain('interruptible: false');
    expect(realtimeScenarioSource).not.toContain('SERVICE_SURVEY_REALTIME_FIRST_TURN');
    expect(realtimeScenarioSource).toMatch(/VoxEngine\.sendMediaBetween\(customerCall, voiceAgentAPIClient\)[\s\S]*voiceAgentAPIClient\.responseCreate\(\{\}\)/);
    expect(realtimeScenarioSource).toContain("startNativeGrokRealtime('connected')");
  });

  it('prewarms native xAI on ringing but starts media only after the call is connected', () => {
    expect(realtimeScenarioSource).toContain("startNativeGrokRealtime('ringing')");
    expect(realtimeScenarioSource).toContain('function maybeStartNativeGrokMedia(reason)');
    expect(realtimeScenarioSource).toContain('if (finished || nativeGrokResponseStarted || !connected || !voiceAgentAPIClient || !sessionUpdated) return;');
    expect(realtimeScenarioSource).toContain("maybeStartNativeGrokMedia('connected')");
    expect(realtimeScenarioSource).toContain("maybeStartNativeGrokMedia('session_updated')");
    expect(realtimeScenarioSource).toContain('nativeGrokResponseStarted = true;');
    expect(realtimeScenarioSource).toContain('media_start_requested');
  });

  it('does not keep startup greeting timers or gated caller audio hacks', () => {
    expect(realtimeScenarioSource).not.toContain('firstGreetingPending');
    expect(realtimeScenarioSource).not.toContain('customerInputStarted');
    expect(realtimeScenarioSource).not.toContain('firstTurnTimeoutId');
    expect(realtimeScenarioSource).not.toContain('firstTurnListenFallbackTimeoutId');
    expect(realtimeScenarioSource).not.toContain('function startCustomerInput(reason)');
  });

  it('uses explicit low-latency server VAD settings for phone speech', () => {
    expect(realtimeScenarioSource).toContain("type: 'server_vad'");
    expect(realtimeScenarioSource).toContain('threshold: 0.65');
    expect(realtimeScenarioSource).toContain('silence_duration_ms: 0');
    expect(realtimeScenarioSource).toContain('prefix_padding_ms: 333');
  });

  it('does not override xAI speech speed so Irina keeps her native timbre', () => {
    expect(realtimeScenarioSource).not.toContain('output: { speed:');
    expect(realtimeScenarioSource).not.toContain('audio.output.speed');
  });

  it('passes the same read-only business tools to Grok realtime as the text AI agent', () => {
    const expectedReadTools = [
      'get_service_catalog',
      'calculate_price',
      'validate_selection',
      'check_subscription',
      'get_student_discount',
      'get_order_status',
      'get_my_bookings',
      'list_pickup_points',
      'handoff_to_operator',
      'get_studio_status',
      'check_slots',
      'create_booking',
    ];

    expect(scenarioSource).toContain('function realtimeBusinessTools()');
    expect(realtimeScenarioSource).toContain('tools: realtimeBusinessTools(),');
    for (const name of expectedReadTools) {
      expect(scenarioSource).toContain(`name: '${name}'`);
    }
    expect(scenarioSource).toContain('Единственный источник услуг');
    expect(scenarioSource).toContain('pricing_guidance');
    expect(scenarioSource).toContain('итоговую сумму даёт calculate_price');
    expect(scenarioSource).toContain('Единственный источник свободных слотов');
    expect(realtimeScenarioSource).not.toContain("name: 'hangup_call'");
    expect(realtimeScenarioSource).not.toContain("name: 'create_print_order_draft'");
    expect(realtimeScenarioSource).not.toContain("name: 'create_subscription_draft'");
    expect(realtimeScenarioSource).not.toContain("name: 'create_booking_draft'");
    expect(realtimeScenarioSource).not.toContain("name: 'request_payment_link'");
  });

  it('executes backend Grok realtime function calls through the backend tool endpoint', () => {
    const handlerSource = extractHandlerSource('Grok.VoiceAgentAPIEvents.ResponseFunctionCallArgumentsDone');

    expect(scenarioSource).toContain('SERVICE_SURVEY_TOOL_WEBHOOK_URL');
    expect(handlerSource).not.toContain("payload.name === 'hangup_call'");
    expect(handlerSource).toContain("payload.name === 'handoff_to_operator'");
    expect(handlerSource).toContain('startOperatorHandoff(payload)');
    expect(handlerSource).toContain('httpPostJsonParse(SERVICE_SURVEY_TOOL_WEBHOOK_URL');
    expect(handlerSource).toContain("tool_name: payload.name");
    expect(handlerSource).toContain("arguments: String(payload.arguments || '{}')");
    expect(handlerSource).toContain("type: 'function_call_output'");
    expect(handlerSource).toContain('call_id: payload.call_id');
    expect(handlerSource).toContain('voiceAgentAPIClient.responseCreate({})');
  });

  it('handles handoff_to_operator locally by bridging the customer to a Voximplant user', () => {
    expect(realtimeScenarioSource).toContain('function startOperatorHandoff(payload)');
    expect(realtimeScenarioSource).toContain("var operatorUser = data && data.operatorUser ? String(data.operatorUser) : STUDIO_USER;");
    expect(realtimeScenarioSource).toContain('operatorCall = VoxEngine.callUser({');
    expect(realtimeScenarioSource).toContain('username: operatorUser');
    expect(realtimeScenarioSource).toContain('closeNativeGrok(\'operator_handoff_connected\')');
    expect(realtimeScenarioSource).toContain('VoxEngine.sendMediaBetween(customerCall, operatorCall)');
    expect(realtimeScenarioSource).toContain("writeLog('survey_rt_handoff', 'bridged'");
    expect(realtimeScenarioSource).toContain("finish('operator_disconnected_after_handoff'");
    expect(realtimeScenarioSource).toContain('operator_answer_timeout');
  });

  it('continues Grok realtime if the operator cannot answer the handoff call', () => {
    expect(realtimeScenarioSource).toContain('function failOperatorHandoff(reason, details, payload)');
    expect(realtimeScenarioSource).toContain("status: 'operator_unavailable'");
    expect(realtimeScenarioSource).toContain('sendFunctionOutput(payload,');
    expect(realtimeScenarioSource).toContain('voiceAgentAPIClient.responseCreate({})');
  });

  it('passes the configured Grok voice model to the native Voximplant client', () => {
    expect(realtimeScenarioSource).toContain(
      'Grok.createVoiceAgentAPIClient({ xAIApiKey: xaiApiKey, model: model, onWebSocketClose: onWebSocketClose })',
    );
  });

  it('lets Grok choose wording while keeping the call goal clear', () => {
    expect(configSource).toContain('Своё Фото: фото на документы, печать и дизайн');
    expect(scenarioSource).toContain('Своё Фото: фото на документы, печать и дизайн');
    expect(configSource).toContain('Причина звонка: узнать, нужна ли клиенту помощь по услугам');
    expect(scenarioSource).toContain('Причина звонка: узнать, нужна ли клиенту помощь по услугам');
    expect(configSource).not.toContain('сам позвонил клиенту');
    expect(scenarioSource).not.toContain('сам позвонил клиенту');
    expect(configSource).not.toContain('после визита');
    expect(scenarioSource).not.toContain('после визита');
    expect(configSource).not.toContain('как прошло');
    expect(scenarioSource).not.toContain('как прошло');
    expect(configSource).not.toContain('понравилось');
    expect(scenarioSource).not.toContain('понравилось');
    expect(configSource).not.toContain('заказы');
    expect(scenarioSource).not.toContain('заказы');
    expect(configSource).not.toContain('Скажи, пожалуйста');
    expect(scenarioSource).not.toContain('Скажи, пожалуйста');
    expect(configSource).not.toContain('Начни:');
    expect(scenarioSource).not.toContain('Начни:');
  });
});
