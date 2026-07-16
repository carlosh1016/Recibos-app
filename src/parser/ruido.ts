/**
 * Heurística 7: limpiar el texto del pie de página ANTES de correr las demás
 * heurísticas sobre él, para no confundir un hash o un número de póliza con
 * un NIT o un valor monetario.
 *
 * TODO implementar: quitar (o al menos no considerar como candidatos a
 * campos) las líneas que contengan:
 * - Códigos QR decodificados / representaciones de QR.
 * - CUFE/CUDE: hashes largos alfanuméricos (típicamente 90+ caracteres hex).
 * - Referencias a pólizas o resoluciones ("Resolución DIAN No.", "Póliza No.").
 * - Textos legales largos ("Esta factura se asimila a una letra de cambio...").
 */
export function limpiarRuido(_rawOCRText: string): string {
  throw new Error('TODO: limpiarRuido no implementado')
}
