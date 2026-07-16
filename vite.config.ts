import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'generateSW' precachea todo el build automáticamente (JS, CSS, la plantilla
      // .xlsx, el worker/wasm de tesseract.js) para que la app cargue con el navegador
      // en modo avión. Es la estrategia correcta acá: no necesitamos rutas de red que
      // interceptar a mano, todo el procesamiento ya es local.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Recibos App',
        short_name: 'Recibos',
        description: 'Procesa fotos de facturas colombianas y expórtalas a Excel, 100% offline.',
        theme_color: '#2563eb',
        background_color: '#2563eb',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // tesseract.js descarga sus archivos de traineddata (spa) la primera vez desde
        // un CDN; se cachean aquí con una estrategia "cache first" para que, una vez
        // descargados, el OCR funcione sin red. La primera ejecución SÍ requiere
        // internet para bajar el modelo de idioma.
        runtimeCaching: [
          {
            urlPattern: ({ url }: { url: URL }) =>
              url.origin.includes('tessdata') || url.pathname.endsWith('.traineddata.gz'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'tesseract-lang-data',
              expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // La plantilla de Excel y el resto de assets estáticos ya quedan precacheados
        // por defecto vía globPatterns (dist/**/*.{js,css,html,png,svg,xlsx,...}).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,xlsx}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
      },
    }),
  ],
})
