import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Screen } from '../components'
import { db } from '../db/db'
import { exportarExcel } from '../excel/export'
import type { Receipt, Session } from '../types'

export function Export() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [cargando, setCargando] = useState(true)
  const [exportando, setExportando] = useState(false)
  const [exportado, setExportado] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function cargar() {
      if (!sessionId) return
      const id = Number(sessionId)
      const [s, lista] = await Promise.all([
        db.sessions.get(id),
        db.receipts.where('sessionId').equals(id).toArray(),
      ])
      setSession(s ?? null)
      setReceipts(lista)
      setCargando(false)
    }
    void cargar()
  }, [sessionId])

  const revisadas = receipts.filter((r) => r.status === 'ok').length
  const pendientes = receipts.length - revisadas

  async function descargarExcel() {
    if (!sessionId) return
    setError(null)
    setExportando(true)
    try {
      const blob = await exportarExcel(receipts)

      // Patrón estándar para forzar la descarga de un Blob generado en el
      // navegador (sin backend que sirva el archivo): un <a> temporal con
      // un object URL, click programático, y luego revocar el URL.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const nombre = session?.name.replace(/[^\w\s-]/g, '').trim() || `sesion-${sessionId}`
      a.download = `${nombre}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      setExportado(true)
    } catch (e) {
      // `e` es `unknown` acá (ver useUnknownInCatchVariables en tsconfig), no
      // `any`: hay que comprobar que es un Error antes de leer `.message`.
      setError(e instanceof Error ? e.message : 'Error desconocido exportando el Excel')
    } finally {
      setExportando(false)
    }
  }

  return (
    <Screen
      titulo="Exportar a Excel"
      subtitulo={session?.name ?? `Sesión #${sessionId}`}
      volverA={`/review/${sessionId}`}
    >
      {cargando ? (
        <p className="text-sm text-slate-400">Cargando…</p>
      ) : (
        <>
          {/* Resumen: la usuaria decide con esto si le conviene exportar ya o
              volver a revisar. Por eso va ANTES del botón. */}
          <Card>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
                  Revisadas
                </dt>
                <dd className="font-semibold text-slate-900">{revisadas}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="flex items-center gap-2 text-slate-600">
                  <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                  Sin revisar
                </dt>
                <dd className="font-semibold text-slate-900">{pendientes}</dd>
              </div>
              <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2">
                <dt className="font-medium text-slate-900">Total</dt>
                <dd className="font-semibold text-slate-900">
                  {receipts.length} factura{receipts.length === 1 ? '' : 's'}
                </dd>
              </div>
            </dl>
          </Card>

          {/* Aviso, NO bloqueo: exportar con pendientes es una decisión válida
              (se corrige después en el Excel), así que solo se informa. */}
          {pendientes > 0 && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Tienes {pendientes} factura{pendientes === 1 ? '' : 's'} sin revisar. Puedes exportarlas
              igual, pero conviene revisarlas antes para que los datos salgan correctos.
            </p>
          )}

          <Button
            fullWidth
            className="mt-5"
            onClick={() => void descargarExcel()}
            disabled={exportando || receipts.length === 0}
          >
            {exportando ? 'Generando…' : 'Descargar Excel'}
          </Button>

          {receipts.length === 0 && (
            <p className="mt-3 text-center text-sm text-slate-500">
              Esta sesión no tiene facturas todavía.
            </p>
          )}

          {exportado && !error && (
            <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-sm font-medium text-green-800">Excel descargado</p>
              <Button variant="secondary" fullWidth className="mt-3" onClick={() => navigate('/')}>
                Volver al inicio
              </Button>
            </div>
          )}

          {error && (
            <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </Screen>
  )
}
