import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentSource = (): string =>
  readFileSync(
    'src/app/features/photograph/components/photographer-list/components/team-hero/team-hero.component.ts',
    'utf8',
  );

describe('TeamHeroComponent source contract', () => {
  it('uses factual studio copy and icon visuals instead of photos', () => {
    const source = componentSource();

    expect(source).toContain('Съёмка в студии без лишней суеты');
    expect(source).toContain('Фото на документы, портреты, печать и файл');
    expect(source).toContain('Как проходит съёмка');
    expect(source).not.toContain('Фотографы, которые держат кадр под контролем');
    expect(source).not.toContain('<img');
    expect(source).not.toContain('TeamMember');
    expect(source).not.toContain('teamPreviewMembers');
    expect(source).not.toContain('portraitsVisible');
    expect(source).toContain('photo_camera');
    expect(source).toContain('hero-product-card');
  });

  it('keeps the booking CTA and proof points', () => {
    const source = componentSource();

    expect(source).toContain('routerLink="/booking"');
    expect(source).toContain('5.0');
    expect(source).toContain('Ручная ретушь');
  });
});
