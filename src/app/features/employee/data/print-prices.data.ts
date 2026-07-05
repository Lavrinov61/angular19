export interface PrintPreset {
  id: string;
  slug?: string;
  icon: string;
  label: string;
  printerType: 'photo' | 'mfp' | 'document';
  sublimation?: boolean;
  paperSize: string;
  mediaType?: string;
  quality: string;
  fitMode: 'fit' | 'fill' | 'stretch' | 'actual';
  borderless: boolean;
  colorMode: 'color' | 'bw';
  duplex: boolean;
  mirror: boolean;
  renderingIntent?: 'perceptual' | 'relative_colorimetric' | 'saturation' | 'absolute_colorimetric';
  price?: number;
}
