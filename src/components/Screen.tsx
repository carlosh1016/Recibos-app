import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

// Cascarón común de pantalla: fondo, header pegajoso y ancho máximo. Antes cada
// página repetía `mx-auto max-w-md p-6` con anchos distintos (md, 2xl, 4xl) y
// sin header consistente, así que navegar entre ellas se sentía como cambiar de
// app. Centralizarlo también garantiza el `pb` seguro de abajo en móvil.

interface ScreenProps {
  titulo: string
  /** Línea de contexto bajo el título (ej. nombre de la sesión). */
  subtitulo?: ReactNode
  /** Si se pasa, el header muestra la flecha "atrás" hacia esa ruta. */
  volverA?: string
  /** Contenido alineado a la derecha del header (contador, badge…). */
  accion?: ReactNode
  /** `max-w` del contenido. Review necesita más ancho por el par foto+formulario. */
  ancho?: 'md' | 'xl' | '4xl'
  children: ReactNode
}

const ANCHOS = { md: 'max-w-md', xl: 'max-w-xl', '4xl': 'max-w-4xl' } as const

export function Screen({ titulo, subtitulo, volverA, accion, ancho = 'md', children }: ScreenProps) {
  const navigate = useNavigate()

  return (
    <div className="flex min-h-full flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className={`mx-auto flex ${ANCHOS[ancho]} items-center gap-3 px-4 py-3`}>
          {volverA && (
            <button
              type="button"
              onClick={() => navigate(volverA)}
              aria-label="Volver"
              className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold text-slate-900">{titulo}</h1>
            {subtitulo && <p className="truncate text-xs text-slate-500">{subtitulo}</p>}
          </div>
          {accion}
        </div>
      </header>

      <main className={`mx-auto w-full ${ANCHOS[ancho]} flex-1 px-4 py-5 pb-8`}>{children}</main>
    </div>
  )
}
