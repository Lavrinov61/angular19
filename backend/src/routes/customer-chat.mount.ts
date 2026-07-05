import type { Router } from 'express';

interface RouteMountTarget {
  use(path: string, router: Router): void;
}

interface CustomerChatRouteSet {
  customerChatRoutes: Router;
  bookingChatRoutes: Router;
}

/**
 * Customer chat is the canonical mobile/customer-chat API under /api/chat.
 * /api/visitor-chat remains a compatibility alias for existing web clients.
 */
export function registerCustomerChatRoutes(
  targetApp: RouteMountTarget,
  prefix: string,
  routes: CustomerChatRouteSet,
): void {
  targetApp.use(`${prefix}/chat`, routes.customerChatRoutes);
  targetApp.use(`${prefix}/chat`, routes.bookingChatRoutes);
  targetApp.use(`${prefix}/visitor-chat`, routes.customerChatRoutes);
}
