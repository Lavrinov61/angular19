import { describe, expect, it } from 'vitest';
import { PHOTOGRAPHERS_DATA, TEAM_MEMBERS } from './photographers.data';

describe('photographers fallback data contract', () => {
  it('does not ship unavailable photographer portraits', () => {
    for (const photographer of PHOTOGRAPHERS_DATA) {
      expect(photographer.profileImage).toBe('/assets/images/default-avatar.svg');
      expect(photographer.profileImage).not.toContain('/assets/static/photographers/');
    }

    for (const member of TEAM_MEMBERS) {
      expect(member.portraitHero).toBe('/assets/images/default-avatar.svg');
      expect(member.portraitCard).toBe('/assets/images/default-avatar.svg');
    }
  });

  it('keeps fallback copy factual instead of personal performance claims', () => {
    const text = JSON.stringify({ PHOTOGRAPHERS_DATA, TEAM_MEMBERS });

    expect(text).not.toContain('успешных фотосессий');
    expect(text).not.toContain('естественные эмоции');
    expect(text).not.toContain('Креативный подход');
    expect(text).not.toMatch(/\d\+?\s*(?:лет|года|год)\s+в/);

    for (const member of TEAM_MEMBERS) {
      expect(member.experienceYears).toBe(0);
      expect(member.sessionsCompleted).toBe(0);
      expect(member.personalFact).toBeUndefined();
    }
  });
});
