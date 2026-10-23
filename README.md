# Recibos App

PWA para procesar fotos de facturas colombianas y exportarlas a Excel
(ExcelJS). Con internet, la foto se lee con un modelo de visión vía
OpenRouter (por defecto `google/gemini-2.5-flash-lite`) a través de las
funciones serverless de `api/` en Vercel; sin internet, cae al OCR local
(tesseract.js). Los datos viven solo en el dispositivo (IndexedDB vía Dexie).

## Variables de entorno (servidor)

Las funciones de `api/` necesitan estas variables, sin prefijo `VITE_` (nunca
llegan al navegador). En producción se configuran en el proyecto de Vercel; en
local, en `.env.local` (copia `.env.example`):

- `OPENROUTER_API_KEY` — clave de https://openrouter.ai/keys.
- `OPENROUTER_MODEL` — opcional; cambia el modelo sin tocar código.
- `APP_PASSWORD` — contraseña compartida del login.
- `APP_AUTH_SECRET` — secreto para firmar el token (`openssl rand -hex 32`).

`pnpm run dev` sirve también `/api/login` y `/api/extract` (plugin `apiLocal`
en `vite.config.ts`), así que no hace falta `vercel dev` ni otro servidor.

## Requisitos

- Copiar tu plantilla a `public/templates/plantilla_facturas_compra.xlsx`
  (ver `public/templates/README.md`). Sin ella, `excel/export.ts` no tiene
  nada que cargar.
- Correr `pnpm run setup:ocr` una vez después de `pnpm install` (ver
  `scripts/setup-ocr-assets.mjs`): copia/descarga a `public/tesseract/` los
  assets que necesita tesseract.js (worker, core WASM, modelo de idioma
  'spa') para que el OCR funcione sin red. Requiere internet la primera vez
  (descarga ~2MB del modelo de idioma); después queda cacheado por el
  service worker.

## Desarrollo

```bash
pnpm install
pnpm run setup:ocr
pnpm run dev
```

## Comandos

- `pnpm run dev` — servidor de desarrollo con HMR.
- `pnpm run build` — typecheck (`tsc -b`) + build de producción con el service worker de la PWA.
- `pnpm run preview` — sirve el build de `dist/` localmente, tal cual quedaría en producción.
- `pnpm test` — pruebas unitarias (Vitest). Cubren `utils/dv.ts`, `utils/nit.ts` y `parser/reconcile.ts`.
- `pnpm run lint` — Oxlint.
- `pnpm run setup:ocr` — descarga/copia los assets de OCR a `public/tesseract/` (ver arriba).

## Estado del proyecto

Implementado y probado: modelo de datos (`types/`), esquema de IndexedDB
(`db/`), cálculo del DV y normalización de NIT (`utils/`), OCR con tesseract.js
(`ocr/tesseract.ts`), preprocesamiento con opencv.js (`ocr/preprocess.ts`),
parser con reconciliación de valores y NIT del emisor (`parser/reconcile.ts`),
configuración de Tailwind/PWA, y el flujo `Home` → `Capture` funcionando de
punta a punta (foto → preprocesar → OCR → parsear → guardar en Dexie).

Con stubs claros (buscar `TODO` en el código) listos para implementar
después: `excel/export.ts`, y el detalle de las páginas `Review`/`Export`
(hoy listan los recibos guardados pero no tienen edición de campos).

## Verificar que funciona offline

1. `pnpm run build && pnpm run preview`.
2. Abrir la URL que imprime `preview` en Chrome/Edge.
3. DevTools → pestaña Application → Service Workers: confirmar que hay uno
   activado ("activated and is running") para ese origen.
4. DevTools → pestaña Network → marcar "Offline" (o cortar el wifi).
5. Recargar la página (F5): debe seguir cargando la app con normalidad — eso
   confirma que el service worker está sirviendo todo desde caché.
6. Opcional: DevTools → Application → Manifest, para revisar que el manifest
   ("Recibos App", tema azul) se detectó bien y probar "Add to home screen".
