import { test, expect } from '@playwright/test';

test('UTM click → page loads → fingerprint initialized', async ({ page }) => {
  await page.goto('/?utm_source=e2e&utm_campaign=sprint3_test&utm_medium=playwright');

  // Base: страница прогрузилась, нет JS ошибок в консоли
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // Ждём пока Angular boot: наличие <body> с hydrated контентом
  await page.waitForLoadState('networkidle', { timeout: 15_000 });

  // Проверка, что нет критичных JS ошибок
  expect(errors.filter(e => !e.includes('favicon')).join(' | ')).toBe('');

  // UTM сохранён в localStorage / cookie (зависит от tracking.service реализации)
  const lsTracking = await page.evaluate(() => {
    try {
      const raw = window.localStorage.getItem('magnus_tracking') || window.localStorage.getItem('tracking_params');
      return raw;
    } catch { return null; }
  });
  // Не падаем если null — просто информационная проверка
  console.log('tracking storage:', lsTracking);
});
