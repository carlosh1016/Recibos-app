import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ProgressBar, Screen } from '../components'
import { db } from '../db/db'
import { preprocess } from '../ocr/preprocess'
import { precalentarWorkerOCR, reconocerTexto, terminarWorkerOCR } from '../ocr/tesseract'
import { reconcile } from '../parser/reconcile'
import { extraerConLLM, llmDisponible } from '../extract/geminiExtract'

// Estados explícitos del pipeline por foto, para que la UI siempre muestre
// en qué etapa está en vez de quedarse "quieta sin errores visibles" (el bug
// original) mientras algo corre en segundo plano.
type Estado = 'idle' | 'llm' | 'preprocesando' | 'ocr' | 'parseando' | 'listo' | 'error'

// Estado de la cámara en vivo (getUserMedia). Si el dispositivo/permiso no la
// deja usar, se cae a un <input type=file> como respaldo (ver más abajo).
type EstadoCamara = 'iniciando' | 'activa' | 'no-disponible'

// Qué motor leyó el ÚLTIMO recibo. La app cae de la ruta IA a Tesseract en
// silencio cuando el proxy falla, y eso confundía: los datos salían peores sin
// ninguna señal visible de por qué. Mostrarlo convierte el fallback en
// información en vez de en un misterio.
type Motor = 'ia' | 'ocr'

// Rangos de la barra global (0-100), uno por etapa. `preprocesando` cubre
// TANTO la carga de opencv.js como el pipeline en sí (ver el onProgress de
// preprocess(), que reporta 0/0.5/1 dentro de este mismo tramo).
const RANGO_PREPROCESO: [number, number] = [0, 30]
const RANGO_OCR: [number, number] = [30, 90]
const RANGO_PARSEO: [number, number] = [90, 100]

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
 * Captura el frame actual del <video> completo, sin recorte, a resolución
 * nativa de la cámara.
 */
function capturarFrameDeVideo(video: HTMLVideoElement): HTMLCanvasElement {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) throw new Error('La cámara todavía no entrega imagen; espera un momento e intenta de nuevo')

  const canvas = document.createElement('canvas')
  canvas.width = vw
  canvas.height = vh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo obtener el contexto 2D para capturar la foto')
  ctx.drawImage(video, 0, 0, vw, vh)
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
  const [motor, setMotor] = useState<Motor | null>(null)
  const [nombreSesion, setNombreSesion] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const procesando =
    estado === 'llm' || estado === 'preprocesando' || estado === 'ocr' || estado === 'parseando'

  // El contador arranca con las facturas que YA tiene la sesión, no en cero: al
  // volver a una sesión vieja los recibos siguen en IndexedDB, y si el contador
  // dijera 0 el botón de revisar no aparecería y la sesión se vería vacía
  // aunque tuviera todo su trabajo guardado.
  useEffect(() => {
    async function cargarSesion() {
      if (!sessionId) return
      const id = Number(sessionId)
      const [sesion, cuantos] = await Promise.all([
        db.sessions.get(id),
        db.receipts.where('sessionId').equals(id).count(),
      ])
      setNombreSesion(sesion?.name ?? null)
      setRecibosCapturados(cuantos)
    }
    void cargarSesion()
  }, [sessionId])

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
        // Ruta ONLINE (LLM con visión): si hay proxy configurado e internet, se
        // intenta primero — lee la tirilla mucho mejor y devuelve los campos ya
        // estructurados. Si falla por cualquier razón, se cae al pipeline offline
        // de Tesseract de abajo (no se re-lanza el error aquí).
        if (llmDisponible() && navigator.onLine) {
          try {
            setEstado('llm')
            setProgresoGlobal(40)
            const tLlm = performance.now()
            const { data, status, raw } = await extraerConLLM(blob)
            console.log(`[capture] LLM terminó en ${Math.round(performance.now() - tLlm)}ms:`, { data, status })

            await db.receipts.add({
              sessionId: Number(sessionId),
              imageBlob: blob,
              rawOCRText: raw,
              status,
              data,
              createdAt: new Date(),
            })
            console.log('[capture] recibo guardado en Dexie (ruta LLM)')

            setProgresoGlobal(100)
            setEstado('listo')
            setMotor('ia')
            setRecibosCapturados((n) => n + 1)
            return
          } catch (llmErr) {
            console.warn('[capture] ruta LLM falló, usando Tesseract como respaldo:', llmErr)
            // continúa al pipeline offline de abajo
          }
        }

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
        setMotor('ocr')
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

  // Captura desde la cámara EN VIVO: toma el frame actual completo (sin
  // recorte) y lo manda al pipeline.
  async function capturarDesdeCamara() {
    const video = videoRef.current
    if (!video || procesando) return
    try {
      console.log('[capture] capturando frame de la cámara en vivo')
      const canvas = capturarFrameDeVideo(video)
      // Congelar el preview AL INSTANTE: el frame ya se tomó (drawImage de
      // arriba es síncrono), así que se pausa el <video> para que quede
      // mostrando la foto capturada. Feedback claro de "ya se tomó, puedes
      // moverte" mientras corre el OCR. Se reanuda en procesarImagen() al
      // terminar (éxito o error), para reencuadrar el siguiente recibo.
      video.pause()
      const blob = await canvasABlob(canvas)
      console.log('[capture] frame capturado:', canvas.width, 'x', canvas.height, blob.size, 'bytes')
      await procesarImagen(canvas, blob)
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
    idle: 'Encuadra la factura y toca "Capturar".',
    llm: 'Foto tomada, leyendo la factura con IA… ya puedes moverte.',
    preprocesando: 'Foto tomada, procesando (mejorando la imagen)… ya puedes moverte.',
    ocr: 'Foto tomada, reconociendo texto (OCR)… ya puedes moverte.',
    parseando: 'Foto tomada, extrayendo los datos de la factura…',
    listo: '¡Recibo guardado! Puedes capturar otro.',
    error: 'Algo falló procesando esta foto.',
  }

  return (
    <Screen
      titulo="Capturar facturas"
      subtitulo={nombreSesion ?? 'Encuadra la factura y toca Capturar'}
      volverA="/"
      accion={
        <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {recibosCapturados} guardada{recibosCapturados === 1 ? '' : 's'}
        </span>
      }
    >
      {estadoCamara !== 'no-disponible' ? (
        <>
          {/* Cámara EN VIVO, a pantalla completa dentro de la tarjeta: se
              captura la foto entera, sin recorte ni recuadro guía. */}
          <div className="relative overflow-hidden rounded-xl bg-black">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="block h-auto w-full"
            />

            {estadoCamara === 'iniciando' && (
              <p className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
                Abriendo la cámara…
              </p>
            )}
          </div>

          <Button
            fullWidth
            className="mt-4"
            onClick={() => void capturarDesdeCamara()}
            disabled={procesando || estadoCamara !== 'activa'}
          >
            {procesando ? 'Procesando…' : 'Capturar'}
          </Button>
        </>
      ) : (
        // Respaldo cuando no hay cámara en vivo (escritorio, permiso negado):
        // <input type=file>. capture="environment" sugiere la cámara trasera
        // en móviles que lleguen hasta acá.
        <label className={`block ${procesando ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
          <div
            className={`relative mx-auto flex w-full max-w-[220px] items-center justify-center rounded-xl border-2 border-dashed ${
              procesando ? 'border-slate-200 bg-slate-100' : 'border-brand-400 bg-brand-50'
            }`}
            style={{ aspectRatio: '3 / 4' }}
          >
            <p className={`px-4 text-center text-sm font-medium ${procesando ? 'text-slate-400' : 'text-brand-700'}`}>
              {procesando ? 'Procesando…' : 'Toca para tomar la foto de la tirilla'}
            </p>
          </div>
          <span className="mt-2 block text-center text-sm text-slate-500">
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
        className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
          estado === 'error'
            ? 'border-red-200 bg-red-50 text-red-700'
            : estado === 'listo'
              ? 'border-green-200 bg-green-50 text-green-800'
              : 'border-slate-200 bg-white text-slate-600'
        }`}
      >
        <p>{mensajeEstado[estado]}</p>

        {(procesando || estado === 'error') && (
          <div className="mt-2">
            <ProgressBar valor={progresoGlobal} tono={estado === 'error' ? 'error' : 'progreso'} />
          </div>
        )}

        {/* Qué motor leyó la última factura: la IA es mucho más precisa, así que
            si aparece "OCR local" la usuaria sabe que puede haber más que
            corregir en Revisar (y que quizá se cayó internet). */}
        {estado === 'listo' && motor && (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
            <span
              className={`h-1.5 w-1.5 rounded-full ${motor === 'ia' ? 'bg-green-500' : 'bg-amber-500'}`}
              aria-hidden="true"
            />
            {motor === 'ia' ? 'Leída con IA' : 'Leída con OCR local — revisa los datos con cuidado'}
          </p>
        )}

        {estado === 'error' && error && <p className="mt-2 font-mono text-xs">{error}</p>}
      </div>

      {/* Solo aparece cuando ya hay algo que revisar: un botón que no lleva a
          ninguna parte es ruido en la pantalla más usada de la app. */}
      {recibosCapturados > 0 && (
        <Button
          variant="secondary"
          fullWidth
          className="mt-4"
          onClick={() => navigate(`/review/${sessionId}`)}
          disabled={procesando}
        >
          Revisar {recibosCapturados} factura{recibosCapturados === 1 ? '' : 's'}
        </Button>
      )}
    </Screen>
  )
}
