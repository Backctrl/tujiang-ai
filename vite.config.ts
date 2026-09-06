import path from 'path'
import { defineConfig } from '@lark-apaas/coding-preset-vite-react'

export default defineConfig({
  server: {
    proxy: { '/api': { target: process.env.TUJIANG_API_TARGET || 'http://127.0.0.1:3100', changeOrigin: false } },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
})
