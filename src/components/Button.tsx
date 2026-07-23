import type { ButtonHTMLAttributes, ReactNode } from 'react'

// Botón único de la app. Existe para que el "peso visual" sea una DECISIÓN
// explícita (variant) y no algo que se improvise con clases sueltas en cada
// pantalla: el diseño exige un solo botón primario por pantalla, y eso solo se
// puede sostener si las variantes están nombradas.
//
// `min-h-[44px]` no es estético: es el área táctil mínima para que una usuaria
// con prisa no falle el toque en el celular.

type Variant = 'primary' | 'secondary' | 'danger'

const VARIANTES: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-800 shadow-sm',
  secondary: 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 active:bg-slate-100',
  // Destructivo: sin fondo hasta hover, para que nunca compita con el primario.
  danger: 'text-red-600 hover:bg-red-50 active:bg-red-100 border border-transparent hover:border-red-200',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Ocupa todo el ancho — el caso normal en móvil. */
  fullWidth?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  fullWidth = false,
  className = '',
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={
        `inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-6 py-3 ` +
        `text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ` +
        `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 ` +
        `${fullWidth ? 'w-full ' : ''}${VARIANTES[variant]} ${className}`
      }
    >
      {children}
    </button>
  )
}
