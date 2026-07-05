import { test, expect } from '@playwright/test';

test('contact channel heading stays below the hero block', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/contacts');
  await expect(page.locator('#contact-methods-title')).toBeAttached();
  await expect(page.locator('.connect-zone > .section-heading .section-eyebrow')).toHaveCount(0);

  const heroBox = await page.locator('.hero').boundingBox();
  const headingBox = await page.locator('.connect-zone > .section-heading').boundingBox();

  if (!heroBox || !headingBox) {
    throw new Error('Contacts hero or channel heading was not rendered');
  }

  expect(headingBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height);
  expect(errors.filter((message) => !message.includes('favicon')).join(' | ')).toBe('');
});
