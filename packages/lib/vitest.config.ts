import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    projects: [
      {
        esbuild: {
          jsx: 'automatic',
        },
        test: {
          name: 'unit',
          include: ['**/*.test.ts'],
          exclude: ['**/*.integration.test.ts'],
          testTimeout: 5000,
        },
      },
      {
        test: {
          name: 'integration',
          include: ['**/*.integration.test.ts'],
          testTimeout: 60_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
