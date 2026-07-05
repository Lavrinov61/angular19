export interface ChatOrderNavigationTarget {
  readonly type: 'order';
  readonly id: string;
}

export function createChatOrderNavigationTarget(orderId: string): ChatOrderNavigationTarget {
  return { type: 'order', id: orderId };
}
