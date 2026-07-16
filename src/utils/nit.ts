import { calcularDV } from './dv'

// NIT "comodín" que muchos POS colombianos usan para ventas sin factura a nombre
// de un tercero identificado ("consumidor final"). Si el parser lo ve como
// candidato a NIT del emisor, debe descartarlo — nunca es el NIT real del negocio.
const NIT_CONSUMIDOR_FINAL = '222222222222'

/**
 * Resultado de normalizar un NIT leído del recibo. `dv` es siempre el
 * calculado con el algoritmo DIAN (fuente de verdad); `dvOCR` es el dígito que
 * traía el texto original, si el formato incluía uno — se conserva solo como
 * referencia/diagnóstico (ej. para detectar en Review una foto mal reconocida),
 * nunca se usa para llenar la columna E del Excel.
 */
export interface NitNormalizado {
  nit: string
  dv: string
  dvOCR?: string
}

/**
 * Acepta los formatos que entrega el OCR sobre facturas colombianas, p. ej.:
 * "830.087.099-3", "832 006 666-7", "901074741-5", o incluso solo "901074741"
 * sin DV. Quita puntos, espacios y el guion, y separa el DV si vino incluido.
 */
export function normalizeNit(raw: string): NitNormalizado {
  const cleaned = raw.trim()
  const dashIndex = cleaned.lastIndexOf('-')

  let nitPart = cleaned
  let dvOCR: string | undefined

  if (dashIndex !== -1) {
    nitPart = cleaned.slice(0, dashIndex)
    const dvDigits = cleaned.slice(dashIndex + 1).replace(/\D/g, '')
    dvOCR = dvDigits.length > 0 ? dvDigits : undefined
  }

  const nit = nitPart.replace(/\D/g, '')

  return { nit, dv: calcularDV(nit), dvOCR }
}

export function esNitConsumidorFinal(nit: string): boolean {
  return nit.replace(/\D/g, '') === NIT_CONSUMIDOR_FINAL
}
