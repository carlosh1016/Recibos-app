import type { CV, Mat } from '@techstark/opencv-js'

// Preprocesa la foto de un recibo ANTES de pasarla a Tesseract: en fotos de
// celular (luz pareja, sombras, papel arrugado) mejorar contraste y
// binarizar antes del OCR sube mucho la tasa de acierto.
//
// El paquete real usado es '@techstark/opencv-js' (no el paquete npm
// literal "opencv.js", que es un build no oficial y mucho menos usado/
// mantenido). @techstark/opencv-js empaqueta el build oficial de OpenCV.js
// que publica el propio proyecto OpenCV, es lo que la comunidad usa en
// proyectos Vite/webpack, y trae tipos de TS reales.
//
// El import de este paquete es DINÁMICO (`await import(...)` dentro de
// cargarOpenCv(), no un `import` estático arriba del archivo): el bundle de
// OpenCV.js pesa ~13MB (es su runtime WASM). Con import estático quedaría
// fusionado en el chunk principal y retrasaría el primer render de TODA la
// app. Con import dinámico, Vite lo separa en su propio chunk que solo se
// descarga la primera vez que se llama a preprocess() — "carga diferida".

// El paquete no declara un tipo formal para su default export (es el módulo
// Emscripten crudo), así que se extiende el tipo `CV` (la superficie de la
// API de OpenCV que sí viene tipada) con las dos cosas que se usan del
// wrapper del módulo y que no son parte de la API de OpenCV en sí.
type CvModule = CV & {
  Mat?: unknown
  onRuntimeInitialized?: () => void
  // Ver el comentario en aplicarPipelineOpenCv: este build de opencv.js no
  // incluye el módulo "photo" (fastNlMeansDenoising no existe en runtime),
  // así que se tipa como opcional para poder feature-detectarlo sin `any`.
  fastNlMeansDenoising?: (src: Mat, dst: Mat, h: number) => void
}

let cvPromise: Promise<CvModule> | null = null

function cargarOpenCv(): Promise<CvModule> {
  if (!cvPromise) {
    cvPromise = import('@techstark/opencv-js').then((mod) => {
      const cv = mod.default as CvModule
      // El módulo Emscripten de OpenCV se compila/inicializa de forma
      // asíncrona por separado de la carga del archivo JS. Si `cv.Mat` ya
      // existe, el runtime WASM ya terminó de inicializar; si no, hay que
      // esperar el callback `onRuntimeInitialized` (patrón documentado por
      // el propio paquete).
      if (cv.Mat) return cv
      return new Promise<CvModule>((resolve) => {
        cv.onRuntimeInitialized = () => resolve(cv)
      })
    })
  }
  return cvPromise
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
 * cada Mat que ya no se necesita se libera a mano con `.delete()`. Es el
 * mismo tipo de disciplina que cerrar un archivo o una conexión en backend:
 * si no se llama `.delete()`, esa memoria queda reservada hasta que se
 * recargue la página.
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
    // El build de opencv.js de @techstark/opencv-js (basado en el build
    // oficial de docs.opencv.org) NO incluye el módulo "photo" de OpenCV,
    // que es donde vive fastNlMeansDenoising — se verificó inspeccionando el
    // bundle instalado: la función no existe en runtime, no es un typo. Se
    // usa bilateralFilter (sí incluido, vive en "imgproc") como sustituto:
    // no es matemáticamente equivalente a Non-Local Means, pero cumple el
    // mismo propósito de reducir ruido preservando bordes de texto, y evita
    // que todo el pipeline explote en producción.
    console.warn(
      '[preprocess] cv.fastNlMeansDenoising no está disponible en este build de opencv.js ' +
        '(módulo "photo" no incluido); usando cv.bilateralFilter como sustituto.',
    )
    cv.bilateralFilter(escalado, sinRuido, 9, 75, 75)
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

/** Fallback si opencv.js no carga/inicializa: gris + aumento simple de contraste con Canvas 2D. */
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
    // Luminancia perceptual (ponderada por canal, no un promedio simple).
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
 * Punto de entrada: preprocesa `input` y devuelve un canvas listo para
 * pasarle a reconocerTexto() (ver ocr/tesseract.ts). Si opencv.js falla al
 * cargar o inicializar (offline sin el chunk cacheado todavía, WASM no
 * soportado, etc.), cae al fallback de Canvas 2D en vez de romper el flujo
 * de captura completo — se loguea el error igual, nunca en silencio.
 */
export async function preprocess(input: EntradaImagen): Promise<HTMLCanvasElement> {
  try {
    console.log('[preprocess] cargando opencv.js...')
    const cv = await cargarOpenCv()
    console.log('[preprocess] opencv.js listo, aplicando pipeline...')
    const resultado = aplicarPipelineOpenCv(cv, input)
    console.log('[preprocess] pipeline de opencv.js terminado')
    return resultado
  } catch (error) {
    console.error('[preprocess] opencv.js falló, usando fallback de Canvas 2D:', error)
    return preprocesarConCanvas2D(input)
  }
}
