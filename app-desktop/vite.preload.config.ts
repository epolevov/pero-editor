import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'electron/preload.ts'),
      formats: ['cjs'],
      fileName: () => 'preload.js',
    },
    outDir: 'dist/preload',
    rollupOptions: {
      external: ['electron'],
    },
    minify: false,
    sourcemap: true,
  },
})
