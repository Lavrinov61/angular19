var SCENARIO_NAME = 'flash-call-otp';
var DEFAULT_CALLBACK_URL = 'https://svoefoto.ru/api/telephony/voice-otp/event';
var CALLBACK_VERSION = '2026-05-15';
var TERMINATE_DELAY_MS = 900;

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ stringifyError: String(error) });
  }
}

function writeLog(scope, eventName, data) {
  Logger.write('[flash-call-otp] ' + safeJson({
    scope: scope,
    event: eventName,
    data: data || {},
  }));
}

function parseCustomData() {
  try {
    var raw = VoxEngine.customData ? VoxEngine.customData() : '';
    if (!raw) return null;
    if (typeof raw === 'string') return JSON.parse(raw);
    return raw;
  } catch (error) {
    writeLog('custom_data', 'parse_error', { error: String(error) });
  }
  return null;
}

function maskPhone(value) {
  var digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return '***';
  if (digits.length === 11 && digits[0] === '7') {
    return '+7 (' + digits.slice(1, 4) + ') ***-**-' + digits.slice(-2);
  }
  return new Array(Math.max(0, digits.length - 1)).join('*') + digits.slice(-2);
}

function safeString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function getCallId(call, e) {
  if (e && e.id !== undefined && e.id !== null) {
    return String(e.id);
  }
  try {
    if (call && call.id) {
      return String(call.id());
    }
  } catch (error) {
    writeLog('call', 'id_error', { error: String(error) });
  }
  return '';
}

function headerNames(headers) {
  if (!headers || typeof headers !== 'object') return [];
  try {
    return Object.keys(headers);
  } catch (error) {
    writeLog('event', 'headers_error', { error: String(error) });
  }
  return [];
}

function eventData(e) {
  return {
    code: e && e.code,
    reason: e && e.reason,
    internalCode: e && e.internalCode,
    duration: e && e.duration,
    cost: e && e.cost,
    successful: e && e.successful,
    headerNames: headerNames(e && e.headers),
  };
}

function postJson(url, payload, callbackSecret, label) {
  try {
    var opts = new Net.HttpRequestOptions();
    opts.method = 'POST';
    opts.headers = ['Content-Type: application/json'];
    if (callbackSecret) {
      opts.headers.push('x-svf-voximplant-secret: ' + callbackSecret);
    }
    opts.postData = JSON.stringify(payload);
    Net.httpRequest(url, function(res) {
      writeLog('webhook', label, {
        code: res && res.code,
        error: res && res.error,
      });
    }, opts);
  } catch (error) {
    writeLog('webhook', label + '_error', { error: String(error) });
  }
}

function enableStats(call) {
  try {
    if (call && call.enableMediaStatistics) {
      call.enableMediaStatistics();
    }
  } catch (error) {
    writeLog('call', 'media_stats_error', { error: String(error) });
  }
}

function addCallEvent(call, eventName, handler) {
  if (call && eventName && handler) {
    call.addEventListener(eventName, handler);
  }
}

function safeHangup(call, reason) {
  try {
    if (call && call.hangup) {
      call.hangup();
      return;
    }
  } catch (error) {
    writeLog('call', 'hangup_error', { reason: reason, error: String(error) });
  }
}

function clampNumber(value, fallback, min, max) {
  var numeric = Number(value);
  if (!isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

VoxEngine.addEventListener(AppEvents.Started, function(startedEvent) {
  var customData = parseCustomData();
  if (!customData) {
    writeLog('session', 'invalid_custom_data', {});
    VoxEngine.terminate();
    return;
  }

  var destination = safeString(customData.destination);
  var callerId = safeString(customData.callerId);
  var code = safeString(customData.code).replace(/\D/g, '');
  var callbackUrl = safeString(customData.callbackUrl) || DEFAULT_CALLBACK_URL;
  var callbackSecret = safeString(customData.callbackSecret);
  var repeatCount = clampNumber(customData.repeatCount, 2, 1, 3);
  var hangupAfterMs = clampNumber(customData.hangupAfterMs, 15000, 5000, 60000);
  var sessionId = startedEvent && startedEvent.sessionId !== undefined
    ? String(startedEvent.sessionId)
    : '';
  var call = null;
  var terminated = false;
  var hangupRequested = false;

  function notify(eventName, e, extra) {
    var details = eventData(e);
    var payload = {
      type: 'voice_otp_event',
      version: CALLBACK_VERSION,
      event: eventName,
      sessionId: sessionId,
      callId: getCallId(call, e),
      destination: destination,
      callerId: callerId,
      eventCode: details.code,
      sipCode: details.code,
      internalCode: details.internalCode,
      duration: details.duration,
      successful: details.successful,
      reason: details.reason || (extra && extra.reason) || '',
      timestamp: new Date().toISOString(),
      details: details,
    };
    if (extra) {
      payload.details.extra = extra;
    }

    writeLog('event', eventName, {
      sessionId: sessionId,
      callId: payload.callId,
      destinationMasked: maskPhone(destination),
      callerIdMasked: maskPhone(callerId),
      eventCode: payload.eventCode,
      internalCode: payload.internalCode,
      duration: payload.duration,
      successful: payload.successful,
      reason: payload.reason,
      headerNames: details.headerNames,
      extra: extra || {},
    });

    if (callbackUrl) {
      postJson(callbackUrl, payload, callbackSecret, eventName);
    }
  }

  function terminate(reason, e) {
    if (terminated) return;
    terminated = true;
    notify('terminate', e, { reason: reason || 'unknown' });
    setTimeout(function() {
      VoxEngine.terminate();
    }, TERMINATE_DELAY_MS);
  }

  function requestHangup(reason) {
    if (hangupRequested) return;
    hangupRequested = true;
    notify('hangup_requested', null, { reason: reason || 'unknown' });
    safeHangup(call, reason);
  }

  if (!destination || !callerId || code.length < 4) {
    notify('invalid_custom_data', null, {
      hasDestination: !!destination,
      hasCallerId: !!callerId,
      codeLength: code.length,
    });
    terminate('invalid_custom_data');
    return;
  }

  notify('started', startedEvent, {
    repeatCount: repeatCount,
    hangupAfterMs: hangupAfterMs,
  });

  call = VoxEngine.callPSTN(destination, callerId);
  enableStats(call);

  var digits = code.split('').join(' ');
  var phrases = [];
  for (var i = 0; i < repeatCount; i++) {
    phrases.push(i === 0 ? 'Код входа: ' + digits : 'Повторяю код: ' + digits);
  }
  var message = phrases.join('. ');

  function onPlaybackFinished(e) {
    try {
      call.removeEventListener(CallEvents.PlaybackFinished, onPlaybackFinished);
    } catch (error) {
      writeLog('call', 'remove_playback_listener_error', { error: String(error) });
    }
    notify('playback_finished', e);
    setTimeout(function() {
      requestHangup('playback_finished');
    }, 500);
  }

  addCallEvent(call, CallEvents.Ringing, function(e) {
    notify('ringing', e);
  });

  addCallEvent(call, CallEvents.AudioStarted, function(e) {
    notify('audio_started', e);
  });

  addCallEvent(call, CallEvents.FirstAudioPacketReceived, function(e) {
    notify('first_audio_packet', e);
  });

  addCallEvent(call, CallEvents.Connected, function(e) {
    notify('connected', e);
    addCallEvent(call, CallEvents.PlaybackReady, function(playbackEvent) {
      notify('playback_ready', playbackEvent);
    });
    addCallEvent(call, CallEvents.PlaybackStarted, function(playbackEvent) {
      notify('playback_started', playbackEvent);
    });
    addCallEvent(call, CallEvents.PlaybackFinished, onPlaybackFinished);
    try {
      call.say(message, {
        language: VoiceList.YandexV3.ru_RU_jane,
        ttsOptions: { rate: 'slow' },
      });
    } catch (error) {
      notify('failed', e, { reason: 'say_error', error: String(error) });
      requestHangup('say_error');
      terminate('say_error', e);
      return;
    }

    setTimeout(function() {
      requestHangup('connected_timeout');
    }, hangupAfterMs);
  });

  addCallEvent(call, CallEvents.Failed, function(e) {
    notify('failed', e);
    terminate('failed', e);
  });

  addCallEvent(call, CallEvents.Disconnected, function(e) {
    notify('disconnected', e);
    terminate('disconnected', e);
  });

  setTimeout(function() {
    notify('timeout', null, {
      reason: 'hard_timeout',
      timeoutMs: Math.max(hangupAfterMs + 10000, 25000),
    });
    requestHangup('hard_timeout');
    terminate('hard_timeout');
  }, Math.max(hangupAfterMs + 10000, 25000));
});
