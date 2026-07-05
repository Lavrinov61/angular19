-- «Супер обработка»: разрешить множественный выбор во ВСЕХ группах конфигуратора ретуши.
-- Было: стиль макияжа / тени / стрелки / губы / одежда / фон / цветокоррекция — single (1 вариант).
-- Стало: multi — оператор отмечает несколько вариантов сразу → ретушёр делает несколько версий.
-- Только данные каталога (super_retouch_checklist_items); фронт (rc-checkbox) и backend
-- (resolveRetouchConfig) уже поддерживают multi. Группа notes не трогается.
-- Идемпотентно: повторный прогон ничего не меняет (уже multi).

BEGIN;

UPDATE super_retouch_checklist_items
SET group_selection_type = 'multi',
    updated_at = now()
WHERE group_selection_type = 'single';

COMMIT;
