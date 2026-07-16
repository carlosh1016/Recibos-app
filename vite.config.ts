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
        // Todos los assets de OCR/visión (worker de tesseract.js, los .wasm
        // del core, el traineddata de 'spa', y el chunk de opencv.js) están
        // self-hosteados en public/ (ver scripts/setup-ocr-assets.mjs) en vez
        // de cargarse de un CDN externo. Con eso, precachearlos por
        // globPatterns como el resto del build alcanza — no hace falta una
        // regla de runtimeCaching aparte apuntando a un origen externo, y el
        // OCR funciona offline incluso en el primer uso tras instalar la PWA.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,xlsx,wasm,gz}'],
        // El chunk de opencv.js pesa ~13MB (es su runtime WASM) y los core de
        // tesseract.js ~2.8-3.9MB cada uno; el default de workbox (2MB) los
        // dejaría fuera del precache. 20MB da margen sin ser el límite real.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
})
