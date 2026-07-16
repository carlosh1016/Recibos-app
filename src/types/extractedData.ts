// Forma de pago detectada en el recibo. Se modela como una unión de strings
// literales ('contado' | 'credito'), NO como un `enum` de TypeScript.
//
// Por qué no enum: un `enum` numérico o de string de TS genera código JS real en
// el bundle (un objeto con el mapeo) y, en el caso de los enums numéricos, crea un
// "reverse mapping" que casi nunca quieres. Una unión de literales, en cambio, es
// pura información de tipos: desaparece por completo al compilar. Como estos
// valores se van a guardar tal cual en IndexedDB y se van a escribir en celdas de
// Excel, es más simple comparar contra el string plano ("contado") que contra
// FormaPago.Contado. Es el patrón recomendado en la comunidad de TS para este caso.
export type FormaPago = 'contado' | 'credito'

/**
 * Todos los campos (salvo `doc`) son opcionales a propósito: este objeto se llena
 * incrementalmente por el OCR + parser, que pueden fallar en extraer cualquier
 * campo individual (mala foto, formato inesperado, etc). Un campo opcional
 * (`numero?: string`) se tipa como `string | undefined`, y TS obliga a revisar
 * si existe antes de usarlo (con `strictNullChecks`, ver tsconfig). Eso es
 * justamente lo que queremos: que el compilador te recuerde en cada punto de la
 * UI de Review que un campo puede no haberse podido leer, en vez de asumir que
 * siempre viene con datos como harías con un DTO de backend ya validado.
 */
export interface ExtractedData {
  // Literal fijo en vez de `string`: hoy solo soportamos factura de compra (FC).
  // Escribirlo como el tipo literal 'FC' (no `string`) sirve de documentación viva
  // y, el día que se sumen otros tipos de documento, cambiar esto a
  // `'FC' | 'NC' | 'ND'` hace que TS marque en rojo cada sitio del código que
  // asumía que siempre era 'FC'.
  doc: 'FC'

  numero?: string
  fecha?: string // formato ISO 'YYYY-MM-DD' una vez normalizada por el parser
  nit?: string // normalizado: solo dígitos, sin puntos/espacios/guion
  dv?: string // dígito de verificación, calculado (no confiar en el OCR), '0'-'9'
  razonSocial?: string
  direccion?: string
  ciudad?: string
  telefono?: string
  centroCosto?: string
  concepto?: string

  // Los montos son `number`, no `string`. El OCR entrega texto ("$ 1.234.567"),
  // así que la conversión a número (quitar separadores de miles, etc.) es
  // responsabilidad del parser; para cuando el dato llega a la UI/Excel ya debe
  // ser un número limpio con el que se puede sumar/restar/formatear sin parsear.
  valorBase?: number
  porcentajeIva?: number // como fracción, ej. 0.19 para 19% — así se escribe directo en la celda con formato 0.00%
  ivaMonto?: number
  total?: number

  formaPago?: FormaPago
}
