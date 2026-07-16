import { useParams } from 'react-router-dom'
import type { ChangeEvent } from 'react'

export function Capture() {
  // useParams() por defecto tipa cada param como `string | undefined` (la URL
  // podría no traerlo). Con el generic `<{ sessionId: string }>` le decimos a
  // TS "confía en que esta ruta siempre trae sessionId" — es responsabilidad
  // de cómo se declaran las rutas en App.tsx que eso sea cierto, TS no puede
  // verificarlo solo con el tipo.
  const { sessionId } = useParams<{ sessionId: string }>()

  /**
   * TODO implementar el flujo real de captura:
   * 1. Al elegir/tomar una foto (este onChange), `e.target.files[0]` ya ES un
   *    Blob (todo File extiende Blob), no hace falta convertirlo.
   * 2. `const rawOCRText = await reconocerTexto(file)` — ver '../ocr/tesseract'.
   * 3. `const data = parseReceipt(rawOCRText)` — ver '../parser'.
   * 4. Guardar el recibo:
   *    `await db.receipts.add({ sessionId: Number(sessionId), imageBlob: file,
   *    rawOCRText, status: 'pending', data, createdAt: new Date() })`
   *    (el status inicial real depende de si reconciliaValores(data) da bien
   *    o mal — ver parser/reconciliacion.ts).
   * 5. Dejar la cámara lista para la siguiente foto: este flujo se repite por
   *    cada recibo de la sesión. Un botón "Terminar" navega a
   *    `/review/${sessionId}` cuando el usuario ya tomó todas las fotos.
   */
  function onFotoSeleccionada(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    console.log('TODO: procesar foto de recibo', file)
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold text-brand-700">Capturar recibos</h1>
      <p className="mt-1 text-sm text-gray-600">Sesión #{sessionId}</p>

      <label className="mt-6 block cursor-pointer rounded border-2 border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
        Tomar foto
        {/* capture="environment" abre directo la cámara trasera en móvil, sin
            pasar por la galería. En desktop simplemente abre el selector de
            archivos normal. */}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={onFotoSeleccionada}
          className="hidden"
        />
      </label>

      <p className="mt-4 text-xs text-gray-400">
        TODO: OCR + parser + guardado en Dexie (ver comentarios en el código).
      </p>
    </div>
  )
}
