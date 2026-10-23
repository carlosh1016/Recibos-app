import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ProgressBar, Screen } from '../components'
import { db } from '../db/db'
import { preprocess } from '../ocr/preprocess'
import { precalentarWorkerOCR, reconocerTexto, terminarWorkerOCR } from '../ocr/tesseract'
import { reconcile } from '../parser/reconcile'
import { extraerConLLM, llmDisponible } from '../extract/llmExtract'
import { cajaAPixeles, type Rect } from '../extract/caja'
import type { Receipt } from '../types'

// Estados explícitos del pipeline por foto, para que la UI siempre muestre
// en qué etapa está en vez de quedarse "quieta sin errores visibles" (el bug
// original) mientras algo corre en segundo plano.
type Estado = 'idle' | 'llm' | 'preprocesando' | 'ocr' | 'parseando' | 'listo' | 'error'

// Estado de la cámara en vivo (getUserMedia). Si el dispositivo/permiso no la
// deja usar, se cae a un <input type=file> como respaldo (ver más abajo).
type EstadoCamara = 'iniciando' | 'activa' | 'no-disponible'

// Qué motor leyó el ÚLTIMO recibo. La app cae de la ruta IA a Tesseract en
// silencio cuando la IA falla, y eso confundía: los datos salían peores sin
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

// Lado más largo con el que se manda/guarda una foto elegida desde archivo. La
// de un celular puede pesar 4-8MB (12+ megapíxeles) y en base64 pasarse del
// límite de body de Vercel (~4.5MB); 2560 es lo mismo que se le pide a la
// cámara en vivo (ver iniciarCamara), así que la IA ve el mismo detalle.
const LADO_MAXIMO_ARCHIVO = 2560

/**
 * Redibuja una foto de archivo en un canvas, achicándola si pasa de
 * LADO_MAXIMO_ARCHIVO. Además deja la foto ya "derecha": el navegador aplica la
 * orientación EXIF al dibujarla, así que lo que ve la IA y las coordenadas del
 * recorte (ver recortarImagen) se refieren a la misma imagen.
 */
function imagenACanvas(img: HTMLImageElement): HTMLCanvasElement {
  const escala = Math.min(1, LADO_MAXIMO_ARCHIVO / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * escala)
  canvas.height = Math.round(img.naturalHeight * escala)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo obtener el contexto 2D para preparar la foto')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Recorta la región `rect` (en píxeles) del canvas y la devuelve como JPEG. */
function recortarImagen(canvas: HTMLCanvasElement, rect: Rect): Promise<Blob> {
  const recorte = document.createElement('canvas')
  recorte.width = rect.ancho
  recorte.height = rect.alto
  const ctx = recorte.getContext('2d')
  if (!ctx) return Promise.reject(new Error('No se pudo obtener el contexto 2D para recortar'))
  ctx.drawImage(canvas, rect.x, rect.y, rect.ancho, rect.alto, 0, 0, rect.ancho, rect.alto)
  return canvasABlob(recorte)
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
  // Cuántas facturas salieron de la ÚLTIMA foto (puede traer varias), para el
  // mensaje de "listo".
  const [ultimasGuardadas, setUltimasGuardadas] = useState(1)
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

  // Núcleo compartido del pipeline: IA (o preprocesa -> OCR -> parsea) ->
  // guarda. Recibe la foto completa como canvas (de la cámara, o la de archivo
  // ya redibujada por imagenACanvas) y el blob JPEG de ese mismo canvas.
  const procesarImagen = useCallback(
    async (imagen: HTMLCanvasElement, blob: Blob) => {
      if (!sessionId) return

      setError(null)
      setProgresoGlobal(0)
      const inicioTotal = performance.now()

      try {
        // Ruta ONLINE (LLM con visión): si hay sesión iniciada e internet, se
        // intenta primero — lee la tirilla mucho mejor y devuelve los campos ya
        // estructurados. Si falla por cualquier razón, se cae al pipeline offline
        // de Tesseract de abajo (no se re-lanza el error aquí).
        if (llmDisponible() && navigator.onLine) {
          try {
            setEstado('llm')
            setProgresoGlobal(40)
            const tLlm = performance.now()
            const facturas = await extraerConLLM(blob)
            console.log(`[capture] LLM terminó en ${Math.round(performance.now() - tLlm)}ms:`, facturas)

            // Una factura por Receipt, cada una con su recorte. Si el recorte
            // falla (o la IA no dio una caja válida), se guarda la foto
            // completa: perder el recorte nunca debe tumbar la factura ni
            // mandarla al OCR local, que no sabe separar varias tirillas.
            const creadoEn = new Date()
            const recibos = await Promise.all(
              facturas.map(async (f): Promise<Receipt> => {
                let recorte: Blob | undefined
                if (f.caja) {
                  try {
                    recorte = await recortarImagen(imagen, cajaAPixeles(f.caja, imagen.width, imagen.height))
                  } catch (errRecorte) {
                    console.warn('[capture] no se pudo recortar la factura, se guarda la foto completa:', errRecorte)
                  }
                }
                return {
                  sessionId: Number(sessionId),
                  imageBlob: recorte ?? blob,
                  fotoOriginal: recorte ? blob : undefined,
                  rawOCRText: f.raw,
                  status: f.status,
                  data: f.data,
                  createdAt: creadoEn,
                }
              }),
            )
            await db.receipts.bulkAdd(recibos)
            console.log(`[capture] ${recibos.length} recibo(s) guardado(s) en Dexie (ruta LLM)`)

            setProgresoGlobal(100)
            setEstado('listo')
            setMotor('ia')
            setUltimasGuardadas(recibos.length)
            setRecibosCapturados((n) => n + recibos.length)
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
        setUltimasGuardadas(1)
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

  // Respaldo: <input type=file>. Sigue el mismo camino que la cámara: la foto
  // completa va a la IA, que dice dónde está cada factura para recortarla.
  async function onFotoSeleccionada(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      console.log('[capture] foto seleccionada (respaldo):', file.name, file.size, 'bytes', file.type)
      const canvas = imagenACanvas(await cargarImagenDesdeArchivo(file))
      await procesarImagen(canvas, await canvasABlob(canvas))
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
    listo:
      ultimasGuardadas > 1
        ? `¡${ultimasGuardadas} facturas guardadas de esta foto! Revísalas una por una antes de exportar.`
        : '¡Recibo guardado! Puedes capturar otro.',
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
