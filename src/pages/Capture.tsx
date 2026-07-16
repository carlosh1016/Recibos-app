import { useEffect, useState, type ChangeEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { db } from '../db/db'
import { preprocess } from '../ocr/preprocess'
import { reconocerTexto, terminarWorkerOCR } from '../ocr/tesseract'
import { reconcile } from '../parser/reconcile'

// Estados explícitos del pipeline por foto, para que la UI siempre muestre
// en qué etapa está en vez de quedarse "quieta sin errores visibles" (el bug
// original) mientras algo corre en segundo plano.
type Estado = 'idle' | 'preprocesando' | 'ocr' | 'parseando' | 'listo' | 'error'

/**
 * Decodifica el archivo de la foto en un <img> ya listo para usar. `decode()`
 * confirma que el bitmap terminó de decodificarse antes de seguir — sin esto,
 * en algunos navegadores el evento `onload` puede dispararse antes de que la
 * imagen esté lista para operaciones como drawImage a resolución completa.
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

export function Capture() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()

  const [estado, setEstado] = useState<Estado>('idle')
  const [progresoOcr, setProgresoOcr] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [recibosCapturados, setRecibosCapturados] = useState(0)

  // El worker de tesseract.js es un singleton a nivel de módulo (ver
  // ocr/tesseract.ts), pero SE TIENE que terminar al salir de esta pantalla
  // para liberar el WASM y el modelo de idioma de memoria.
  useEffect(() => {
    return () => {
      void terminarWorkerOCR()
    }
  }, [])

  async function onFotoSeleccionada(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Permite volver a elegir el mismo archivo dos veces seguidas (si no se
    // limpia, el navegador no vuelve a disparar onChange para el mismo File).
    e.target.value = ''
    if (!file || !sessionId) return

    setError(null)
    setProgresoOcr(0)

    try {
      console.log('[capture] foto seleccionada:', file.name, file.size, 'bytes', file.type)

      setEstado('preprocesando')
      const imagen = await cargarImagenDesdeArchivo(file)
      const canvasPreprocesado = await preprocess(imagen)
      console.log('[capture] preprocesamiento terminado')

      setEstado('ocr')
      const rawOCRText = await reconocerTexto(canvasPreprocesado, ({ progress }) => {
        setProgresoOcr(progress)
      })
      console.log('[capture] OCR terminado, primeros 200 caracteres:', rawOCRText.slice(0, 200))

      setEstado('parseando')
      const { data, status } = reconcile(rawOCRText)
      console.log('[capture] parser terminado:', { data, status })

      await db.receipts.add({
        sessionId: Number(sessionId),
        imageBlob: file,
        rawOCRText,
        status,
        data,
        createdAt: new Date(),
      })
      console.log('[capture] recibo guardado en Dexie')

      setEstado('listo')
      setRecibosCapturados((n) => n + 1)
    } catch (err) {
      // Nunca fallar en silencio: se loguea el detalle técnico en consola y
      // se muestra un mensaje en la UI.
      console.error('[capture] error procesando el recibo:', err)
      setEstado('error')
      setError(err instanceof Error ? err.message : 'Error desconocido procesando la foto')
    }
  }

  const procesando = estado === 'preprocesando' || estado === 'ocr' || estado === 'parseando'

  const mensajeEstado: Record<Estado, string> = {
    idle: 'Listo para tomar una foto.',
    preprocesando: 'Mejorando la imagen...',
    ocr: 'Reconociendo texto (OCR)...',
    parseando: 'Extrayendo los datos de la factura...',
    listo: '¡Recibo guardado! Puedes tomar otra foto.',
    error: 'Algo falló procesando esta foto.',
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold text-brand-700">Capturar recibos</h1>
      <p className="mt-1 text-sm text-gray-600">Sesión #{sessionId}</p>

      <label
        className={`mt-6 block rounded border-2 border-dashed p-8 text-center text-sm ${
          procesando ? 'cursor-not-allowed border-gray-200 text-gray-300' : 'cursor-pointer border-gray-300 text-gray-500'
        }`}
      >
        {procesando ? 'Procesando...' : 'Tomar foto'}
        {/* capture="environment" abre directo la cámara trasera en móvil, sin
            pasar por la galería. En desktop abre el selector de archivos normal. */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => void onFotoSeleccionada(e)}
          disabled={procesando}
          className="hidden"
        />
      </label>

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
        {estado === 'ocr' && (
          <div className="mt-2 h-2 w-full rounded bg-gray-200">
            <div
              className="h-2 rounded bg-brand-600 transition-all"
              style={{ width: `${Math.round(progresoOcr * 100)}%` }}
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
