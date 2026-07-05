import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runPhotoWorkspaceMaintenance } from './photo-workspace-scheduler.service.js';

describe('photo workspace scheduler', () => {
  const repository = {
    purgeExpiredJournal: vi.fn(),
    purgeExpiredAiOriginalLinks: vi.fn(),
  };
  const notificationService = {
    sendDueNotifications: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('sends due notifications and purges expired internal records', async () => {
    repository.purgeExpiredJournal.mockResolvedValue(3);
    repository.purgeExpiredAiOriginalLinks.mockResolvedValue(2);

    await runPhotoWorkspaceMaintenance(repository as never, notificationService as never);

    expect(notificationService.sendDueNotifications).toHaveBeenCalledTimes(1);
    expect(repository.purgeExpiredJournal).toHaveBeenCalledTimes(1);
    expect(repository.purgeExpiredAiOriginalLinks).toHaveBeenCalledTimes(1);
  });
});
