/**
 * Una sesión agrupa los recibos de una "tanda" de procesamiento (ej. "Compras
 * mayo 2026"). Es el equivalente a una carpeta o un lote.
 */
export interface Session {
  // `id` es opcional porque Dexie lo autogenera (autoIncrement) al insertar la fila:
  // el objeto que armas en memoria ANTES de guardarlo no tiene id todavía. Una vez
  // que Dexie.table.add() retorna, sí lo tiene. En vez de crear dos tipos separados
  // (uno para "por crear" y otro para "ya guardado" — algo común en TS estricto),
  // aquí se opta por un único tipo con `id` opcional porque es la convención que
  // usa la propia documentación de Dexie y mantiene el código simple.
  id?: number
  name: string
  // Se guarda como `Date` real, no como string ISO. IndexedDB (y por lo tanto Dexie)
  // usa "structured clone" para persistir datos, que sí sabe serializar/deserializar
  // objetos Date de forma nativa — a diferencia de una API REST con JSON, donde
  // tendrías que convertir a string y parsear de vuelta a mano.
  createdAt: Date
}
