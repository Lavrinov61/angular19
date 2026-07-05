-- Sprint 5: Subscription marketing data — savings labels + descriptions
-- Idempotent: safe to re-run

-- Savings labels
UPDATE subscription_plans SET savings_label = 'Экономия до 40%' WHERE slug = 'doc-print-student';
UPDATE subscription_plans SET savings_label = 'Экономия до 50%' WHERE slug = 'doc-print-business';
UPDATE subscription_plans SET savings_label = 'Экономия до 60%' WHERE slug = 'doc-print-office';
UPDATE subscription_plans SET savings_label = 'Экономия до 40%' WHERE slug = 'scan-lite';
UPDATE subscription_plans SET savings_label = 'Экономия до 50%' WHERE slug = 'scan-pro';
UPDATE subscription_plans SET savings_label = 'Экономия до 60%' WHERE slug = 'scan-biz';
UPDATE subscription_plans SET savings_label = 'Экономия до 35%' WHERE slug = 'photo-docs-agent';
UPDATE subscription_plans SET savings_label = 'Экономия до 45%' WHERE slug = 'photo-docs-agency';
UPDATE subscription_plans SET savings_label = 'Экономия до 55%' WHERE slug = 'photo-docs-corp';
UPDATE subscription_plans SET savings_label = 'Экономия до 30%' WHERE slug = 'retouch-fan';
UPDATE subscription_plans SET savings_label = 'Экономия до 45%' WHERE slug = 'retouch-pro';
UPDATE subscription_plans SET savings_label = 'Экономия до 55%' WHERE slug = 'retouch-studio';

-- Enrich descriptions with marketing copy
UPDATE subscription_plans SET description = 'Базовый пакет для печати рефератов, курсовых и учебных материалов. 100 страниц ч/б — хватит на месяц учёбы.' WHERE slug = 'doc-print-student';
UPDATE subscription_plans SET description = 'Оптимальный выбор для малого бизнеса. Печать документов, договоров, прайсов — всё по фиксированной цене.' WHERE slug = 'doc-print-business';
UPDATE subscription_plans SET description = 'Максимальный пакет для офиса. Все форматы, глянцевая печать и скидка 30% на всё сверх лимита.' WHERE slug = 'doc-print-office';
UPDATE subscription_plans SET description = 'Начните оцифровку семейного архива или рабочих документов. 100 сканов в месяц — отличный старт.' WHERE slug = 'scan-lite';
UPDATE subscription_plans SET description = 'Расширенный пакет для регулярной архивации. Автосканирование, ручная обработка и кадрирование в комплекте.' WHERE slug = 'scan-pro';
UPDATE subscription_plans SET description = 'Полное решение для бизнеса: массовое сканирование, кадрирование, ламинирование важных документов.' WHERE slug = 'scan-biz';
UPDATE subscription_plans SET description = 'Для независимых агентов: 5 комплектов фото на документы с нейро-обработкой каждый месяц.' WHERE slug = 'photo-docs-agent';
UPDATE subscription_plans SET description = 'Для агентств с потоком клиентов. 12 комплектов, 6 подстановок формы, нейро-обработка.' WHERE slug = 'photo-docs-agency';
UPDATE subscription_plans SET description = 'Корпоративное решение: HR-отдел, кадровое агентство, крупная компания. Максимальный объём + срочные заказы.' WHERE slug = 'photo-docs-corp';
UPDATE subscription_plans SET description = 'Идеально для блогеров и начинающих фотографов. 5 простых + 1 базовая ретушь каждый месяц.' WHERE slug = 'retouch-fan';
UPDATE subscription_plans SET description = 'Профессиональный набор для фотографов: простая, базовая, репортажная и профессиональная ретушь.' WHERE slug = 'retouch-pro';
UPDATE subscription_plans SET description = 'Студийный масштаб обработки. 30+ ретушей в месяц для фотостудий и агентств.' WHERE slug = 'retouch-studio';
