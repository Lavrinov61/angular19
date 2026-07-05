-- Fix savings_label for Документы Лайт: was 80%, actual is 86%
UPDATE subscription_plans SET savings_label = 'Экономия 86%' WHERE slug = 'launch-docs-lite' AND savings_label = 'Экономия 80%';
