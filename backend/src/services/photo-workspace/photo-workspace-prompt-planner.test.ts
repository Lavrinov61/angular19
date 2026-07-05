import { describe, expect, it } from 'vitest';
import { buildPhotoWorkspacePromptPlan, assembleFinalPrompt } from './photo-workspace-prompt-planner.js';

describe('photo workspace prompt planner', () => {
  it('uses only the configured hardcoded prompt phrases plus accepted client wishes', () => {
    const plan = buildPhotoWorkspacePromptPlan({
      variantLimit: 3,
      acceptedWishes: ['убрать маленькую родинку', 'сделать тон кожи ровнее'],
      retouchOptions: ['Расширенная обработка'],
      documentLabel: 'Загранпаспорт 3,5×4,5',
    });

    expect(plan).toHaveLength(3);
    expect(plan.map(item => item.basePrompt)).toEqual([
      'почистить кожу, почистить фон\nубрать маленькую родинку\nсделать тон кожи ровнее',
      'убрать морщины, убрать синяки под глазами\nубрать маленькую родинку\nсделать тон кожи ровнее',
      'убрать второй подбородок, поправить волосы и объём, поправить губы если это девушка\nубрать маленькую родинку\nсделать тон кожи ровнее',
    ]);
    expect(plan[0].basePrompt).toContain('убрать маленькую родинку');
    expect(plan[0].basePrompt).not.toContain('Загранпаспорт 3,5×4,5');
    expect(plan.map(item => item.basePrompt).join('\n')).not.toContain('поправить структуру волос');
    expect(plan.map(item => item.basePrompt).join('\n')).not.toContain('сделать фон белым');
    expect(plan.map(item => item.basePrompt).join('\n')).not.toContain('Сохрани');
  });

  it('fills variants with the three approved prompt phrases only', () => {
    const plan = buildPhotoWorkspacePromptPlan({
      variantLimit: 5,
      acceptedWishes: [],
      retouchOptions: [],
      documentLabel: 'Паспорт РФ 35×45',
    });

    expect(plan.map(item => item.presetSlug)).toEqual([
      'skin_background_clean',
      'wrinkles_under_eyes',
      'face_hair_lips',
    ]);
    expect(plan.map(item => item.finalPrompt)).toEqual([
      'почистить кожу, почистить фон',
      'убрать морщины, убрать синяки под глазами',
      'убрать второй подбородок, поправить волосы и объём, поправить губы если это девушка',
    ]);
  });

  it('falls back to one variant when the requested limit is not finite', () => {
    const plan = buildPhotoWorkspacePromptPlan({
      variantLimit: Number.NaN,
      acceptedWishes: ['сохранить естественную улыбку'],
      retouchOptions: [],
      documentLabel: 'Паспорт РФ 35×45',
    });

    expect(plan).toHaveLength(1);
    expect(plan[0].presetSlug).toBe('skin_background_clean');
  });

  it('keeps super tariff capped by the available prompt presets', () => {
    const plan = buildPhotoWorkspacePromptPlan({
      variantLimit: 10,
      acceptedWishes: [],
      retouchOptions: [],
      documentLabel: 'Паспорт РФ 35×45',
    });

    expect(plan).toHaveLength(3);
    expect(plan.map(item => item.slotNumber)).toEqual([1, 2, 3]);
  });

  it('appends employee prompt additions without hiding the base prompt', () => {
    const finalPrompt = assembleFinalPrompt({
      basePrompt: 'Сохранить внешность.',
      manualPrompt: 'Добавить мягкий акцент на глаза.',
      referencesSummary: 'Референсы: волосы, макияж.',
    });

    expect(finalPrompt).toBe('Сохранить внешность.\nРеференсы: волосы, макияж.\nДополнение сотрудника: Добавить мягкий акцент на глаза.');
  });
});
