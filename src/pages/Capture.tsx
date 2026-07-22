import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import { preprocess } from '../ocr/preprocess'
import { precalentarWorkerOCR, reconocerTexto, terminarWorkerOCR } from '../ocr/tesseract'
import { reconcile } from '../parser/reconcile'

// Estados explícitos del pipeline por foto, para que la UI siempre muestre
// en qué etapa está en vez de quedarse "quieta sin errores visibles" (el bug
// original) mientras algo corre en segundo plano.
type Estado = 'idle' | 'preprocesando' | 'ocr' | 'parseando' | 'listo' | 'error'

// Estado de la cámara en vivo (getUserMedia). Si el dispositivo/permiso no la
// deja usar, se cae a un <input type=file> como respaldo (ver más abajo).
type EstadoCamara = 'iniciando' | 'activa' | 'no-disponible'

// Rangos de la barra global (0-100), uno por etapa. `preprocesando` cubre
// TANTO la carga de opencv.js como el pipeline en sí (ver el onProgress de
// preprocess(), que reporta 0/0.5/1 dentro de este mismo tramo).
const RANGO_PREPROCESO: [number, number] = [0, 30]
const RANGO_OCR: [number, number] = [30, 90]
const RANGO_PARSEO: [number, number] = [90, 100]

// Recorte de la tirilla dentro del cuadro de la cámara, como FRACCIONES del
// frame (no píxeles): un rectángulo angosto y alto, centrado, con la forma de
// una tirilla térmica. TODO lo que quede fuera de este rectángulo (el teclado,
// la mesa, el fondo) se descarta ANTES del OCR — esa es la causa raíz del OCR
// ruidoso: Tesseract veía la tirilla ocupando media imagen y perdía densidad
// de texto. El overlay que ve el usuario usa EXACTAMENTE estas mismas
// fracciones, así que "lo que encuadra es lo que se recorta".
const RECORTE = { x: 0.15, y: 0.05, w: 0.7, h: 0.9 } as const

function mapearProgreso(fraccion: number, [desde, hasta]: [number, number]): number {
  return desde + fraccion * (hasta - desde)
}

/**
 * Decodifica el archivo de la foto (respaldo con <input type=file>) en un
 * <img> ya listo para usar. `decode()` confirma que el bitmap terminó de
 * decodificarse antes de seguir.
 */
function cargarImagenDesdeArchivo(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      img
        .decode()
        .then(() => {
          URL.revokeObjectURL(url)
          resolve(img)
        })
        .catch((err: unknown) => {
          URL.revokeObjectURL(url)
          reject(err instanceof Error ? err : new Error('No se pudo decodificar la imagen'))
        })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo cargar la imagen capturada'))
    }
    img.src = url
  })
}

/** Convierte un canvas a Blob (JPEG) para guardarlo en Dexie como imageBlob. */
function canvasABlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('No se pudo serializar la imagen recortada'))
      },
      'image/jpeg',
      0.92,
    )
  })
}

/**
 * Recorta el frame actual del <video> al rectángulo de la tirilla (RECORTE) y
 * devuelve un canvas SOLO con esa región, a resolución nativa de la cámara.
 * Como el <video> se muestra con su aspecto natural (w-full h-auto, sin
 * object-fit que recorte), las fracciones del overlay mapean 1:1 a las
 * fracciones del frame intrínseco — lo que se ve encuadrado es lo que se corta.
 */
function recortarFrameDeVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) throw new Error('La cámara todavía no entrega imagen; espera un momento e intenta de nuevo')

  const sx = Math.round(RECORTE.x * vw)
  const sy = Math.round(RECORTE.y * vh)
  const sw = Math.round(RECORTE.w * vw)
  const sh = Math.round(RECORTE.h * vh)

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo obtener el contexto 2D para recortar la foto')
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas
}

export function Capture() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const [estado, setEstado] = useState<Estado>('idle')
  const [estadoCamara, setEstadoCamara] = useState<EstadoCamara>('iniciando')
  const [progresoGlobal, setProgresoGlobal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [recibosCapturados, setRecibosCapturados] = useState(0)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const procesando = estado === 'preprocesando' || estado === 'ocr' || estado === 'parseando'

  // Arranca la cámara trasera en vivo. Si falla (sin permiso, sin cámara, o
  // navegador de escritorio), se cae al respaldo de <input type=file>.
  useEffect(() => {
    let cancelado = false

    // Warm-up del worker de OCR en paralelo con la cámara: baja los MB del
    // modelo mientras el usuario encuadra, así la primera captura no arranca la
    // descarga desde cero (causa del "se queda cargando" sobre redes lentas).
    void precalentarWorkerOCR()

    async function iniciarCamara() {
      if (!navigator.mediaDevices?.getUserMedia) {
        console.warn('[capture] getUserMedia no está disponible; usando respaldo de archivo')
        setEstadoCamara('no-disponible')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            // Se pide alta resolución para que el recorte de la tirilla llegue
            // con más detalle al OCR (tinta térmica tenue necesita píxeles). Es
            // `ideal`, no `exact`: un teléfono que no lo soporte cae a lo que
            // pueda sin romper getUserMedia.
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        })
        if (cancelado) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {
            // Algunos navegadores exigen gesto del usuario; el <video> con
            // autoPlay/muted suele reproducir igual, así que no es fatal.
          })
        }
        console.log('[capture] cámara en vivo activa')
        setEstadoCamara('activa')
      } catch (err) {
        console.warn('[capture] no se pudo abrir la cámara en vivo, usando respaldo de archivo:', err)
        setEstadoCamara('no-disponible')
      }
    }

    void iniciarCamara()

    return () => {
      cancelado = true
      // El worker de tesseract.js (singleton de módulo) se libera al salir de
      // esta pantalla para soltar el WASM y el modelo de idioma de memoria.
      void terminarWorkerOCR()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  // Núcleo compartido del pipeline: preprocesa -> OCR -> parsea -> guarda.
  // Recibe la IMAGEN ya recortada (canvas de la cámara o <img> del archivo) y
  // el blob que se persiste como foto del recibo.
  const procesarImagen = useCallback(
    async (imagen: HTMLCanvasElement | HTMLImageElement, blob: Blob) => {
      if (!sessionId) return

      setError(null)
      setProgresoGlobal(0)
      const inicioTotal = performance.now()

      try {
        setEstado('preprocesando')
        const tPreproceso = performance.now()
        const canvasPreprocesado = await preprocess(imagen, (fraccion) => {
          setProgresoGlobal(mapearProgreso(fraccion, RANGO_PREPROCESO))
        })
        console.log(`[capture] preprocesamiento terminado en ${Math.round(performance.now() - tPreproceso)}ms`)

        setEstado('ocr')
        const tOcr = performance.now()
        const rawOCRText = await reconocerTexto(canvasPreprocesado, ({ progress }) => {
          setProgresoGlobal(mapearProgreso(progress, RANGO_OCR))
        })
        console.log(
          `[capture] OCR terminado en ${Math.round(performance.now() - tOcr)}ms, ` +
            `primeros 200 caracteres: ${rawOCRText.slice(0, 200)}`,
        )

        setEstado('parseando')
        setProgresoGlobal(mapearProgreso(0, RANGO_PARSEO))
        const tParseo = performance.now()
        const { data, status } = reconcile(rawOCRText)
        console.log(`[capture] parser terminado en ${Math.round(performance.now() - tParseo)}ms:`, { data, status })

        await db.receipts.add({
          sessionId: Number(sessionId),
          imageBlob: blob,
          rawOCRText,
          status,
          data,
          createdAt: new Date(),
        })
        console.log('[capture] recibo guardado en Dexie')
        console.log(`[capture] pipeline completo en ${Math.round(performance.now() - inicioTotal)}ms`)

        setProgresoGlobal(100)
        setEstado('listo')
        setRecibosCapturados((n) => n + 1)
      } catch (err) {
        console.error(`[capture] error tras ${Math.round(performance.now() - inicioTotal)}ms procesando el recibo:`, err)
        setEstado('error')
        setError(err instanceof Error ? err.message : 'Error desconocido procesando la foto')
      } finally {
        // Reanudar el preview en vivo para reencuadrar el siguiente recibo (si
        // se había pausado al capturar). No-op en el respaldo de <input file>,
        // donde no hay <video> montado.
        void videoRef.current?.play().catch(() => {})
      }
    },
    [sessionId],
  )

  // Captura desde la cámara EN VIVO: toma el frame actual, lo recorta al
  // recuadro de la tirilla y lo manda al pipeline.
  async function capturarDesdeCamara() {
    const video = videoRef.current
    if (!video || procesando) return
    try {
      console.log('[capture] capturando frame de la cámara en vivo')
      const canvasRecortado = recortarFrameDeVideo(video)
      // Congelar el preview AL INSTANTE: el frame ya se tomó (drawImage de
      // arriba es síncrono), así que se pausa el <video> para que quede
      // mostrando la foto capturada. Feedback claro de "ya se tomó, puedes
      // moverte" mientras corre el OCR. Se reanuda en procesarImagen() al
      // terminar (éxito o error), para reencuadrar el siguiente recibo.
      video.pause()
      const blob = await canvasABlob(canvasRecortado)
      console.log('[capture] frame recortado:', canvasRecortado.width, 'x', canvasRecortado.height, blob.size, 'bytes')
      await procesarImagen(canvasRecortado, blob)
    } catch (err) {
      console.error('[capture] error capturando frame de la cámara:', err)
      setEstado('error')
      setError(err instanceof Error ? err.message : 'No se pudo capturar la foto')
    }
  }

  // Respaldo: <input type=file>. Aquí NO se recorta (no sabemos dónde está la
  // tirilla dentro de una foto arbitraria) — se procesa la imagen completa.
  async function onFotoSeleccionada(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      console.log('[capture] foto seleccionada (respaldo):', file.name, file.size, 'bytes', file.type)
      const imagen = await cargarImagenDesdeArchivo(file)
      await procesarImagen(imagen, file)
    } catch (err) {
      console.error('[capture] error cargando la foto del archivo:', err)
      setEstado('error')
      setError(err instanceof Error ? err.message : 'No se pudo cargar la foto')
    }
  }

  const mensajeEstado: Record<Estado, string> = {
    idle: 'Encuadra la tirilla dentro del recuadro y toca "Capturar".',
    preprocesando: 'Foto tomada, procesando (mejorando la imagen)… ya puedes moverte.',
    ocr: 'Foto tomada, reconociendo texto (OCR)… ya puedes moverte.',
    parseando: 'Foto tomada, extrayendo los datos de la factura…',
    listo: '¡Recibo guardado! Puedes capturar otro.',
    error: 'Algo falló procesando esta foto.',
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold text-brand-700">Capturar recibos</h1>
      <p className="mt-1 text-sm text-gray-600">Sesión #{sessionId}</p>

      {estadoCamara !== 'no-disponible' ? (
        <>
          {/* Cámara EN VIVO: el <video> se muestra a su aspecto natural (sin
              object-fit que recorte), así el recuadro guía en % mapea 1:1 al
              frame que se recorta. El recuadro NO es decorativo: delimita
              exactamente la región que se le pasa al OCR. */}
          <div className="relative mt-6 overflow-hidden rounded-lg bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="block h-auto w-full"
            />

            {/* Overlay del recorte: oscurece lo de afuera y marca la tirilla. */}
            <div
              className="pointer-events-none absolute border-2 border-dashed border-brand-300"
              style={{
                left: `${RECORTE.x * 100}%`,
                top: `${RECORTE.y * 100}%`,
                width: `${RECORTE.w * 100}%`,
                height: `${RECORTE.h * 100}%`,
                boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
              }}
            >
              <span className="absolute left-1 top-1 h-5 w-5 border-l-2 border-t-2 border-brand-200" />
              <span className="absolute right-1 top-1 h-5 w-5 border-r-2 border-t-2 border-brand-200" />
              <span className="absolute bottom-1 left-1 h-5 w-5 border-b-2 border-l-2 border-brand-200" />
              <span className="absolute bottom-1 right-1 h-5 w-5 border-b-2 border-r-2 border-brand-200" />
            </div>

            {estadoCamara === 'iniciando' && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                Abriendo la cámara…
              </p>
            )}

            <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs font-medium text-white/90">
              Centra la tirilla dentro del recuadro
            </p>
          </div>

          <button
            type="button"
            onClick={() => void capturarDesdeCamara()}
            disabled={procesando || estadoCamara !== 'activa'}
            className="mt-4 w-full rounded bg-brand-600 px-4 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {procesando ? 'Procesando…' : 'Capturar'}
          </button>
        </>
      ) : (
        // Respaldo cuando no hay cámara en vivo (escritorio, permiso negado):
        // <input type=file>. capture="environment" sugiere la cámara trasera
        // en móviles que lleguen hasta acá.
        <label className={`mt-6 block ${procesando ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <div
            className={`relative mx-auto flex w-full max-w-[220px] items-center justify-center rounded-lg border-2 border-dashed ${
              procesando ? 'border-gray-200 bg-gray-50' : 'border-brand-400 bg-brand-50/40'
            }`}
            style={{ aspectRatio: '3 / 4' }}
          >
            <p className={`px-4 text-center text-sm font-medium ${procesando ? 'text-gray-400' : 'text-brand-700'}`}>
              {procesando ? 'Procesando…' : 'Toca para tomar la foto de la tirilla'}
            </p>
          </div>
          <span className="mt-2 block text-center text-sm text-gray-500">
            {procesando ? '' : 'La cámara en vivo no está disponible en este dispositivo'}
          </span>
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => void onFotoSeleccionada(e)}
            disabled={procesando}
            className="hidden"
          />
        </label>
      )}

      <div
        className={`mt-4 rounded p-3 text-sm ${
          estado === 'error'
            ? 'bg-red-50 text-red-700'
            : estado === 'listo'
              ? 'bg-green-50 text-green-700'
              : 'bg-gray-50 text-gray-600'
        }`}
      >
        <p>{mensajeEstado[estado]}</p>

        {(procesando || estado === 'error') && (
          <div className="mt-2 h-2 w-full rounded bg-gray-200">
            <div
              className={`h-2 rounded transition-all ${estado === 'error' ? 'bg-red-500' : 'bg-brand-600'}`}
              style={{ width: `${Math.round(progresoGlobal)}%` }}
            />
          </div>
        )}

        {estado === 'error' && error && <p className="mt-1 font-mono text-xs">{error}</p>}
      </div>

      <p className="mt-4 text-sm text-gray-600">Recibos capturados en esta sesión: {recibosCapturados}</p>

      <button
        type="button"
        onClick={() => navigate(`/review/${sessionId}`)}
        disabled={procesando}
        className="mt-2 w-full rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        Ir a revisar
      </button>
    </div>
  )
}
