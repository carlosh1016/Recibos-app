// Mapa de columnas de public/templates/plantilla_facturas_compra.xlsx. Esto es
// dato literal (no una heurística que haya que "adivinar" del OCR), así que se
// implementa completo de una vez — es la única fuente de verdad para
// excel/export.ts sobre qué va en cada columna.

// Los recibos se agregan como filas NUEVAS empezando en la fila 4 (las
// primeras 3 filas de la plantilla son título/encabezado).
export const PRIMERA_FILA = 4

// Columnas con valores directos que salen de ExtractedData (no son fórmula).
export const COL_DIRECTA = {
  doc: 'A', // siempre "FC"
  numero: 'B',
  fecha: 'C', // formato de celda: fecha
  nit: 'D',
  dv: 'E', // SIEMPRE calculado (ver utils/dv.ts), nunca el DV leído por OCR
  razonSocial: 'F',
  direccion: 'G', // o vacío si no se extrajo
  ciudad: 'H', // o vacío
  telefono: 'I', // o vacío
  concepto: 'K',
  valorBase: 'M', // OJO: es la BASE, nunca el total — ver reconciliacion.ts
  porcentajeIva: 'P',
  formaPago: 'AH', // valor de celda: 11050501 (contado) / 22050501 (crédito)
} as const

// Códigos que van en la columna AH según ExtractedData.formaPago.
export const CODIGO_FORMA_PAGO = {
  contado: 11050501,
  credito: 22050501,
} as const

// Columnas J y L de la plantilla no están mapeadas a ningún campo de
// ExtractedData en el encargo original (ni siquiera `centroCosto`, que sí
// existe en el modelo de datos). Antes de implementar excel/export.ts hay que
// confirmar con la plantilla real si alguna de esas columnas corresponde a
// centro de costo o debe quedar vacía — no se adivina aquí para no escribir
// datos en la columna equivocada de una factura real.

// Columnas de retención (S, W, AA, AE): quedan vacías/0 por defecto, se
// ajustan a mano después de exportar.
export const COL_RETENCION = {
  reteFuente: 'S',
  reteIca: 'W',
  reteIva: 'AA',
  reteOtra: 'AE',
} as const

/**
 * Fórmulas por fila (r = número de fila de la hoja, ej. 4, 5, 6...). Se
 * devuelven como texto de fórmula SIN el signo "=" inicial porque así las
 * espera ExcelJS al asignarlas: `cell.value = { formula: FORMULAS.N(4) }`.
 * Deben escribirse como fórmula (para que Excel las recalcule si alguien
 * edita una celda de retención a mano), nunca precalcular el resultado.
 */
export const FORMULAS = {
  N: (r: number) => `IF(O${r}>0,240810," ")`,
  O: (r: number) => `IF(P${r}>0,M${r},0)`,
  Q: (r: number) => `ROUND(O${r}*P${r},0)`,

  R: (r: number) => `IF(S${r}>0,236705," ")`,
  T: (r: number) => `IF(S${r}>0,Q${r},0)`,
  U: (r: number) => `IF(P${r}=2.4%,Q${r},ROUND(T${r}*S${r},0))`,

  V: (r: number) => `IF(W${r}>0,236540," ")`,
  X: (r: number) => `IF(W${r}>0,M${r},0)`,
  Y: (r: number) => `ROUND(X${r}*W${r},0)`,

  Z: (r: number) => `IF(AA${r}>0,236805," ")`,
  AB: (r: number) => `IF(AA${r}>0,M${r},0)`,
  AC: (r: number) => `ROUND(AB${r}*AA${r}/1000,0)`,

  AD: (r: number) => `IF(AE${r}>0,135519," ")`,
  AF: (r: number) => `IF(AE${r}>0,M${r},0)`,
  AG: (r: number) => `ROUND(AF${r}*AE${r},0)`,

  AI: (r: number) => `+M${r}+Q${r}-U${r}-Y${r}-AC${r}-AG${r}`,
} as const

// Formatos numéricos a preservar/aplicar por columna (no cambian entre filas).
export const FORMATOS_CELDA = {
  fecha: 'dd/mm/yyyy', // columna C
  moneda: '#,##0', // columnas M, Q, AI
  porcentaje: '0.00%', // columnas P, S, W, AE
} as const
