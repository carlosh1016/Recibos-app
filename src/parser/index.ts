// Barrel de parser/. La orquestación real vive en reconcile.ts (un único
// punto de entrada, `reconcile(rawText)`, que ya hace todo: NIT del emisor +
// DV, fecha, número, razón social, concepto, y la reconciliación de
// base/IVA/total). Las heurísticas ya no están separadas en un archivo por
// campo (como en el primer scaffold) porque en la práctica el NIT, los
// valores y el status del recibo se decidían juntos de todos modos.
export { reconcile, type ReconcileResult } from './reconcile'
export { normalizarFecha } from './fecha'
