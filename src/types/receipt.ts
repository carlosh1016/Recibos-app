import type { ExtractedData } from './extractedData'

// Igual que con FormaPago: unión de literales en vez de enum. Ver el comentario
// extendido en extractedData.ts. Además, al ser un tipo puramente estructural,
// se puede usar directamente para narrowing con un switch/if en la UI:
//   if (receipt.status === 'error') { ... }
// y TS sabe exactamente qué otros valores son posibles.
export type ReceiptStatus = 'pending' | 'reviewed' | 'error'

/**
 * Un recibo individual: la foto + lo que el OCR leyó en crudo + lo que el parser
 * (y luego el usuario, en Review) extrajo estructurado.
 */
export interface Receipt {
  // Igual razonamiento que Session.id: autoIncrement de Dexie, opcional hasta
  // que la fila exista en IndexedDB.
  id?: number
  // Clave foránea "a mano": Dexie/IndexedDB no tiene JOINs ni foreign keys reales
  // como una base relacional. `sessionId` es solo un number que referencia
  // Session.id por convención; la integridad referencial (que exista esa sesión)
  // es responsabilidad del código de la app, no de la base de datos.
  sessionId: number

  // `Blob` es un tipo del DOM (viene de la lib "DOM" incluida en tsconfig, no hay
  // que declararlo nosotros) que representa datos binarios — aquí, la foto tal
  // cual la entrega el input de cámara/archivo. Dexie sabe guardar Blobs
  // directamente en IndexedDB sin que los conviertas a base64 a mano.
  imageBlob: Blob

  // Texto crudo tal cual lo devolvió tesseract.js, sin procesar. Se conserva
  // siempre (incluso si el parser interpreta mal algo) para poder reprocesar o
  // depurar manualmente en Review sin repetir el OCR.
  rawOCRText: string

  status: ReceiptStatus

  data: ExtractedData

  createdAt: Date
}
