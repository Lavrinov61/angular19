# Native Notifier Agent

Отдельный агент уведомлений для компьютеров точек. Он не зависит от открытого браузера: держит собственное Socket.IO WebSocket-подключение к API, получает события `native-notifier:*` и проигрывает системный звук на Windows/macOS.

## Сеть

Агент рассчитан на внутреннюю сеть: в `serverUrl` указывается VPN/LAN адрес API, например `http://10.200.0.10:3000` или внутреннее DNS-имя. По умолчанию `requirePrivateServerUrl=true`, поэтому агент откажется стартовать, если указан публичный домен.

VPN может быть реализован на маршрутизаторе. Агенту не нужно знать детали VPN: ему нужен только внутренний адрес API, который доступен с компьютера точки через этот маршрутизатор.

## Backend env

В backend нужно задать machine-token:

```bash
NATIVE_NOTIFIER_AGENT_TOKENS=replace-with-random-token
```

Можно указать несколько токенов через запятую. Токен должен совпадать с `token` в конфиге агента.

## Config

Скопируйте `config.example.json` в `config.json` и заполните:

```json
{
  "serverUrl": "http://10.200.0.10:3000",
  "agentId": "soborny-pult-01",
  "studioId": "UUID_ТОЧКИ",
  "token": "TOKEN_FROM_BACKEND_ENV",
  "requirePrivateServerUrl": true
}
```

`studioId` включает уведомления для текущей смены/POS-смены на точке. `userId` можно добавить, если агент должен слушать конкретного сотрудника.

## Run

```bash
npm install
npm run build
node dist/index.js --config ./config.json
```

На Windows запускать лучше как задачу "At log on" от пользователя точки, а не как `LocalSystem`: так надежнее работают звук и toast. На macOS использовать LaunchAgent пользователя.

## Admin API

Проверить подключение:

```bash
GET /api/native-notifier/status?studio_id=<studio_uuid>
```

Отправить тест:

```bash
POST /api/native-notifier/test
{
  "studio_id": "<studio_uuid>",
  "title": "Тест",
  "body": "Проверка звука на точке"
}
```
