import { clearToken, getToken, isTokenValid } from '../auth/authToken'
import type { ExtractedData, FormaPago } from '../types/extractedData'
import type { ReceiptStatus } from '../types/receipt'
import { calcularDV } from '../utils/dv'
import { esNitConsumidorFinal, normalizeNit } from '../utils/nit'
import { withTimeout } from '../utils/withTimeout'
import { cajaValida, type Caja } from './caja'

// Ruta ONLINE de extracción: manda la foto de la tirilla a la función
// serverless api/extract.ts (que a su vez llama a un modelo de visión vía
// OpenRouter) y recibe los campos ya estructurados. La clave de OpenRouter NO
// está aquí — vive en el servidor. Esta ruta es un COMPLEMENTO del pipeline
// offline de Tesseract, no un reemplazo: si no hay internet o algo falla,
// Capture cae al OCR local. Por eso las funciones acá nunca "arreglan" el
// error: lo propagan para que Capture decida usar el fallback.

// Mismo dominio siempre: en producción la sirve Vercel y en dev local el
// plugin apiLocal de vite.config.ts.
const EXTRACT_URL = '/api/extract'
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

/** Campos crudos tal cual los devuelve api/extract.ts (cualquiera puede ser null). */
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
  box_2d?: unknown // ver extract/caja.ts; se valida con cajaValida()
}

/** Una factura ya interpretada, lista para guardarse como Receipt. */
export interface FacturaExtraida {
  data: ExtractedData
  status: ReceiptStatus
  /** JSON crudo del modelo para esta factura, guardado como rawOCRText. */
  raw: string
  /** Dónde está la factura dentro de la foto; undefined si no se puede recortar. */
  caja?: Caja
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
  // normalizeNit() lanza si el texto no tiene dígitos ("N/A") o tiene más de
  // 15; sin este filtro, un NIT raro tumbaba la extracción completa (y con
  // varias facturas en la foto, se perdían todas por culpa de una).
  const cantidadDigitos = nitTexto?.replace(/\D/g, '').length ?? 0
  if (nitTexto && cantidadDigitos >= 1 && cantidadDigitos <= 15) {
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

  // Sin IVA (0%, ej. "no responsable de IVA"): toda la venta es base. El modelo
  // suele dejar la base en null en estas facturas, y sin esto la columna M del
  // Excel quedaba vacía -> las fórmulas daban el total de la fila en $0.
  if (data.valorBase === undefined && data.total !== undefined && data.porcentajeIva === 0) {
    data.valorBase = data.total
    data.ivaMonto ??= 0
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
 * Interpreta la respuesta de api/extract.ts: `{ facturas: [...] }`, una entrada
 * por cada factura que el modelo encontró en la foto.
 *
 * Con VARIAS facturas en una misma foto hay un riesgo que no existe con una
 * sola: que el modelo cruce datos entre ellas (el NIT de una con el total de
 * otra). El DV no detecta eso — un NIT válido puesto en la factura equivocada
 * sigue validando. Por eso, si hay más de una, ninguna nace 'ok': todas van a
 * 'review' para que la usuaria las confirme contra su recorte. Y las que no
 * traen nada útil ('error') se descartan, porque casi siempre son una
 * detección falsa (un papel que no era factura, la misma tirilla contada dos
 * veces), no una factura real ilegible.
 */
export function interpretarFacturas(body: unknown): FacturaExtraida[] {
  const lista = (body as { facturas?: unknown } | null)?.facturas
  if (!Array.isArray(lista)) {
    throw new Error('La extracción con IA no devolvió "facturas"')
  }

  const facturas = lista
    .filter((f): f is CamposLLM => typeof f === 'object' && f !== null)
    .map((campos): FacturaExtraida => ({
      ...construirResultado(campos),
      raw: JSON.stringify(campos),
      caja: cajaValida(campos.box_2d),
    }))

  if (facturas.length <= 1) {
    if (facturas.length === 0) throw new Error('La IA no encontró ninguna factura en la foto')
    return facturas
  }

  const utiles = facturas.filter((f) => f.status !== 'error')
  if (utiles.length === 0) throw new Error('La IA no pudo leer ninguna de las facturas de la foto')
  return utiles.map((f) => ({ ...f, status: 'review' }))
}

/**
 * Extrae los datos de las facturas de la foto mandándola a api/extract.ts.
 * Lanza si no hay sesión, si la red falla, o si el servidor responde error —
 * Capture atrapa eso y usa el pipeline de Tesseract como respaldo.
 */
export async function extraerConLLM(blob: Blob): Promise<FacturaExtraida[]> {
  const token = getToken()
  if (!token || !isTokenValid()) {
    throw new Error('Ruta LLM no disponible (sesión no iniciada o expirada)')
  }

  const imageBase64 = await blobABase64(blob)
  const mimeType = blob.type || 'image/jpeg'

  const resp = await withTimeout(
    fetch(EXTRACT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ imageBase64, mimeType }),
    }),
    LLM_TIMEOUT_MS,
    `La extracción con IA no respondió en ${LLM_TIMEOUT_MS / 1000}s`,
  )

  // 401 = el servidor rechazó la firma del token (se rotó APP_AUTH_SECRET, o es
  // un token de otro entorno). El cliente solo valida la fecha, así que sin
  // esto el token "vigente" seguiría mandando cada foto al OCR local en
  // silencio hasta que expire. Se borra para que RequireAuth pida login en la
  // siguiente navegación.
  if (resp.status === 401) clearToken()

  if (!resp.ok) {
    const detalle = await resp.text().catch(() => '')
    throw new Error(`La extracción con IA respondió ${resp.status}: ${detalle.slice(0, 200)}`)
  }

  return interpretarFacturas(await resp.json())
}
