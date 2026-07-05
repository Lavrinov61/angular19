export type ReadyFormTimestamp = string | Date;

export interface ReadyFormBaseRow {
  id: string;
  title: string;
  description: string | null;
  original_name: string;
  stored_name: string;
  mime_type: string;
  file_size: string;
  extension: string;
  uploaded_by: string | null;
  uploader_name: string | null;
  created_at: ReadyFormTimestamp;
  updated_at: ReadyFormTimestamp;
}

export interface ReadyFormRow extends ReadyFormBaseRow {
  storage_path: string;
}

export interface ReadyFormListRow extends ReadyFormBaseRow {
  total_count: string;
}

export interface ReadyFormDownloadRow {
  id: string;
  original_name: string;
  storage_path: string;
  mime_type: string;
  file_size: string;
}
