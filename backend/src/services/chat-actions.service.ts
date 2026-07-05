import type { BotMessageResult } from '../routes/chat/chat-shared.js';

export type { BotMessageResult };

export interface ChatActionHandlers {
  handleInteractiveResponse: (
    buttonValue: string,
    sessionId: string,
    buttonData?: Record<string, any>,
  ) => Promise<BotMessageResult | null>;
  handleContextualTextInput?: (
    content: string,
    sessionId: string,
  ) => Promise<BotMessageResult | null>;
}

interface ExecuteChatActionOptions {
  followupInput?: string;
  handlers?: ChatActionHandlers;
}

async function loadHandlers(): Promise<ChatActionHandlers> {
  const mod = await import('../routes/chat/chat-bot-engine.js');
  return {
    handleInteractiveResponse: mod.handleInteractiveResponse,
    handleContextualTextInput: mod.handleContextualTextInput,
  };
}

export async function executeChatAction(
  sessionId: string,
  actionValue: string,
  actionData?: Record<string, any>,
  options: ExecuteChatActionOptions = {},
): Promise<BotMessageResult | null> {
  const handlers = options.handlers ?? await loadHandlers();
  const primary = await handlers.handleInteractiveResponse(actionValue, sessionId, actionData);
  if (!primary) return null;

  if (options.followupInput && handlers.handleContextualTextInput) {
    const followup = await handlers.handleContextualTextInput(options.followupInput, sessionId);
    return followup || primary;
  }

  return primary;
}
