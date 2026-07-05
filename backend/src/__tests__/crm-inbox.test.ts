import { describe, it } from 'vitest';

describe('GET /api/crm/inbox — paymentFilter (P1 #7)', () => {
  it.todo('paymentFilter=paid_unlinked returns only chats with payment_links.status=paid AND order_ref_linked IS NULL');
  it.todo('paymentFilter=invalid returns 400 with zod error message');
});
