import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const componentSource = (): string =>
  readFileSync('src/app/features/photograph/components/photographer-list/photographer-list.component.ts', 'utf8');

const componentTemplate = (): string =>
  readFileSync('src/app/features/photograph/components/photographer-list/photographer-list.component.html', 'utf8');

describe('PhotographerListComponent content contract', () => {
  it('uses factual studio-process copy instead of fake personal positioning', () => {
    const source = componentSource();
    const template = componentTemplate();
    const combined = `${source}\n${template}`;

    expect(combined).not.toContain('раскрыться перед камерой');
    expect(combined).not.toContain('конкретного фотографа');
    expect(combined).not.toContain('чей стиль вам ближе');
    expect(combined).not.toContain('Минимум — 10');
    expect(combined).not.toContain('200+ снимков');
    expect(template).toContain('Кто работает со съёмкой в студии');
    expect(source).toContain('Свободного сотрудника на смене');
  });

  it('does not render public staff profile cards without real staff portraits', () => {
    const source = componentSource();
    const template = componentTemplate();
    const combined = `${source}\n${template}`;

    expect(combined).not.toContain('PhotographerCardComponent');
    expect(combined).not.toContain('app-photographer-card');
    expect(combined).not.toContain('teamMembers');
    expect(combined).not.toContain('getTeamMembers');
    expect(combined).not.toContain('@type\': \'Person');
    expect(template).toContain('Что делает сотрудник на смене');
  });
});
