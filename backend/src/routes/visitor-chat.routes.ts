/**
 * visitor-chat.routes.ts — thin compatibility wrapper.
 *
 * The original 6452-line monolith has been split into 16 modules in ./chat/.
 * This wrapper re-exports the assembled router for backward compatibility with app.ts.
 *
 * @see ./chat/index.ts — module assembler
 */

export { default } from './chat/index.js';
export { handleInteractiveResponse, handleContextualTextInput } from './chat/chat-bot-engine.js';
