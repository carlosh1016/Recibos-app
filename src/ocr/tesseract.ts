/**
 * OCR 100% offline con tesseract.js (WebAssembly). El modelo de idioma 'spa'
 * se descarga la primera vez desde un CDN y luego el service worker lo cachea
 * (ver el `runtimeCaching` de vite-plugin-pwa en vite.config.ts) — solo esa
 * primera vez requiere internet; después el reconocimiento corre sin red.
 *
 * TODO implementar, usando tesseract.js:
 * - Opción simple (una llamada por foto): `import { recognize } from
 *   'tesseract.js'` y `const { data } = await recognize(imageBlob, 'spa')`.
 * - Opción más eficiente si se procesan varias fotos seguidas en la misma
 *   sesión de Capture: `createWorker('spa')` una vez, reusar
 *   `worker.recognize(imageBlob)` por cada foto, y `worker.terminate()` al
 *   salir de la pantalla de Capture (evita reinicializar el modelo cada vez).
 * - `data.text` es el texto plano que se guarda en `Receipt.rawOCRText`.
 *   `data.words`/`data.lines` también traen las posiciones (bounding boxes)
 *   de cada palabra, útil más adelante si se quiere resaltar sobre la foto
 *   qué región originó un campo extraído — no se usa todavía en el parser.
 */
export async function reconocerTexto(_imageBlob: Blob): Promise<string> {
  throw new Error('TODO: reconocerTexto no implementado')
}
