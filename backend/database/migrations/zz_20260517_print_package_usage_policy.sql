BEGIN;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS usage_policy JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN subscription_plans.usage_policy IS
  'JSON policy shown to clients and used by backend for package terms such as print coverage multipliers.';

WITH policies AS (
  SELECT
    jsonb_build_object(
      'kind', 'coverage_print_package',
      'unit_label', 'лист A4',
      'base_coverage_percent', 15,
      'max_coverage_percent', 100,
      'coverage_tiers', jsonb_build_array(
        jsonb_build_object(
          'min_percent', 0,
          'max_percent', 15,
          'credit_multiplier', 1,
          'title', 'До 15%',
          'description', 'Множитель заливки x1: ч/б лист списывает 1, цветной - 1.2 листа.'
        ),
        jsonb_build_object(
          'min_percent', 15.01,
          'max_percent', 50,
          'credit_multiplier', 2,
          'title', '15-50%',
          'description', 'Множитель заливки x2 применяется к базовому расходу листа.'
        ),
        jsonb_build_object(
          'min_percent', 50.01,
          'max_percent', 75,
          'credit_multiplier', 3,
          'title', '50-75%',
          'description', 'Множитель заливки x3 применяется к базовому расходу листа.'
        ),
        jsonb_build_object(
          'min_percent', 75.01,
          'max_percent', 100,
          'credit_multiplier', 4,
          'title', '75-100%',
          'description', 'Множитель заливки x4 применяется к базовому расходу листа.'
        )
      ),
      'product_multipliers', jsonb_build_array(
        jsonb_build_object(
          'product_id', 'a2000001-0000-0000-0000-000000000001',
          'product_name', 'Печать A4 ч/б',
          'base_product_id', NULL,
          'credit_multiplier', 1,
          'description', 'Чёрно-белая A4 списывается x1 при заливке до 15%.'
        ),
        jsonb_build_object(
          'product_id', 'a2000001-0000-0000-0000-000000000002',
          'product_name', 'Печать A4 цвет',
          'base_product_id', 'a2000001-0000-0000-0000-000000000001',
          'credit_multiplier', 1.2,
          'description', 'Цветная A4 списывается из общего A4-пакета с базовым множителем x1.2 при заливке до 15%.'
        )
      ),
      'terms', jsonb_build_array(
        'Пакет действует 1 месяц с момента оплаты.',
        'Это разовая покупка без подписки и автопродления.',
        'Номинал пакета рассчитан на печать A4 при заливке страницы до 15%.',
        'Чёрно-белая A4 до 15% списывает x1, цветная A4 до 15% списывает x1.2.',
        'Если заливка выше 15%, листы списываются с дополнительным множителем по шкале заливки.',
        'Для цветной A4 итоговый расход считается как x1.2 × множитель заливки.'
      ),
      'steps', jsonb_build_array(
        'Купите пакет печати.',
        'Оформите печать документов A4 в личном кабинете или в студии.',
        'Система определит заливку каждой страницы.',
        'Из пакета спишется базовый расход листа с учётом цветности: ч/б x1, цвет x1.2, затем множитель заливки.'
      ),
      'faq', jsonb_build_array(
        jsonb_build_object(
          'question', 'Почему пакет может закончиться раньше номинала?',
          'answer', 'Номинал указан для чёрно-белой A4 с заливкой до 15%. Цветная A4 списывается x1.2, а плотные страницы расходуют больше листов пакета по шкале заливки.'
        ),
        jsonb_build_object(
          'question', 'Можно ли перенести остаток на следующий месяц?',
          'answer', 'Нет. Пакет действует 1 месяц после покупки, не продлевается и не переносится.'
        ),
        jsonb_build_object(
          'question', 'Это подписка?',
          'answer', 'Нет. Это разовая покупка пакета печати на 1 месяц без автоматического списания.'
        )
      )
    ) AS doc_usage_policy,
    jsonb_build_object(
      'kind', 'photo_print_package',
      'unit_label', 'фото 10x15',
      'base_coverage_percent', NULL,
      'max_coverage_percent', NULL,
      'coverage_tiers', '[]'::jsonb,
      'terms', jsonb_build_array(
        'Пакет действует 1 месяц с момента оплаты.',
        'Это разовая покупка без подписки и автопродления.',
        'Одно фото 10x15 списывает 1 фото из пакета.',
        'Остаток пакета виден в личном кабинете.'
      ),
      'steps', jsonb_build_array(
        'Купите пакет фотопечати.',
        'Выберите фотографии для печати 10x15.',
        'При оплате примените доступный пакет.',
        'Из пакета спишется фактическое количество фотографий.'
      ),
      'faq', jsonb_build_array(
        jsonb_build_object(
          'question', 'Это подписка?',
          'answer', 'Нет. Это разовая покупка пакета фотопечати на 1 месяц без автоматического списания.'
        ),
        jsonb_build_object(
          'question', 'Какие фото входят в пакет?',
          'answer', 'Пакет рассчитан на стандартную фотопечать 10x15. Другие услуги оплачиваются отдельно.'
        ),
        jsonb_build_object(
          'question', 'Что будет с остатком через месяц?',
          'answer', 'Неиспользованный остаток сгорает после окончания срока действия пакета.'
        )
      )
    ) AS photo_usage_policy
),
plan_updates AS (
  SELECT v.*, CASE WHEN v.kind = 'doc' THEN policies.doc_usage_policy ELSE policies.photo_usage_policy END AS usage_policy
  FROM policies
  CROSS JOIN (
    VALUES
      (
        'launch-printscan-lite',
        '80 листов A4',
        'Пакет печати документов на 80 листов A4. Действует 1 месяц после покупки.',
        '["80 листов A4", "Действует 1 месяц", "Ч/б x1, цвет x1.2 до 15%"]'::jsonb,
        'doc'
      ),
      (
        'launch-printscan-biz',
        '250 листов A4',
        'Пакет печати документов на 250 листов A4. Действует 1 месяц после покупки.',
        '["250 листов A4", "Действует 1 месяц", "Ч/б x1, цвет x1.2 до 15%"]'::jsonb,
        'doc'
      ),
      (
        'launch-printscan-pro',
        '800 листов A4',
        'Пакет печати документов на 800 листов A4. Действует 1 месяц после покупки.',
        '["800 листов A4", "Действует 1 месяц", "Ч/б x1, цвет x1.2 до 15%"]'::jsonb,
        'doc'
      ),
      (
        'launch-photoprint-lite',
        '15 фото 10x15',
        'Пакет фотопечати на 15 фото 10x15. Действует 1 месяц после покупки.',
        '["15 фото 10x15", "Действует 1 месяц", "Разовая покупка"]'::jsonb,
        'photo'
      ),
      (
        'launch-photoprint-standard',
        '80 фото 10x15',
        'Пакет фотопечати на 80 фото 10x15. Действует 1 месяц после покупки.',
        '["80 фото 10x15", "Действует 1 месяц", "Разовая покупка"]'::jsonb,
        'photo'
      ),
      (
        'launch-photoprint-pro',
        '200 фото 10x15',
        'Пакет фотопечати на 200 фото 10x15. Действует 1 месяц после покупки.',
        '["200 фото 10x15", "Действует 1 месяц", "Разовая покупка"]'::jsonb,
        'photo'
      )
  ) AS v(slug, name, description, features, kind)
)
UPDATE subscription_plans sp
SET name = plan_updates.name,
    description = plan_updates.description,
    features = plan_updates.features,
    usage_policy = plan_updates.usage_policy,
    credits_rollover_months = 1,
    billing_period = 'monthly',
    subscriber_discount_percent = 0,
    is_customizable = false,
    updated_at = NOW()
FROM plan_updates
WHERE sp.slug = plan_updates.slug;

WITH quantities(slug, quantity) AS (
  VALUES
    ('launch-printscan-lite', 80),
    ('launch-printscan-biz', 250),
    ('launch-printscan-pro', 800),
    ('launch-photoprint-lite', 15),
    ('launch-photoprint-standard', 80),
    ('launch-photoprint-pro', 200)
)
UPDATE subscription_plan_items spi
SET included_quantity = quantities.quantity
FROM quantities
JOIN subscription_plans sp ON sp.slug = quantities.slug
WHERE spi.plan_id = sp.id;

COMMIT;
