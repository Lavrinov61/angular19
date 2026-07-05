import { describe, expect, it } from 'vitest';

import { CONTACTS } from './contacts.data';

describe('CONTACTS', () => {
  it('does not expose public online chat in shared contact links', () => {
    expect(CONTACTS.links.some(link => link.icon === 'chat' || link.href === '#chat')).toBe(false);
  });

  it('marks WhatsApp public contact link as temporarily unavailable', () => {
    const whatsappLink = CONTACTS.links.find(link => link.icon === 'whatsapp');

    expect(whatsappLink).toMatchObject({
      label: 'WhatsApp',
      notice: 'Временно не работает',
    });
  });
});
