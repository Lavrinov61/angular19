import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import type { PhotoWorkspaceApiService } from '../../services/photo-workspace-api.service';
import type { PhotoWorkspaceEnvelopeDto } from '../../models/photo-workspace.model';
import { PhotoWorkspaceComponent } from './photo-workspace.component';

describe('PhotoWorkspaceComponent', () => {
  it('keeps the workspace focused on the crop image and processing variants', () => {
    const source = readSource('src/app/features/employee/components/photo-workspace/photo-workspace.component.ts');

    expect(source).toContain('grid-template-columns: 160px minmax(540px, 2.35fr) minmax(300px, 1fr);');
    expect(source).toContain('.pw-panel--assets { padding: 8px 6px; }');
  });

  it('lets the crop preview expand instead of staying capped at thumbnail height', () => {
    const source = readSource('src/app/features/employee/components/photo-workspace/photo-workspace-crop-panel.component.ts');

    expect(source).toContain('[style.--pwc-image-aspect]="canvasAspectRatio()"');
    expect(source).toContain('max-height: 100%;');
    expect(source).not.toContain('calc(100vh - 300px)');
    expect(source).not.toContain('max-height: 56vh;');
  });

  it('requires choosing the crop format before entering the crop editor', () => {
    const source = readSource('src/app/features/employee/components/photo-workspace/photo-workspace-crop-panel.component.ts');

    expect(source).toContain('readonly cropFormatConfirmed = signal(false)');
    expect(source).toContain('class="pwc-format-grid"');
    expect(source).toContain('(click)="beginCrop()"');
    expect(source).not.toContain('class="pwc-doc-select"');
  });

  it('offers 9x12 and 4x6 crop formats in the workspace crop flow', () => {
    const source = readSource('src/app/features/employee/components/photo-workspace/photo-workspace-crop-panel.component.ts');

    expect(source).toContain("slug: 'photo_9x12'");
    expect(source).toContain("label: 'Фото 9x12'");
    expect(source).toContain("slug: 'photo_4x6'");
    expect(source).toContain("label: 'Фото 4x6'");
  });

  it('uses bounded workflow tabs instead of rendering every workflow panel in one scroll', () => {
    const source = readSource('src/app/features/employee/components/photo-workspace/photo-workspace.component.ts');

    expect(source).toContain('type PhotoWorkspaceWorkflowTab');
    expect(source).toContain('readonly workflowTabs = computed');
    expect(source).toContain('@switch (activeWorkflowTab())');
    expect(source).toContain('class="pw-workflow-tabs"');
    expect(source).toContain('class="pw-workflow-body"');
    expect(source).toContain('.pw-workflow-body');
    expect(source).toContain('overflow: hidden;');
  });

  it('surfaces AI generation progress from retouch websocket events', () => {
    const workspaceSource = readSource('src/app/features/employee/components/photo-workspace/photo-workspace.component.ts');
    const aiPanelSource = readSource('src/app/features/employee/components/photo-workspace/photo-workspace-ai-panel.component.ts');
    const wsSource = readSource('src/app/core/services/websocket.service.ts');

    expect(workspaceSource).toContain('retouchProgressEffect');
    expect(workspaceSource).toContain('wsService.retouchEvent()');
    expect(workspaceSource).toContain('[progressByVariantId]="aiProgressByVariantId()"');
    expect(aiPanelSource).toContain('MatProgressBarModule');
    expect(aiPanelSource).toContain('mat-progress-bar');
    expect(aiPanelSource).toContain('photoWorkspaceAiProgressLabel');
    expect(wsSource).toContain('workspaceVariantId?: string');
    expect(wsSource).toContain('providerStatus?:');
  });

  it('clears a stale error after successful approval feedback import', () => {
    const envelope = makeEnvelope();
    const error = signal<string | null>('Не удалось импортировать пожелания');
    const envelopes = signal<PhotoWorkspaceEnvelopeDto[]>([envelope]);
    const api: Pick<PhotoWorkspaceApiService, 'importApprovalFeedback'> = {
      importApprovalFeedback: () => of({ success: true, data: [] }),
    };
    const component = Object.create(PhotoWorkspaceComponent.prototype) as PhotoWorkspaceComponent;
    Object.defineProperty(component, 'api', { value: api });
    Object.defineProperty(component, 'activeEnvelope', { value: () => envelope });
    Object.defineProperty(component, 'error', { value: error });
    Object.defineProperty(component, 'envelopes', { value: envelopes });

    component.importApprovalFeedback();

    expect(error()).toBeNull();
  });
});

function makeEnvelope(): PhotoWorkspaceEnvelopeDto {
  return {
    item: {
      id: 'item-1',
      order_id: 'order-1',
      approval_session_id: null,
      source_asset_id: null,
      source_asset_url: '/media/source.jpg',
      source_asset_name: '9X9A5351.JPG',
      label: '9X9A5351.JPG',
      document_type: 'passport_rf',
      tariff_level: 'extended',
      variant_limit: 0,
      crop_payload: {},
      crop_job_id: null,
      crop_result_url: null,
      crop_result_thumbnail_url: null,
      status: 'crop_ready',
      active_section: 'wishes',
      created_by: 'user-1',
      updated_by: 'user-1',
      created_at: '2026-06-23T07:00:00.000Z',
      updated_at: '2026-06-23T07:00:00.000Z',
    },
    references: [],
    wishes: [],
    variants: [],
  };
}

function readSource(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}
