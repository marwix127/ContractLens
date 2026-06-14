import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy de las llamadas al backend Express (evita CORS en desarrollo).
    proxy: {
      '/contracts': 'http://localhost:3000'
    }
  }
})
