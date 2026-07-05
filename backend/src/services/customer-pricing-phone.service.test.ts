import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPoolQuery = vi.fn();
const mockGetClientContextByUserId = vi.fn();
const mockGetClientContextByContactId = vi.fn();

vi.mock('../database/db.js', () => ({
  pool: { query: mockPoolQuery },
}));

vi.mock('./client-context.service.js', () => ({
  getClientContextByUserId: mockGetClientContextByUserId,
  getClientContextByContactId: mockGetClientContextByContactId,
}));

const {
  isUsableCustomerPricingPhone,
  resolveCustomerPricingPhone,
} = await import('./customer-pricing-phone.service.js');

describe('customer-pricing-phone.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  it('rejects masked or incomplete frontend phones', () => {
    expect(isUsableCustomerPricingPhone('+7 (952) ***-**-04')).toBe(false);
    expect(isUsableCustomerPricingPhone('795204')).toBe(false);
    expect(isUsableCustomerPricingPhone('')).toBe(false);
    expect(isUsableCustomerPricingPhone('+7 952 603-08-04')).toBe(true);
  });

  it('prefers a usable explicit phone without identity lookup', async () => {
    const phone = await resolveCustomerPricingPhone({
      phone: '+7 952 603-08-04',
      clientUserId: 'user-1',
    });

    expect(phone).toBe('+7 952 603-08-04');
    expect(mockGetClientContextByUserId).not.toHaveBeenCalled();
  });

  it('resolves a masked frontend phone by client user id inside the backend only', async () => {
    mockGetClientContextByUserId.mockResolvedValue({
      profile: { phone: '+7 952 603-08-04' },
    });

    const phone = await resolveCustomerPricingPhone({
      phone: '+7 (952) ***-**-04',
      clientUserId: 'user-1',
    });

    expect(phone).toBe('+7 952 603-08-04');
    expect(mockGetClientContextByUserId).toHaveBeenCalledWith('user-1');
  });

  it('falls back to contact id and then chat session identity', async () => {
    mockGetClientContextByContactId.mockResolvedValueOnce({
      profile: { phone: null },
    });
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ visitor_phone: null, user_id: 'user-2', contact_id: null }],
    });
    mockGetClientContextByUserId.mockResolvedValueOnce({
      profile: { phone: '+7 900 111-22-33' },
    });

    const phone = await resolveCustomerPricingPhone({
      clientContactId: 'contact-1',
      sessionId: 'session-1',
    });

    expect(phone).toBe('+7 900 111-22-33');
    expect(mockGetClientContextByContactId).toHaveBeenCalledWith('contact-1');
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('FROM conversations'), ['session-1']);
    expect(mockGetClientContextByUserId).toHaveBeenCalledWith('user-2');
  });
});
