import { getToken, isTokenValid } from '../auth/authToken'
import type { ExtractedData, FormaPago } from '../types/extractedData'
import type { ReceiptStatus } from '../types/receipt'
import { calcularDV } from '../utils/dv'
import { esNitConsumidorFinal, normalizeNit } from '../utils/nit'
import { withTimeout } from '../utils/withTimeout'

// Ruta ONLINE de extracción: manda la imagen recortada de la tirilla al proxy
// serverless (que a su vez llama a Gemini) y recibe los campos ya estructurados.
// La clave de Gemini NO está aquí — vive en el proxy (ver proxy/README.md). Esta
// ruta es un COMPLEMENTO del pipeline offline de Tesseract, no un reemplazo: si
// no hay proxy configurado, no hay internet, o algo falla, Capture cae al OCR
// local. Por eso las funciones acá nunca "arreglan" el error: lo propagan para
// que Capture decida usar el fallback.

// URL del proxy. Si el build NO define VITE_LLM_PROXY_URL, se usa la ruta del
// MISMO dominio '/api/extract' — que es la función serverless de Vercel
// (api/extract.ts). En local se puede apuntar a wrangler con
// VITE_LLM_PROXY_URL=http://localhost:8787 (ver .env).
const PROXY_URL = import.meta.env.VITE_LLM_PROXY_URL || '/api/extract'
const LLM_TIMEOUT_MS = 30_000
const MARGEN_CUADRE = 1 // pesos; mismo criterio que el parser (reconcile.ts)

/**
 * Hay ruta LLM disponible si hay una sesión iniciada (token vigente). Antes
 * dependía de un token compartido incrustado en el build; ahora depende de que
 * la usuaria haya iniciado sesión con la contraseña (ver src/auth/authToken.ts).
 */
export function llmDisponible(): boolean {
  return isTokenValid()
}

/** Campos crudos tal cual los devuelve el proxy (cualquiera puede ser null). */
interface CamposLLM {
  razonSocial?: string | null
  nit?: string | null
  numero?: string | null
  fecha?: string | null
  concepto?: string | null
  valorBase?: number | null
  porcentajeIva?: number | null
  ivaMonto?: number | null
  total?: number | null
  formaPago?: string | null
}

/** Convierte un Blob a base64 puro (sin el prefijo `data:...;base64,`). */
function blobABase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = reader.result
      if (typeof res !== 'string') {
        reject(new Error('No se pudo leer la imagen como base64'))
        return
      }
      const coma = res.indexOf(',')
      resolve(coma === -1 ? res : res.slice(coma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Error leyendo la imagen'))
    reader.readAsDataURL(blob)
  })
}

function textoLimpio(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function numeroFinito(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function normalizarFormaPago(v: unknown): FormaPago | undefined {
  const t = textoLimpio(v)?.toLowerCase()
  if (t === 'contado' || t === 'credito' || t === 'crédito') return t === 'crédito' ? 'credito' : (t as FormaPago)
  return undefined
}

const redondear2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Construye un ExtractedData confiable a partir de los campos del LLM. NUNCA
 * confía a ciegas: el DV se RECALCULA desde el NIT (como en el parser), el
 * comodín de consumidor final se descarta, y si falta la base pero hay total +
 * %IVA se reconstruye. Devuelve también el status según la misma filosofía que
 * reconcile: 'ok' solo si hay NIT y total sin discrepancia.
 */
function construirResultado(campos: CamposLLM): { data: ExtractedData; status: ReceiptStatus } {
  const data: ExtractedData = { doc: 'FC' }

  const nitTexto = textoLimpio(campos.nit)
  if (nitTexto) {
    const { nit } = normalizeNit(nitTexto)
    if (nit.length >= 8 && !esNitConsumidorFinal(nit)) {
      data.nit = nit
      data.dv = calcularDV(nit) // recomputado, no el que "leyó" el modelo
    }
  }

  data.razonSocial = textoLimpio(campos.razonSocial)
  data.numero = textoLimpio(campos.numero)
  data.fecha = textoLimpio(campos.fecha)
  data.concepto = textoLimpio(campos.concepto)
  data.formaPago = normalizarFormaPago(campos.formaPago)

  data.total = numeroFinito(campos.total)
  data.valorBase = numeroFinito(campos.valorBase)
  data.porcentajeIva = numeroFinito(campos.porcentajeIva)
  data.ivaMonto = numeroFinito(campos.ivaMonto)

  // Reconstrucción base/iva si falta la base pero hay total + %IVA (> 0).
  if (data.valorBase === undefined && data.total !== undefined && data.porcentajeIva && data.porcentajeIva > 0) {
    const base = redondear2(data.total / (1 + data.porcentajeIva))
    data.valorBase = base
    if (data.ivaMonto === undefined) data.ivaMonto = redondear2(data.total - base)
  }

  // --- Status -------------------------------------------------------------
  const tieneNit = data.nit !== undefined && data.nit.length >= 8
  const tieneTotal = data.total !== undefined
  const hayDiscrepancia =
    data.valorBase !== undefined &&
    data.ivaMonto !== undefined &&
    data.total !== undefined &&
    Math.abs(data.valorBase + data.ivaMonto - data.total) > MARGEN_CUADRE
  const tieneAlgoUtil = tieneNit || tieneTotal || data.razonSocial !== undefined

  let status: ReceiptStatus
  if (tieneNit && tieneTotal && !hayDiscrepancia) status = 'ok'
  else if (tieneAlgoUtil) status = 'review'
  else status = 'error'

  return { data, status }
}

/**
 * Extrae los datos de la factura mandando la imagen recortada al proxy. Lanza si
 * no hay proxy configurado, si la red falla, o si el proxy responde error —
 * Capture atrapa eso y usa el pipeline de Tesseract como respaldo.
 *
 * `raw` es el JSON crudo devuelto por el modelo, para guardarlo como rawOCRText
 * (útil en Review para depurar qué "vio" el LLM).
 */
export async function extraerConLLM(
  blob: Blob,
): Promise<{ data: ExtractedData; status: ReceiptStatus; raw: string }> {
  const token = getToken()
  if (!token || !isTokenValid()) {
    throw new Error('Ruta LLM no disponible (sesión no iniciada o expirada)')
  }

  const imageBase64 = await blobABase64(blob)
  const mimeType = blob.type || 'image/jpeg'

  const resp = await withTimeout(
    fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ imageBase64, mimeType }),
    }),
    LLM_TIMEOUT_MS,
    `El proxy LLM no respondió en ${LLM_TIMEOUT_MS / 1000}s`,
  )

  if (!resp.ok) {
    const detalle = await resp.text().catch(() => '')
    throw new Error(`El proxy LLM respondió ${resp.status}: ${detalle.slice(0, 200)}`)
  }

  const body = (await resp.json()) as { fields?: CamposLLM }
  if (!body.fields || typeof body.fields !== 'object') {
    throw new Error('El proxy LLM no devolvió "fields"')
  }

  const { data, status } = construirResultado(body.fields)
  return { data, status, raw: JSON.stringify(body.fields) }
}
