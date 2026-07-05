import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  heicConvert: vi.fn(),
  sharp: Object.assign(
    vi.fn(() => ({
      jpeg: vi.fn(() => ({ toBuffer: vi.fn() })),
      on: vi.fn(),
      destroy: vi.fn(),
    })),
    {
      format: { heif: { input: { fileSuffix: [] } } },
    },
  ),
}));

vi.mock('sharp', () => ({
  default: mocks.sharp,
}));

vi.mock('child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('heic-convert', () => ({
  default: mocks.heicConvert,
}));

import { convertImageBufferToJpeg } from './image-convert.js';

describe('image-convert HEIC fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses libheif-js when heif-convert cannot parse the HEIC container', async () => {
    const input = Buffer.from([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x68, 0x65, 0x69, 0x63,
    ]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

    mocks.execFile.mockImplementation((_bin, _args, _options, callback) => {
      callback(new Error('Too many auxiliary image references'));
    });
    mocks.heicConvert.mockResolvedValue(jpeg);

    const result = await convertImageBufferToJpeg(input, 'image/heic', 'IMG_0809.HEIC');

    expect(result).toEqual(jpeg);
    expect(mocks.sharp).not.toHaveBeenCalled();
    expect(mocks.execFile).toHaveBeenCalledWith(
      'heif-convert',
      expect.arrayContaining(['--quiet', '-q', '92']),
      expect.objectContaining({ timeout: 120_000 }),
      expect.any(Function),
    );
    expect(mocks.heicConvert).toHaveBeenCalledWith({
      buffer: input,
      format: 'JPEG',
      quality: 0.92,
    });
  });
});
