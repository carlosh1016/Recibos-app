/**
 * Heurísticas 1 y 2: encontrar el NIT del EMISOR de la factura (no del
 * cliente/adquiriente) y descartar el comodín "222222222222" (consumidor
 * final, típico de POS colombianos).
 *
 * TODO implementar:
 * - Buscar candidatos con un regex de NIT: dígitos agrupados con puntos o
 *   espacios opcionales y guion + dígito final opcional, ej:
 *   /\d{1,3}[.\s]?\d{3}[.\s]?\d{3}-?\d?/g
 * - Por cada candidato, revisar la línea donde aparece (y la anterior): si
 *   contiene "Cliente", "Adquiriente" o "Adquirente" (case-insensitive),
 *   descartarlo — es el NIT del comprador, no del emisor.
 * - Descartar cualquier candidato que sea el comodín de consumidor final con
 *   `esNitConsumidorFinal` (ver '../utils/nit', ya implementado y probado).
 * - El emisor casi siempre aparece en el encabezado, cerca del nombre del
 *   negocio: entre los candidatos restantes, preferir el primero que
 *   aparezca en el documento.
 * - Devolver el NIT tal cual se encontró en el texto (sin normalizar); la
 *   normalización final la hace `normalizeNit` desde parser/index.ts.
 */
export function extraerNitEmisor(_rawOCRText: string): string | undefined {
  throw new Error('TODO: extraerNitEmisor no implementado')
}
