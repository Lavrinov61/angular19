import {
  canStartAiGeneration,
  canStartInitialAiGeneration,
  initialWorkspaceAssetToCreate,
  photoWorkspaceAiElapsedLabel,
  photoWorkspaceAiProgressLabel,
  photoWorkspaceAiProgressMode,
  photoWorkspaceAiProgressValue,
  notificationCountdownLabel,
  photoWorkspaceCounters,
} from './photo-workspace-state';

describe('photo workspace state', () => {
  it('computes global counters for the order', () => {
    expect(photoWorkspaceCounters([
      {
        id: 'item-1',
        variants: [
          { status: 'checked', enabled: true },
          { status: 'error', enabled: true },
          { status: 'needs_photoshop_check', enabled: true },
        ],
      },
    ])).toEqual({
      aiDone: 1,
      aiTotal: 3,
      aiErrors: 1,
      photoshopWaiting: 1,
      readyToSend: 1,
    });
  });

  it('shows countdown for debounced notification', () => {
    expect(notificationCountdownLabel(
      new Date('2026-06-22T10:00:00.000Z'),
      '2026-06-22T10:04:05.000Z',
    )).toBe('4:05');
  });

  it('allows AI generation only when readiness has no blockers', () => {
    expect(canStartAiGeneration({ promptReady: true, blockers: [] })).toBe(true);
    expect(canStartAiGeneration({ promptReady: false, blockers: ['wish_pending'] })).toBe(false);
  });

  it('allows the main AI generation button only before the first attempt for a photo', () => {
    const readiness = { promptReady: true, blockers: [] };

    expect(canStartInitialAiGeneration(readiness, [
      { status: 'planned', enabled: true, ai_job_id: null, ai_original_url: null },
    ], false, false)).toBe(true);
    expect(canStartInitialAiGeneration(readiness, [
      { status: 'generating', enabled: true, ai_job_id: null, ai_original_url: null },
    ], false, false)).toBe(false);
    expect(canStartInitialAiGeneration(readiness, [
      { status: 'error', enabled: true, ai_job_id: 'job-1', ai_original_url: null },
    ], false, false)).toBe(false);
    expect(canStartInitialAiGeneration(readiness, [
      { status: 'planned', enabled: true, ai_job_id: null, ai_original_url: null },
    ], false, true)).toBe(false);
  });

  it('selects an initial order file for workspace item creation when no item exists yet', () => {
    expect(initialWorkspaceAssetToCreate([], '/uploads/source.jpg', '9X9A5351.JPG')).toEqual({
      id: 'initial-source',
      url: '/uploads/source.jpg',
      name: '9X9A5351.JPG',
      source: 'order',
      thumbnailUrl: null,
    });
  });

  it('does not create an initial workspace item when the file is already a main photo', () => {
    expect(initialWorkspaceAssetToCreate([
      { item: { source_asset_url: '/uploads/source.jpg' } },
    ], '/uploads/source.jpg', '9X9A5351.JPG')).toBeNull();
  });

  it('does not create another main photo when only media signed URL query changed', () => {
    expect(initialWorkspaceAssetToCreate([
      { item: { source_asset_url: 'https://svoefoto.ru/media/order-attachments/source.jpg?exp=1&sig=old' } },
    ], 'https://svoefoto.ru/media/order-attachments/source.jpg?exp=2&sig=new', '9X9A5351.JPG')).toBeNull();
  });

  it('maps AI generation progress to operator-facing labels and progress bars', () => {
    expect(photoWorkspaceAiProgressLabel({ phase: 'queued' })).toBe('В очереди fal.ai');
    expect(photoWorkspaceAiProgressLabel({ phase: 'in_progress', providerStatus: 'IN_PROGRESS' })).toBe('fal.ai генерирует');
    expect(photoWorkspaceAiProgressLabel({ phase: 'fetching_result', providerStatus: 'COMPLETED' })).toBe('Получаем файл');
    expect(photoWorkspaceAiProgressValue({ phase: 'queued' })).toBe(15);
    expect(photoWorkspaceAiProgressValue({ phase: 'fetching_result' })).toBe(85);
    expect(photoWorkspaceAiProgressMode({ phase: 'in_progress' })).toBe('indeterminate');
    expect(photoWorkspaceAiProgressMode({ phase: 'completed' })).toBe('determinate');
  });

  it('formats AI generation elapsed time for slow jobs', () => {
    expect(photoWorkspaceAiElapsedLabel(
      new Date('2026-07-04T16:03:05.000Z'),
      new Date('2026-07-04T16:00:00.000Z').getTime(),
    )).toBe('3:05');
  });
});
