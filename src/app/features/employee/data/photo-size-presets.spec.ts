import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_CARD_A4_TEMPLATE,
  ENVELOPE_C6_KRAFT_TEMPLATE,
  calculateBusinessCardLayout,
  isBusinessCardMediaTypeId,
} from './photo-size-presets';

const printTemplatesDir = resolve(process.cwd(), 'src/assets/print-templates');
const envelopeHtmlPath = resolve(printTemplatesDir, 'envelope-c6-svoefoto-template.html');

describe('business card print template', () => {
  it('uses the Canon C3226i dense paper media contract', () => {
    expect(BUSINESS_CARD_A4_TEMPLATE).toMatchObject({
      paperSize: 'A4',
      requiredPrinterNeedle: 'c3226',
      requiredMediaTypeId: 'heavy6',
      requiredPaperSourceId: 'manual',
    });
    expect(isBusinessCardMediaTypeId('heavy6')).toBe(true);
    expect(isBusinessCardMediaTypeId('Плотная 6 / 221-256 г/м2')).toBe(true);
    expect(isBusinessCardMediaTypeId('250gsm')).toBe(true);
    expect(isBusinessCardMediaTypeId('heavy7')).toBe(true);
    expect(isBusinessCardMediaTypeId('Плотная 7 / 257-300 г/м2')).toBe(true);
    expect(isBusinessCardMediaTypeId('plain')).toBe(false);
  });

  it('places both business card sizes as 2 by 5 sheets on A4', () => {
    expect(calculateBusinessCardLayout('business-card', 10)).toMatchObject({
      cols: 2,
      rows: 5,
      photosPerSheet: 10,
      photoCellW: 90,
      photoCellH: 50,
      templateMode: 'business-card',
      sheetsNeeded: 1,
    });
    expect(calculateBusinessCardLayout('business-card-eu', 10)).toMatchObject({
      cols: 2,
      rows: 5,
      photosPerSheet: 10,
      photoCellW: 85,
      photoCellH: 55,
      templateMode: 'business-card',
      sheetsNeeded: 1,
    });
  });
});

describe('C6 kraft envelope template', () => {
  it('uses the Canon C3226i envelope media contract', () => {
    expect(ENVELOPE_C6_KRAFT_TEMPLATE).toMatchObject({
      paperSize: 'c6_envelope',
      paperWidthMm: 114,
      paperHeightMm: 162,
      requiredPrinterNeedle: 'c3226',
      requiredMediaTypeId: 'envelope',
      requiredPaperSourceId: 'manual',
    });
  });

  it('exposes a horizontal HTML source template for the envelope face', () => {
    expect(ENVELOPE_C6_KRAFT_TEMPLATE).toMatchObject({
      templateHtmlUrl: '/assets/print-templates/envelope-c6-svoefoto-template.html',
      templateOrientation: 'landscape',
      templateWidthMm: 162,
      templateHeightMm: 114,
    });
  });

  it('keeps the HTML template transparent and self-contained for Chrome screenshots', () => {
    const html = readFileSync(envelopeHtmlPath, 'utf8');

    expect(html).toContain('data-template="c6-envelope-face"');
    expect(html).toContain('background: transparent');
    expect(html).toContain('src="svoefoto-logo-black.png"');
    expect(existsSync(resolve(printTemplatesDir, 'svoefoto-logo-black.png'))).toBe(true);
    expect(html).not.toMatch(/#b98748|#d1aa70|#a66e35|#caa06b|--paper/);
    expect(html).not.toContain('C6 крафтовый конверт');
    expect(html).not.toContain('выдать клиенту');
    expect(html).not.toMatch(/>[^<]*C6[^<]*</);
    expect(html).not.toContain('Баррикадная');
    expect(html).toContain('Соборный 21');
  });
});
