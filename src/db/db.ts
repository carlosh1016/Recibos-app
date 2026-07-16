import Dexie, { type EntityTable } from 'dexie'
import type { Session } from '../types/session'
import type { Receipt } from '../types/receipt'

// Dexie es una capa de conveniencia sobre IndexedDB, la base de datos que trae el
// navegador para persistencia local (esto es lo que nos permite ser 100% offline
// sin backend: session/receipts viven en el propio dispositivo).
//
// Se extiende la clase Dexie para obtener una instancia con propiedades tipadas
// (`sessions`, `receipts`) en vez de tener que castear `db.table('sessions')` cada
// vez que se usa. `EntityTable<Session, 'id'>` es un helper genérico de Dexie:
// - Session es el tipo de fila.
// - 'id' es el nombre del campo que actúa como primary key.
// Con eso, Dexie infiere automáticamente que `sessions.add(...)` devuelve
// `Promise<number>` (el id autogenerado) y que `sessions.get(id)` devuelve
// `Promise<Session | undefined>`.
class RecibosDB extends Dexie {
  sessions!: EntityTable<Session, 'id'>
  receipts!: EntityTable<Receipt, 'id'>

  constructor() {
    super('recibos-app')

    // La cadena de `stores()` NO lista todos los campos del objeto (a diferencia
    // de una tabla SQL) — solo los que quieres que IndexedDB indexe para poder
    // hacer where()/orderBy() eficientes. Cualquier otro campo del objeto
    // (rawOCRText, data, imageBlob, ...) se guarda igual, simplemente no se puede
    // filtrar por él directamente sin un índice.
    //
    // '++id'   -> primary key autoincremental (equivalente a SERIAL/AUTO_INCREMENT)
    // 'sessionId' -> índice normal, para poder hacer receipts.where('sessionId').equals(id)
    // 'status'    -> índice normal, para filtrar recibos pendientes/con error
    this.version(1).stores({
      sessions: '++id, createdAt',
      receipts: '++id, sessionId, status, createdAt',
    })
  }
}

// Se exporta una única instancia (patrón singleton): toda la app comparte la
// misma conexión a la base de datos, igual que harías con un pool de conexiones
// en el backend.
export const db = new RecibosDB()
