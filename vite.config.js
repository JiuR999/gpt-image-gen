import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/pearapi': {
        target: 'https://api.pearapi.ai',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/pearapi/, ''),
      },
    },
  },
})
