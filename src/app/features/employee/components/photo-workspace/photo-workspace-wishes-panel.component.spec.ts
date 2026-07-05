import { describe, expect, it } from 'vitest';
import type { PhotoWorkspaceWishDto } from '../../models/photo-workspace.model';
import { PhotoWorkspaceWishesPanelComponent } from './photo-workspace-wishes-panel.component';

describe('PhotoWorkspaceWishesPanelComponent', () => {
  it('shows order comments in the order wishes group', () => {
    const panel = Object.create(PhotoWorkspaceWishesPanelComponent.prototype) as PhotoWorkspaceWishesPanelComponent & {
      wishes: () => readonly PhotoWorkspaceWishDto[];
    };
    panel.wishes = () => [
      makeWish({ id: 'wish-comment', source_type: 'order_comment' }),
      makeWish({ id: 'wish-order', source_type: 'order_wishes' }),
    ];

    expect(panel.wishesBySource('order').map(wish => wish.id)).toEqual([
      'wish-comment',
      'wish-order',
    ]);
  });
});

function makeWish(overrides: Partial<PhotoWorkspaceWishDto> = {}): PhotoWorkspaceWishDto {
  return {
    id: 'wish-1',
    item_id: 'item-1',
    source_type: 'manual',
    source_id: null,
    source_label: null,
    text: 'Выровнять тон кожи',
    status: 'pending',
    reject_reason: null,
    created_by: null,
    updated_by: null,
    created_at: '2026-06-23T06:00:00.000Z',
    updated_at: '2026-06-23T06:00:00.000Z',
    ...overrides,
  };
}
