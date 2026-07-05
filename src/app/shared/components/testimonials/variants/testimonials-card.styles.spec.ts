import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  'src/app/shared/components/testimonials/variants/testimonials-card.component.ts',
  'utf8',
);

const styles = source.match(/styles:\s*\[`(?<body>[\s\S]*?)`\]/)?.groups?.['body'] ?? '';

describe('TestimonialsCardComponent styles', () => {
  it('owns a shared light brand palette instead of relying on dark editorial fallbacks', () => {
    expect(styles).toContain('--testimonials-card-surface: #ffffff');
    expect(styles).toContain('--testimonials-card-on-surface: #14161c');
    expect(styles).toContain('--testimonials-card-accent: #f42b23');
    expect(styles).toContain('background: var(--testimonials-card-surface-soft)');
    expect(styles).toContain('--mat-card-outlined-container-color: var(--testimonials-card-surface)');
    expect(styles).not.toContain('--ed-');
  });
});
