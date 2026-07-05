/// <reference lib="webworker" />

interface ResizeRequest {
  file: File;
  maxDimension: number;
  quality: number;
  outputType: string;
  maxSizeBytes: number;
}

interface ResizeResponse {
  file: File;
  resized: boolean;
}

addEventListener('message', async (event: MessageEvent<ResizeRequest>) => {
  const { file, maxDimension, quality, outputType, maxSizeBytes } = event.data;

  // Skip non-images
  if (!file.type.startsWith('image/')) {
    postMessage({ file, resized: false } satisfies ResizeResponse);
    return;
  }

  // Skip formats that shouldn't be rasterized
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    postMessage({ file, resized: false } satisfies ResizeResponse);
    return;
  }

  const mustConvert = file.type === 'image/webp' || file.type === 'image/heic' || file.type === 'image/heif';

  if (!mustConvert && file.size <= maxSizeBytes) {
    postMessage({ file, resized: false } satisfies ResizeResponse);
    return;
  }

  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width === 0 || bitmap.height === 0) {
      bitmap.close();
      postMessage({ file, resized: false } satisfies ResizeResponse);
      return;
    }

    // Scale dimensions
    let width = bitmap.width;
    let height = bitmap.height;
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      postMessage({ file, resized: false } satisfies ResizeResponse);
      return;
    }

    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await canvas.convertToBlob({ type: outputType, quality });

    // If re-encoding made it larger, return original
    if (blob.size >= file.size) {
      postMessage({ file, resized: false } satisfies ResizeResponse);
      return;
    }

    const ext = outputType === 'image/jpeg' ? '.jpg'
      : outputType === 'image/png' ? '.png'
      : outputType === 'image/webp' ? '.webp'
      : '.jpg';
    const dotIdx = file.name.lastIndexOf('.');
    const base = dotIdx > 0 ? file.name.slice(0, dotIdx) : file.name;
    const name = `${base}${ext}`;

    const resized = new File([blob], name, {
      type: outputType,
      lastModified: file.lastModified,
    });

    postMessage({ file: resized, resized: true } satisfies ResizeResponse);
  } catch {
    postMessage({ file, resized: false } satisfies ResizeResponse);
  }
});
