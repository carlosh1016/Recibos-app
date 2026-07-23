import type { ReactNode } from 'react'

// Tarjeta base (superficie blanca sobre el fondo slate-50). Es solo contenedor:
// no impone padding interno fijo distinto al del diseño para que las listas
// densas y los bloques de resumen usen la misma superficie.

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>
  )
}
