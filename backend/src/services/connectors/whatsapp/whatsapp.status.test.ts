import { describe, expect, it } from 'vitest';
import { WhatsAppAdapter } from './whatsapp.adapter.js';

describe('WhatsAppAdapter status parsing', () => {
  it('matches Gupshup status callbacks by gs_id and keeps detailed media errors', () => {
    const adapter = new WhatsAppAdapter();

    const updates = adapter.parseStatusUpdate({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'provider-meta-id',
              gs_id: 'gupshup-message-id',
              status: 'failed',
              timestamp: '1778253451',
              errors: [{
                code: 131053,
                title: 'Media upload error',
                message: 'Media upload error',
                error_data: {
                  details: 'Downloading media from weblink failed with http code 500',
                },
              }],
            }],
          },
        }],
      }],
    });

    expect(updates).toEqual([{
      externalMessageId: 'gupshup-message-id',
      status: 'failed',
      timestamp: new Date(1778253451 * 1000),
      errorCode: '131053',
      errorMessage: 'Downloading media from weblink failed with http code 500',
    }]);
  });

  it('falls back to Meta status id when gs_id is absent', () => {
    const adapter = new WhatsAppAdapter();

    const updates = adapter.parseStatusUpdate({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              id: 'wamid-meta-id',
              status: 'delivered',
              timestamp: '1778253451000',
            }],
          },
        }],
      }],
    });

    expect(updates).toEqual([{
      externalMessageId: 'wamid-meta-id',
      status: 'delivered',
      timestamp: new Date(1778253451000),
      errorCode: undefined,
      errorMessage: undefined,
    }]);
  });

  it('records Gupshup enqueued callbacks as accepted', () => {
    const adapter = new WhatsAppAdapter();

    const updates = adapter.parseStatusUpdate({
      entry: [{
        changes: [{
          value: {
            statuses: [{
              gs_id: 'gupshup-message-id',
              status: 'enqueued',
              timestamp: 1778253451000,
            }],
          },
        }],
      }],
    });

    expect(updates[0]?.externalMessageId).toBe('gupshup-message-id');
    expect(updates[0]?.status).toBe('accepted');
    expect(updates[0]?.timestamp).toEqual(new Date(1778253451000));
  });
});
