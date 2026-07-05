import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { shouldOpenWorkdayWelcome } from './workspace-layout.component';

describe('WorkspaceLayoutComponent top navigation', () => {
  it('shows the instructions link before the new order action', () => {
    const sourcePath = join(dirname(fileURLToPath(import.meta.url)), 'workspace-layout.component.ts');
    const source = readFileSync(sourcePath, 'utf8');
    const instructionsIndex = source.indexOf('routerLink="/employee/knowledge"');
    const newOrderIndex = source.indexOf('[queryParams]="{action: \'new-order\'}"');

    expect(instructionsIndex).toBeGreaterThanOrEqual(0);
    expect(newOrderIndex).toBeGreaterThanOrEqual(0);
    expect(instructionsIndex).toBeLessThan(newOrderIndex);
  });
});

describe('WorkspaceLayoutComponent workday welcome gate', () => {
  const baseState = {
    isBrowser: true,
    workdayLoaded: true,
    dialogOpen: false,
    workdayStartSkipped: false,
    hasShiftManagePermission: true,
    canStartWorkday: true,
    hasUser: true,
  };

  it('does not reopen the required workday dialog after an admin skips it', () => {
    expect(shouldOpenWorkdayWelcome({
      ...baseState,
      workdayStartSkipped: true,
    })).toBe(false);
  });

  it('still opens the required workday dialog before it has been skipped', () => {
    expect(shouldOpenWorkdayWelcome(baseState)).toBe(true);
  });
});
