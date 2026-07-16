# Recibos App

PWA 100% offline para procesar fotos de facturas colombianas (OCR con
tesseract.js) y exportarlas a Excel (ExcelJS). Sin backend: todo corre en el
navegador, con IndexedDB (Dexie) como almacenamiento local.

## Requisitos

- Copiar tu plantilla a `public/templates/plantilla_facturas_compra.xlsx`
  (ver `public/templates/README.md`). Sin ella, `excel/export.ts` no tiene
  nada que cargar.

## Desarrollo

```bash
npm install
npm run dev
```

## Comandos

- `npm run dev` — servidor de desarrollo con HMR.
- `npm run build` — typecheck (`tsc -b`) + build de producción con el service worker de la PWA.
- `npm run preview` — sirve el build de `dist/` localmente, tal cual quedaría en producción.
- `npm test` — pruebas unitarias (Vitest). Hoy cubren `utils/dv.ts` y `utils/nit.ts`.
- `npm run lint` — Oxlint.

## Estado del proyecto

Implementado y probado: modelo de datos (`types/`), esquema de IndexedDB
(`db/`), cálculo del DV y normalización de NIT (`utils/`), configuración de
Tailwind/PWA, y una `Home` funcional (crear sesión, listar sesiones).

Con stubs claros (buscar `TODO` en el código) listos para implementar
después: `ocr/tesseract.ts`, `parser/*`, `excel/export.ts`, y las páginas
`Capture`, `Review`, `Export`.

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
