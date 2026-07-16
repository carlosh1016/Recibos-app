# Recibos App

PWA 100% offline para procesar fotos de facturas colombianas (OCR con
tesseract.js) y exportarlas a Excel (ExcelJS). Sin backend: todo corre en el
navegador, con IndexedDB (Dexie) como almacenamiento local.

## Requisitos

- Copiar tu plantilla a `public/templates/plantilla_facturas_compra.xlsx`
  (ver `public/templates/README.md`). Sin ella, `excel/export.ts` no tiene
  nada que cargar.
- Correr `npm run setup:ocr` una vez después de `npm install` (ver
  `scripts/setup-ocr-assets.mjs`): copia/descarga a `public/tesseract/` los
  assets que necesita tesseract.js (worker, core WASM, modelo de idioma
  'spa') para que el OCR funcione sin red. Requiere internet la primera vez
  (descarga ~2MB del modelo de idioma); después queda cacheado por el
  service worker.

## Desarrollo

```bash
npm install
npm run setup:ocr
npm run dev
```

## Comandos

- `npm run dev` — servidor de desarrollo con HMR.
- `npm run build` — typecheck (`tsc -b`) + build de producción con el service worker de la PWA.
- `npm run preview` — sirve el build de `dist/` localmente, tal cual quedaría en producción.
- `npm test` — pruebas unitarias (Vitest). Cubren `utils/dv.ts`, `utils/nit.ts` y `parser/reconcile.ts`.
- `npm run lint` — Oxlint.
- `npm run setup:ocr` — descarga/copia los assets de OCR a `public/tesseract/` (ver arriba).

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

1. `npm run build && npm run preview`.
2. Abrir la URL que imprime `preview` en Chrome/Edge.
3. DevTools → pestaña Application → Service Workers: confirmar que hay uno
   activado ("activated and is running") para ese origen.
4. DevTools → pestaña Network → marcar "Offline" (o cortar el wifi).
5. Recargar la página (F5): debe seguir cargando la app con normalidad — eso
   confirma que el service worker está sirviendo todo desde caché.
6. Opcional: DevTools → Application → Manifest, para revisar que el manifest
   ("Recibos App", tema azul) se detectó bien y probar "Add to home screen".
