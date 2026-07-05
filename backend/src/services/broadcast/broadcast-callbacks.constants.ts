/**
 * Broadcast inline-button callback_data identifiers.
 * Kept in a dependency-light module so both the telegram adapter (matching) and
 * campaign.service (button building) can import them without pulling the heavy
 * chat-broadcast/notification graph that broadcast-callbacks.service depends on.
 */
export const BCAST_UNSUB = 'bcast_unsub';
export const BCAST_NOT_STUDENT = 'bcast_not_student';
export const BCAST_ADDRESSES = 'bcast_addresses';

/** True if a callback_data string belongs to the broadcast button set. */
export function isBroadcastCallback(data: string): boolean {
  return data === BCAST_UNSUB || data === BCAST_NOT_STUDENT || data === BCAST_ADDRESSES;
}
