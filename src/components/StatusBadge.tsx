import type { ReceiptStatus } from '../types'
import { ESTILO_ESTADO } from './estadoRecibo'

// Píldora de estado del recibo. El punto de color va además del texto para que
// el estado no dependa SOLO del color (daltonismo, pantalla al sol).

export function StatusBadge({ status }: { status: ReceiptStatus }) {
  const e = ESTILO_ESTADO[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${e.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${e.punto}`} aria-hidden="true" />
      {e.texto}
    </span>
  )
}
