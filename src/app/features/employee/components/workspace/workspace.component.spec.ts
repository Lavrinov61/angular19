import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Workspace chat order side panel source contract', () => {
  const readSource = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

  const chatDetailTs = readSource('src/app/features/employee/components/detail-panel/chat-detail.component.ts');
  const chatDetailHtml = readSource('src/app/features/employee/components/detail-panel/chat-detail.component.html');
  const detailPanelTs = readSource('src/app/features/employee/components/detail-panel/detail-panel.component.ts');
  const workspaceTs = readSource('src/app/features/employee/components/workspace/workspace.component.ts');

  it('exposes an explicit create-order action from chat detail', () => {
    expect(chatDetailTs).toContain('createOrderFromChat = output<void>()');
    expect(chatDetailTs).toContain('requestCreateOrderFromChat(): void');
    expect(chatDetailHtml).toContain('Создать заказ');
    expect(chatDetailHtml).toContain('(click)="requestCreateOrderFromChat()"');
  });

  it('forwards create-order intent through the detail panel', () => {
    expect(detailPanelTs).toContain('createOrderFromChat = output<void>()');
    expect(detailPanelTs).toContain('(createOrderFromChat)="createOrderFromChat.emit()"');
  });

  it('renders chat-context order creation in the workspace side panel', () => {
    expect(workspaceTs).toContain('showChatOrderPanel = signal(false)');
    expect(workspaceTs).toContain('onCreateOrderFromChat(): void');
    expect(workspaceTs).toContain('(createOrderFromChat)="onCreateOrderFromChat()"');
    expect(workspaceTs).toContain("@if (showChatOrderPanel() && selectedItem()?.type === 'chat')");
    expect(workspaceTs).toContain('[dialogSessionId]="activeSessionId() ?? \'\'"');
  });

  it('switches the desktop shell into photo workspace focus mode', () => {
    expect(detailPanelTs).toContain('photoWorkspaceFocusChange = output<boolean>()');
    expect(detailPanelTs).toContain('photoWorkspaceFocus = signal(false)');
    expect(detailPanelTs).toContain('(photoWorkspaceFocusChange)="onPhotoWorkspaceFocusChange($event)"');
    expect(workspaceTs).toContain('photoWorkspaceFocus = signal(false)');
    expect(workspaceTs).toContain('[class.photo-workspace-focus]="photoWorkspaceFocus()"');
    expect(workspaceTs).toContain('(photoWorkspaceFocusChange)="onPhotoWorkspaceFocusChange($event)"');
    expect(workspaceTs).toContain('.workspace.desktop.photo-workspace-focus');
    expect(workspaceTs).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(workspaceTs).toContain('.workspace.desktop.photo-workspace-focus .inbox-col');
    expect(workspaceTs).toContain('.workspace.desktop.photo-workspace-focus .client-col');
  });
});
