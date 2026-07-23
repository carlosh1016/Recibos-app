import type { InputHTMLAttributes, ReactNode } from 'react'

// Campo de formulario con estado visual. El `tono` comunica confianza de la
// extracción: la usuaria debe poder barrer la pantalla y ver de inmediato QUÉ
// hay que mirar, sin leer cada valor. Por eso el amarillo no es decorativo —
// marca "el modelo no está seguro" o "esto no cuadra".

type Tono = 'normal' | 'alerta' | 'error'

const TONOS: Record<Tono, string> = {
  normal: 'border-slate-200 bg-white focus:border-brand-500 focus:ring-brand-500/30',
  alerta: 'border-amber-300 bg-amber-50 focus:border-amber-500 focus:ring-amber-500/30',
  error: 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-red-500/30',
}

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  tono?: Tono
  /** Datos que "parecen datos" (NIT, número de factura) van en monoespaciado. */
  mono?: boolean
  /** Nota bajo el campo: explica el problema cuando el tono no es normal. */
  ayuda?: ReactNode
}

export function Field({ label, tono = 'normal', mono = false, ayuda, ...props }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      <input
        {...props}
        className={
          `w-full rounded-lg border px-3 py-2.5 text-base text-slate-900 outline-none ` +
          `transition-colors focus:ring-2 ${mono ? 'font-mono ' : ''}${TONOS[tono]}`
        }
      />
      {ayuda && <span className="mt-1 block text-xs text-slate-500">{ayuda}</span>}
    </label>
  )
}
