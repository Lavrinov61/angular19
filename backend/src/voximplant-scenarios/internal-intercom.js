/**
 * internal-intercom — внутренние звонки между студиями через Voximplant.
 *
 * Зарегистрированный SIP-юзер набирает короткий номер, и Voximplant соединяет
 * его с SIP-юзером другой студии (звонок целиком внутри аккаунта, бесплатно):
 *   1 → soborny101       (Соборный 21)
 *   2 → barrikadnaya201  (2-я Баррикадная 4)
 *
 * ВРЕМЕННОЕ ЗАКРЫТИЕ СТУДИИ: перед соединением сценарий спрашивает у backend
 * (GET /api/telephony/intercom-route) эффективную маршрутизацию. Если студия
 * назначения временно закрыта (studios.status в БД), backend уводит её короткий
 * номер на открытую точку (обычно Соборный) — чтобы набравший «2» при закрытой
 * Баррикадной всё равно дозвонился до живого сотрудника. Авто-возврат к
 * "2"→barrikadnaya201 происходит сам в день после status_until.
 *
 * Фолбэк: при любой ошибке/таймауте запроса используем СТАТИЧЕСКУЮ карту
 * BASE_EXTENSIONS — сбой backend не должен ломать внутренние звонки.
 *
 * Привязано к правилу с паттерном ^[12]$ в приложении svoefoto (54011823).
 * Звонки между двумя SIP-юзерами одного приложения тарифицируются как
 * внутренние (бесплатно). Телефоны регистрируются НАПРЯМУЮ в Voximplant.
 */

var BASE_EXTENSIONS = {
  '1': 'soborny101',
  '2': 'barrikadnaya201',
};

var ROUTE_URL = 'https://svoefoto.ru/api/telephony/intercom-route';
var ROUTE_TIMEOUT_MS = 4000;

function logEvent(scope, event, data) {
  Logger.write('[internal-intercom] ' + JSON.stringify({ scope: scope, event: event, data: data || {} }));
}

/**
 * Резолвит SIP-юзера для короткого номера с учётом закрытия студии.
 * Всегда вызывает callback ровно один раз: с эффективным target из backend
 * либо со статическим BASE_EXTENSIONS[dest] при ошибке/таймауте.
 */
function resolveTarget(dest, callback) {
  var fallback = BASE_EXTENSIONS[dest];
  var settled = false;

  function settle(target, source) {
    if (settled) {
      return;
    }
    settled = true;
    logEvent('routing', 'resolved', { destination: dest, target: target, source: source });
    callback(target);
  }

  // Страховочный таймер: если HTTP-callback не пришёл вовремя — идём по статике.
  var guard = setTimeout(function () {
    settle(fallback, 'timeout');
  }, ROUTE_TIMEOUT_MS);

  try {
    var opts = new Net.HttpRequestOptions();
    opts.method = 'GET';
    Net.httpRequest(ROUTE_URL, function (res) {
      clearTimeout(guard);
      var target = fallback;
      var source = 'fallback_http';
      try {
        if (res && res.code === 200 && res.text) {
          var body = JSON.parse(res.text);
          if (body && body.route && body.route[dest]) {
            target = body.route[dest];
            source = 'backend';
          }
        }
      } catch (parseError) {
        logEvent('routing', 'parse_error', { error: String(parseError) });
      }
      settle(target, source);
    }, opts);
  } catch (error) {
    clearTimeout(guard);
    logEvent('routing', 'request_error', { error: String(error) });
    settle(fallback, 'fallback_exception');
  }
}

function bridgeTo(inbound, target, e) {
  var outbound = VoxEngine.callUser({
    username: target,
    callerid: e.callerid,
    displayName: e.displayName || e.callerid,
    video: false,
    scheme: e.scheme,
  });

  logEvent('outgoing', 'dial_user', { username: target, callerid: e.callerid });

  // easyProcess соединяет входящее и исходящее плечи, отвечает на вызов
  // при ответе адресата и сам завершает сессию по разъединению любой стороны.
  VoxEngine.easyProcess(inbound, outbound, function () {
    logEvent('session', 'bridged', { username: target });
  });
}

VoxEngine.addEventListener(AppEvents.CallAlerting, function (e) {
  var inbound = e.call;
  var dest = String(e.destination || '').trim();

  logEvent('incoming', 'alerting', {
    destination: dest,
    callerid: e.callerid,
    base_target: BASE_EXTENSIONS[dest] || null,
  });

  if (!BASE_EXTENSIONS[dest]) {
    // Неизвестный внутренний номер — вежливо отклоняем.
    inbound.addEventListener(CallEvents.Connected, function () {
      inbound.hangup();
    });
    inbound.answer();
    logEvent('incoming', 'unknown_extension', { destination: dest });
    return;
  }

  // Спрашиваем backend об эффективной точке (с учётом закрытия), затем соединяем.
  resolveTarget(dest, function (target) {
    bridgeTo(inbound, target, e);
  });
});
