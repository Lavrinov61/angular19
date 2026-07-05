import { createLogger } from '../../utils/logger.js';
import { PhotoWorkspaceNotificationService } from './photo-workspace-notification.service.js';
import { PhotoWorkspaceRepository } from './photo-workspace.repository.js';

export interface PhotoWorkspaceMaintenanceRepository {
  purgeExpiredJournal(): Promise<number>;
  purgeExpiredAiOriginalLinks(): Promise<number>;
}

export interface PhotoWorkspaceDueNotificationService {
  sendDueNotifications(): Promise<void>;
}

const logger = createLogger('photo-workspace-scheduler');
const PHOTO_WORKSPACE_MAINTENANCE_INTERVAL_MS = 60_000;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let maintenanceRunning = false;

export async function runPhotoWorkspaceMaintenance(
  repository: PhotoWorkspaceMaintenanceRepository = new PhotoWorkspaceRepository(),
  notificationService: PhotoWorkspaceDueNotificationService = new PhotoWorkspaceNotificationService(),
): Promise<void> {
  await notificationService.sendDueNotifications();

  const purgedJournalRows = await repository.purgeExpiredJournal();
  const purgedAiOriginalLinks = await repository.purgeExpiredAiOriginalLinks();

  if (purgedJournalRows > 0 || purgedAiOriginalLinks > 0) {
    logger.info('Photo workspace maintenance processed expired records', {
      purgedJournalRows,
      purgedAiOriginalLinks,
    });
  }
}

async function runScheduledPhotoWorkspaceMaintenance(): Promise<void> {
  if (maintenanceRunning) {
    logger.warn('Photo workspace maintenance skipped because a previous run is still active');
    return;
  }

  maintenanceRunning = true;
  try {
    await runPhotoWorkspaceMaintenance();
  } catch (error: unknown) {
    logger.error('Photo workspace maintenance failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    maintenanceRunning = false;
  }
}

export function startPhotoWorkspaceScheduler(): void {
  if (intervalHandle) {
    return;
  }

  void runScheduledPhotoWorkspaceMaintenance();
  intervalHandle = setInterval(runScheduledPhotoWorkspaceMaintenance, PHOTO_WORKSPACE_MAINTENANCE_INTERVAL_MS);
  logger.info('Photo workspace scheduler started', {
    intervalMs: PHOTO_WORKSPACE_MAINTENANCE_INTERVAL_MS,
  });
}

export function stopPhotoWorkspaceScheduler(): void {
  if (!intervalHandle) {
    return;
  }

  clearInterval(intervalHandle);
  intervalHandle = null;
  logger.info('Photo workspace scheduler stopped');
}
