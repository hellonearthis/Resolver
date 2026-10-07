/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './', // Important for Electron to load assets correctly in production
  optimizeDeps: {
    include: [
      'essentia.js/dist/essentia-wasm.es.js',
      'essentia.js/dist/essentia.js-core.es.js',
    ],
  },
  assetsInclude: ['**/*.wasm'],
  // ES-format workers are required: the Essentia worker lazy-loads WASM via dynamic import(),
  // which the default 'iife' worker format cannot code-split.
  worker: {
    format: 'es',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
      exclude: ['**/*.test.*', 'src/types/**', '**/*.d.ts']
    },
  },
})
