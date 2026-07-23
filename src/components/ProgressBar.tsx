// Barra de progreso del pipeline de captura. Nunca simula avance: el valor
// viene del progreso real (preprocesado / OCR / LLM). Un spinner mudo haría que
// la usuaria no sepa si la app está trabajando o colgada, que era el bug
// original de esta pantalla.

interface ProgressBarProps {
  /** 0-100. */
  valor: number
  tono?: 'progreso' | 'exito' | 'error'
}

const TONOS = {
  progreso: 'bg-brand-600',
  exito: 'bg-green-500',
  error: 'bg-red-500',
} as const

export function ProgressBar({ valor, tono = 'progreso' }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(valor)))
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`h-full rounded-full transition-all duration-300 ${TONOS[tono]}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
