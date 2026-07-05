/** JSONB contract for photo_approval_annotations.annotation */

export interface TextAnnotation {
  type: 'text';
  comment: string;
}

export interface PointAnnotation {
  type: 'point';
  x: number;
  y: number;
  comment: string;
}

export type PhotoAnnotation = TextAnnotation | PointAnnotation;
