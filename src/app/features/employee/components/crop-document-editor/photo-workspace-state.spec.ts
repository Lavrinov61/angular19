import {
  addReferenceToActiveItem,
  createInitialWorkspaceState,
  createWorkItemFromAsset,
  removeReferenceFromActiveItem,
  setActiveWorkItem,
  updateActivePrompt,
  updateActiveResult,
  type PhotoWorkspaceAsset,
} from './photo-workspace-state';

const assets: PhotoWorkspaceAsset[] = [
  { id: 'order-1', url: 'https://svoefoto.ru/media/order/1.jpg', name: 'Фото 1', source: 'order' },
  { id: 'order-2', url: 'https://svoefoto.ru/media/order/2.jpg', name: 'Фото 2', source: 'order' },
  { id: 'chat-1', url: 'https://svoefoto.ru/media/chat/glasses.jpg', name: 'Очки', source: 'chat' },
];

describe('photo workspace state', () => {
  it('creates one active work item from the selected initial asset', () => {
    const state = createInitialWorkspaceState({ assets, initialAssetUrl: assets[1].url });

    expect(state.activeWorkItemId).toBe('work-order-2');
    expect(state.workItems.length).toBe(1);
    expect(state.workItems[0].sourceAssetId).toBe('order-2');
    expect(state.workItems[0].label).toBe('Фото 1');
  });

  it('keeps references separate for each main photo', () => {
    let state = createInitialWorkspaceState({ assets, initialAssetUrl: assets[0].url });
    state = addReferenceToActiveItem(state, 'chat-1');
    state = createWorkItemFromAsset(state, 'order-2');
    state = setActiveWorkItem(state, 'work-order-2');

    expect(state.workItems.find(item => item.id === 'work-order-1')?.referenceAssetIds).toEqual(['chat-1']);
    expect(state.workItems.find(item => item.id === 'work-order-2')?.referenceAssetIds).toEqual([]);
  });

  it('toggles references without affecting the source photo', () => {
    let state = createInitialWorkspaceState({ assets, initialAssetUrl: assets[0].url });

    state = addReferenceToActiveItem(state, 'order-1');
    state = addReferenceToActiveItem(state, 'chat-1');
    state = removeReferenceFromActiveItem(state, 'chat-1');

    expect(state.workItems[0].referenceAssetIds).toEqual([]);
  });

  it('keeps prompt and result state isolated per work item', () => {
    let state = createInitialWorkspaceState({ assets, initialAssetUrl: assets[0].url });
    state = updateActivePrompt(state, 'Подставить очки аккуратно');
    state = updateActiveResult(state, {
      resultUrl: 'https://svoefoto.ru/media/approvals/result-1.jpg',
      jobId: 'job-1',
      savedAsOriginal: false,
    });
    state = createWorkItemFromAsset(state, 'order-2');
    state = setActiveWorkItem(state, 'work-order-2');

    expect(state.workItems.find(item => item.id === 'work-order-1')?.employeePrompt).toBe('Подставить очки аккуратно');
    expect(state.workItems.find(item => item.id === 'work-order-1')?.resultUrl).toBe('https://svoefoto.ru/media/approvals/result-1.jpg');
    expect(state.workItems.find(item => item.id === 'work-order-2')?.employeePrompt).toBe('');
    expect(state.workItems.find(item => item.id === 'work-order-2')?.resultUrl).toBeNull();
  });

  it('marks only the active work item as saved when result is saved as original', () => {
    let state = createInitialWorkspaceState({ assets, initialAssetUrl: assets[0].url });
    state = updateActiveResult(state, {
      resultUrl: 'https://svoefoto.ru/media/approvals/result-1.jpg',
      jobId: 'job-1',
      savedAsOriginal: true,
    });
    state = createWorkItemFromAsset(state, 'order-2');

    expect(state.workItems.find(item => item.id === 'work-order-1')?.savedAsOriginal).toBe(true);
    expect(state.workItems.find(item => item.id === 'work-order-2')?.savedAsOriginal).toBe(false);
  });
});
