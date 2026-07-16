import type { ExtractedData } from '../types'

/**
 * Heurística 6: validar que base + IVA ≈ total (con una tolerancia de
 * redondeo pequeña, ej. +-2 pesos). Si no cuadra, el Receipt correspondiente
 * debe marcarse status='error' para que el usuario lo revise a mano en
 * Review — NUNCA autocorregir en silencio un valor que no cuadra.
 *
 * Importante para quien conecte esto con excel/export.ts: la columna VALOR
 * (M) del Excel final es `valorBase`, NUNCA `total`. Es un error común
 * confundirlas porque en muchos recibos el número más grande y más visible
 * es el total.
 *
 * TODO implementar:
 * - Comparar (data.valorBase ?? 0) + (data.ivaMonto ?? 0) contra data.total
 *   con tolerancia de redondeo.
 * - Devolver false si falta alguno de los tres valores (no se puede validar
 *   sin ellos, y por seguridad eso también debería llevar a status='error').
 */
export function reconciliaValores(_data: ExtractedData): boolean {
  throw new Error('TODO: reconciliaValores no implementado')
}
