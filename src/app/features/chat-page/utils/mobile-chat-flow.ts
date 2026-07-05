export type MobileChatMode = 'home' | 'thread';

export interface InitialMobileChatModeInput {
  readonly isMobile: boolean;
  readonly hasAcceptedOrderNotice: boolean;
  readonly sessionId: string | null;
  readonly support: string | null;
}

export function getInitialMobileChatMode(input: InitialMobileChatModeInput): MobileChatMode {
  if (!input.isMobile) {
    return 'thread';
  }

  if (input.hasAcceptedOrderNotice || input.sessionId || input.support === 'manager') {
    return 'thread';
  }

  return 'home';
}
