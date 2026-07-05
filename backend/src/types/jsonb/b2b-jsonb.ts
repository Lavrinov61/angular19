export type B2BJsonPrimitive = string | number | boolean | null;
export type B2BJsonValue = B2BJsonPrimitive | B2BJsonObject | B2BJsonValue[];

export interface B2BJsonObject {
  [key: string]: B2BJsonValue | undefined;
}

export interface B2BVerificationSnapshot extends B2BJsonObject {
  provider?: string;
  inn?: string;
  kpp?: string | null;
  ogrn?: string | null;
  legal_name?: string;
  legal_address?: string | null;
  user_role?: string | null;
  consented_at?: string;
}

export interface B2BReconciliationPayload extends B2BJsonObject {
  reason?: string;
  candidates?: B2BJsonValue[];
}
