import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
      },
      manifest: {
        name: '개발4팀 일정 및 근태 보드',
        short_name: '개발4팀 일정',
        description: '태웅메디칼 개발4팀 통합 일정 및 근태 워크스페이스',
        theme_color: '#111827',
        background_color: '#F4F5F7',
        display: 'standalone',
        icons: [
          {
            src: 'icon-192x192.jpg',
            sizes: '192x192',
            type: 'image/jpeg'
          },
          {
            src: 'icon-512x512.jpg',
            sizes: '512x512',
            type: 'image/jpeg'
          }
        ]
      }
    })
  ],
})
