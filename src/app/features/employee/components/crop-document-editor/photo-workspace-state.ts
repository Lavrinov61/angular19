export type PhotoWorkspaceAssetSource = 'order' | 'chat' | 'approval' | 'result';

export interface PhotoWorkspaceAsset {
  id: string;
  url: string;
  name: string;
  source: PhotoWorkspaceAssetSource;
  photoId?: string;
  thumbnailUrl?: string | null;
}

export interface PhotoWorkspaceWorkItem {
  id: string;
  label: string;
  sourceAssetId: string;
  referenceAssetIds: readonly string[];
  employeePrompt: string;
  resultUrl: string | null;
  resultPhotoId: string | null;
  jobId: string | null;
  savedAsOriginal: boolean;
}

export interface PhotoWorkspaceState {
  assets: readonly PhotoWorkspaceAsset[];
  workItems: readonly PhotoWorkspaceWorkItem[];
  activeWorkItemId: string | null;
}

export interface CreateInitialWorkspaceStateInput {
  assets: readonly PhotoWorkspaceAsset[];
  initialAssetUrl: string;
}

export interface WorkItemResultPatch {
  resultUrl: string | null;
  resultPhotoId?: string | null;
  jobId: string | null;
  savedAsOriginal: boolean;
}

export function createInitialWorkspaceState(input: CreateInitialWorkspaceStateInput): PhotoWorkspaceState {
  const assets = uniqueAssets(input.assets);
  const initial = assets.find(asset => asset.url === input.initialAssetUrl) ?? assets[0];
  if (!initial) {
    return { assets: [], workItems: [], activeWorkItemId: null };
  }
  const item = makeWorkItem(initial, 1);
  return { assets, workItems: [item], activeWorkItemId: item.id };
}

export function createWorkItemFromAsset(state: PhotoWorkspaceState, assetId: string): PhotoWorkspaceState {
  const asset = state.assets.find(candidate => candidate.id === assetId);
  if (!asset) return state;
  const existing = state.workItems.find(item => item.sourceAssetId === assetId);
  if (existing) {
    return { ...state, activeWorkItemId: existing.id };
  }
  const item = makeWorkItem(asset, state.workItems.length + 1);
  return {
    ...state,
    workItems: [...state.workItems, item],
    activeWorkItemId: item.id,
  };
}

export function setActiveWorkItem(state: PhotoWorkspaceState, workItemId: string): PhotoWorkspaceState {
  return state.workItems.some(item => item.id === workItemId)
    ? { ...state, activeWorkItemId: workItemId }
    : state;
}

export function addReferenceToActiveItem(state: PhotoWorkspaceState, assetId: string): PhotoWorkspaceState {
  return updateActiveWorkItem(state, item => {
    if (item.sourceAssetId === assetId || item.referenceAssetIds.includes(assetId)) return item;
    return { ...item, referenceAssetIds: [...item.referenceAssetIds, assetId] };
  });
}

export function removeReferenceFromActiveItem(state: PhotoWorkspaceState, assetId: string): PhotoWorkspaceState {
  return updateActiveWorkItem(state, item => ({
    ...item,
    referenceAssetIds: item.referenceAssetIds.filter(id => id !== assetId),
  }));
}

export function updateActivePrompt(state: PhotoWorkspaceState, employeePrompt: string): PhotoWorkspaceState {
  return updateActiveWorkItem(state, item => ({ ...item, employeePrompt }));
}

export function updateActiveResult(state: PhotoWorkspaceState, patch: WorkItemResultPatch): PhotoWorkspaceState {
  return updateActiveWorkItem(state, item => ({
    ...item,
    resultUrl: patch.resultUrl,
    resultPhotoId: patch.resultPhotoId ?? item.resultPhotoId,
    jobId: patch.jobId,
    savedAsOriginal: patch.savedAsOriginal,
  }));
}

export function getActiveWorkItem(state: PhotoWorkspaceState): PhotoWorkspaceWorkItem | null {
  return state.workItems.find(item => item.id === state.activeWorkItemId) ?? null;
}

export function getAssetById(state: PhotoWorkspaceState, assetId: string): PhotoWorkspaceAsset | null {
  return state.assets.find(asset => asset.id === assetId) ?? null;
}

function updateActiveWorkItem(
  state: PhotoWorkspaceState,
  updater: (item: PhotoWorkspaceWorkItem) => PhotoWorkspaceWorkItem,
): PhotoWorkspaceState {
  if (!state.activeWorkItemId) return state;
  return {
    ...state,
    workItems: state.workItems.map(item =>
      item.id === state.activeWorkItemId ? updater(item) : item,
    ),
  };
}

function makeWorkItem(asset: PhotoWorkspaceAsset, index: number): PhotoWorkspaceWorkItem {
  return {
    id: `work-${asset.id}`,
    label: `Фото ${index}`,
    sourceAssetId: asset.id,
    referenceAssetIds: [],
    employeePrompt: '',
    resultUrl: null,
    resultPhotoId: null,
    jobId: null,
    savedAsOriginal: false,
  };
}

function uniqueAssets(assets: readonly PhotoWorkspaceAsset[]): PhotoWorkspaceAsset[] {
  const seen = new Set<string>();
  const out: PhotoWorkspaceAsset[] = [];
  for (const asset of assets) {
    if (!asset.url || seen.has(asset.url)) continue;
    seen.add(asset.url);
    out.push(asset);
  }
  return out;
}
