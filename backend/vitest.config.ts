import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['src/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
