import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadStorageService(publicUrl = 'https://svoefoto.ru/media') {
  vi.resetModules();
  vi.stubEnv('STORAGE_TYPE', 'local');
  vi.stubEnv('S3_PUBLIC_URL', publicUrl);
  const module = await import('./storage.service.js');
  return module.storageService;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('StorageService.keyFromUrl', () => {
  it('strips signed URL query and hash from public media URLs', async () => {
    const storageService = await loadStorageService();

    expect(storageService.keyFromUrl(
      'https://svoefoto.ru/media/order-attachments/photo.jpg?exp=1782124891&sig=abc#preview',
    )).toBe('order-attachments/photo.jpg');
  });

  it('keeps plain public media URLs unchanged', async () => {
    const storageService = await loadStorageService();

    expect(storageService.keyFromUrl(
      'https://svoefoto.ru/media/chat/client-photo.jpg',
    )).toBe('chat/client-photo.jpg');
  });
});
