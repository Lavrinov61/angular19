/** JSONB shape for photo_print_orders.items array elements */
export interface PhotoPrintItem {
  uploadedUrl?: string;
  photoUrl?: string;
  format: string;
  paperType: string;
  quantity: number;
}
