/**
 * Heurística 4: detectar el formato de fecha y normalizarlo a ISO
 * 'YYYY-MM-DD'. Formatos a soportar:
 * - ISO ya normalizado: "2026-05-23"
 * - DD/MM/YYYY: "14/06/2026"
 * - MM/DD/YYYY: "05/15/2026"
 * - Mes en texto: "May-13-2026"
 *
 * TODO implementar:
 * - Si ya viene como YYYY-MM-DD, devolver tal cual (validando rangos de mes/día).
 * - Para "N/M/YYYY": si el primer número es > 12, tiene que ser el día
 *   (DD/MM/YYYY) — no hay ambigüedad posible. Si el segundo es > 12, tiene
 *   que ser MM/DD/YYYY. Si ambos son <= 12, es ambiguo: Colombia usa
 *   DD/MM/YYYY por convención, así que se resuelve a ese formato salvo que
 *   haya otra pista en el propio texto del recibo.
 * - Para meses en texto (may, jun, ene, ...) usar un mapa de abreviaturas en
 *   español e inglés a número de mes de 2 dígitos.
 */
export function normalizarFecha(_textoFecha: string): string | undefined {
  throw new Error('TODO: normalizarFecha no implementado')
}
