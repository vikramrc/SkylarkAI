import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  base: '/',

  server: {
    port: 5175,
    host: true,
    proxy: {
      '/api/mastra': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      '/api/auth': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      '/api/phoenix': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        secure: false,
      },
      '/api': {
        target: 'https://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
      '/skylark-openai': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/skylark-openai/, '/api/skylark-openai')
      }
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
