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
      // Sin esto, `pnpm run dev` no genera manifest ni service worker en
      // absoluto (vite-plugin-pwa solo actúa en build por defecto). Si se
      // prueba la instalabilidad de la PWA en el celular apuntando al
      // servidor de dev (`vite --host`), el navegador no encuentra ningún
      // manifest real — y si además hay un service worker de una build
      // anterior ya instalado en ese mismo origen, ese SW viejo puede seguir
      // interceptando requests y sirviendo respuestas obsoletas. Con
      // devOptions.enabled, dev también sirve un manifest real para poder
      // probar "Agregar a pantalla de inicio" sin tener que hacer build cada vez.
      devOptions: {
        enabled: true,
        type: 'module',
      },
      manifest: {
        name: 'Recibos App',
        short_name: 'Recibos',
        description: 'Procesa fotos de facturas colombianas y expórtalas a Excel, 100% offline.',
        theme_color: '#1b4fd8',
        background_color: '#1b4fd8',
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
        // 'webmanifest' estaba faltando acá: sin él, manifest.webmanifest no
        // quedaba en el precache explícito de globPatterns (aunque
        // vite-plugin-pwa igual lo escribe a dist/, y funciona bien servido
        // en caliente vía `vite preview` — pero es más seguro que también
        // esté precacheado como el resto de los assets estáticos).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,xlsx,wasm,gz,webmanifest}'],
        // El chunk de opencv.js pesa ~13MB (es su runtime WASM) y los core de
        // tesseract.js ~2.8-3.9MB cada uno; el default de workbox (2MB) los
        // dejaría fuera del precache. 20MB da margen sin ser el límite real.
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
      },
    }),
  ],
})
