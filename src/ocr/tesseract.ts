import { createWorker, PSM, type Worker } from 'tesseract.js'

export interface OcrProgress {
  status: string
  progress: number // 0..1
}

export type OcrProgressListener = (info: OcrProgress) => void

// CAUSA RAÍZ del bug original: este archivo era 100% un stub (solo un
// `throw new Error('TODO...')`) y Capture.tsx nunca lo llamaba — el
// onChange del input de foto solo hacía `console.log('TODO...')`. Por eso no
// pasaba nada al elegir una foto: ni siquiera se intentaba correr OCR.
//
// tesseract.js 7.0.0 (ver package.json) ya NO usa el flujo de v4
// (`worker.loadLanguage()` + `worker.initialize()`): `createWorker(langs)`
// hace todo internamente (load + loadLanguage + initialize) y resuelve un
// worker listo para usar. Llamar a esos métodos viejos en v7 directamente
// tiraría error de "not a function".
//
// Un solo worker para toda la sesión de captura: crearlo tarda varios
// segundos (baja/inicializa el WASM + el modelo de idioma), así que se crea
// UNA sola vez (module-level singleton) y se reusa para cada foto — nunca un
// worker nuevo por recibo.
let workerPromise: Promise<Worker> | null = null

// El logger de progreso se fija una sola vez al crear el worker (es una
// opción de createWorker, no de cada recognize()), pero cada llamada a
// reconocerTexto() puede querer reportar a un callback distinto (ej. una
// barra de progreso por foto). Por eso el logger fijo delega a esta variable
// mutable, que reconocerTexto() actualiza antes/después de cada job. Como el
// flujo de Capture procesa una foto a la vez (nunca en paralelo), no hay
// condición de carrera real entre llamadas.
let listenerActual: OcrProgressListener | null = null

function crearWorker(): Promise<Worker> {
  console.log('[ocr] creando worker de tesseract.js (spa)...')
  return createWorker('spa', undefined, {
    // Self-hosteados en public/tesseract/ (ver scripts/setup-ocr-assets.mjs)
    // en vez de dejar los defaults de tesseract.js, que apuntan a
    // cdn.jsdelivr.net: sin esto, el OCR requeriría internet la primera vez
    // que se usa, rompiendo la promesa de "100% offline" de la PWA incluso
    // en una instalación fresca sin conectividad. Al ser rutas propias del
    // origen, además quedan precacheadas por el service worker (ver
    // vite.config.ts) igual que el resto de la app.
    workerPath: '/tesseract/worker.min.js',
    corePath: '/tesseract/core',
    langPath: '/tesseract/lang',
    logger: (m) => {
      console.log(`[ocr] ${m.status} ${(m.progress * 100).toFixed(0)}%`)
      listenerActual?.({ status: m.status, progress: m.progress })
    },
  }).then(async (worker) => {
    // Mejora 2: 'spa' ya se fija en createWorker(). psm '4' = columna única
    // (los recibos suelen tener texto en un bloque angosto), dpi 300 porque
    // Tesseract asume 70 dpi por defecto si no se le dice nada, lo que
    // degrada mucho la precisión en fotos de celular de alta resolución.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SINGLE_COLUMN,
      user_defined_dpi: '300',
    })
    console.log('[ocr] worker listo')
    return worker
  })
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = crearWorker().catch((error: unknown) => {
      // Si la creación falla (ej. no se pudieron cargar los assets), no
      // dejar cacheada una promesa rota: el próximo intento debe poder
      // volver a crear el worker desde cero en vez de quedar roto para
      // siempre hasta recargar la página.
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

/**
 * Corre OCR sobre una imagen YA preprocesada (ver ocr/preprocess.ts — nunca
 * se le pasa la foto cruda directamente, ver Mejora 2 del encargo). Acepta
 * lo mismo que tesseract.js soporta de forma nativa: un Blob/File o un
 * <canvas> (lo que devuelve preprocess()).
 */
export async function reconocerTexto(
  image: Blob | HTMLCanvasElement,
  onProgress?: OcrProgressListener,
): Promise<string> {
  console.log('[ocr] iniciando reconocimiento de texto...')
  const worker = await getWorker()

  listenerActual = onProgress ?? null
  try {
    const { data } = await worker.recognize(image)
    console.log(`[ocr] texto reconocido (${data.text.length} caracteres, confianza ${data.confidence})`)
    return data.text
  } catch (error) {
    // Nunca tragarse el error: se relanza tal cual para que Capture.tsx lo
    // muestre en la UI, pero se deja un rastro claro en consola con el
    // contexto de en qué etapa pasó.
    console.error('[ocr] recognize() falló', error)
    throw error
  } finally {
    listenerActual = null
  }
}

/** Se llama al desmontar la pantalla de Capture: libera el worker (WASM + memoria del modelo). */
export async function terminarWorkerOCR(): Promise<void> {
  if (!workerPromise) return
  console.log('[ocr] terminando worker')
  const worker = await workerPromise
  workerPromise = null
  await worker.terminate()
}
