-- Супер-обработка: гендер-фильтр конфигуратора ретуши.
-- Группы макияжа (Акценты макияжа, Стрелки/подводка, Ресницы) были помечены gender='any'
-- и потому показывались мужчинам. Переносим их в женский фильтр: макияж = женское.
-- Идемпотентно (WHERE gender <> 'female'). БД общая dev/prod — применяется один раз.

UPDATE super_retouch_checklist_items
SET gender = 'female', updated_at = now()
WHERE group_slug IN ('makeup-accent', 'eye-liner', 'lashes')
  AND gender <> 'female';
