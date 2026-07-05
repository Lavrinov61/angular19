export type { ReviewSession, ReviewPhoto, ReviewVariant } from '../../features/photo-review/photo-review.service';
import type { ReviewPhoto } from '../../features/photo-review/photo-review.service';

export type PhotoAnnotation = ReviewPhoto['annotations'][number];

export type CompareMode = 'tap-toggle' | 'slider' | 'side-by-side';

export type PhotoStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';
