import type { ReceiptStatus } from '../types'

// Tabla ÚNICA de estilos por estado de recibo. Antes vivía dentro de Review.tsx,
// así que la tira de miniaturas era la única parte de la app que sabía
// "verde = ok". Al extraerla, Home, Review y Export muestran el mismo código de
// color sin repetir la tabla (y sin que se desincronice).
//
// Va en su propio archivo (y no junto a StatusBadge) porque mezclar constantes
// con componentes rompe el fast refresh de React en Vite.

interface EstiloEstado {
  texto: string
  /** Fondo + texto, para el badge (píldora). */
  badge: string
  /** Solo el color de fondo sólido, para puntos e indicadores compactos. */
  punto: string
  /** Borde izquierdo + fondo suave, para tarjetas y miniaturas de lista. */
  tarjeta: string
}

export const ESTILO_ESTADO: Record<ReceiptStatus, EstiloEstado> = {
  ok: {
    texto: 'OK',
    badge: 'bg-green-100 text-green-700',
    punto: 'bg-green-500',
    tarjeta: 'border-green-300 bg-green-50 text-green-800',
  },
  review: {
    texto: 'Revisar',
    badge: 'bg-amber-100 text-amber-700',
    punto: 'bg-amber-500',
    tarjeta: 'border-amber-300 bg-amber-50 text-amber-800',
  },
  error: {
    texto: 'Error',
    badge: 'bg-red-100 text-red-700',
    punto: 'bg-red-500',
    tarjeta: 'border-red-300 bg-red-50 text-red-800',
  },
}
