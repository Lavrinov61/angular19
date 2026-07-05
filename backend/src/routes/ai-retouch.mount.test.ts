import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function readAppSource(): Promise<string> {
  return readFile(resolve(__dirname, '../app.ts'), 'utf8');
}

describe('ai retouch app mount', () => {
  it('mounts CRM photo-retouch endpoints under /api/photo-retouch', async () => {
    const source = await readAppSource();

    expect(source).toContain("import aiRetouchRoutes from './routes/ai-retouch.routes.js';");
    expect(source).toContain('targetApp.use(`${prefix}/photo-retouch`, aiRetouchRoutes);');
  });
});
