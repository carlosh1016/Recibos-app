import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import { exportarExcel } from '../excel/export'

export function Export() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [error, setError] = useState<string | null>(null)

  async function descargarExcel() {
    if (!sessionId) return
    setError(null)
    try {
      const receipts = await db.receipts.where('sessionId').equals(Number(sessionId)).toArray()
      const blob = await exportarExcel(receipts)

      // Patrón estándar para forzar la descarga de un Blob generado en el
      // navegador (sin backend que sirva el archivo): un <a> temporal con
      // un object URL, click programático, y luego revocar el URL.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `recibos-sesion-${sessionId}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      // `e` es `unknown` acá (ver useUnknownInCatchVariables en tsconfig), no
      // `any`: hay que comprobar que es un Error antes de leer `.message`.
      setError(e instanceof Error ? e.message : 'Error desconocido exportando el Excel')
    }
  }

  return (
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-xl font-semibold text-brand-700">Exportar a Excel</h1>
      <p className="mt-1 text-sm text-gray-600">Sesión #{sessionId}</p>

      <button
        type="button"
        onClick={() => void descargarExcel()}
        className="mt-6 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
      >
        Descargar Excel
      </button>

      {error && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-700">
          {error} (esperado por ahora: excel/export.ts todavía es un stub, ver TODOs ahí).
        </p>
      )}
    </div>
  )
}
