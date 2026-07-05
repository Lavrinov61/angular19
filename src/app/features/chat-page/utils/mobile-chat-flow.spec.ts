import { describe, expect, it } from 'vitest';

import { getInitialMobileChatMode } from './mobile-chat-flow';

describe('getInitialMobileChatMode', () => {
  it('keeps a plain mobile chat visit on the contact home', () => {
    expect(getInitialMobileChatMode({
      isMobile: true,
      hasAcceptedOrderNotice: false,
      sessionId: null,
      support: null,
    })).toBe('home');
  });

  it('opens the thread when mobile chat is entered for a concrete context', () => {
    expect(getInitialMobileChatMode({
      isMobile: true,
      hasAcceptedOrderNotice: false,
      sessionId: 'chat-session-1',
      support: null,
    })).toBe('thread');

    expect(getInitialMobileChatMode({
      isMobile: true,
      hasAcceptedOrderNotice: false,
      sessionId: null,
      support: 'manager',
    })).toBe('thread');

    expect(getInitialMobileChatMode({
      isMobile: true,
      hasAcceptedOrderNotice: true,
      sessionId: null,
      support: null,
    })).toBe('thread');
  });

  it('keeps desktop on the existing thread-first flow', () => {
    expect(getInitialMobileChatMode({
      isMobile: false,
      hasAcceptedOrderNotice: false,
      sessionId: null,
      support: null,
    })).toBe('thread');
  });
});
