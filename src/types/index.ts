// Barrel file: re-exporta todo lo de types/ para poder importar como
// `import type { Receipt, Session } from '../types'` en vez de apuntar a cada
// archivo individual. `export type { ... }` (con la palabra `type`) en vez de
// `export { ... }` le indica al compilador que esto se borra por completo del
// JS final — no genera ningún re-export en tiempo de ejecución, porque interfaces
// y type aliases no existen en runtime.
export type { Session } from './session'
export type { Receipt, ReceiptStatus } from './receipt'
export type { ExtractedData, FormaPago } from './extractedData'
