import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// The API is always called on the same origin under /api/v1. In development
// Vite proxies it to the FastAPI backend (EMS_API_PROXY_TARGET, default :8030),
// so the session cookie and CSRF protection behave exactly as in production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  return {
    plugins: [react()],
    server: {
      port: 5180,
      strictPort: true,
      proxy: { '/api': { target: env.EMS_API_PROXY_TARGET || 'http://127.0.0.1:8030', changeOrigin: false } },
    },
    preview: { port: 5180, strictPort: true },
  }
})
