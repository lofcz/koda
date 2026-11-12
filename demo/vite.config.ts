import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/.
  base: process.env.DEMO_BASE ?? '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Import the component straight from the parent src/ so the demo
      // doubles as a development harness.
      'koda-editor': path.resolve(__dirname, '../src/index.ts'),
    },
    // The aliased source must resolve to the demo's single React copy,
    // otherwise: "invalid hook call".
    dedupe: ['react', 'react-dom'],
  },
});
