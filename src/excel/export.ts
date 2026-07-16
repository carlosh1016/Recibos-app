import type { Receipt } from '../types'

const TEMPLATE_URL = '/templates/plantilla_facturas_compra.xlsx'

/**
 * Genera el Excel final a partir de los recibos ya revisados, cargando la
 * plantilla del usuario y agregando una fila por recibo desde
 * PRIMERA_FILA (4). Devuelve un Blob listo para descargar (crear un
 * `<a download>` con `URL.createObjectURL`).
 *
 * TODO implementar, usando exceljs:
 * 1. `const res = await fetch(TEMPLATE_URL)` y `workbook.xlsx.load(await res.arrayBuffer())`
 *    — la plantilla vive en public/, así que en runtime queda servida en esa
 *    misma ruta (y precacheada por el service worker, ver vite.config.ts).
 * 2. Tomar la hoja correcta con `workbook.worksheets[0]` (o por nombre si la
 *    plantilla tiene varias pestañas).
 * 3. Por cada receipt, en la fila `PRIMERA_FILA + index`:
 *    - Escribir los valores directos usando COL_DIRECTA (columnMap.ts):
 *      doc, numero, fecha, nit, dv, razonSocial, direccion, ciudad,
 *      telefono, concepto, valorBase, porcentajeIva.
 *    - `formaPago` no se escribe tal cual: se traduce con
 *      CODIGO_FORMA_PAGO[data.formaPago] antes de escribirla en AH.
 *    - Las columnas de retención (COL_RETENCION) se dejan vacías/0.
 *    - Las columnas de fórmula (FORMULAS.N, .O, .Q, .R, .T, .U, .V, .X, .Y,
 *      .Z, .AB, .AC, .AD, .AF, .AG, .AI) se asignan como
 *      `cell.value = { formula: FORMULAS.N(fila) }` — como fórmula, nunca el
 *      resultado ya calculado, para que Excel las recalcule si alguien edita
 *      a mano una celda de retención.
 * 4. Aplicar/confirmar los formatos de celda de FORMATOS_CELDA en las
 *    columnas correspondientes (fecha en C; moneda en M, Q, AI; porcentaje
 *    en P, S, W, AE) — si la plantilla ya trae el formato de columna
 *    predefinido puede bastar con no pisarlo al escribir el valor.
 * 5. `const buffer = await workbook.xlsx.writeBuffer()` y envolverlo en un
 *    `Blob` con el mime type de xlsx
 *    ('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').
 */
export async function exportarExcel(_receipts: Receipt[]): Promise<Blob> {
  throw new Error(`TODO: exportarExcel no implementado (plantilla esperada en ${TEMPLATE_URL})`)
}
