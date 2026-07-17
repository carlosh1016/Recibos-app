import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../db/db'
import type { Session } from '../types'

export function Home() {
  // `useState<Session[]>([])` fija explícitamente el tipo del estado en vez de
  // dejar que TS lo infiera de `[]` (que sería `never[]`, un array que no
  // acepta agregarle nada). Es el mismo motivo por el que en un backend
  // tipado declararías el tipo de una lista vacía en vez de dejarla inferir.
  const [sessions, setSessions] = useState<Session[]>([])
  const [nombreNueva, setNombreNueva] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    // Efecto "cargar al montar": Dexie es async (IndexedDB lo es por diseño),
    // así que no se puede simplemente `await` dentro de useEffect — el
    // callback de useEffect no puede ser async. Se define y llama una función
    // async interna en su lugar, patrón estándar en React+TS.
    async function cargarSesiones() {
      const todas = await db.sessions.orderBy('createdAt').reverse().toArray()
      setSessions(todas)
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
  async function eliminarSesion(session: Session) {
    if (!session.id) return
    const n = await db.receipts.where('sessionId').equals(session.id).count()
    const detalle = n > 0 ? ` y sus ${n} recibo(s)` : ''
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
    <div className="mx-auto max-w-md p-6">
      <h1 className="text-2xl font-semibold text-brand-700">Recibos App</h1>
      <p className="mt-1 text-sm text-gray-600">
        Procesa fotos de facturas colombianas y expórtalas a Excel — todo offline.
      </p>

      <form onSubmit={crearSesion} className="mt-6 flex gap-2">
        <input
          type="text"
          value={nombreNueva}
          onChange={(e) => setNombreNueva(e.target.value)}
          placeholder="Nombre de la sesión (ej. Compras mayo 2026)"
          className="flex-1 rounded border border-gray-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Crear
        </button>
      </form>

      <ul className="mt-6 divide-y divide-gray-200">
        {sessions.map((session) => (
          <li key={session.id} className="flex items-center gap-2 py-3">
            <button
              type="button"
              onClick={() => navigate(`/capture/${session.id}`)}
              className="flex-1 text-left"
            >
              <span className="font-medium text-gray-900">{session.name}</span>
              <span className="block text-xs text-gray-500">
                {session.createdAt.toLocaleString('es-CO')}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void eliminarSesion(session)}
              aria-label={`Eliminar sesión ${session.name}`}
              title="Eliminar sesión"
              className="shrink-0 rounded border border-transparent px-2 py-1 text-sm text-gray-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600"
            >
              🗑
            </button>
          </li>
        ))}
        {sessions.length === 0 && (
          <li className="py-3 text-sm text-gray-500">Todavía no hay sesiones.</li>
        )}
      </ul>
    </div>
  )
}
