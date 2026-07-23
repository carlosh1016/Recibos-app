import ExcelJS from 'exceljs'
import type { ExtractedData, Receipt } from '../types'
import { calcularDV } from '../utils/dv'
import {
  CODIGO_FORMA_PAGO,
  COL_DIRECTA,
  COL_RETENCION,
  FORMATOS_CELDA,
  FORMULAS,
  PRIMERA_FILA,
} from './columnMap'

const TEMPLATE_URL = '/templates/plantilla_facturas_compra.xlsx'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// Lo que sabemos escribir en una celda directa.
type Escribible = string | number | Date | null

/**
 * Convierte una fecha ISO 'YYYY-MM-DD' a un `Date` LOCAL (no UTC) para que Excel
 * la guarde como fecha real y no como texto. Se construye con partes explícitas
 * (`new Date(y, m-1, d)`) en vez de `new Date(iso)` a propósito: esto último
 * interpreta el string como medianoche UTC y, en zonas horarias negativas como
 * Colombia (UTC-5), la corre al día anterior. Si el texto no viene en ISO, se
 * devuelve tal cual para no perder el dato.
 */
function fechaAExcel(iso: string | undefined): Date | string | undefined {
  if (!iso) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim())
  if (!m) return iso
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** DV a escribir en la columna E: SIEMPRE calculado, nunca el leído por OCR. */
function dvSeguro(data: ExtractedData): string | undefined {
  if (data.dv) return data.dv
  if (!data.nit) return undefined
  try {
    return calcularDV(data.nit)
  } catch {
    return undefined
  }
}

/**
 * Genera el Excel final a partir de los recibos ya revisados, cargando la
 * plantilla del usuario y agregando una fila por recibo desde PRIMERA_FILA (4).
 * Devuelve un Blob listo para descargar. Ver columnMap.ts para el mapeo exacto
 * de columnas, fórmulas y formatos.
 */
export async function exportarExcel(receipts: Receipt[]): Promise<Blob> {
  const res = await fetch(TEMPLATE_URL)
  if (!res.ok) {
    throw new Error(
      `No se pudo cargar la plantilla (${TEMPLATE_URL}): HTTP ${res.status}. ` +
        'Coloca plantilla_facturas_compra.xlsx en public/templates/.',
    )
  }

  const bytes = await res.arrayBuffer()
  // Un .xlsx es un zip: sus dos primeros bytes son "PK" (0x50 0x4B). Si Vite no
  // encuentra el archivo, sirve el index.html del SPA (HTTP 200 pero HTML), y
  // exceljs fallaría con un críptico "Can't find end of central directory".
  // Detectamos ese caso aquí para dar un mensaje entendible.
  const encabezado = new Uint8Array(bytes.slice(0, 2))
  if (encabezado[0] !== 0x50 || encabezado[1] !== 0x4b) {
    throw new Error(
      `Falta la plantilla en public/templates/plantilla_facturas_compra.xlsx ` +
        `(la ruta ${TEMPLATE_URL} no devolvió un archivo .xlsx válido). ` +
        'Coloca ahí tu plantilla contable y reinicia el servidor.',
    )
  }

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes)
  const ws = workbook.worksheets[0]
  if (!ws) throw new Error('La plantilla no tiene ninguna hoja.')

  receipts.forEach((receipt, i) => {
    const fila = PRIMERA_FILA + i
    const { data } = receipt

    const set = (col: string, value: Escribible) => {
      ws.getCell(`${col}${fila}`).value = value
    }

    // --- Columnas directas -------------------------------------------------
    set(COL_DIRECTA.doc, data.doc) // siempre 'FC'
    set(COL_DIRECTA.numero, data.numero ?? null)
    set(COL_DIRECTA.nit, data.nit ?? null)
    set(COL_DIRECTA.dv, dvSeguro(data) ?? null)
    set(COL_DIRECTA.razonSocial, data.razonSocial ?? null)
    set(COL_DIRECTA.direccion, data.direccion ?? null)
    set(COL_DIRECTA.ciudad, data.ciudad ?? null)
    set(COL_DIRECTA.telefono, data.telefono ?? null)
    set(COL_DIRECTA.concepto, data.concepto ?? null)

    // Fecha: como Date real (con formato) si viene en ISO; si no, texto crudo.
    const fecha = fechaAExcel(data.fecha)
    const celdaFecha = ws.getCell(`${COL_DIRECTA.fecha}${fila}`)
    celdaFecha.value = fecha ?? null
    if (fecha instanceof Date) celdaFecha.numFmt = FORMATOS_CELDA.fecha

    // Base (moneda) — es la BASE, nunca el total.
    const celdaBase = ws.getCell(`${COL_DIRECTA.valorBase}${fila}`)
    celdaBase.value = data.valorBase ?? null
    celdaBase.numFmt = FORMATOS_CELDA.moneda

    // % IVA — se guarda como fracción (0.19) con formato porcentaje.
    const celdaIva = ws.getCell(`${COL_DIRECTA.porcentajeIva}${fila}`)
    celdaIva.value = data.porcentajeIva ?? null
    celdaIva.numFmt = FORMATOS_CELDA.porcentaje

    // Forma de pago: no se escribe tal cual, se traduce a su código contable.
    set(COL_DIRECTA.formaPago, data.formaPago ? CODIGO_FORMA_PAGO[data.formaPago] : null)

    // --- Retenciones: 0 por defecto, se ajustan a mano tras exportar -------
    for (const col of Object.values(COL_RETENCION)) {
      ws.getCell(`${col}${fila}`).value = 0
    }
    // Las tasas de retención se muestran como porcentaje (S, W, AE).
    for (const col of [COL_RETENCION.reteFuente, COL_RETENCION.reteIca, COL_RETENCION.reteOtra]) {
      ws.getCell(`${col}${fila}`).numFmt = FORMATOS_CELDA.porcentaje
    }

    // --- Fórmulas por fila -------------------------------------------------
    // Se escriben como fórmula (no el resultado precalculado) para que Excel
    // las recalcule si se edita una celda de retención a mano.
    for (const [col, fn] of Object.entries(FORMULAS)) {
      ws.getCell(`${col}${fila}`).value = { formula: fn(fila) }
    }
    // Columnas de fórmula con formato moneda.
    ws.getCell(`Q${fila}`).numFmt = FORMATOS_CELDA.moneda
    ws.getCell(`AI${fila}`).numFmt = FORMATOS_CELDA.moneda
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return new Blob([buffer as BlobPart], { type: XLSX_MIME })
}
