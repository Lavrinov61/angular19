import { PHOTO_WORKSPACE_PROMPT_PRESETS } from './photo-workspace.constants.js';

export interface BuildPromptPlanInput {
  variantLimit: number;
  acceptedWishes: readonly string[];
  retouchOptions: readonly string[];
  documentLabel: string;
}

export interface PhotoWorkspacePromptPlanItem {
  slotNumber: number;
  presetSlug: string;
  presetLabel: string;
  internalName: string;
  enabled: boolean;
  basePrompt: string;
  manualPrompt: string;
  finalPrompt: string;
  promptReady: boolean;
}

export interface AssembleFinalPromptInput {
  basePrompt: string;
  manualPrompt: string;
  referencesSummary: string;
}

export function buildPhotoWorkspacePromptPlan(input: BuildPromptPlanInput): PhotoWorkspacePromptPlanItem[] {
  const limit = normalizeVariantLimit(input.variantLimit);
  const acceptedWishes = input.acceptedWishes.map(wish => wish.trim()).filter(Boolean);

  return PHOTO_WORKSPACE_PROMPT_PRESETS.slice(0, limit).map((preset, index) => {
    const basePrompt = buildBasePrompt({
      presetBasePrompt: preset.basePrompt,
      acceptedWishes,
    });

    return {
      slotNumber: index + 1,
      presetSlug: preset.slug,
      presetLabel: preset.label,
      internalName: `Фото ${index + 1} - ${index === 0 ? 'пожелания клиента' : preset.label.toLowerCase()}`,
      enabled: true,
      basePrompt,
      manualPrompt: '',
      finalPrompt: basePrompt,
      promptReady: basePrompt.trim().length > 0,
    };
  });
}

function normalizeVariantLimit(value: number): number {
  const integer = Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(10, integer));
}

export function assembleFinalPrompt(input: AssembleFinalPromptInput): string {
  return [
    input.basePrompt.trim(),
    input.referencesSummary.trim(),
    input.manualPrompt.trim() ? `Дополнение сотрудника: ${input.manualPrompt.trim()}` : '',
  ].filter(Boolean).join('\n');
}

function buildBasePrompt(input: {
  presetBasePrompt: string;
  acceptedWishes: readonly string[];
}): string {
  const parts = [
    input.presetBasePrompt,
    ...input.acceptedWishes,
  ];

  return parts.filter(Boolean).join('\n');
}
