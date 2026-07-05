/** WhatsApp Cloud API types (webhook payload + API responses). */

export interface WaMedia {
  id?: string;
  url?: string;
  mime_type?: string;
}

export interface WaDocument extends WaMedia {
  filename?: string;
}

export interface WaMessage {
  id: string;
  from: string;
  type: string;
  text?: { body: string };
  image?: WaMedia;
  video?: WaMedia;
  audio?: WaMedia;
  document?: WaDocument;
  location?: { latitude: number; longitude: number };
  context?: { id: string };
}

export interface WaContact {
  wa_id: string;
  profile?: { name: string };
}

export interface WaStatus {
  id: string;
  status: string;
  errors?: Array<{ code: number; title: string }>;
}

export interface WaValue {
  messages?: WaMessage[];
  contacts?: WaContact[];
  statuses?: WaStatus[];
}

export interface WaChange {
  value?: WaValue;
}

export interface WaEntry {
  changes?: WaChange[];
}

export interface WaWebhookBody {
  entry?: WaEntry[];
}

export interface WaApiResponse {
  messages?: Array<{ id: string }>;
}
