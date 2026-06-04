import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('/react/') || id.includes('/react-dom/')) return 'react'
          if (id.includes('/@supabase/')) return 'supabase'
          if (id.includes('/leaflet/')) return 'leaflet'
          if (id.includes('/dexie/') || id.includes('/luxon/') || id.includes('/papaparse/')) return 'data'
          return 'vendor'
        },
      },
    },
  },
})
