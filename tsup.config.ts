import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/document.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2019',
  // The component entry carries its own 'use client' directive. The document
  // entry must stay usable from server components and plain Node.js programs.
});
