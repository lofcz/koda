import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // Native rendering and React controls are verified in real Chromium by
      // test:browser. Keep unit coverage focused on the document and lifecycle.
      include: [
        'src/model.ts',
        'src/engine.ts',
        'src/locale.ts',
        'src/stableKey.ts',
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 90,
        branches: 85,
        functions: 90,
        lines: 90,
      },
    },
  },
});
