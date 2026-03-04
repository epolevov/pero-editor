import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig(async () => {
  const { default: tailwindcss } = await import('@tailwindcss/vite')

  return {
    root: path.resolve(__dirname, '../app-frontend'),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: path.resolve(__dirname, 'dist/renderer'),
      emptyOutDir: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '../app-frontend'),
      },
    },
    base: './',
  }
})
