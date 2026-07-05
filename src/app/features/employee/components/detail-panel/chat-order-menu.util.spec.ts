import { describe, expect, it } from 'vitest';

import { createChatOrderNavigationTarget } from './chat-order-menu.util';

describe('createChatOrderNavigationTarget', () => {
  it('opens the selected client order in the detail panel', () => {
    expect(createChatOrderNavigationTarget('CRM-260526-VTB5')).toEqual({
      type: 'order',
      id: 'CRM-260526-VTB5',
    });
  });
});
