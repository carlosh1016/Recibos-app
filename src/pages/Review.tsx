import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import type { Receipt } from '../types'

export function Review() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const [receipts, setReceipts] = useState<Receipt[]>([])

  useEffect(() => {
    async function cargarRecibos() {
      if (!sessionId) return
      const lista = await db.receipts.where('sessionId').equals(Number(sessionId)).toArray()
      setReceipts(lista)
    }
    void cargarRecibos()
  }, [sessionId])

  /**
   * TODO implementar la UI de revisión real, por cada receipt en `receipts`:
   * - Layout de dos columnas: la foto (`URL.createObjectURL(receipt.imageBlob)`,
   *   acordarse de revocar el object URL al desmontar para no filtrar memoria)
   *   al lado de un formulario con cada campo de `receipt.data` editable.
   * - Resaltar visualmente (ej. borde/fondo rojo) los campos valorBase, iva y
   *   total cuando `receipt.status === 'error'` (ya lo decide `reconcile()`
   *   en parser/reconcile.ts al capturar), para que el usuario corrija a
   *   mano el campo que está mal leído.
   * - Al editar un campo, actualizar tanto el estado local como
   *   `db.receipts.update(receipt.id, { data: nuevoData, status: 'reviewed' })`.
   * - Un recibo con `status === 'error'` debería quedar visualmente marcado en
   *   la lista aunque el usuario no haya entrado a revisarlo todavía.
   */
  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold text-brand-700">Revisar recibos</h1>
      <p className="mt-1 text-sm text-gray-600">Sesión #{sessionId}</p>

      <ul className="mt-6 space-y-2">
        {receipts.map((receipt) => (
          <li
            key={receipt.id}
            className={`rounded border p-3 text-sm ${
              receipt.status === 'error' ? 'border-red-400 bg-red-50' : 'border-gray-200'
            }`}
          >
            Recibo #{receipt.id} — {receipt.data.razonSocial ?? '(sin razón social)'} — estado:{' '}
            {receipt.status}
          </li>
        ))}
        {receipts.length === 0 && (
          <li className="text-sm text-gray-500">Todavía no hay recibos en esta sesión.</li>
        )}
      </ul>

      <p className="mt-4 text-xs text-gray-400">
        TODO: formulario editable por campo + foto al lado (ver comentarios en el código).
      </p>
    </div>
  )
}
