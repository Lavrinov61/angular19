-- KPI Gamification Bridge: KPI-based achievements
-- Links composite KPI scores to the gamification achievement system.
-- Condition types: composite_metric, composite_streak, composite_categories, composite_and_alerts
-- Idempotent: safe to re-run

INSERT INTO employee_achievements (code, title, description, icon, category, xp_reward, condition, sort_order) VALUES
  ('kpi_weekly_excellent',
   'Звезда недели',
   'Недельный KPI скор 90+',
   'star', 'kpi', 150,
   '{"type":"composite_metric","period":"weekly","threshold":90}', 20),

  ('kpi_monthly_excellent',
   'Сотрудник месяца',
   'Месячный KPI скор 90+',
   'emoji_events', 'kpi', 300,
   '{"type":"composite_metric","period":"monthly","threshold":90}', 21),

  ('kpi_consistent_10',
   'Надёжный сотрудник',
   '10 дней подряд KPI 75+',
   'verified', 'kpi', 200,
   '{"type":"composite_streak","threshold":75,"target":10}', 22),

  ('kpi_consistent_30',
   'Железная стабильность',
   '30 дней подряд KPI 75+',
   'diamond', 'kpi', 500,
   '{"type":"composite_streak","threshold":75,"target":30}', 23),

  ('kpi_pentathlete',
   'Пятиборец',
   'Все категории KPI выше 75',
   'sports_score', 'kpi', 300,
   '{"type":"composite_categories","threshold":75}', 24),

  ('kpi_perfect_month',
   'Идеальный месяц',
   'Месячный скор 95+ без критических алертов',
   'workspace_premium', 'kpi', 500,
   '{"type":"composite_and_alerts","period":"monthly","score":95,"max_critical":0}', 25)

ON CONFLICT (code) DO NOTHING;
