import type { ExtractedData } from '../types'

/**
 * Heurística 5: solo IVA (no hay otros impuestos que detectar).
 *
 * TODO implementar:
 * - Si el texto contiene "IVA incluido", el total impreso YA incluye el IVA:
 *   si el recibo trae un desglose explícito de base/IVA, usarlo tal cual; si
 *   no, derivar base = total / (1 + porcentajeIva).
 * - Si el texto contiene "No responsable de IVA", o el documento es de tipo
 *   INC/impuesto al consumo (no IVA), fijar porcentajeIva = 0.
 * - Los porcentajes de IVA usuales en Colombia son 0%, 5% y 19% — usar eso
 *   como pista para corregir OCR ruidoso (ej. "19Z" o "l9%" -> 19%).
 */
export function extraerImpuestos(
  _rawOCRText: string,
): Pick<ExtractedData, 'valorBase' | 'porcentajeIva' | 'ivaMonto' | 'total'> {
  throw new Error('TODO: extraerImpuestos no implementado')
}
