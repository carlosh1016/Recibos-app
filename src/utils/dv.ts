// Algoritmo oficial de la DIAN (módulo 11) para calcular el dígito de
// verificación (DV) de un NIT colombiano. `as const` congela el array como una
// tupla de números literales de solo lectura en vez de `number[]` genérico —
// no cambia el comportamiento en runtime, pero evita que alguien haga
// `PESOS_DV.push(...)` por error en otro archivo, y TS infiere el tipo más
// preciso posible (útil si en el futuro se valida contra `PESOS_DV.length`).
const PESOS_DV = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const

/**
 * Calcula el DV de un NIT (sin el propio DV, solo los dígitos del NIT).
 * Nunca se debe tomar el DV directamente del texto leído por OCR: un dígito mal
 * reconocido ahí pasaría desapercibido. Este cálculo es la única fuente de verdad.
 */
export function calcularDV(nit: string): string {
  const digits = nit.replace(/\D/g, '')
  if (digits.length === 0) {
    throw new Error('calcularDV: el NIT no tiene dígitos')
  }
  if (digits.length > PESOS_DV.length) {
    // La tabla de pesos de la DIAN cubre NITs de hasta 15 dígitos, más que
    // suficiente para cualquier NIT o cédula colombiana real.
    throw new Error(`calcularDV: NIT demasiado largo (${digits.length} dígitos)`)
  }

  let suma = 0
  // Se recorre de derecha a izquierda: el dígito de las unidades usa el primer
  // peso (3), el siguiente hacia la izquierda usa el segundo (7), etc.
  for (let i = 0; i < digits.length; i++) {
    const digito = Number(digits[digits.length - 1 - i])
    suma += digito * PESOS_DV[i]
  }

  const resto = suma % 11
  return String(resto < 2 ? resto : 11 - resto)
}
