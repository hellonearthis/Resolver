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
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
    css: false,
  },
})
