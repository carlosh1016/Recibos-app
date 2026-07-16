import type { ExtractedData } from '../types'
import { normalizeNit } from '../utils/nit'
import { extraerImpuestos } from './impuestos'
import { extraerNitEmisor } from './nitEmisor'
import { reconciliaValores } from './reconciliacion'
import { limpiarRuido } from './ruido'

// La normalización de fecha (parser/fecha.ts) todavía no se conecta aquí
// porque falta decidir en qué parte del texto crudo buscar la fecha antes de
// normalizarla; se deja el archivo listo para cuando se implemente.

/**
 * Punto de entrada del parser: recibe el texto crudo de tesseract.js
 * (Receipt.rawOCRText) y arma el ExtractedData correspondiente. Se llama
 * desde el flujo de Capture/Review al terminar el OCR de cada recibo.
 *
 * Este archivo es un STUB que solo compone la forma que debería tener la
 * orquestación, usando las heurísticas individuales de este mismo directorio
 * (todas ellas también stubs por ahora, ver ruido.ts, nitEmisor.ts, fecha.ts,
 * impuestos.ts, reconciliacion.ts). Llamarla hoy lanza un error porque las
 * piezas de las que depende también lo hacen — así queda explícito qué falta
 * por implementar en vez de devolver datos silenciosamente vacíos o falsos.
 */
export function parseReceipt(rawOCRText: string): ExtractedData {
  const texto = limpiarRuido(rawOCRText)

  const nitCrudo = extraerNitEmisor(texto)
  const { nit, dv } = nitCrudo ? normalizeNit(nitCrudo) : { nit: undefined, dv: undefined }

  const impuestos = extraerImpuestos(texto)

  const data: ExtractedData = {
    doc: 'FC',
    nit,
    dv,
    ...impuestos,
  }

  // TODO: usar el resultado de reconciliaValores para decidir si el Receipt
  // que contiene este ExtractedData debe quedar en status='error' (eso lo
  // decide quien llama a parseReceipt, no esta función — parser/ solo
  // extrae datos, no conoce el modelo Receipt).
  reconciliaValores(data)

  return data
}

export { limpiarRuido } from './ruido'
export { extraerNitEmisor } from './nitEmisor'
export { normalizarFecha } from './fecha'
export { extraerImpuestos } from './impuestos'
export { reconciliaValores } from './reconciliacion'
