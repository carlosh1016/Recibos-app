import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Screen, StatusBadge } from '../components'
import { db } from '../db/db'
import type { Session } from '../types'

// Sesión + el resumen que se muestra en la tarjeta. El conteo NO vive en la
// tabla `sessions` (se derivaría y quedaría desincronizado); se calcula al
// cargar, que con IndexedDB local y decenas de recibos es instantáneo.
interface SesionConResumen extends Session {
  total: number
  pendientes: number
}

/** "hoy" / "ayer" / "12 jul" — más legible que un timestamp completo. */
function fechaRelativa(fecha: Date): string {
  const hoy = new Date()
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDias = Math.round((dia(hoy) - dia(fecha)) / 86_400_000)
  if (diffDias === 0) return 'hoy'
  if (diffDias === 1) return 'ayer'
  if (diffDias < 7) return `hace ${diffDias} días`
  return fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

export function Home() {
  // `useState<SesionConResumen[]>([])` fija explícitamente el tipo del estado en
  // vez de dejar que TS lo infiera de `[]` (que sería `never[]`, un array que no
  // acepta agregarle nada). Es el mismo motivo por el que en un backend tipado
  // declararías el tipo de una lista vacía en vez de dejarla inferir.
  const [sessions, setSessions] = useState<SesionConResumen[]>([])
  const [nombreNueva, setNombreNueva] = useState('')
  const [cargando, setCargando] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    // Efecto "cargar al montar": Dexie es async (IndexedDB lo es por diseño),
    // así que no se puede simplemente `await` dentro de useEffect — el
    // callback de useEffect no puede ser async. Se define y llama una función
    // async interna en su lugar, patrón estándar en React+TS.
    async function cargarSesiones() {
      const todas = await db.sessions.orderBy('createdAt').reverse().toArray()
      // Un solo barrido de recibos y se agrupa en memoria: evita disparar 2
      // consultas por sesión (N+1) cuando la lista crece.
      const recibos = await db.receipts.toArray()
      const conResumen = todas.map((s): SesionConResumen => {
        const suyos = recibos.filter((r) => r.sessionId === s.id)
        return {
          ...s,
          total: suyos.length,
          pendientes: suyos.filter((r) => r.status !== 'ok').length,
        }
      })
      setSessions(conResumen)
      setCargando(false)
    }
    void cargarSesiones()
  }, [])

  async function crearSesion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!nombreNueva.trim()) return

    // db.sessions.add(...) devuelve el id autogenerado (number) — ver el
    // comentario sobre EntityTable en db/db.ts.
    const id = await db.sessions.add({
      name: nombreNueva.trim(),
      createdAt: new Date(),
    })
    navigate(`/capture/${id}`)
  }

  // Descartar una sesión completa. Como los recibos referencian sessionId "a
  // mano" (IndexedDB no tiene foreign keys ni ON DELETE CASCADE, ver db/db.ts),
  // el borrado en cascada es responsabilidad nuestra: se eliminan primero los
  // recibos de la sesión y luego la sesión, ambos dentro de una transacción
  // para que no quede a medias (recibos huérfanos sin sesión) si algo falla.
  async function eliminarSesion(session: SesionConResumen) {
    if (!session.id) return
    const detalle = session.total > 0 ? ` y sus ${session.total} recibo(s)` : ''
    if (!window.confirm(`¿Eliminar la sesión "${session.name}"${detalle}? Esta acción no se puede deshacer.`)) {
      return
    }
    await db.transaction('rw', db.receipts, db.sessions, async () => {
      await db.receipts.where('sessionId').equals(session.id!).delete()
      await db.sessions.delete(session.id!)
    })
    setSessions((prev) => prev.filter((s) => s.id !== session.id))
  }

  return (
    <Screen titulo="Recibos App" subtitulo="Facturas de compra → Excel">
      {/* Crear sesión: es LA acción principal de esta pantalla, así que va
          arriba y visible, no escondida tras un modal. */}
      <Card>
        <form onSubmit={crearSesion}>
          <label htmlFor="nombre-sesion" className="block text-sm font-semibold text-slate-900">
            Nueva sesión
          </label>
          <p className="mt-0.5 text-xs text-slate-500">
            Agrupa las facturas de una misma empresa o periodo.
          </p>
          <input
            id="nombre-sesion"
            type="text"
            value={nombreNueva}
            onChange={(e) => setNombreNueva(e.target.value)}
            placeholder="Ej. Compras julio 2026"
            className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-base text-slate-900 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
          />
          <Button type="submit" fullWidth disabled={!nombreNueva.trim()} className="mt-3">
            Empezar a capturar
          </Button>
        </form>
      </Card>

      <h2 className="mb-2 mt-6 px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
        Sesiones recientes
      </h2>

      {cargando ? (
        <p className="px-1 text-sm text-slate-400">Cargando…</p>
      ) : sessions.length === 0 ? (
        <Card className="text-center">
          <p className="text-sm text-slate-500">
            Todavía no hay sesiones. Crea una arriba para tomar tu primera factura.
          </p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {sessions.map((session) => (
            <li key={session.id}>
              <Card className="flex items-center gap-2 !p-0">
                {/* La tarjeta entera es el área táctil para continuar: en móvil
                    apuntar a un texto pequeño es la principal fuente de toques
                    fallidos. */}
                <button
                  type="button"
                  onClick={() => navigate(`/capture/${session.id}`)}
                  className="min-h-[44px] flex-1 rounded-l-xl px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="block font-medium text-slate-900">{session.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {session.total === 0
                      ? 'Sin facturas'
                      : `${session.total} factura${session.total === 1 ? '' : 's'}`}
                    {' · '}
                    {fechaRelativa(session.createdAt)}
                  </span>
                </button>

                {session.total > 0 && (
                  <StatusBadge status={session.pendientes > 0 ? 'review' : 'ok'} />
                )}

                <button
                  type="button"
                  onClick={() => void eliminarSesion(session)}
                  aria-label={`Eliminar sesión ${session.name}`}
                  title="Eliminar sesión"
                  className="mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-300 hover:bg-red-50 hover:text-red-600"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" />
                  </svg>
                </button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  )
}
