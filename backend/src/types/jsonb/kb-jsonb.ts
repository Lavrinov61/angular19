export type KbJsonPrimitive = string | number | boolean | null;
export type KbJsonValue = KbJsonPrimitive | KbJsonObject | KbJsonValue[];

export interface KbJsonObject {
  [key: string]: KbJsonValue | undefined;
}

export interface KbScreenshotJsonb extends KbJsonObject {
  src: string;
  alt?: string;
  caption?: string;
}

export interface KbEntityMetadataJsonb extends KbJsonObject {
  audience?: string;
  module?: string;
  ui_route?: string;
  last_reviewed_at?: string;
  questions?: string[];
  screenshots?: KbScreenshotJsonb[];
}

export interface KbTaskPayloadJsonb extends KbJsonObject {
  source_slug?: string;
  reason?: string;
}

export type KbTaskResultJsonb = KbJsonObject;
export type KbDataSourceConfigJsonb = KbJsonObject;
export type KbAccessRuleMetadataJsonb = KbJsonObject;
export type KbMetricThresholdJsonb = KbJsonObject;
export type KbMetricDashboardConfigJsonb = KbJsonObject;
export type KbMetricDimensionsJsonb = KbJsonObject;
export type KbConfigValueJsonb = KbJsonValue;
