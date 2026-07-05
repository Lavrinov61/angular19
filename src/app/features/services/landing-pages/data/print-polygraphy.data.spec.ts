import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PRINT_POLYGRAPHY_DATA } from './print-polygraphy.data';

describe('print polygraphy landing data', () => {
  it('ships a factual plastic spring binding landing with education-first pricing copy', () => {
    const landing = PRINT_POLYGRAPHY_DATA['pereplet-na-plastikovuyu-pruzhinu'];

    expect(landing).toBeDefined();
    expect(landing?.canonicalUrl).toBe('/pereplet-na-plastikovuyu-pruzhinu');
    expect(landing?.heroHighlight).toContain('пластиковую пружину');
    expect(landing?.heroSubtitle).toContain('переплёт за 10 ₽');
    expect(landing?.heroSubtitle).toContain('печать А4 от 3 ₽');

    const searchableCopy = [
      landing?.metaTitle,
      landing?.metaDescription,
      landing?.heroHighlight,
      landing?.heroTitle,
      landing?.heroSubtitle,
      ...(landing?.specifications.map((item) => `${item.label} ${item.value}`) ?? []),
      ...(landing?.requirements ?? []),
      ...(landing?.faqItems.map((item) => `${item.question} ${item.answer}`) ?? []),
    ].join(' ').toLowerCase();

    expect(searchableCopy).toContain('образовательн');
    expect(searchableCopy).toContain('199 ₽');
    expect(searchableCopy).toContain('не промокод');
    expect(searchableCopy).not.toContain('stud-print3');
    expect(searchableCopy).not.toContain('твёрдый переплёт');
    expect(searchableCopy).not.toContain('твердый переплет');
    expect(searchableCopy).not.toContain('металлическая пружина');
    expect(searchableCopy).not.toContain('клеевой переплёт');
    expect(searchableCopy).not.toContain('клеевой переплет');
    expect(searchableCopy).not.toContain('термопереплёт');
    expect(searchableCopy).not.toContain('термопереплет');
  });

  it('publishes factual AI context for education binding without fake promo mechanics', () => {
    const llmsText = readFileSync(resolve(process.cwd(), 'public/llms.txt'), 'utf8').toLowerCase();

    expect(llmsText).toContain('https://svoefoto.ru/pereplet-na-plastikovuyu-pruzhinu');
    expect(llmsText).toContain('https://svoefoto.ru/education');
    expect(llmsText).toContain('переплёт на пластиковую пружину');
    expect(llmsText).toContain('переплёт за 10 ₽');
    expect(llmsText).toContain('печать а4 от 3 ₽');
    expect(llmsText).toContain('199 ₽/мес');
    expect(llmsText).toContain('не промокод');
    expect(llmsText).toContain('stud-print3');
    expect(llmsText).toContain('не используйте');
  });
});
