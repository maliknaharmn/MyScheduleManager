import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    rolldownOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy/index.html', import.meta.url)),
        terms: fileURLToPath(new URL('./terms/index.html', import.meta.url)),
        cookies: fileURLToPath(new URL('./cookies/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000', changeOrigin: false },
      '/health': { target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
