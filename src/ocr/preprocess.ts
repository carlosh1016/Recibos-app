import type { CV, Mat } from '@techstark/opencv-js'
import { withTimeout } from '../utils/withTimeout'

// CAUSA RAÍZ DEL CUELGUE: `@techstark/opencv-js` expone su default export
// como una Promise SIEMPRE — su factory interna (ver
// node_modules/@techstark/opencv-js/dist/opencv.js) es una función `async`,
// y toda función `async` devuelve una Promise al llamarla sin importar qué
// pasa adentro. El código anterior asumía el patrón "clásico" de los
// tutoriales de OpenCV.js (un objeto `cv` síncrono al que se le asigna
// `cv.onRuntimeInitialized = callback`) y hacía exactamente eso... sobre una
// Promise. Asignarle una propiedad a una Promise no falla ni tira error: es
// una propiedad más, que nadie lee. El callback nunca se disparaba, la
// Promise que devolvía cargarOpenCv() nunca se resolvía ni se rechazaba, y
// el `await` en preprocess() se quedaba esperando para siempre — sin error,
// sin log, sin nada, exactamente el síntoma reportado.
//
// El fix: no adivinar la forma del valor. Se soportan explícitamente los
// tres casos que la propia librería puede devolver (documentados en su
// README): (1) una Promise -> esperarla; (2) un Module ya listo
// (`cv.Mat` ya es función) -> usarlo directo; (3) un Module todavía
// inicializando -> esperar `onRuntimeInitialized`. Y en los tres casos se
// verifica con una función REAL (`typeof cv.Mat === 'function'`) que el
// resultado sirve, en vez de confiar en que el objeto exista.
//
// (Nota: NO se cambió a inyectar un <script src="opencv.js"> a mano como en
// los tutoriales clásicos de OpenCV.js, porque ese patrón asume un build
// "MODULARIZE=0" con un objeto `cv` síncrono desde el instante en que carga
// el script — y como se explicó arriba, el build que usa este proyecto no es
// de ese tipo: sea vía <script> o vía import(), `cv` sigue siendo una
// Promise. Cambiar el mecanismo de carga no habría arreglado nada; el bug
// estaba en cómo se interpretaba el valor resuelto, no en cómo se cargaba.)
//
// El import sigue siendo DINÁMICO (`await import(...)` adentro de
// cargarOpenCvSinTimeout(), no un import estático arriba del archivo): el
// bundle de OpenCV.js pesa ~13-15MB. Vite lo separa en su propio chunk,
// servido desde el MISMO origen que el resto de la app (nunca un CDN externo
// — Vite lo copia al build, no lo referencia por URL remota), que solo se
// descarga la primera vez que se llama a preprocess().
type CvModule = CV & {
  Mat?: unknown
  onRuntimeInitialized?: () => void
  // Ver el comentario en aplicarPipelineOpenCv: este build de opencv.js no
  // incluye el módulo "photo" (fastNlMeansDenoising no existe en runtime),
  // así que se tipa como opcional para poder feature-detectarlo sin `any`.
  fastNlMeansDenoising?: (src: Mat, dst: Mat, h: number) => void
}

const CARGA_OPENCV_TIMEOUT_MS = 15_000

function cvListo(cv: unknown): cv is CvModule {
  return typeof (cv as { Mat?: unknown } | undefined)?.Mat === 'function'
}

let cvPromise: Promise<CvModule> | null = null

function cargarOpenCvSinTimeout(): Promise<CvModule> {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then((mod) => {
      const valor = mod.default as CvModule | Promise<CvModule>

      // Caso 1 (el real para este build): el default export ES una Promise.
      if (valor instanceof Promise) {
        return valor.then((cv) => {
          if (!cvListo(cv)) throw new Error('opencv.js resolvió pero cv.Mat no es una función')
          return cv
        })
      }

      // Caso 2: ya está inicializado (se deja por compatibilidad si algún
      // día se cambia a un build que sí siga el patrón clásico). Se chequea
      // `typeof valor.Mat === 'function'` inline en vez de con cvListo():
      // TS ya sabe que `valor` es CvModule acá (no `unknown`), así que pasar
      // por un type predicate genérico hace que la rama "falsa" se infiera
      // como `never` en vez de seguir siendo CvModule.
      if (typeof valor.Mat === 'function') return valor

      // Caso 3: objeto todavía inicializando -> registrar el callback ANTES
      // de que el runtime termine (acá ya está inyectado/cargado el script,
      // así que no hay condición de carrera real, pero el orden se mantiene
      // igual de explícito que si la hubiera).
      return new Promise<CvModule>((resolve, reject) => {
        valor.onRuntimeInitialized = () => {
          if (cvListo(valor)) resolve(valor)
          else reject(new Error('opencv.js inicializó pero cv.Mat no es una función'))
        }
      })
    })
  }
  return cvPromise
}

/** Carga (una sola vez, cacheada a nivel de módulo) con timeout de 15s. */
function cargarOpenCv(): Promise<CvModule> {
  return withTimeout(cargarOpenCvSinTimeout(), CARGA_OPENCV_TIMEOUT_MS, `opencv.js no cargó en ${CARGA_OPENCV_TIMEOUT_MS}ms`)
}

type EntradaImagen = HTMLCanvasElement | HTMLImageElement | ImageData

function dimensiones(input: EntradaImagen): { ancho: number; alto: number } {
  if (input instanceof ImageData) return { ancho: input.width, alto: input.height }
  if (input instanceof HTMLImageElement) return { ancho: input.naturalWidth, alto: input.naturalHeight }
  return { ancho: input.width, alto: input.height }
}

/**
 * Pipeline pedido: gris -> escalado x2 (INTER_CUBIC) -> denoise -> CLAHE ->
 * umbral adaptativo gaussiano. Cada paso intermedio es un `cv.Mat`, que vive
 * en el heap de WASM, no en el heap de JS con garbage collector — por eso
 * cada Mat que ya no se necesita se libera a mano con `.delete()`.
 */
function aplicarPipelineOpenCv(cv: CvModule, input: EntradaImagen): HTMLCanvasElement {
  const src = input instanceof ImageData ? cv.matFromImageData(input) : cv.imread(input)

  const gris = new cv.Mat()
  cv.cvtColor(src, gris, cv.COLOR_RGBA2GRAY, 0)
  src.delete()

  const escalado = new cv.Mat()
  cv.resize(gris, escalado, new cv.Size(gris.cols * 2, gris.rows * 2), 0, 0, cv.INTER_CUBIC)
  gris.delete()

  const sinRuido = new cv.Mat()
  if (typeof cv.fastNlMeansDenoising === 'function') {
    cv.fastNlMeansDenoising(escalado, sinRuido, 10)
  } else {
    // El build de opencv.js de @techstark/opencv-js NO incluye el módulo
    // "photo" de OpenCV, donde vive fastNlMeansDenoising — se verificó
    // inspeccionando el bundle instalado, no es un typo. cv.medianBlur(ksize
    // 3) como sustituto: más simple que bilateralFilter, buen compromiso
    // para quitar ruido puntual de una foto de celular sin difuminar bordes
    // de texto de más.
    console.warn(
      '[preprocess] cv.fastNlMeansDenoising no está disponible en este build de opencv.js ' +
        '(módulo "photo" no incluido); usando cv.medianBlur(ksize=3) como sustituto.',
    )
    cv.medianBlur(escalado, sinRuido, 3)
  }
  escalado.delete()

  const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8))
  const conClahe = new cv.Mat()
  clahe.apply(sinRuido, conClahe)
  clahe.delete()
  sinRuido.delete()

  const binaria = new cv.Mat()
  cv.adaptiveThreshold(conClahe, binaria, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, 31, 15)
  conClahe.delete()

  const canvasSalida = document.createElement('canvas')
  cv.imshow(canvasSalida, binaria)
  binaria.delete()

  return canvasSalida
}

/** Fallback si opencv.js no carga/inicializa/expira: gris + contraste con Canvas 2D. */
function preprocesarConCanvas2D(input: EntradaImagen): HTMLCanvasElement {
  const { ancho, alto } = dimensiones(input)
  const canvas = document.createElement('canvas')
  canvas.width = ancho
  canvas.height = alto

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('No se pudo obtener el contexto 2D del canvas para el fallback de preprocesamiento')
  }

  if (input instanceof ImageData) {
    ctx.putImageData(input, 0, 0)
  } else {
    ctx.drawImage(input, 0, 0, ancho, alto)
  }

  const imageData = ctx.getImageData(0, 0, ancho, alto)
  const pixeles = imageData.data
  const CONTRASTE = 1.4
  for (let i = 0; i < pixeles.length; i += 4) {
    const gris = 0.299 * pixeles[i] + 0.587 * pixeles[i + 1] + 0.114 * pixeles[i + 2]
    const conContraste = Math.min(255, Math.max(0, (gris - 128) * CONTRASTE + 128))
    pixeles[i] = conContraste
    pixeles[i + 1] = conContraste
    pixeles[i + 2] = conContraste
  }
  ctx.putImageData(imageData, 0, 0)

  return canvas
}

/**
 * `onProgress` reporta una fracción 0..1 en dos saltos (no hay una API nativa
 * de progreso incremental para cargar/inicializar un módulo WASM, así que no
 * se simulan valores intermedios): 0 al empezar, 0.5 apenas se sabe si
 * opencv.js cargó o si tocó ir al fallback, 1 cuando el canvas de salida ya
 * está listo. Capture.tsx mapea esto al tramo 0-30% de su barra global.
 *
 * Punto de entrada: preprocesa `input` y devuelve un canvas listo para
 * reconocerTexto() (ver ocr/tesseract.ts). El preprocesamiento es una MEJORA,
 * no un requisito — si opencv.js falla, tarda más de 15s, o cualquier otro
 * error, esta función SIEMPRE resuelve igual (nunca se queda esperando, nunca
 * revienta el pipeline) cayendo al fallback de Canvas 2D. El error se loguea
 * igual, nunca en silencio.
 */
export async function preprocess(
  input: EntradaImagen,
  onProgress?: (fraccion: number) => void,
): Promise<HTMLCanvasElement> {
  const inicio = performance.now()
  onProgress?.(0)
  try {
    console.log('[preprocess] cargando opencv.js...')
    const cargaInicio = performance.now()
    const cv = await cargarOpenCv()
    console.log(`[preprocess] opencv.js cargado en ${Math.round(performance.now() - cargaInicio)}ms`)
    onProgress?.(0.5)

    const resultado = aplicarPipelineOpenCv(cv, input)
    console.log(`[preprocess] terminado (con opencv.js) en ${Math.round(performance.now() - inicio)}ms total`)
    onProgress?.(1)
    return resultado
  } catch (error) {
    console.error(
      `[preprocess] opencv.js falló tras ${Math.round(performance.now() - inicio)}ms, ` +
        'usando fallback de Canvas 2D:',
      error,
    )
    onProgress?.(0.5)
    const fallbackInicio = performance.now()
    const resultado = preprocesarConCanvas2D(input)
    console.log(`[preprocess] fallback de Canvas 2D terminado en ${Math.round(performance.now() - fallbackInicio)}ms`)
    onProgress?.(1)
    return resultado
  }
}
