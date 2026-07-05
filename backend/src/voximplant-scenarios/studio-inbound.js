var SCENARIO_NAME = 'studio-inbound';
var STUDIO_USER = 'soborny101';
// Внутренние номера для перевода звонка между студиями (оператор жмёт «Перевод» → набирает цифру).
// 1 → Соборный (soborny101), 2 → Баррикадная (barrikadnaya201). См. сценарий internal-intercom.
var TRANSFER_EXTENSIONS = { '1': 'soborny101', '2': 'barrikadnaya201' };
var FALLBACK_CALLER_ID = '+78633226575';
var BACKEND_BASE_URL = 'https://svoefoto.ru';
var INCOMING_WEBHOOK_URL = BACKEND_BASE_URL + '/api/telephony/incoming-call';
var CALL_EVENT_WEBHOOK_URL = BACKEND_BASE_URL + '/api/telephony/call-event';
var OUTBOUND_TIMEOUT_MS = 45000;
var REDIAL_DELAY_MS = 1500;
var MAX_OPERATOR_DIAL_ATTEMPTS = 20;
var QUEUE_PROMPT_DELAY_MS = 18000;
var QUEUE_PROMPT_INTERVAL_MS = 16000;
var TERMINATE_DELAY_MS = 1500;
var FALLBACK_HANGUP_DELAY_MS = 9000;
var GREETING_MESSAGE = 'Здравствуйте, вы позвонили в Своё Фото. Пожалуйста, оставайтесь на линии. Вам ответит первый освободившийся сотрудник. Если не хотите ждать, напишите нам через удобный мессенджер на сайте своё фото точка ру.';
var QUEUE_MESSAGE = 'Пожалуйста, оставайтесь на линии. Мы соединяем вас с сотрудником.';
var FALLBACK_MESSAGE = 'Сейчас все сотрудники заняты. Мы получили ваш звонок, номер сохранён, и перезвоним вам в ближайшее время. Также вы можете написать нам через удобный мессенджер на сайте своё фото точка ру.';

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (error) {
    return JSON.stringify({ stringifyError: String(error) });
  }
}

function writeLog(scope, eventName, data) {
  Logger.write('[studio-inbound] ' + safeJson({
    scope: scope,
    event: eventName,
    data: data || {},
  }));
}

function normalizePhone(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback || '';
  }
  return String(value);
}

function getCallId(call) {
  try {
    if (call && call.id) {
      return String(call.id());
    }
  } catch (error) {
    writeLog('call', 'id_error', { error: String(error) });
  }
  return 'studio-inbound-' + String(Date.now()) + '-' + String(Math.floor(Math.random() * 1000000));
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

function enableStats(call, label) {
  try {
    if (call && call.enableMediaStatistics) {
      call.enableMediaStatistics();
    }
  } catch (error) {
    writeLog(label, 'media_stats_error', { error: String(error) });
  }
}

function answerIncoming(call, reason) {
  try {
    if (call && call.answer) {
      call.answer();
      writeLog('incoming', 'answered_by_scenario', { reason: reason || 'unknown' });
      return true;
    }
  } catch (error) {
    writeLog('incoming', 'answer_error', { error: String(error) });
  }
  return false;
}

function stopPrompt(call, label) {
  try {
    if (call && call.stopPlayback) {
      call.stopPlayback();
    }
  } catch (error) {
    writeLog(label, 'stop_playback_error', { error: String(error) });
  }
}

function sayMessage(call, message, label) {
  try {
    if (call && call.say) {
      call.say(message, Language.RU_RUSSIAN_FEMALE);
      writeLog(label, 'say', { message: message });
      return true;
    }
  } catch (error) {
    writeLog(label, 'say_error', { error: String(error) });
  }
  return false;
}

function hangup(call, label) {
  try {
    if (call && call.hangup) {
      call.hangup();
    }
  } catch (error) {
    writeLog(label, 'hangup_error', { error: String(error) });
  }
}

function sayFallbackAndHangup(call) {
  if (sayMessage(call, FALLBACK_MESSAGE, 'incoming_fallback')) {
    setTimeout(function() {
      hangup(call, 'incoming');
    }, FALLBACK_HANGUP_DELAY_MS);
    return FALLBACK_HANGUP_DELAY_MS;
  }
  hangup(call, 'incoming');
  return 0;
}

function terminateSoon(reason, delayMs) {
  var delay = typeof delayMs === 'number' && delayMs > 0 ? delayMs : TERMINATE_DELAY_MS;
  writeLog('session', 'terminate_scheduled', { reason: reason, delayMs: delay });
  setTimeout(function() {
    VoxEngine.terminate();
  }, delay);
}

function addEvent(call, eventName, handler) {
  if (call && eventName && handler) {
    call.addEventListener(eventName, handler);
  }
}

VoxEngine.addEventListener(AppEvents.CallAlerting, function(e) {
  var incoming = e.call;
  var callerNumber = normalizePhone(e.callerid, FALLBACK_CALLER_ID);
  var calledNumber = normalizePhone(e.destination, FALLBACK_CALLER_ID);
  var sessionId = getCallId(incoming);
  var finished = false;
  var missedReported = false;
  var answeredReported = false;
  var endedReported = false;
  var operatorConnected = false;
  var incomingAnswered = false;
  var mediaBridged = false;
  var outgoing = null;
  var transferOutgoing = null;
  var dialAttempt = 0;
  var lastOperatorFailure = null;
  var timeoutId = null;
  var redialId = null;
  var queuePromptId = null;

  function clearTimers() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (redialId !== null) {
      clearTimeout(redialId);
      redialId = null;
    }
    if (queuePromptId !== null) {
      clearTimeout(queuePromptId);
      queuePromptId = null;
    }
  }

  function basePayload(extra) {
    var payload = {
      caller_number: callerNumber,
      called_number: calledNumber,
      session_id: sessionId,
      scenario: SCENARIO_NAME,
      destination_user: STUDIO_USER,
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
      reason: 'operator_connected',
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
    }), 'answered');
  }

  function reportEnded(details) {
    if (endedReported) {
      return;
    }
    endedReported = true;
    postJson(CALL_EVENT_WEBHOOK_URL, basePayload({
      event: 'ended',
      duration_seconds: details && details.duration,
      reason: details && details.reason ? details.reason : 'normal_call_clearing',
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
    }), 'ended');
  }

  function reportMissed(reason, details) {
    if (missedReported || operatorConnected) {
      return;
    }
    missedReported = true;
    postJson(CALL_EVENT_WEBHOOK_URL, basePayload({
      event: 'missed',
      reason: reason,
      failure_code: details && (details.code || details.internalCode),
      failure_name: details && details.reason,
    }), 'missed');
  }

  function answerIncomingFor(reason) {
    if (incomingAnswered) {
      return true;
    }
    incomingAnswered = answerIncoming(incoming, reason);
    return incomingAnswered;
  }

  function bridgeCalls(reason) {
    if (mediaBridged) {
      return;
    }
    if (!outgoing) {
      writeLog('media', 'bridge_skipped_no_outgoing', { reason: reason || 'unknown' });
      return;
    }
    try {
      VoxEngine.sendMediaBetween(incoming, outgoing);
      mediaBridged = true;
      writeLog('media', 'bridged', { reason: reason || 'unknown' });
    } catch (error) {
      writeLog('media', 'send_media_error', { error: String(error), reason: reason || 'unknown' });
    }
  }

  function scheduleQueuePrompt(delayMs) {
    if (queuePromptId !== null || finished || operatorConnected) {
      return;
    }
    queuePromptId = setTimeout(function() {
      queuePromptId = null;
      if (finished || operatorConnected) {
        return;
      }
      sayMessage(incoming, QUEUE_MESSAGE, 'incoming_queue');
      scheduleQueuePrompt(QUEUE_PROMPT_INTERVAL_MS);
    }, delayMs);
  }

  function rememberOperatorFailure(eventName, details, attempt) {
    lastOperatorFailure = {
      event: eventName,
      attempt: attempt,
      code: details && details.code,
      internalCode: details && details.internalCode,
      reason: details && details.reason,
      duration: details && details.duration,
      cost: details && details.cost,
      headers: details && details.headers,
    };
  }

  function scheduleOperatorRedial(eventName, details) {
    if (finished || operatorConnected || redialId !== null) {
      return;
    }
    if (dialAttempt >= MAX_OPERATOR_DIAL_ATTEMPTS) {
      writeLog('outgoing', 'redial_limit_reached', {
        attempts: dialAttempt,
        event: eventName,
        details: details || {},
      });
      return;
    }
    redialId = setTimeout(function() {
      redialId = null;
      dialOperator('redial_after_' + eventName);
    }, REDIAL_DELAY_MS);
    writeLog('outgoing', 'redial_scheduled', {
      nextAttempt: dialAttempt + 1,
      delayMs: REDIAL_DELAY_MS,
      event: eventName,
      details: details || {},
    });
  }

  function resolveTransferTarget(raw) {
    var key = String(raw === undefined || raw === null ? '' : raw).trim();
    if (Object.prototype.hasOwnProperty.call(TRANSFER_EXTENSIONS, key)) {
      return TRANSFER_EXTENSIONS[key];
    }
    return null;
  }

  function startBlindTransfer(operatorCall, target) {
    var transferCall;
    try {
      transferCall = VoxEngine.callUser({
        username: target,
        callerid: callerNumber,
        displayName: callerNumber,
        video: false,
        scheme: e.scheme,
      });
    } catch (error) {
      writeLog('transfer', 'calluser_error', { error: String(error), target: target });
      try { operatorCall.notifyBlindTransferFailed(500, 'Transfer dial error'); } catch (notifyError) {}
      return;
    }
    transferOutgoing = transferCall;
    enableStats(transferCall, 'transfer');
    var transferSettled = false;

    addEvent(transferCall, CallEvents.Ringing, function(ev) {
      writeLog('transfer', 'ringing', { target: target, details: eventData(ev) });
    });

    addEvent(transferCall, CallEvents.Connected, function() {
      if (transferSettled) {
        return;
      }
      transferSettled = true;
      writeLog('transfer', 'connected', { target: target });
      try { VoxEngine.stopMediaBetween(incoming, operatorCall); } catch (error) { writeLog('transfer', 'stop_media_error', { error: String(error) }); }
      try { VoxEngine.sendMediaBetween(incoming, transferCall); } catch (error) { writeLog('transfer', 'send_media_error', { error: String(error) }); }
      // Переключаем активное плечо на переведённый звонок и убираем оператора.
      outgoing = transferCall;
      transferOutgoing = null;
      try { operatorCall.notifyBlindTransferSuccess(); } catch (error) {}
      hangup(operatorCall, 'operator_after_transfer');
    });

    addEvent(transferCall, CallEvents.Failed, function(ev) {
      if (transferSettled) {
        return;
      }
      transferSettled = true;
      transferOutgoing = null;
      var details = eventData(ev);
      writeLog('transfer', 'failed', { target: target, details: details });
      // Перевод не удался — оператор остаётся на линии с клиентом, ничего не рвём.
      try { operatorCall.notifyBlindTransferFailed(details.code || 486, details.reason || 'Transfer target unavailable'); } catch (error) {}
    });

    addEvent(transferCall, CallEvents.Disconnected, function(ev) {
      var details = eventData(ev);
      if (!transferSettled) {
        transferSettled = true;
        transferOutgoing = null;
        writeLog('transfer', 'disconnected_before_connect', { target: target, details: details });
        try { operatorCall.notifyBlindTransferFailed(480, 'Transfer target disconnected'); } catch (error) {}
        return;
      }
      if (finished || outgoing !== transferCall) {
        return;
      }
      // Клиент уже соединён с другой студией, и та положила трубку → завершаем сессию.
      writeLog('transfer', 'target_disconnected', { details: details });
      reportEnded(details);
      finish('transfer_target_disconnected', details, false);
    });
  }

  function enableBlindTransfer(operatorCall) {
    try {
      if (!operatorCall || !operatorCall.handleBlindTransfer) {
        writeLog('transfer', 'unsupported', {});
        return;
      }
      operatorCall.handleBlindTransfer(true);
      addEvent(operatorCall, CallEvents.BlindTransferRequested, function(te) {
        var requested = te && te.transferTo;
        var target = resolveTransferTarget(requested);
        writeLog('transfer', 'requested', { transferTo: requested, target: target });
        if (finished || !target) {
          try { operatorCall.notifyBlindTransferFailed(404, 'Unknown transfer target'); } catch (error) {}
          return;
        }
        startBlindTransfer(operatorCall, target);
      });
      writeLog('transfer', 'enabled', {});
    } catch (error) {
      writeLog('transfer', 'enable_error', { error: String(error) });
    }
  }

  function dialOperator(reason) {
    if (finished || operatorConnected) {
      return;
    }
    dialAttempt += 1;
    var attempt = dialAttempt;
    var currentOutgoing = VoxEngine.callUser({
      username: STUDIO_USER,
      callerid: callerNumber,
      displayName: callerNumber,
      video: false,
      scheme: e.scheme,
    });
    outgoing = currentOutgoing;

    enableStats(currentOutgoing, 'outgoing');
    writeLog('outgoing', 'dial_user', {
      username: STUDIO_USER,
      callerNumber: callerNumber,
      sessionId: sessionId,
      attempt: attempt,
      reason: reason || 'initial',
    });

    addEvent(currentOutgoing, CallEvents.Ringing, function(ringingEvent) {
      writeLog('outgoing', 'ringing', {
        attempt: attempt,
        details: eventData(ringingEvent),
      });
    });

    addEvent(currentOutgoing, CallEvents.AudioStarted, function(audioStartedEvent) {
      writeLog('outgoing', 'audio_started', {
        attempt: attempt,
        details: eventData(audioStartedEvent),
      });
    });

    addEvent(currentOutgoing, CallEvents.Connected, function(connectedEvent) {
      if (finished || operatorConnected || currentOutgoing !== outgoing) {
        return;
      }
      clearTimers();
      operatorConnected = true;
      writeLog('outgoing', 'connected', {
        attempt: attempt,
        details: eventData(connectedEvent),
      });
      answerIncomingFor('operator_connected');
      stopPrompt(incoming, 'incoming');
      bridgeCalls('operator_connected');
      reportAnswered(eventData(connectedEvent));
      enableBlindTransfer(currentOutgoing);
    });

    addEvent(currentOutgoing, CallEvents.Failed, function(failedEvent) {
      var details = eventData(failedEvent);
      writeLog('outgoing', 'failed', {
        attempt: attempt,
        details: details,
      });
      if (finished || operatorConnected || currentOutgoing !== outgoing) {
        return;
      }
      outgoing = null;
      rememberOperatorFailure('failed', details, attempt);
      scheduleOperatorRedial('failed', details);
    });

    addEvent(currentOutgoing, CallEvents.Disconnected, function(disconnectedEvent) {
      var details = eventData(disconnectedEvent);
      writeLog('outgoing', 'disconnected', {
        attempt: attempt,
        details: details,
      });
      if (finished || currentOutgoing !== outgoing) {
        return;
      }
      if (operatorConnected) {
        reportEnded(details);
        finish('operator_disconnected', details, false);
        return;
      }
      outgoing = null;
      rememberOperatorFailure('disconnected_before_answer', details, attempt);
      scheduleOperatorRedial('disconnected_before_answer', details);
    });
  }

  function finish(reason, details, playFallback) {
    if (finished) {
      return;
    }
    finished = true;
    clearTimers();
    writeLog('session', 'finish', {
      reason: reason,
      details: details || {},
      operatorConnected: operatorConnected,
      missedReported: missedReported,
    });
    hangup(transferOutgoing, 'transfer');
    var terminateDelay = TERMINATE_DELAY_MS;
    if (playFallback) {
      answerIncomingFor('fallback_' + reason);
      stopPrompt(incoming, 'incoming');
      terminateDelay += sayFallbackAndHangup(incoming);
    } else {
      hangup(incoming, 'incoming');
    }
    terminateSoon(reason, terminateDelay);
  }

  addEvent(incoming, CallEvents.Disconnected, function(disconnectedEvent) {
    var details = eventData(disconnectedEvent);
    writeLog('incoming', 'disconnected', details);
    clearTimers();
    hangup(outgoing, 'outgoing');
    if (operatorConnected) {
      reportEnded(details);
      finish('caller_disconnected', details, false);
      return;
    }
    reportMissed('caller_disconnected_before_operator', details);
    finish('caller_disconnected_before_operator', details, false);
  });

  addEvent(incoming, CallEvents.Failed, function(failedEvent) {
    var details = eventData(failedEvent);
    writeLog('incoming', 'failed', details);
    clearTimers();
    hangup(outgoing, 'outgoing');
    if (!operatorConnected) {
      reportMissed('incoming_failed', details);
    }
    finish('incoming_failed', details, false);
  });

  writeLog('incoming', 'alerting', {
    callerNumber: callerNumber,
    calledNumber: calledNumber,
    sessionId: sessionId,
  });

  enableStats(incoming, 'incoming');
  answerIncomingFor('scenario_greeting');
  postJson(INCOMING_WEBHOOK_URL, {
    caller_number: callerNumber,
    called_number: calledNumber,
    session_id: sessionId,
  }, 'incoming');
  dialOperator('initial');
  sayMessage(incoming, GREETING_MESSAGE, 'incoming_greeting');
  scheduleQueuePrompt(QUEUE_PROMPT_DELAY_MS);

  timeoutId = setTimeout(function() {
    var details = {
      reason: 'operator_answer_timeout',
      duration: OUTBOUND_TIMEOUT_MS / 1000,
      attempts: dialAttempt,
      lastOperatorFailure: lastOperatorFailure,
    };
    writeLog('outgoing', 'timeout', details);
    hangup(outgoing, 'outgoing');
    reportMissed('operator_answer_timeout', details);
    finish('operator_answer_timeout', details, true);
  }, OUTBOUND_TIMEOUT_MS);
});
