import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: env.VITE_BASE_PATH || '/',
    server: {
      proxy: {
        '/api': 'http://127.0.0.1:8787',
      },
    },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': '/src',
      },
    },
    build: {
      rollupOptions: {
        output: {
        manualChunks: {
          'xyflow-canvas': ['@xyflow/react'],
          'firebase-auth': ['firebase/app', 'firebase/auth'],
          vendor: ['react', 'react-dom', '@tanstack/react-query', '@tanstack/react-router'],
        },
        },
      },
    },
  }
})
