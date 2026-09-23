import macrosPlugin from 'vite-plugin-babel-macros';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  // Transform lingui macros (e.g. `msg`) used by the code under test.
  plugins: [macrosPlugin()],
  test: {
    projects: [
      {
        // Inherit the root plugins (lingui macros) and esbuild settings.
        extends: true,
        test: {
          name: 'unit',
          include: ['**/*.test.ts'],
          exclude: ['**/*.integration.test.ts'],
          testTimeout: 5000,
        },
      },
      {
        extends: true,
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
