import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Sirve las funciones de api/*.ts (las mismas que despliega Vercel) dentro de
 * `pnpm run dev`, para no necesitar `vercel dev` ni un servidor aparte en
 * local. Cada función es un `handler(Request): Response` estándar, así que
 * basta con traducir el request/response de Node a los de Web Fetch.
 * Los nombres que empiezan con `_` (api/_lib) se excluyen, igual que en Vercel.
 */
function apiLocal(): Plugin {
  return {
    name: 'api-local',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const ruta = /^\/api\/([a-z][\w-]*)$/.exec(url.pathname)
        if (!ruta) return next()

        try {
          const mod = (await server.ssrLoadModule(`/api/${ruta[1]}.ts`)) as {
            default: (request: Request) => Promise<Response>
          }

          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) {
            if (typeof v === 'string') headers.set(k, v)
          }

          const response = await mod.default(
            new Request(url, {
              method: req.method,
              headers,
              body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
            }),
          )

          res.statusCode = response.status
          response.headers.forEach((valor, clave) => res.setHeader(clave, valor))
          res.end(Buffer.from(await response.arrayBuffer()))
        } catch (err) {
          next(err)
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // En dev, las funciones de api/ leen sus secretos (OPENROUTER_API_KEY,
  // APP_PASSWORD, APP_AUTH_SECRET) de process.env, igual que en Vercel. Vite
  // solo expone al CLIENTE las variables con prefijo VITE_, así que cargar
  // todas acá (prefijo '') no las mete en el bundle del navegador.
  if (command === 'serve') Object.assign(process.env, loadEnv(mode, process.cwd(), ''))

  return {
    plugins: [
      apiLocal(),
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
  }
})
