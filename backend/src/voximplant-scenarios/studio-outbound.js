var SCENARIO_NAME = 'studio-outbound';
var CALLER_ID = '+78633226575';
var STUDIO_USER = 'soborny101';
var BACKEND_BASE_URL = 'https://svoefoto.ru';
var CALL_EVENT_WEBHOOK_URL = BACKEND_BASE_URL + '/api/telephony/call-event';
var SERVICE_SURVEY_RESULT_WEBHOOK_URL = BACKEND_BASE_URL + '/api/telephony/service-survey/result';
var SERVICE_SURVEY_TURN_WEBHOOK_URL = BACKEND_BASE_URL + '/api/telephony/service-survey/turn';
var SERVICE_SURVEY_TOOL_WEBHOOK_URL = BACKEND_BASE_URL + '/api/telephony/service-survey/tool';
var SERVICE_SURVEY_DEFAULT_QUESTION = 'Здравствуйте, это "Своё Фото". Мы хотим стать удобнее для клиентов. Подскажите, какую услугу нам стоит добавить?';
var SERVICE_SURVEY_DEFAULT_GREETING = 'Здравствуйте! Это Своё Фото. Удобно пару минут? Хотим задать короткий вопрос.';
// Фолбэк-инструкции realtime-режима (если customData почему-то не принёс realtimeInstructions).
var SERVICE_SURVEY_REALTIME_FALLBACK_INSTRUCTIONS = 'Контекст: звонок от Своё Фото клиенту. Своё Фото: фото на документы, печать и дизайн. Причина звонка: узнать, нужна ли клиенту помощь по услугам. Разговор на русском.';
var SERVICE_SURVEY_THANK_YOU_MESSAGE = 'Спасибо. Мы записали ваш ответ. Хорошего дня.';
var OPERATOR_SETUP_TIMEOUT_MS = 45000;
var PSTN_SETUP_TIMEOUT_MS = 120000;
var SERVICE_SURVEY_MAX_ANSWER_MS = 45000;
var SERVICE_SURVEY_THANK_YOU_DELAY_MS = 4500;
var SERVICE_SURVEY_OVERALL_TIMEOUT_MS = 360000;
var SERVICE_SURVEY_TURN_HTTP_TIMEOUT_MS = 25000; // > TTS_TIMEOUT (20с) backend + запас на сеть
var TERMINATE_DELAY_MS = 1200;

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ stringifyError: String(error) });
  }
}

function writeLog(scope, eventName, data) {
  Logger.write('[studio-outbound] ' + safeJson({
    scope: scope,
    event: eventName,
    data: data || {},
  }));
}

function normalizeDestination(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return '+7' + digits;
  if (digits.length === 11 && digits[0] === '8') return '+7' + digits.slice(1);
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;
  if (digits.length >= 10 && digits.length <= 15) return '+' + digits;
  return '';
}

function eventData(e) {
  return {
    code: e && e.code,
    reason: e && e.reason,
    internalCode: e && e.internalCode,
    duration: e && e.duration,
    cost: e && e.cost,
    headers: e && e.headers,
  };
}

function postJson(url, payload, label) {
  try {
    var opts = new Net.HttpRequestOptions();
    opts.method = 'POST';
    opts.headers = ['Content-Type: application/json'];
    opts.postData = JSON.stringify(payload);
    Net.httpRequest(url, function(res) {
      writeLog('webhook', label, {
        code: res && res.code,
        error: res && res.error,
        text: res && res.text,
      });
    }, opts);
  } catch (error) {
    writeLog('webhook', label + '_error', { error: String(error) });
  }
}

function getVoximplantWebhookSecret() {
  try {
    if (VoxEngine.getSecretValue) {
      return String(VoxEngine.getSecretValue('VOXIMPLANT_WEBHOOK_SECRET')
        || VoxEngine.getSecretValue('VOXIMPLANT_VOICE_CALL_CALLBACK_SECRET')
        || '');
    }
  } catch (error) {
    writeLog('webhook_auth', 'secret_read_error', { label: 'voximplant_webhook', error: String(error) });
  }
  return '';
}

function jsonWebhookHeaders() {
  var headers = ['Content-Type: application/json'];
  var secret = getVoximplantWebhookSecret();
  if (secret) headers.push('x-svf-voximplant-secret: ' + secret);
  return headers;
}

// Как postJson, но РАЗБИРАЕТ JSON-ответ и отдаёт его в onResult(parsed, res).
// Нужно разговорному опросу: backend возвращает следующую реплику бота и URL озвучки.
function httpPostJsonParse(url, payload, label, onResult) {
  var settled = false;
  function settle(parsed, res) {
    if (settled) return;
    settled = true;
    onResult(parsed, res);
  }
  try {
    var opts = new Net.HttpRequestOptions();
    opts.method = 'POST';
    opts.headers = jsonWebhookHeaders();
    opts.postData = JSON.stringify(payload);
    Net.httpRequest(url, function(res) {
      var parsed = null;
      try {
        if (res && res.text) parsed = JSON.parse(res.text);
      } catch (parseError) {
        parsed = null;
      }
      writeLog('survey_chat_http', label, { code: res && res.code, ok: !!parsed });
      settle(parsed, res || null);
    }, opts);
  } catch (error) {
    writeLog('survey_chat_http', label + '_error', { error: String(error) });
    settle(null, null);
  }
}

function getCallId(call) {
  try {
    if (call && call.id) {
      return String(call.id());
    }
  } catch (error) {
    writeLog('call', 'id_error', { error: String(error) });
  }
  return '';
}

function getCallNumber(call) {
  try {
    if (call && call.number) {
      return String(call.number());
    }
  } catch (error) {
    writeLog('call', 'number_error', { error: String(error) });
  }
  return '';
}

function addEvent(call, eventName, handler) {
  if (call && eventName && handler) {
    call.addEventListener(eventName, handler);
  }
}

function enableStats(call, label) {
  try {
    if (call && call.enableMediaStatistics) {
      call.enableMediaStatistics();
    }
  } catch (error) {
    writeLog(label, 'media_stats_error', { error: String(error) });
  }
}

function safeHangup(call, label) {
  try {
    if (call && call.hangup) {
      call.hangup();
    }
  } catch (error) {
    writeLog(label, 'hangup_error', { error: String(error) });
  }
}

function safeReject(call, label) {
  try {
    if (call && call.reject) {
      call.reject();
      return;
    }
  } catch (error) {
    writeLog(label, 'reject_error', { error: String(error) });
  }
  safeHangup(call, label);
}

function ringIncoming(call) {
  try {
    if (call && call.ring) {
      call.ring();
    }
  } catch (error) {
    writeLog('incoming', 'ring_error', { error: String(error) });
  }
}

function startIncomingEarlyMedia(call, e) {
  try {
    if (!call || !call.startEarlyMedia) {
      return;
    }
    if (e && e.scheme) {
      call.startEarlyMedia(null, e.scheme);
    } else {
      call.startEarlyMedia();
    }
  } catch (error) {
    writeLog('incoming', 'early_media_error', { error: String(error) });
  }
}

function answerIncoming(call, e, destination) {
  try {
    if (!call || !call.answer) {
      return false;
    }
    var parameters = { displayName: destination };
    if (e && e.call && e.call.displayName) {
      parameters.displayName = e.call.displayName();
    }
    if (e && e.scheme) {
      parameters.scheme = e.scheme;
    }
    call.answer(e && e.headers ? e.headers : {}, parameters);
    return true;
  } catch (error) {
    writeLog('incoming', 'answer_error', { error: String(error) });
  }
  return false;
}

function terminateSoon(reason, delayMs) {
  var delay = typeof delayMs === 'number' && delayMs > 0 ? delayMs : TERMINATE_DELAY_MS;
  writeLog('session', 'terminate_scheduled', {
    reason: reason,
    delayMs: delay,
  });
  setTimeout(function() {
    VoxEngine.terminate();
  }, delay);
}

function parseCustomData() {
  try {
    if (!VoxEngine.customData) {
      return null;
    }
    var raw = VoxEngine.customData();
    if (!raw) {
      return null;
    }
    if (typeof raw === 'string') {
      return JSON.parse(raw);
    }
    return raw;
  } catch (error) {
    writeLog('custom_data', 'parse_error', { error: String(error) });
  }
  return null;
}

function estimateSpeechMs(text) {
  var length = String(text || '').length;
  return Math.max(8500, Math.min(20000, length * 95));
}

function estimateRealtimeGreetingMs(text) {
  var length = String(text || '').length;
  return Math.max(2200, Math.min(4200, length * 70));
}

function pickAsrProfileFromProvider(provider) {
  if (!provider) {
    return null;
  }
  var preferred = ['ru_RU', 'RU_RUSSIAN', 'ru-RU', 'RU'];
  for (var i = 0; i < preferred.length; i++) {
    if (provider[preferred[i]]) {
      return provider[preferred[i]];
    }
  }
  var keys = Object.keys(provider);
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    if (key && String(key).toLowerCase().indexOf('ru') >= 0) {
      return provider[key];
    }
  }
  return null;
}

function pickRussianAsrProfile() {
  if (typeof ASRProfileList === 'undefined') {
    return null;
  }
  var providers = ['YandexV3', 'Yandex', 'Google', 'TBank', 'SaluteSpeech'];
  for (var i = 0; i < providers.length; i++) {
    var profile = pickAsrProfileFromProvider(ASRProfileList[providers[i]]);
    if (profile) {
      return profile;
    }
  }
  var providerKeys = Object.keys(ASRProfileList);
  for (var j = 0; j < providerKeys.length; j++) {
    var fallbackProfile = pickAsrProfileFromProvider(ASRProfileList[providerKeys[j]]);
    if (fallbackProfile) {
      return fallbackProfile;
    }
  }
  return null;
}

function ensureAsrModuleLoaded() {
  try {
    if (typeof Modules !== 'undefined' && Modules.ASR) {
      require(Modules.ASR);
    }
  } catch (error) {
    writeLog('service_survey_asr', 'require_error', { error: String(error) });
  }
  return typeof ASRProfileList !== 'undefined' && !!VoxEngine.createASR;
}

function ensureGrokModuleLoaded() {
  try {
    if (typeof Modules !== 'undefined' && Modules.Grok) {
      require(Modules.Grok);
    }
  } catch (error) {
    writeLog('survey_rt_grok', 'require_error', { error: String(error) });
  }
  return typeof Grok !== 'undefined' && !!Grok.createVoiceAgentAPIClient;
}

function extractRecordingUrl(recordEvent) {
  if (!recordEvent) {
    return '';
  }
  return String(recordEvent.url
    || recordEvent.recordingUrl
    || recordEvent.recordUrl
    || recordEvent.record_url
    || '');
}

function startClickToCall(data, startedEvent) {
  var destination = normalizeDestination(data && data.destination);
  var callerId = normalizeDestination(data && data.callerId) || CALLER_ID;
  var operatorUser = data && data.operatorUser ? String(data.operatorUser) : STUDIO_USER;
  var sessionId = data && data.sessionId
    ? String(data.sessionId)
    : 'studio-click-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000));
  var operatorCall = null;
  var pstnCall = null;
  var finished = false;
  var operatorConnected = false;
  var pstnConnected = false;
  var answeredReported = false;
  var endedReported = false;
  var failedReported = false;
  var mediaBridged = false;
  var operatorTimeoutId = null;
  var pstnTimeoutId = null;

  function clearTimers() {
    if (operatorTimeoutId !== null) {
      clearTimeout(operatorTimeoutId);
      operatorTimeoutId = null;
    }
    if (pstnTimeoutId !== null) {
      clearTimeout(pstnTimeoutId);
      pstnTimeoutId = null;
    }
  }

  function basePayload(extra) {
    var payload = {
      caller_number: callerId,
      called_number: destination || '',
      session_id: sessionId,
      scenario: SCENARIO_NAME,
      destination_user: operatorUser,
      occurred_at: new Date().toISOString(),
    };
    if (extra) {
      Object.keys(extra).forEach(function(key) {
        payload[key] = extra[key];
      });
    }
    return payload;
  }

  function reportAnswered(details) {
    if (answeredReported) {
      return;
    }
    answeredReported = true;
    postJson(CALL_EVENT_WEBHOOK_URL, basePayload({
      event: 'answered',
      reason: 'pstn_connected',
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
    }), 'click_answered');
  }

  function reportEnded(details) {
    if (endedReported || !answeredReported) {
      return;
    }
    endedReported = true;
    postJson(CALL_EVENT_WEBHOOK_URL, basePayload({
      event: 'ended',
      duration_seconds: details && details.duration,
      reason: details && details.reason ? details.reason : 'normal_call_clearing',
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
    }), 'click_ended');
  }

  function reportFailed(reason, details) {
    if (failedReported || answeredReported) {
      return;
    }
    failedReported = true;
    postJson(CALL_EVENT_WEBHOOK_URL, basePayload({
      event: 'failed',
      reason: reason,
      duration_seconds: details && details.duration,
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
    }), 'click_failed');
  }

  function bridgeCalls(reason) {
    if (mediaBridged || !operatorCall || !pstnCall) {
      return;
    }
    try {
      VoxEngine.sendMediaBetween(operatorCall, pstnCall);
      mediaBridged = true;
      writeLog('click_media', 'bridged', { reason: reason || 'unknown' });
    } catch (error) {
      writeLog('click_media', 'send_media_error', {
        reason: reason || 'unknown',
        error: String(error),
      });
    }
  }

  function finish(reason, details) {
    if (finished) {
      return;
    }
    finished = true;
    clearTimers();
    writeLog('click_session', 'finish', {
      reason: reason,
      details: details || {},
      operatorConnected: operatorConnected,
      pstnConnected: pstnConnected,
      answeredReported: answeredReported,
      failedReported: failedReported,
    });
    safeHangup(operatorCall, 'click_operator');
    safeHangup(pstnCall, 'click_pstn');
    terminateSoon(reason);
  }

  function dialPstn() {
    if (finished || pstnCall) {
      return;
    }
    pstnCall = VoxEngine.callPSTN(destination, callerId);
    enableStats(pstnCall, 'click_pstn');
    writeLog('click_pstn', 'dial_pstn', {
      callerId: callerId,
      destination: destination,
      callId: getCallId(pstnCall),
      sessionId: sessionId,
    });
    bridgeCalls('pstn_dialed');

    addEvent(pstnCall, CallEvents.Ringing, function(ringingEvent) {
      writeLog('click_pstn', 'ringing', eventData(ringingEvent));
    });

    addEvent(pstnCall, CallEvents.AudioStarted, function(audioStartedEvent) {
      writeLog('click_pstn', 'audio_started', eventData(audioStartedEvent));
      bridgeCalls('pstn_audio_started');
    });

    addEvent(pstnCall, CallEvents.FirstAudioPacketReceived, function(firstAudioEvent) {
      writeLog('click_pstn', 'first_audio_packet', eventData(firstAudioEvent));
    });

    addEvent(pstnCall, CallEvents.Connected, function(connectedEvent) {
      if (finished) {
        return;
      }
      if (pstnTimeoutId !== null) {
        clearTimeout(pstnTimeoutId);
        pstnTimeoutId = null;
      }
      pstnConnected = true;
      writeLog('click_pstn', 'connected', eventData(connectedEvent));
      bridgeCalls('pstn_connected');
      reportAnswered(eventData(connectedEvent));
    });

    addEvent(pstnCall, CallEvents.Failed, function(failedEvent) {
      var details = eventData(failedEvent);
      writeLog('click_pstn', 'failed', details);
      if (pstnConnected) {
        reportEnded(details);
        finish('pstn_failed_after_connect', details);
        return;
      }
      reportFailed('pstn_failed_before_answer', details);
      finish('pstn_failed_before_answer', details);
    });

    addEvent(pstnCall, CallEvents.Disconnected, function(disconnectedEvent) {
      var details = eventData(disconnectedEvent);
      writeLog('click_pstn', 'disconnected', details);
      if (pstnConnected) {
        reportEnded(details);
        finish('pstn_disconnected', details);
        return;
      }
      reportFailed('pstn_disconnected_before_answer', details);
      finish('pstn_disconnected_before_answer', details);
    });

    pstnTimeoutId = setTimeout(function() {
      var details = {
        reason: 'pstn_setup_timeout',
        timeoutMs: PSTN_SETUP_TIMEOUT_MS,
      };
      writeLog('click_pstn', 'setup_timeout', details);
      reportFailed('pstn_setup_timeout', details);
      finish('pstn_setup_timeout', details);
    }, PSTN_SETUP_TIMEOUT_MS);
  }

  writeLog('click_session', 'started', {
    destination: destination,
    callerId: callerId,
    operatorUser: operatorUser,
    sessionId: sessionId,
    voximplantSessionId: startedEvent && startedEvent.sessionId,
  });

  if (!destination) {
    reportFailed('invalid_destination', { reason: 'invalid_destination' });
    finish('invalid_destination');
    return;
  }

  operatorCall = VoxEngine.callUser({
    username: operatorUser,
    callerid: callerId,
    displayName: 'CRM click-to-call',
    video: false,
  });
  enableStats(operatorCall, 'click_operator');

  addEvent(operatorCall, CallEvents.Ringing, function(ringingEvent) {
    writeLog('click_operator', 'ringing', eventData(ringingEvent));
  });

  addEvent(operatorCall, CallEvents.AudioStarted, function(audioStartedEvent) {
    writeLog('click_operator', 'audio_started', eventData(audioStartedEvent));
  });

  addEvent(operatorCall, CallEvents.Connected, function(connectedEvent) {
    if (finished || operatorConnected) {
      return;
    }
    if (operatorTimeoutId !== null) {
      clearTimeout(operatorTimeoutId);
      operatorTimeoutId = null;
    }
    operatorConnected = true;
    writeLog('click_operator', 'connected', eventData(connectedEvent));
    dialPstn();
  });

  addEvent(operatorCall, CallEvents.Failed, function(failedEvent) {
    var details = eventData(failedEvent);
    writeLog('click_operator', 'failed', details);
    reportFailed('operator_failed', details);
    finish('operator_failed', details);
  });

  addEvent(operatorCall, CallEvents.Disconnected, function(disconnectedEvent) {
    var details = eventData(disconnectedEvent);
    writeLog('click_operator', 'disconnected', details);
    if (pstnConnected) {
      reportEnded(details);
      finish('operator_disconnected', details);
      return;
    }
    reportFailed(operatorConnected ? 'operator_disconnected_before_pstn_answer' : 'operator_disconnected_before_answer', details);
    finish('operator_disconnected', details);
  });

  operatorTimeoutId = setTimeout(function() {
    var details = {
      reason: 'operator_answer_timeout',
      timeoutMs: OPERATOR_SETUP_TIMEOUT_MS,
    };
    writeLog('click_operator', 'setup_timeout', details);
    reportFailed('operator_answer_timeout', details);
    finish('operator_answer_timeout', details);
  }, OPERATOR_SETUP_TIMEOUT_MS);
}

function startServiceSurvey(data, startedEvent) {
  var destination = normalizeDestination(data && data.destination);
  var callerId = normalizeDestination(data && data.callerId) || CALLER_ID;
  var sessionId = data && data.sessionId
    ? String(data.sessionId)
    : 'service-survey-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000));
  var question = data && data.question ? String(data.question) : SERVICE_SURVEY_DEFAULT_QUESTION;
  var parsedMaxAnswerMs = Number(data && data.maxAnswerMs);
  var maxAnswerMs = isFinite(parsedMaxAnswerMs) && parsedMaxAnswerMs >= 10000 && parsedMaxAnswerMs <= 120000
    ? parsedMaxAnswerMs
    : SERVICE_SURVEY_MAX_ANSWER_MS;
  var customerCall = null;
  var asr = null;
  var finished = false;
  var connected = false;
  var answeredReported = false;
  var terminalReported = false;
  var promptStarted = false;
  var promptFinished = false;
  var listeningStarted = false;
  var recordingUrl = '';
  var transcriptText = '';
  var transcriptConfidence = null;
  var transcriptLanguageCode = '';
  var connectedAtMs = 0;
  var setupTimeoutId = null;
  var promptFallbackTimeoutId = null;
  var answerTimeoutId = null;
  var thankYouTimeoutId = null;

  function clearTimer(timerId) {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }

  function clearTimers() {
    clearTimer(setupTimeoutId);
    clearTimer(promptFallbackTimeoutId);
    clearTimer(answerTimeoutId);
    clearTimer(thankYouTimeoutId);
    setupTimeoutId = null;
    promptFallbackTimeoutId = null;
    answerTimeoutId = null;
    thankYouTimeoutId = null;
  }

  function durationSeconds(details) {
    if (details && details.duration !== undefined) {
      return details.duration;
    }
    if (!connectedAtMs) {
      return undefined;
    }
    return Math.max(0, Math.round((Date.now() - connectedAtMs) / 1000));
  }

  function basePayload(extra) {
    var payload = {
      caller_number: callerId,
      called_number: destination || '',
      session_id: sessionId,
      question: question,
      occurred_at: new Date().toISOString(),
    };
    if (extra) {
      Object.keys(extra).forEach(function(key) {
        payload[key] = extra[key];
      });
    }
    return payload;
  }

  function report(eventName, payload, label) {
    postJson(SERVICE_SURVEY_RESULT_WEBHOOK_URL, basePayload(payload), label || ('survey_' + eventName));
  }

  function reportAnswered(details) {
    if (answeredReported) {
      return;
    }
    answeredReported = true;
    report('answered', {
      event: 'answered',
      reason: 'pstn_connected',
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
    }, 'survey_answered');
  }

  function reportRecording(url) {
    if (!url) {
      return;
    }
    report('recording', {
      event: 'recording',
      recording_url: url,
    }, 'survey_recording');
  }

  function reportTerminal(eventName, reason, details) {
    if (terminalReported) {
      return;
    }
    terminalReported = true;
    report(eventName, {
      event: eventName,
      duration_seconds: durationSeconds(details),
      reason: reason,
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
      transcript: transcriptText || undefined,
      confidence: transcriptConfidence === null ? undefined : transcriptConfidence,
      language_code: transcriptLanguageCode || undefined,
      recording_url: recordingUrl || undefined,
    }, 'survey_' + eventName);
  }

  function stopListening(reason) {
    if (!asr) {
      return;
    }
    try {
      if (customerCall && customerCall.stopMediaTo) {
        customerCall.stopMediaTo(asr);
      }
    } catch (error) {
      writeLog('service_survey_asr', 'stop_media_error', {
        reason: reason,
        error: String(error),
      });
    }
    try {
      if (asr.stop) {
        asr.stop();
      }
    } catch (error) {
      writeLog('service_survey_asr', 'stop_error', {
        reason: reason,
        error: String(error),
      });
    }
  }

  function finish(reason, details, terminalEvent) {
    if (finished) {
      return;
    }
    finished = true;
    clearTimers();
    stopListening(reason);
    writeLog('service_survey_session', 'finish', {
      reason: reason,
      details: details || {},
      connected: connected,
      transcriptLength: transcriptText.length,
      recordingUrl: recordingUrl,
    });
    if (terminalEvent) {
      reportTerminal(terminalEvent, reason, details);
    } else if (connected) {
      reportTerminal('completed', reason, details);
    } else if (reason === 'invalid_destination') {
      reportTerminal('failed', reason, details);
    } else {
      reportTerminal('no_answer', reason, details);
    }
    safeHangup(customerCall, 'service_survey_customer');
    terminateSoon(reason);
  }

  function sayThanksThenFinish(reason, details) {
    if (finished) {
      return;
    }
    stopListening(reason);
    try {
      if (customerCall && customerCall.say) {
        customerCall.say(SERVICE_SURVEY_THANK_YOU_MESSAGE, Language.RU_RUSSIAN_FEMALE);
      }
    } catch (error) {
      writeLog('service_survey_tts', 'thank_you_error', { error: String(error) });
    }
    thankYouTimeoutId = setTimeout(function() {
      finish(reason, details, 'completed');
    }, SERVICE_SURVEY_THANK_YOU_DELAY_MS);
  }

  function startListening(reason) {
    if (finished || listeningStarted || !customerCall) {
      return;
    }
    listeningStarted = true;
    promptFinished = true;
    if (promptFallbackTimeoutId !== null) {
      clearTimeout(promptFallbackTimeoutId);
      promptFallbackTimeoutId = null;
    }
    writeLog('service_survey_asr', 'start_listening', { reason: reason });

    if (!ensureAsrModuleLoaded()) {
      writeLog('service_survey_asr', 'module_unavailable', {});
      answerTimeoutId = setTimeout(function() {
        finish('asr_module_unavailable', { reason: 'asr_module_unavailable' }, 'completed');
      }, maxAnswerMs);
      return;
    }

    var profile = pickRussianAsrProfile();
    if (!profile) {
      writeLog('service_survey_asr', 'profile_unavailable', {});
      answerTimeoutId = setTimeout(function() {
        finish('asr_profile_unavailable', { reason: 'asr_profile_unavailable' }, 'completed');
      }, maxAnswerMs);
      return;
    }

    try {
      asr = VoxEngine.createASR({
        profile: profile,
        singleUtterance: true,
        interimResults: false,
      });
      if (typeof ASREvents !== 'undefined' && ASREvents.Started) {
        asr.addEventListener(ASREvents.Started, function() {
          writeLog('service_survey_asr', 'started', {});
        });
      }
      if (typeof ASREvents !== 'undefined' && ASREvents.Result) {
        asr.addEventListener(ASREvents.Result, function(resultEvent) {
          if (finished) {
            return;
          }
          var text = String((resultEvent && (resultEvent.text || resultEvent.transcript)) || '').trim();
          if (text) {
            transcriptText = transcriptText ? transcriptText + '\n' + text : text;
          }
          transcriptConfidence = resultEvent && resultEvent.confidence !== undefined ? resultEvent.confidence : transcriptConfidence;
          transcriptLanguageCode = resultEvent && resultEvent.languageCode ? String(resultEvent.languageCode) : transcriptLanguageCode;
          writeLog('service_survey_asr', 'result', {
            text: text,
            confidence: transcriptConfidence,
            languageCode: transcriptLanguageCode,
          });
          if (answerTimeoutId !== null) {
            clearTimeout(answerTimeoutId);
            answerTimeoutId = null;
          }
          sayThanksThenFinish('asr_result', {
            reason: 'asr_result',
            confidence: transcriptConfidence,
          });
        });
      }
      if (typeof ASREvents !== 'undefined' && ASREvents.Error) {
        asr.addEventListener(ASREvents.Error, function(errorEvent) {
          writeLog('service_survey_asr', 'error', {
            error: errorEvent && (errorEvent.error || errorEvent.message || errorEvent.reason),
          });
        });
      }
      customerCall.sendMediaTo(asr);
    } catch (error) {
      writeLog('service_survey_asr', 'create_error', { error: String(error) });
      answerTimeoutId = setTimeout(function() {
        finish('asr_create_error', { reason: 'asr_create_error' }, 'completed');
      }, maxAnswerMs);
      return;
    }

    answerTimeoutId = setTimeout(function() {
      writeLog('service_survey_asr', 'answer_timeout', { timeoutMs: maxAnswerMs });
      sayThanksThenFinish('answer_timeout', { reason: 'answer_timeout' });
    }, maxAnswerMs);
  }

  function startRecording() {
    if (!customerCall) {
      return;
    }
    try {
      customerCall.record();
      writeLog('service_survey_recording', 'record_command_sent', {});
    } catch (error) {
      writeLog('service_survey_recording', 'record_error', { error: String(error) });
    }
  }

  function askQuestion() {
    if (!customerCall || promptStarted) {
      return;
    }
    promptStarted = true;
    try {
      customerCall.say(question, Language.RU_RUSSIAN_FEMALE);
      writeLog('service_survey_tts', 'question_started', { questionLength: question.length });
    } catch (error) {
      writeLog('service_survey_tts', 'question_error', { error: String(error) });
      startListening('question_tts_error');
      return;
    }
    promptFallbackTimeoutId = setTimeout(function() {
      startListening('question_fallback_timeout');
    }, estimateSpeechMs(question));
  }

  writeLog('service_survey_session', 'started', {
    destination: destination,
    callerId: callerId,
    sessionId: sessionId,
    maxAnswerMs: maxAnswerMs,
    voximplantSessionId: startedEvent && startedEvent.sessionId,
  });

  if (!destination) {
    finish('invalid_destination', { reason: 'invalid_destination' }, 'failed');
    return;
  }

  customerCall = VoxEngine.callPSTN(destination, callerId);
  enableStats(customerCall, 'service_survey_customer');

  addEvent(customerCall, CallEvents.Ringing, function(ringingEvent) {
    writeLog('service_survey_customer', 'ringing', eventData(ringingEvent));
  });

  addEvent(customerCall, CallEvents.AudioStarted, function(audioStartedEvent) {
    writeLog('service_survey_customer', 'audio_started', eventData(audioStartedEvent));
  });

  addEvent(customerCall, CallEvents.RecordStarted, function(recordStartedEvent) {
    recordingUrl = extractRecordingUrl(recordStartedEvent) || recordingUrl;
    writeLog('service_survey_recording', 'started', { url: recordingUrl });
    reportRecording(recordingUrl);
  });

  addEvent(customerCall, CallEvents.RecordStopped, function(recordStoppedEvent) {
    recordingUrl = extractRecordingUrl(recordStoppedEvent) || recordingUrl;
    writeLog('service_survey_recording', 'stopped', { url: recordingUrl });
    reportRecording(recordingUrl);
  });

  addEvent(customerCall, CallEvents.PlaybackFinished, function(playbackEvent) {
    writeLog('service_survey_tts', 'playback_finished', eventData(playbackEvent));
    if (promptStarted && !promptFinished) {
      startListening('question_playback_finished');
    }
  });

  addEvent(customerCall, CallEvents.Connected, function(connectedEvent) {
    if (finished || connected) {
      return;
    }
    if (setupTimeoutId !== null) {
      clearTimeout(setupTimeoutId);
      setupTimeoutId = null;
    }
    connected = true;
    connectedAtMs = Date.now();
    writeLog('service_survey_customer', 'connected', eventData(connectedEvent));
    reportAnswered(eventData(connectedEvent));
    startRecording();
    askQuestion();
  });

  addEvent(customerCall, CallEvents.Failed, function(failedEvent) {
    var details = eventData(failedEvent);
    writeLog('service_survey_customer', 'failed', details);
    finish(connected ? 'customer_failed_after_connect' : 'customer_failed_before_answer', details, connected ? 'completed' : 'no_answer');
  });

  addEvent(customerCall, CallEvents.Disconnected, function(disconnectedEvent) {
    var details = eventData(disconnectedEvent);
    writeLog('service_survey_customer', 'disconnected', details);
    finish(connected ? 'customer_disconnected' : 'customer_disconnected_before_answer', details, connected ? 'completed' : 'no_answer');
  });

  setupTimeoutId = setTimeout(function() {
    var details = {
      reason: 'pstn_setup_timeout',
      timeoutMs: PSTN_SETUP_TIMEOUT_MS,
    };
    writeLog('service_survey_customer', 'setup_timeout', details);
    finish('pstn_setup_timeout', details, 'no_answer');
  }, PSTN_SETUP_TIMEOUT_MS);
}

/**
 * Разговорный опрос-забота: двусторонний диалог вместо односторонней зачитки.
 *
 * Поток: PSTN -> запись -> [ход бота] -> слушаем клиента (ASR) -> POST /turn с
 * накопленной историей -> backend отдаёт следующую реплику + URL озвучки голосом
 * Grok (mp3) -> проигрываем (createURLPlayer, фолбэк call.say) -> снова слушаем,
 * пока backend не пришлёт end=true или не упрёмся в лимит ходов. Первый ход —
 * приветствие с дисклеймером о записи (backend отдаёт его на пустую историю).
 */
function startServiceSurveyChat(data, startedEvent) {
  var destination = normalizeDestination(data && data.destination);
  var callerId = normalizeDestination(data && data.callerId) || CALLER_ID;
  var sessionId = data && data.sessionId
    ? String(data.sessionId)
    : 'service-survey-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000));
  var greeting = data && data.greeting ? String(data.greeting) : SERVICE_SURVEY_DEFAULT_GREETING;
  var parsedMaxTurns = Number(data && data.maxTurns);
  var maxTurns = isFinite(parsedMaxTurns) && parsedMaxTurns >= 1 && parsedMaxTurns <= 12
    ? parsedMaxTurns
    : 6;
  var parsedMaxAnswerMs = Number(data && data.maxAnswerMs);
  var maxAnswerMs = isFinite(parsedMaxAnswerMs) && parsedMaxAnswerMs >= 10000 && parsedMaxAnswerMs <= 120000
    ? parsedMaxAnswerMs
    : SERVICE_SURVEY_MAX_ANSWER_MS;
  var useRemoteVoice = !(data && data.voiceEngine === 'voximplant');

  var customerCall = null;
  var asr = null;
  var finished = false;
  var connected = false;
  var answeredReported = false;
  var terminalReported = false;
  var history = [];
  var turnIndex = 0;
  var clientTurns = 0;
  var silenceCount = 0;
  var recordingUrl = '';
  var connectedAtMs = 0;
  var setupTimeoutId = null;
  var answerTimeoutId = null;
  var overallTimeoutId = null;
  var turnTimeoutId = null;

  function clearTimer(timerId) {
    if (timerId !== null) clearTimeout(timerId);
  }
  function clearAllTimers() {
    clearTimer(setupTimeoutId);
    clearTimer(answerTimeoutId);
    clearTimer(overallTimeoutId);
    clearTimer(turnTimeoutId);
    setupTimeoutId = null;
    answerTimeoutId = null;
    overallTimeoutId = null;
    turnTimeoutId = null;
  }

  function durationSeconds(details) {
    if (details && details.duration !== undefined) return details.duration;
    if (!connectedAtMs) return undefined;
    return Math.max(0, Math.round((Date.now() - connectedAtMs) / 1000));
  }

  function transcriptText() {
    var lines = [];
    for (var i = 0; i < history.length; i++) {
      var m = history[i];
      lines.push((m.role === 'client' ? 'Клиент: ' : 'Бот: ') + m.text);
    }
    return lines.join('\n');
  }

  function basePayload(extra) {
    var payload = {
      caller_number: callerId,
      called_number: destination || '',
      session_id: sessionId,
      occurred_at: new Date().toISOString(),
    };
    if (extra) {
      Object.keys(extra).forEach(function(key) { payload[key] = extra[key]; });
    }
    return payload;
  }
  function report(payload, label) {
    postJson(SERVICE_SURVEY_RESULT_WEBHOOK_URL, basePayload(payload), label);
  }
  function reportAnswered() {
    if (answeredReported) return;
    answeredReported = true;
    report({ event: 'answered', reason: 'pstn_connected' }, 'survey_chat_answered');
  }
  function reportRecording(url) {
    if (!url) return;
    report({ event: 'recording', recording_url: url }, 'survey_chat_recording');
  }
  function reportTerminal(eventName, reason, details) {
    if (terminalReported) return;
    terminalReported = true;
    report({
      event: eventName,
      duration_seconds: durationSeconds(details),
      reason: reason,
      transcript: transcriptText() || undefined,
      recording_url: recordingUrl || undefined,
    }, 'survey_chat_' + eventName);
  }

  function stopListening(reason) {
    if (!asr) return;
    try { if (customerCall && customerCall.stopMediaTo) customerCall.stopMediaTo(asr); } catch (e1) {
      writeLog('survey_chat_asr', 'stop_media_error', { reason: reason, error: String(e1) });
    }
    try { if (asr.stop) asr.stop(); } catch (e2) {
      writeLog('survey_chat_asr', 'stop_error', { reason: reason, error: String(e2) });
    }
    asr = null;
  }

  function finish(reason, details, terminalEvent) {
    if (finished) return;
    finished = true;
    clearAllTimers();
    stopListening(reason);
    writeLog('survey_chat_session', 'finish', { reason: reason, clientTurns: clientTurns, turnIndex: turnIndex });
    if (terminalEvent) {
      reportTerminal(terminalEvent, reason, details);
    } else if (connected) {
      reportTerminal('completed', reason, details);
    } else if (reason === 'invalid_destination') {
      reportTerminal('failed', reason, details);
    } else {
      reportTerminal('no_answer', reason, details);
    }
    safeHangup(customerCall, 'survey_chat_customer');
    terminateSoon(reason);
  }

  // Проигрывание реплики бота: удалённый голос (mp3 по URL) или встроенный say.
  // onDone вызывается ровно один раз по завершении (или по страховочному таймеру).
  function speak(text, audioUrl, onDone) {
    if (finished) return;
    var done = false;
    function complete(src) {
      if (done) return;
      done = true;
      writeLog('survey_chat_tts', 'playback_finished', { src: src });
      if (!finished) onDone();
    }
    function fallbackSay() {
      try {
        customerCall.say(String(text), Language.RU_RUSSIAN_FEMALE);
      } catch (sayError) {
        writeLog('survey_chat_tts', 'say_error', { error: String(sayError) });
        complete('say_error');
        return;
      }
      var handler = function() {
        try { customerCall.removeEventListener(CallEvents.PlaybackFinished, handler); } catch (e) { /* noop */ }
        complete('say');
      };
      addEvent(customerCall, CallEvents.PlaybackFinished, handler);
      setTimeout(function() { complete('say_timeout'); }, estimateSpeechMs(text) + 4000);
    }
    if (useRemoteVoice && audioUrl) {
      try {
        var player = VoxEngine.createURLPlayer(String(audioUrl), { progressivePlayback: true });
        // КРИТИЧНО против эха: плеер должен прекратить слать медиа в звонок ДО того,
        // как listenClient() включит ASR — иначе ASR распознает хвост голоса бота.
        var stopUrlPlayer = function() {
          try { if (player && player.stopMediaTo) player.stopMediaTo(customerCall); } catch (e1) { /* noop */ }
          try { if (player && player.stop) player.stop(); } catch (e2) { /* noop */ }
        };
        player.addEventListener(PlayerEvents.PlaybackFinished, function() { stopUrlPlayer(); complete('url'); });
        if (typeof PlayerEvents !== 'undefined' && PlayerEvents.PlaybackError) {
          player.addEventListener(PlayerEvents.PlaybackError, function() {
            writeLog('survey_chat_tts', 'url_player_error', {});
            stopUrlPlayer();
            if (!done) fallbackSay();
          });
        }
        player.sendMediaTo(customerCall);
        // Страховка: если событие конца не пришло — глушим плеер и идём дальше.
        setTimeout(function() { stopUrlPlayer(); complete('url_timeout'); }, estimateSpeechMs(text) + 12000);
        return;
      } catch (playerError) {
        writeLog('survey_chat_tts', 'url_player_exception', { error: String(playerError) });
      }
    }
    fallbackSay();
  }

  function listenClient() {
    if (finished) return;
    if (!ensureAsrModuleLoaded()) {
      writeLog('survey_chat_asr', 'module_unavailable', {});
      finish('asr_module_unavailable', { reason: 'asr_module_unavailable' }, 'completed');
      return;
    }
    var profile = pickRussianAsrProfile();
    if (!profile) {
      writeLog('survey_chat_asr', 'profile_unavailable', {});
      finish('asr_profile_unavailable', { reason: 'asr_profile_unavailable' }, 'completed');
      return;
    }
    var gotResult = false;
    try {
      asr = VoxEngine.createASR({ profile: profile, singleUtterance: true, interimResults: false });
      asr.addEventListener(ASREvents.Result, function(ev) {
        if (finished || gotResult) return;
        gotResult = true;
        clearTimer(answerTimeoutId);
        answerTimeoutId = null;
        var text = String((ev && (ev.text || ev.transcript)) || '').trim();
        writeLog('survey_chat_asr', 'result', { textLength: text.length });
        stopListening('got_result');
        onClientUtterance(text);
      });
      if (typeof ASREvents !== 'undefined' && ASREvents.Error) {
        asr.addEventListener(ASREvents.Error, function(ev) {
          writeLog('survey_chat_asr', 'error', { error: ev && (ev.error || ev.message || ev.reason) });
        });
      }
      customerCall.sendMediaTo(asr);
    } catch (asrError) {
      writeLog('survey_chat_asr', 'create_error', { error: String(asrError) });
      finish('asr_create_error', { reason: 'asr_create_error' }, 'completed');
      return;
    }
    answerTimeoutId = setTimeout(function() {
      if (finished || gotResult) return;
      gotResult = true;
      stopListening('answer_timeout');
      writeLog('survey_chat_asr', 'answer_timeout', { timeoutMs: maxAnswerMs });
      onClientUtterance('');
    }, maxAnswerMs);
  }

  function onClientUtterance(text) {
    if (finished) return;
    if (!text) {
      silenceCount += 1;
      if (silenceCount >= 2) {
        finish('client_silent', { reason: 'client_silent' }, 'completed');
        return;
      }
      // Мягко переспрашиваем, не дёргая мозг и не меняя историю.
      speak('Вы на связи? Поделитесь, пожалуйста, своим впечатлением, нам это очень важно.', null, function() {
        listenClient();
      });
      return;
    }
    silenceCount = 0;
    history.push({ role: 'client', text: text });
    clientTurns += 1;
    nextBotTurn();
  }

  // Запрашивает у backend следующую реплику бота и проигрывает её.
  function nextBotTurn() {
    if (finished) return;
    turnIndex += 1;
    var payload = { session_id: sessionId, turn_index: turnIndex, history: history };
    var myTurn = turnIndex;
    var turnSettled = false;
    turnTimeoutId = setTimeout(function() {
      if (turnSettled || finished) return;
      turnSettled = true;
      // Backend завис (мозг/TTS дольше окна) — не оставляем клиента в тишине:
      // мягко прощаемся встроенным голосом и завершаем. Поздний ответ придёт в
      // already-settled callback и будет проигнорирован (finished/turnSettled).
      writeLog('survey_chat_http', 'turn_timeout_fallback', { turnIndex: myTurn });
      var fb = 'Извините, у нас небольшая техническая заминка. Спасибо вам большое за ответ! Хорошего дня.';
      history.push({ role: 'bot', text: fb });
      speak(fb, null, function() {
        finish('turn_timeout', { reason: 'turn_timeout' }, 'completed');
      });
    }, SERVICE_SURVEY_TURN_HTTP_TIMEOUT_MS);
    httpPostJsonParse(SERVICE_SURVEY_TURN_WEBHOOK_URL, payload, 'turn_' + myTurn, function(parsed) {
      if (turnSettled || finished) return;
      turnSettled = true;
      clearTimer(turnTimeoutId);
      turnTimeoutId = null;
      var body = parsed && parsed.data ? parsed.data : null;
      var reply = body && body.reply_text ? String(body.reply_text) : '';
      var audioUrl = body && body.audio_url ? String(body.audio_url) : null;
      var end = !!(body && body.end);
      if (!reply) {
        // Сеть/мозг не ответили — вежливо завершаем, не оставляем клиента в тишине.
        reply = 'Спасибо вам большое за ответ! Нам очень важно ваше мнение. Хорошего дня!';
        end = true;
      }
      history.push({ role: 'bot', text: reply });
      speak(reply, audioUrl, function() {
        if (finished) return;
        if (end || clientTurns >= maxTurns) {
          finish('dialog_complete', { reason: 'dialog_complete' }, 'completed');
          return;
        }
        listenClient();
      });
    });
  }

  function startRecording() {
    if (!customerCall) return;
    try {
      customerCall.record();
      writeLog('survey_chat_recording', 'record_command_sent', {});
    } catch (error) {
      writeLog('survey_chat_recording', 'record_error', { error: String(error) });
    }
  }

  writeLog('survey_chat_session', 'started', {
    destination: destination,
    callerId: callerId,
    sessionId: sessionId,
    maxTurns: maxTurns,
    useRemoteVoice: useRemoteVoice,
    voximplantSessionId: startedEvent && startedEvent.sessionId,
  });

  if (!destination) {
    finish('invalid_destination', { reason: 'invalid_destination' }, 'failed');
    return;
  }

  customerCall = VoxEngine.callPSTN(destination, callerId);
  enableStats(customerCall, 'survey_chat_customer');

  addEvent(customerCall, CallEvents.Ringing, function(ringingEvent) {
    writeLog('survey_chat_customer', 'ringing', eventData(ringingEvent));
  });
  addEvent(customerCall, CallEvents.AudioStarted, function(audioStartedEvent) {
    writeLog('survey_chat_customer', 'audio_started', eventData(audioStartedEvent));
  });
  addEvent(customerCall, CallEvents.RecordStarted, function(recordStartedEvent) {
    recordingUrl = extractRecordingUrl(recordStartedEvent) || recordingUrl;
    writeLog('survey_chat_recording', 'started', { url: recordingUrl });
    reportRecording(recordingUrl);
  });
  addEvent(customerCall, CallEvents.RecordStopped, function(recordStoppedEvent) {
    recordingUrl = extractRecordingUrl(recordStoppedEvent) || recordingUrl;
    writeLog('survey_chat_recording', 'stopped', { url: recordingUrl });
    reportRecording(recordingUrl);
  });

  addEvent(customerCall, CallEvents.Connected, function(connectedEvent) {
    if (finished || connected) return;
    clearTimer(setupTimeoutId);
    setupTimeoutId = null;
    connected = true;
    connectedAtMs = Date.now();
    writeLog('survey_chat_customer', 'connected', eventData(connectedEvent));
    reportAnswered();
    startRecording();
    overallTimeoutId = setTimeout(function() {
      writeLog('survey_chat_session', 'overall_timeout', {});
      finish('overall_timeout', { reason: 'overall_timeout' }, 'completed');
    }, SERVICE_SURVEY_OVERALL_TIMEOUT_MS);
    nextBotTurn(); // первый ход = приветствие (backend отдаёт его на пустую историю)
  });

  addEvent(customerCall, CallEvents.Failed, function(failedEvent) {
    var details = eventData(failedEvent);
    writeLog('survey_chat_customer', 'failed', details);
    finish(connected ? 'customer_failed_after_connect' : 'customer_failed_before_answer', details, connected ? 'completed' : 'no_answer');
  });
  addEvent(customerCall, CallEvents.Disconnected, function(disconnectedEvent) {
    var details = eventData(disconnectedEvent);
    writeLog('survey_chat_customer', 'disconnected', details);
    finish(connected ? 'customer_disconnected' : 'customer_disconnected_before_answer', details, connected ? 'completed' : 'no_answer');
  });

  setupTimeoutId = setTimeout(function() {
    var details = { reason: 'pstn_setup_timeout', timeoutMs: PSTN_SETUP_TIMEOUT_MS };
    writeLog('survey_chat_customer', 'setup_timeout', details);
    finish('pstn_setup_timeout', details, 'no_answer');
  }, PSTN_SETUP_TIMEOUT_MS);
}

function realtimeBusinessTools() {
  return [
    {
      type: 'function',
      name: 'get_service_catalog',
      description: 'Единственный источник услуг, категорий, опций, цен и pricing_guidance. Каталог не является итоговым расчётом: итоговую сумму даёт calculate_price. Можно искать по query: визитки, макет, фото на документы.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          categorySlug: { type: 'string' },
          query: { type: 'string' },
        },
      },
    },
    {
      type: 'function',
      name: 'calculate_price',
      description: 'Единственный источник итоговой цены по выбранным опциям из каталога.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['categorySlug', 'selectedOptions'],
        properties: {
          categorySlug: { type: 'string' },
          selectedOptions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['option_slug', 'quantity'],
              properties: {
                option_slug: { type: 'string' },
                quantity: { type: 'integer', minimum: 1 },
              },
            },
          },
          deliveryMethod: { type: 'string', enum: ['electronic', 'pickup', 'postal'] },
          isReturning: { type: 'boolean' },
          promoCode: { type: 'string' },
        },
      },
    },
    {
      type: 'function',
      name: 'validate_selection',
      description: 'Проверка совместимости выбранных опций.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['categorySlug', 'selectedOptions'],
        properties: {
          categorySlug: { type: 'string' },
          selectedOptions: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    {
      type: 'function',
      name: 'check_subscription',
      description: 'Проверить активную подписку текущего клиента по телефону звонка.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      type: 'function',
      name: 'get_student_discount',
      description: 'Проверить образовательную льготу текущего клиента по телефону звонка.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      type: 'function',
      name: 'get_order_status',
      description: 'Статус заказа по номеру, только если заказ принадлежит текущему клиенту.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['orderId'],
        properties: { orderId: { type: 'string' } },
      },
    },
    {
      type: 'function',
      name: 'get_my_bookings',
      description: 'Ближайшие записи текущего клиента.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      type: 'function',
      name: 'list_pickup_points',
      description: 'Точки самовывоза, адреса и часы.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
    {
      type: 'function',
      name: 'get_studio_status',
      description: 'Проверить, работает ли точка сегодня или в указанную дату. Без studio возвращает все точки.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          studio: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD, по умолчанию сегодня по Москве.' },
        },
      },
    },
    {
      type: 'function',
      name: 'check_slots',
      description: 'Единственный источник свободных слотов для записи. Без studio возвращает слоты по всем точкам.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['date'],
        properties: {
          studio: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          service: { type: 'string', enum: ['photo_documents', 'portrait_photo'] },
        },
      },
    },
    {
      type: 'function',
      name: 'create_booking',
      description: 'Создать запись по телефону текущего звонка на фото на документы или портретную съёмку.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['studio', 'date', 'time', 'service'],
        properties: {
          studio: { type: 'string', description: 'Код или название точки: soborny, barrikadnaya, адрес или название.' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM' },
          service: { type: 'string', enum: ['photo_documents', 'portrait_photo'] },
          clientName: { type: 'string' },
        },
      },
    },
    {
      type: 'function',
      name: 'handoff_to_operator',
      description: 'Передать разговор сотруднику, если нет точного факта или запрос индивидуальный.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['reason'],
        properties: {
          reason: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
  ];
}

/**
 * РЕЖИМ 3: realtime опрос-забота через готовый Voximplant Grok Voice Agent client.
 *
 * Speech-to-speech ведёт нативный Grok-клиент Voximplant:
 * Grok.createVoiceAgentAPIClient + VoxEngine.sendMediaBetween.
 * Наш backend media bridge в аудиотракте не участвует.
 */
function startServiceSurveyRealtime(data, startedEvent) {
  var destination = normalizeDestination(data && data.destination);
  var callerId = normalizeDestination(data && data.callerId) || CALLER_ID;
  var sessionId = data && data.sessionId
    ? String(data.sessionId)
    : 'service-survey-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000));
  var model = data && data.realtimeModel ? String(data.realtimeModel) : 'grok-voice-think-fast-1.0';
  var voice = data && data.realtimeVoice ? String(data.realtimeVoice) : 'om17cury';
  var instructions = data && data.realtimeInstructions
    ? String(data.realtimeInstructions)
    : SERVICE_SURVEY_REALTIME_FALLBACK_INSTRUCTIONS;
  var operatorUser = data && data.operatorUser ? String(data.operatorUser) : STUDIO_USER;

  var customerCall = null;
  var voiceAgentAPIClient = null;
  var operatorCall = null;
  var finished = false;
  var connected = false;
  var answeredReported = false;
  var terminalReported = false;
  var nativeMediaStarted = false;
  var sessionUpdated = false;
  var operatorConnected = false;
  var handoffInProgress = false;
  var nativeGrokStarting = false;
  var nativeGrokResponseStarted = false;
  var recordingUrl = '';
  var connectedAtMs = 0;
  var setupTimeoutId = null;
  var overallTimeoutId = null;
  var grokStartTimeoutId = null;
  var operatorTimeoutId = null;
  var transcriptLines = [];

  function clearTimer(t) { if (t !== null) clearTimeout(t); }
  function clearAllTimers() {
    clearTimer(setupTimeoutId); clearTimer(overallTimeoutId);
    clearTimer(grokStartTimeoutId); clearTimer(operatorTimeoutId);
    setupTimeoutId = null; overallTimeoutId = null; grokStartTimeoutId = null; operatorTimeoutId = null;
  }
  function durationSeconds(d) {
    if (d && d.duration !== undefined) return d.duration;
    if (!connectedAtMs) return undefined;
    return Math.max(0, Math.round((Date.now() - connectedAtMs) / 1000));
  }
  function transcriptText() { return transcriptLines.join('\n'); }
  function basePayload(extra) {
    var p = { caller_number: callerId, called_number: destination || '',
      session_id: sessionId, occurred_at: new Date().toISOString() };
    if (extra) Object.keys(extra).forEach(function(k) { p[k] = extra[k]; });
    return p;
  }
  function report(payload, label) { postJson(SERVICE_SURVEY_RESULT_WEBHOOK_URL, basePayload(payload), label); }
  function reportAnswered() {
    if (answeredReported) return; answeredReported = true;
    report({ event: 'answered', reason: 'pstn_connected' }, 'survey_rt_answered');
  }
  function reportRecording(url) { if (url) report({ event: 'recording', recording_url: url }, 'survey_rt_recording'); }
  function reportTerminal(eventName, reason, details) {
    if (terminalReported) return; terminalReported = true;
    report({ event: eventName, duration_seconds: durationSeconds(details), reason: reason,
      transcript: transcriptText() || undefined, recording_url: recordingUrl || undefined }, 'survey_rt_' + eventName);
  }
  function closeNativeGrok(reason) {
    if (!voiceAgentAPIClient) return;
    try { if (customerCall && customerCall.stopMediaTo) customerCall.stopMediaTo(voiceAgentAPIClient); }
    catch (e) { writeLog('survey_rt_grok', 'stop_call_media_error', { reason: reason, error: String(e) }); }
    try { if (voiceAgentAPIClient.stopMediaTo) voiceAgentAPIClient.stopMediaTo(customerCall); }
    catch (e2) { writeLog('survey_rt_grok', 'stop_grok_media_error', { reason: reason, error: String(e2) }); }
    try { if (voiceAgentAPIClient.close) voiceAgentAPIClient.close(); }
    catch (e3) { writeLog('survey_rt_grok', 'close_error', { reason: reason, error: String(e3) }); }
    voiceAgentAPIClient = null;
  }

  function maybeStartNativeGrokMedia(reason) {
    if (finished || nativeGrokResponseStarted || !connected || !voiceAgentAPIClient || !sessionUpdated) return;
    nativeGrokResponseStarted = true;
    grokStartTimeoutId = setTimeout(function() {
      if (finished || nativeMediaStarted) return;
      writeLog('survey_rt_grok', 'media_no_audio_timeout', { sessionUpdated: sessionUpdated, reason: reason });
      sayAndFinish('Извините, у нас техническая заминка. Спасибо за ваше время, хорошего дня.', 'grok_no_audio');
    }, 12000);
    writeLog('survey_rt_grok', 'media_start_requested', { reason: reason });
    VoxEngine.sendMediaBetween(customerCall, voiceAgentAPIClient);
    voiceAgentAPIClient.responseCreate({});
  }

  // ЕДИНСТВЕННЫЙ путь завершения. Вебхук с транскриптом уходит ДО terminate.
  function finish(reason, details, terminalEvent) {
    if (finished) return; finished = true;
    clearAllTimers(); closeNativeGrok(reason);
    writeLog('survey_rt_session', 'finish', { reason: reason, lines: transcriptLines.length });
    if (terminalEvent) reportTerminal(terminalEvent, reason, details);
    else if (connected) reportTerminal('completed', reason, details);
    else if (reason === 'invalid_destination') reportTerminal('failed', reason, details);
    else reportTerminal('no_answer', reason, details);
    safeHangup(customerCall, 'survey_rt_customer');
    safeHangup(operatorCall, 'survey_rt_operator');
    terminateSoon(reason);
  }

  // Realtime не поднялся (нет ключа/кредитов/модуля) — извинение встроенным голосом, затем finish.
  function sayAndFinish(text, reason) {
    if (finished) return;
    try { if (customerCall && customerCall.say) customerCall.say(String(text), Language.RU_RUSSIAN_FEMALE); }
    catch (e) { writeLog('survey_rt_grok', 'say_error', { error: String(e) }); }
    setTimeout(function() { finish(reason, { reason: reason }, 'completed'); }, 3500);
  }

  function startRecording() {
    try { customerCall.record(); writeLog('survey_rt_recording', 'record_command_sent', {}); }
    catch (e) { writeLog('survey_rt_recording', 'record_error', { error: String(e) }); }
  }

  function grokPayload(event) {
    if (!event) return {};
    if (event.data && event.data.payload) return event.data.payload;
    if (event.payload) return event.payload;
    if (event.data) return event.data;
    return event;
  }

  function appendTranscriptFromGrokEvent(event, fallbackRole) {
    var payload = grokPayload(event);
    var text = String((payload && (payload.transcript || payload.text || payload.delta)) || '').trim();
    if (!text) return;
    var type = String((payload && payload.type) || (event && event.type) || '');
    var role = fallbackRole || (type.indexOf('input') >= 0 ? 'client' : 'bot');
    if (role === 'client') {
      transcriptLines.push('Клиент: ' + text);
      writeLog('survey_rt_transcript', 'client', { type: 'native_grok', len: text.length });
    } else {
      transcriptLines.push('Бот: ' + text);
      writeLog('survey_rt_transcript', 'bot', { type: 'native_grok', len: text.length });
    }
  }

  function getXaiApiKeySecret() {
    try {
      if (VoxEngine.getSecretValue) {
        return String(VoxEngine.getSecretValue('XAI_API_KEY') || '');
      }
    } catch (e) {
      writeLog('survey_rt_grok', 'secret_read_error', { error: String(e) });
    }
    return '';
  }

  function parseFunctionArguments(payload) {
    try {
      return JSON.parse(String((payload && payload.arguments) || '{}'));
    } catch (e) {
      writeLog('survey_rt_tool', 'parse_arguments_error', { name: payload && payload.name, error: String(e) });
      return {};
    }
  }

  function sendFunctionOutput(payload, value, continueResponse) {
    if (!payload || !payload.call_id || !voiceAgentAPIClient) return;
    try {
      voiceAgentAPIClient.conversationItemCreate({
        item: {
          type: 'function_call_output',
          call_id: payload.call_id,
          output: JSON.stringify(value || {}),
        },
      });
      if (continueResponse) voiceAgentAPIClient.responseCreate({});
    } catch (e) {
      writeLog('survey_rt_tool', 'function_output_error', {
        name: payload && payload.name,
        error: String(e),
      });
    }
  }

  function failOperatorHandoff(reason, details, payload) {
    if (!handoffInProgress || operatorConnected) return;
    clearTimer(operatorTimeoutId);
    operatorTimeoutId = null;
    handoffInProgress = false;
    writeLog('survey_rt_handoff', 'operator_unavailable', {
      reason: reason,
      details: details || {},
    });
    safeHangup(operatorCall, 'survey_rt_operator');
    operatorCall = null;
    sendFunctionOutput(payload, {
      ok: false,
      status: 'operator_unavailable',
      reason: reason,
    }, true);
  }

  function bridgeOperatorHandoff(payload, details) {
    if (finished || !operatorCall) return;
    clearTimer(operatorTimeoutId);
    operatorTimeoutId = null;
    operatorConnected = true;
    handoffInProgress = false;
    writeLog('survey_rt_handoff', 'operator_connected', details || {});
    sendFunctionOutput(payload, {
      ok: true,
      status: 'operator_connected',
    }, false);
    closeNativeGrok('operator_handoff_connected');
    try {
      VoxEngine.sendMediaBetween(customerCall, operatorCall);
      writeLog('survey_rt_handoff', 'bridged', { operatorUser: operatorUser });
    } catch (e) {
      writeLog('survey_rt_handoff', 'bridge_error', { error: String(e) });
      finish('operator_bridge_failed', { reason: 'operator_bridge_failed' }, 'completed');
    }
  }

  function startOperatorHandoff(payload) {
    if (!payload || !payload.call_id) return;
    if (handoffInProgress || operatorConnected) {
      sendFunctionOutput(payload, {
        ok: false,
        status: 'handoff_already_in_progress',
      }, true);
      return;
    }

    var args = parseFunctionArguments(payload);
    handoffInProgress = true;
    writeLog('survey_rt_handoff', 'requested', {
      operatorUser: operatorUser,
      reason: args && args.reason ? String(args.reason) : '',
    });

    try { if (voiceAgentAPIClient && voiceAgentAPIClient.clearMediaBuffer) voiceAgentAPIClient.clearMediaBuffer(); }
    catch (e) { writeLog('survey_rt_handoff', 'clear_buffer_error', { error: String(e) }); }

    try {
      operatorCall = VoxEngine.callUser({
        username: operatorUser,
        callerid: callerId,
        displayName: 'AI handoff',
        video: false,
      });
    } catch (e2) {
      writeLog('survey_rt_handoff', 'call_user_error', { error: String(e2) });
      operatorCall = null;
      handoffInProgress = false;
      sendFunctionOutput(payload, {
        ok: false,
        status: 'operator_unavailable',
        reason: 'operator_call_error',
      }, true);
      return;
    }

    enableStats(operatorCall, 'survey_rt_operator');

    addEvent(operatorCall, CallEvents.Ringing, function(e3) {
      writeLog('survey_rt_operator', 'ringing', eventData(e3));
    });
    addEvent(operatorCall, CallEvents.AudioStarted, function(e4) {
      writeLog('survey_rt_operator', 'audio_started', eventData(e4));
    });
    addEvent(operatorCall, CallEvents.Connected, function(e5) {
      bridgeOperatorHandoff(payload, eventData(e5));
    });
    addEvent(operatorCall, CallEvents.Failed, function(e6) {
      var details = eventData(e6);
      writeLog('survey_rt_operator', 'failed', details);
      if (operatorConnected) {
        finish('operator_failed_after_handoff', details, 'completed');
        return;
      }
      failOperatorHandoff('operator_failed', details, payload);
    });
    addEvent(operatorCall, CallEvents.Disconnected, function(e7) {
      var details = eventData(e7);
      writeLog('survey_rt_operator', 'disconnected', details);
      if (operatorConnected) {
        finish('operator_disconnected_after_handoff', details, 'completed');
        return;
      }
      failOperatorHandoff('operator_disconnected_before_answer', details, payload);
    });

    operatorTimeoutId = setTimeout(function() {
      failOperatorHandoff('operator_answer_timeout', {
        reason: 'operator_answer_timeout',
        timeoutMs: OPERATOR_SETUP_TIMEOUT_MS,
      }, payload);
    }, OPERATOR_SETUP_TIMEOUT_MS);
  }

  function startNativeGrokRealtime(reason) {
    if (voiceAgentAPIClient || nativeGrokStarting) {
      writeLog('survey_rt_grok', 'start_reused', { reason: reason || 'unknown' });
      return;
    }
    if (!ensureGrokModuleLoaded()) {
      writeLog('survey_rt_grok', 'module_unavailable', {});
      if (connected) sayAndFinish('Извините, сервис временно недоступен. Спасибо и хорошего дня.', 'grok_module_unavailable');
      return;
    }

    var xaiApiKey = getXaiApiKeySecret();
    if (!xaiApiKey) {
      writeLog('survey_rt_grok', 'secret_missing', {});
      if (connected) sayAndFinish('Извините, сервис временно недоступен. Спасибо и хорошего дня.', 'grok_secret_missing');
      return;
    }

    var onWebSocketClose = function(event) {
      writeLog('survey_rt_grok', 'websocket_closed', { code: event && event.code, reason: event && event.reason });
      if (!connected) {
        voiceAgentAPIClient = null;
        sessionUpdated = false;
        nativeGrokStarting = false;
        return;
      }
      if (!finished) finish('grok_ws_closed', { reason: 'grok_ws_closed' }, connected ? 'completed' : 'failed');
    };

    nativeGrokStarting = true;
    writeLog('survey_rt_grok', 'client_create_started', { reason: reason || 'unknown', model: model, voice: voice });
    Grok.createVoiceAgentAPIClient({ xAIApiKey: xaiApiKey, model: model, onWebSocketClose: onWebSocketClose }).then(function(client) {
      nativeGrokStarting = false;
      if (finished) {
        try { if (client && client.close) client.close(); } catch (e) { /* noop */ }
        return;
      }
      voiceAgentAPIClient = client;
      writeLog('survey_rt_grok', 'client_created', { model: model, voice: voice, reason: reason || 'unknown' });

      voiceAgentAPIClient.addEventListener(Grok.VoiceAgentAPIEvents.ConversationCreated, function() {
        writeLog('survey_rt_grok', 'conversation_created', {});
        voiceAgentAPIClient.sessionUpdate({
          session: {
            voice: voice,
            turn_detection: {
              type: 'server_vad',
              threshold: 0.65,
              silence_duration_ms: 0,
              prefix_padding_ms: 333,
            },
            instructions: instructions,
            tools: realtimeBusinessTools(),
          },
        });
      });

      voiceAgentAPIClient.addEventListener(Grok.VoiceAgentAPIEvents.SessionUpdated, function() {
        if (sessionUpdated) return;
        sessionUpdated = true;
        writeLog('survey_rt_grok', 'session_updated', {});
        maybeStartNativeGrokMedia('session_updated');
      });

      voiceAgentAPIClient.addEventListener(Grok.VoiceAgentAPIEvents.InputAudioBufferSpeechStarted, function() {
        writeLog('survey_rt_grok', 'input_speech_started', {});
        if (voiceAgentAPIClient) voiceAgentAPIClient.clearMediaBuffer();
      });

      voiceAgentAPIClient.addEventListener(Grok.VoiceAgentAPIEvents.ResponseOutputAudioTranscriptDone, function(event) {
        appendTranscriptFromGrokEvent(event, 'bot');
      });

      voiceAgentAPIClient.addEventListener(Grok.VoiceAgentAPIEvents.ResponseFunctionCallArgumentsDone, function(event) {
        var payload = grokPayload(event);
        if (!payload || !payload.name || !payload.call_id) return;
        if (payload.name === 'handoff_to_operator') {
          startOperatorHandoff(payload);
          return;
        }
        httpPostJsonParse(SERVICE_SURVEY_TOOL_WEBHOOK_URL, {
          session_id: sessionId,
          tool_name: payload.name,
          arguments: String(payload.arguments || '{}'),
          caller_number: callerId,
          called_number: destination,
        }, 'survey_rt_tool', function(parsed) {
          var toolOutput = '{"error":"tool_failed"}';
          try {
            if (parsed && parsed.data && typeof parsed.data.output === 'string') {
              toolOutput = parsed.data.output;
            }
          } catch (e) {
            toolOutput = '{"error":"tool_parse_failed"}';
          }
          if (!voiceAgentAPIClient) return;
          voiceAgentAPIClient.conversationItemCreate({
            item: {
              type: 'function_call_output',
              call_id: payload.call_id,
              output: toolOutput,
            },
          });
          voiceAgentAPIClient.responseCreate({});
        });
      });

      voiceAgentAPIClient.addEventListener(Grok.VoiceAgentAPIEvents.Unknown, function(event) {
        appendTranscriptFromGrokEvent(event, null);
      });

      voiceAgentAPIClient.addEventListener(Grok.VoiceAgentAPIEvents.WebSocketError, function(event) {
        writeLog('survey_rt_grok', 'websocket_error', { reason: event && event.reason });
      });

      voiceAgentAPIClient.addEventListener(Grok.Events.WebSocketMediaStarted, function() {
        nativeMediaStarted = true;
        clearTimer(grokStartTimeoutId);
        grokStartTimeoutId = null;
        writeLog('survey_rt_grok', 'media_started', {});
      });

      voiceAgentAPIClient.addEventListener(Grok.Events.WebSocketMediaEnded, function() {
        writeLog('survey_rt_grok', 'media_ended', {});
      });
    }).catch(function(error) {
      nativeGrokStarting = false;
      writeLog('survey_rt_grok', 'create_error', { error: String(error).slice(0, 200) });
      if (connected) sayAndFinish('Извините, сервис временно недоступен. Спасибо и хорошего дня.', 'grok_create_error');
    });
  }

  writeLog('survey_rt_session', 'started', { destination: destination, callerId: callerId,
    sessionId: sessionId, voice: voice, model: model,
    voximplantSessionId: startedEvent && startedEvent.sessionId });

  if (!destination) { finish('invalid_destination', { reason: 'invalid_destination' }, 'failed'); return; }

  customerCall = VoxEngine.callPSTN(destination, callerId);
  enableStats(customerCall, 'survey_rt_customer');

  addEvent(customerCall, CallEvents.Ringing, function(e) {
    writeLog('survey_rt_customer', 'ringing', eventData(e));
    startNativeGrokRealtime('ringing');
  });
  addEvent(customerCall, CallEvents.AudioStarted, function(e) { writeLog('survey_rt_customer', 'audio_started', eventData(e)); });
  addEvent(customerCall, CallEvents.RecordStarted, function(e) {
    recordingUrl = extractRecordingUrl(e) || recordingUrl;
    writeLog('survey_rt_recording', 'started', { url: recordingUrl }); reportRecording(recordingUrl);
  });
  addEvent(customerCall, CallEvents.RecordStopped, function(e) {
    recordingUrl = extractRecordingUrl(e) || recordingUrl;
    writeLog('survey_rt_recording', 'stopped', { url: recordingUrl }); reportRecording(recordingUrl);
  });

  addEvent(customerCall, CallEvents.Connected, function(e) {
    if (finished || connected) return; // защита от двойного startRealtimeBridge (двойной биллинг xAI)
    clearTimer(setupTimeoutId); setupTimeoutId = null;
    connected = true; connectedAtMs = Date.now();
    writeLog('survey_rt_customer', 'connected', eventData(e));
    reportAnswered();
    startRecording();
    overallTimeoutId = setTimeout(function() {
      writeLog('survey_rt_session', 'overall_timeout', {});
      finish('overall_timeout', { reason: 'overall_timeout' }, 'completed');
    }, SERVICE_SURVEY_OVERALL_TIMEOUT_MS);
    startNativeGrokRealtime('connected');
    maybeStartNativeGrokMedia('connected');
  });

  addEvent(customerCall, CallEvents.Failed, function(e) {
    var d = eventData(e); writeLog('survey_rt_customer', 'failed', d);
    finish(connected ? 'customer_failed_after_connect' : 'customer_failed_before_answer', d, connected ? 'completed' : 'no_answer');
  });
  addEvent(customerCall, CallEvents.Disconnected, function(e) {
    var d = eventData(e); writeLog('survey_rt_customer', 'disconnected', d);
    finish(connected ? 'customer_disconnected' : 'customer_disconnected_before_answer', d, connected ? 'completed' : 'no_answer');
  });

  setupTimeoutId = setTimeout(function() {
    var d = { reason: 'pstn_setup_timeout', timeoutMs: PSTN_SETUP_TIMEOUT_MS };
    writeLog('survey_rt_customer', 'setup_timeout', d);
    finish('pstn_setup_timeout', d, 'no_answer');
  }, PSTN_SETUP_TIMEOUT_MS);
}

var customFlowStarted = false;

function maybeStartCustomFlow(startedEvent, source) {
  if (customFlowStarted) {
    return;
  }
  var data = parseCustomData();
  if (!data || (data.type !== 'studio_click_to_call' && data.type !== 'service_survey')) {
    return;
  }
  customFlowStarted = true;
  if (data.type === 'service_survey') {
    if (data.voiceEngine === 'grok_realtime') {
      writeLog('custom_data', 'service_survey_realtime_detected', { source: source || 'unknown' });
      startServiceSurveyRealtime(data, startedEvent || {});
    } else if (data.conversational) {
      writeLog('custom_data', 'service_survey_chat_detected', { source: source || 'unknown' });
      startServiceSurveyChat(data, startedEvent || {});
    } else {
      writeLog('custom_data', 'service_survey_detected', { source: source || 'unknown' });
      startServiceSurvey(data, startedEvent || {});
    }
    return;
  }
  writeLog('custom_data', 'click_to_call_detected', { source: source || 'unknown' });
  startClickToCall(data, startedEvent || {});
}

VoxEngine.addEventListener(AppEvents.Started, function(e) {
  maybeStartCustomFlow(e, 'Application.Started');
});

setTimeout(function() {
  maybeStartCustomFlow(null, 'deferred_custom_data');
}, 0);

VoxEngine.addEventListener(AppEvents.CallAlerting, function(e) {
  if (customFlowStarted) {
    writeLog('incoming', 'ignored_custom_flow', {});
    return;
  }
  var incoming = e.call;
  var rawDestination = e.destination || getCallNumber(incoming);
  var destination = normalizeDestination(rawDestination);
  var finished = false;
  var pstnConnected = false;
  var incomingConnected = false;
  var mediaBridged = false;
  var setupTimeoutId = null;

  function clearTimers() {
    if (setupTimeoutId !== null) {
      clearTimeout(setupTimeoutId);
      setupTimeoutId = null;
    }
  }

  function terminateSoon(reason) {
    writeLog('session', 'terminate_scheduled', {
      reason: reason,
      delayMs: TERMINATE_DELAY_MS,
    });
    setTimeout(function() {
      VoxEngine.terminate();
    }, TERMINATE_DELAY_MS);
  }

  function finish(reason, details) {
    if (finished) {
      return;
    }
    finished = true;
    clearTimers();
    writeLog('session', 'finish', {
      reason: reason,
      details: details || {},
      pstnConnected: pstnConnected,
      incomingConnected: incomingConnected,
    });
    terminateSoon(reason);
  }

  if (!destination) {
    writeLog('incoming', 'invalid_destination', {
      rawDestination: rawDestination,
      callerid: e.callerid,
      callId: getCallId(incoming),
    });
    safeReject(incoming, 'incoming');
    finish('invalid_destination');
    return;
  }

  writeLog('incoming', 'alerting', {
    callerid: e.callerid,
    rawDestination: rawDestination,
    destination: destination,
    callId: getCallId(incoming),
  });

  enableStats(incoming, 'incoming');

  var outgoing = VoxEngine.callPSTN(destination, CALLER_ID);
  enableStats(outgoing, 'outgoing');

  writeLog('outgoing', 'dial_pstn', {
    callerId: CALLER_ID,
    destination: destination,
    callId: getCallId(outgoing),
  });

  try {
    VoxEngine.sendMediaBetween(incoming, outgoing);
    mediaBridged = true;
    writeLog('media', 'bridged', {
      incomingCallId: getCallId(incoming),
      outgoingCallId: getCallId(outgoing),
    });
  } catch (error) {
    writeLog('media', 'send_media_error', { error: String(error) });
  }

  addEvent(incoming, CallEvents.Connected, function(connectedEvent) {
    incomingConnected = true;
    writeLog('incoming', 'connected', eventData(connectedEvent));
  });

  addEvent(incoming, CallEvents.Failed, function(failedEvent) {
    var details = eventData(failedEvent);
    writeLog('incoming', 'failed', details);
    safeHangup(outgoing, 'outgoing');
    finish('incoming_failed', details);
  });

  addEvent(incoming, CallEvents.Disconnected, function(disconnectedEvent) {
    var details = eventData(disconnectedEvent);
    writeLog('incoming', 'disconnected', details);
    safeHangup(outgoing, 'outgoing');
    finish('incoming_disconnected', details);
  });

  addEvent(outgoing, CallEvents.Ringing, function(ringingEvent) {
    writeLog('outgoing', 'ringing', eventData(ringingEvent));
    ringIncoming(incoming);
  });

  addEvent(outgoing, CallEvents.AudioStarted, function(audioStartedEvent) {
    writeLog('outgoing', 'audio_started', eventData(audioStartedEvent));
    startIncomingEarlyMedia(incoming, audioStartedEvent);
  });

  addEvent(outgoing, CallEvents.FirstAudioPacketReceived, function(firstAudioEvent) {
    writeLog('outgoing', 'first_audio_packet', eventData(firstAudioEvent));
  });

  addEvent(outgoing, CallEvents.Connected, function(connectedEvent) {
    pstnConnected = true;
    clearTimers();
    writeLog('outgoing', 'connected', eventData(connectedEvent));
    if (!mediaBridged) {
      try {
        VoxEngine.sendMediaBetween(incoming, outgoing);
        mediaBridged = true;
        writeLog('media', 'bridged_after_connect', {});
      } catch (error) {
        writeLog('media', 'send_media_after_connect_error', { error: String(error) });
      }
    }
    answerIncoming(incoming, connectedEvent, destination);
  });

  addEvent(outgoing, CallEvents.Failed, function(failedEvent) {
    var details = eventData(failedEvent);
    writeLog('outgoing', 'failed', details);
    if (pstnConnected) {
      safeHangup(incoming, 'incoming');
      finish('outgoing_failed_after_connect', details);
      return;
    }
    safeReject(incoming, 'incoming');
    finish('outgoing_failed_before_connect', details);
  });

  addEvent(outgoing, CallEvents.Disconnected, function(disconnectedEvent) {
    var details = eventData(disconnectedEvent);
    writeLog('outgoing', 'disconnected', details);
    if (pstnConnected) {
      safeHangup(incoming, 'incoming');
      finish('outgoing_disconnected', details);
      return;
    }
    safeReject(incoming, 'incoming');
    finish('outgoing_disconnected_before_connect', details);
  });

  setupTimeoutId = setTimeout(function() {
    var details = {
      reason: 'pstn_setup_timeout',
      timeoutMs: PSTN_SETUP_TIMEOUT_MS,
    };
    writeLog('outgoing', 'setup_timeout', details);
    safeHangup(outgoing, 'outgoing');
    safeReject(incoming, 'incoming');
    finish('pstn_setup_timeout', details);
  }, PSTN_SETUP_TIMEOUT_MS);
});
