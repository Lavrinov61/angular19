// Версия приложения — patch-бамп при КАЖДОЙ правке фронтенда (см. CLAUDE.md), minor/major вручную при релизах
export const APP_VERSION = '0.54.123';

// Автоматический timestamp билда — обновляется скриптами деплоя
const _BUILD_TIMESTAMP = '05.03 14:21';
/** Widened to `string` so deploy scripts can replace the literal with a new timestamp */
export const BUILD_TIMESTAMP = _BUILD_TIMESTAMP as string;
