import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => ({
  // Keep Make preview/deploy URL behavior while using standard Vite plugins.
  base: process.env.FIGMA_PUBLIC_URL ? `${process.env.FIGMA_PUBLIC_URL}/` : '/',
  build: {
    sourcemap: mode === 'development' ? 'inline' : false,
    minify: mode !== 'development',
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: process.env.FIGMA_DEV_SERVER_HOST || '0.0.0.0',
    port: Number.parseInt(process.env.PORT || '8443'),
    strictPort: true,
    watch: { ignored: ['**/.figma/**'] },
  },
  preview: {
    host: process.env.FIGMA_DEV_SERVER_HOST || '0.0.0.0',
    port: Number.parseInt(process.env.PORT || '8443'),
  },
}))
