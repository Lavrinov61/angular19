export interface DnsZone {
  uuid: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  delegation_check_status?: string;
  disabled?: boolean;
}

export interface DnsRrset {
  uuid: string;
  name: string;
  type: string;
  ttl: number;
  records: Array<{ content: string; disabled: boolean }>;
}

export interface DnsZonesResponse {
  count: number;
  next_offset: number;
  result: DnsZone[];
}

export interface DnsRrsetResponse {
  count: number;
  next_offset: number;
  result: DnsRrset[];
}

export function textResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function errorResponse(text: string) {
  return { content: [{ type: 'text' as const, text }], isError: true };
}
