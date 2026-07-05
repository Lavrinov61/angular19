/**
 * Общий интерфейс для фотографий
 */
export interface Photo {
  id: string;
  sessionId: string;
  originalUrl: string;
  processedUrl?: string;
  thumbnailUrl: string;
  status: 'original' | 'processed' | 'selected';
  uploadedAt: string;
  processing?: {
    status: 'pending' | 'completed' | 'failed';
    processedAt?: string;
    versions?: {
      color?: string;
      bw?: string;
      vintage?: string;
      portrait?: string;
    };
  };
  metadata?: {
    width: number;
    height: number;
    fileSize?: number; // Размер файла в байтах
    size?: number; // Алиас для fileSize
    fileName?: string;
    format?: string;
  };
  selected?: boolean;
}
