import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND_HOST = process.env.BACKEND_HOST ?? 'localhost'
const BACKEND_PORT = process.env.BACKEND_PORT ?? '8000'
const FRONTEND_HOST = process.env.FRONTEND_HOST ?? '0.0.0.0'
const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT ?? '5173')

export default defineConfig({
  plugins: [react()],
  server: {
    host: FRONTEND_HOST,
    port: FRONTEND_PORT,
    // Use polling to avoid ENOSPC (inotify file watcher limit)
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      '/api': `http://${BACKEND_HOST}:${BACKEND_PORT}`,
      '/ws': {
        target: `ws://${BACKEND_HOST}:${BACKEND_PORT}`,
        ws: true,
      },
    },
  },
})
