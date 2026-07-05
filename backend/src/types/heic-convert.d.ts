declare module 'heic-convert' {
  interface HeicConvertOptions {
    buffer: Buffer | Uint8Array;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }

  interface HeicConvert {
    (options: HeicConvertOptions): Promise<Buffer | Uint8Array>;
    all?: (options: HeicConvertOptions) => Promise<Array<{ convert: () => Promise<Buffer | Uint8Array> }>>;
  }

  const heicConvert: HeicConvert;
  export default heicConvert;
}
