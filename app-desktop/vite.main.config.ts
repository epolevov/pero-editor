import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, 'electron/main.ts'),
      formats: ['cjs'],
      fileName: () => 'main.js',
    },
    outDir: 'dist/main',
    rollupOptions: {
      external: [
        'electron',
        'electron-updater',
        'electron-log',
        'path',
        'fs',
        'crypto',
        'child_process',
        'net',
        'os',
        'url',
      ],
    },
    minify: false,
    sourcemap: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'electron'),
    },
  },
})
