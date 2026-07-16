import type { ExtractedData, ReceiptStatus } from '../types'
import { calcularDV } from '../utils/dv'
import { normalizarFecha } from './fecha'

// NIT "comodín" de consumidor final que usan muchos POS colombianos. Nunca es
// el NIT real de un emisor.
const NIT_CONSUMIDOR_FINAL = '222222222222'

// Líneas que mencionan estas palabras casi seguro traen el NIT de otra
// entidad (el cliente/adquiriente, o un hash/autorización), no el del emisor.
const PALABRAS_EXCLUYEN_NIT = /cufe|cliente|consumidor|adquiriente|autorizacion/i

export interface ReconcileResult {
  data: ExtractedData
  // Decidido acá (no en el caller) porque es exactamente la información que
  // Capture.tsx necesita para guardar el Receipt con el status correcto: si
  // los valores no cuadran o el NIT tiene baja confianza, el recibo nace en
  // 'error' para que Review lo priorice, en vez de nacer 'pending' y que el
  // usuario tenga que notar el problema él mismo.
  status: ReceiptStatus
  // Confianza específica del NIT (independiente del status general), para
  // que Review pueda mostrar "revisar NIT" en vez de solo "algo no cuadra".
  confianzaNit?: 'alta' | 'baja'
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Convierte un fragmento de texto tipo "$ 14.100" o "11.848,74" a number.
 * Los recibos colombianos mezclan puntos y comas como separador de miles o
 * de decimales según el sistema que emitió la factura, así que no se puede
 * asumir un formato fijo: se decide mirando cuál separador aparece de último
 * (ese es el decimal) y cuántos dígitos lo siguen.
 */
function parseMonto(texto: string): number | undefined {
  const limpio = texto.replace(/[^\d.,]/g, '')
  if (!limpio) return undefined

  const tieneComa = limpio.includes(',')
  const tienePunto = limpio.includes('.')
  let normalizado: string

  if (tieneComa && tienePunto) {
    const decimalEsComa = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
    normalizado = decimalEsComa
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '')
  } else if (tieneComa) {
    const partes = limpio.split(',')
    const ultima = partes[partes.length - 1]
    normalizado = ultima.length === 2 ? `${partes.slice(0, -1).join('')}.${ultima}` : partes.join('')
  } else if (tienePunto) {
    const partes = limpio.split('.')
    const ultima = partes[partes.length - 1]
    normalizado =
      partes.length > 1 && ultima.length === 2 ? `${partes.slice(0, -1).join('')}.${ultima}` : partes.join('')
  } else {
    normalizado = limpio
  }

  const valor = Number(normalizado)
  return Number.isFinite(valor) ? valor : undefined
}

/**
 * TOTAL: "el valor grande junto a 'TOTAL A PAGAR' o 'Total'". Suele
 * repetirse en la factura (encabezado + pie), así que se toma el valor más
 * frecuente entre todas las coincidencias en vez del primero o el último.
 */
function detectarTotal(texto: string): number | undefined {
  const candidatos: number[] = []
  // \btotal\b no matchea "subtotal" (no hay borde de palabra entre "sub" y "total").
  const regex = /total\s*a\s*pagar|\btotal\b/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(texto))) {
    const ventana = texto.slice(match.index, match.index + match[0].length + 25)
    const numero = ventana.match(/([\d.,]+)/)
    if (numero) {
      const monto = parseMonto(numero[1])
      if (monto !== undefined) candidatos.push(monto)
    }
  }
  if (candidatos.length === 0) return undefined

  const conteo = new Map<number, number>()
  for (const c of candidatos) conteo.set(c, (conteo.get(c) ?? 0) + 1)
  let mejor = candidatos[0]
  let mejorConteo = 0
  for (const c of candidatos) {
    const n = conteo.get(c) ?? 0
    if (n > mejorConteo) {
      mejor = c
      mejorConteo = n
    }
  }
  return mejor
}

function detectarBaseExplicita(texto: string): number | undefined {
  const m = texto.match(/(?:base\s*(?:gravable)?|subtotal)[^\d\n]{0,20}([\d.,]+)/i)
  return m ? parseMonto(m[1]) : undefined
}

/** % IVA: 19, 5 o 0 dentro de una ventana de texto cerca de "IVA"/"Incluido". */
function detectarPorcentajeIva(texto: string): number | undefined {
  const centros = [...texto.matchAll(/iva|incluido/gi)].map((m) => m.index ?? 0)
  for (const centro of centros) {
    const alrededor = texto.slice(Math.max(0, centro - 20), centro + 20)
    for (const pct of [19, 5, 0]) {
      if (new RegExp(`\\b${pct}\\s?%`).test(alrededor)) return pct / 100
    }
  }
  return undefined
}

interface CandidatoNit {
  nit: string
  dv: string
  dvOCR: string
  confianza: 'alta' | 'baja'
  lineaIndex: number
}

/**
 * NIT del emisor: se busca solo en las primeras 8 líneas (ahí es donde las
 * facturas colombianas casi siempre imprimen los datos del emisor). El DV se
 * separa tomando el ÚLTIMO dígito del bloque numérico completo (después de
 * quitar puntos/espacios/guiones) en vez de buscar un guion explícito — el
 * guion se pierde seguido en el OCR, pero el dígito sigue estando ahí.
 */
function buscarNitEmisor(lineas: string[]): CandidatoNit | undefined {
  const NIT_CANDIDATO = /(\d[\d.\s-]{6,18}\d)/

  for (let i = 0; i < Math.min(8, lineas.length); i++) {
    const linea = lineas[i]
    if (!/nit/i.test(linea)) continue
    if (PALABRAS_EXCLUYEN_NIT.test(linea)) continue

    const match = linea.match(NIT_CANDIDATO)
    if (!match) continue

    const soloDigitos = match[1].replace(/[.\s-]/g, '')
    if (soloDigitos === NIT_CONSUMIDOR_FINAL) continue
    // NIT de 9-10 dígitos + 1 dígito de DV = 10-11 dígitos en total.
    if (soloDigitos.length < 10 || soloDigitos.length > 11) continue

    const nit = soloDigitos.slice(0, -1)
    const dvOCR = soloDigitos.slice(-1)
    const dv = calcularDV(nit)

    return { nit, dv, dvOCR, confianza: dv === dvOCR ? 'alta' : 'baja', lineaIndex: i }
  }
  return undefined
}

function esMayoriaAlfabetica(linea: string): boolean {
  const limpia = linea.trim()
  if (limpia.length < 3) return false
  const alfabeticos = (limpia.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length
  return alfabeticos / limpia.length > 0.6
}

/** Primera línea "mayormente texto" antes de la línea del NIT. */
function extraerRazonSocial(lineas: string[], lineaNit: number | undefined): string | undefined {
  const limite = lineaNit ?? Math.min(8, lineas.length)
  for (let i = 0; i < limite; i++) {
    if (esMayoriaAlfabetica(lineas[i])) return lineas[i].trim()
  }
  return undefined
}

function extraerNumeroFactura(texto: string): string | undefined {
  const m = texto.match(/(?:factura|fac\.?|nro\.?|no\.?)\s*[:.]?\s*([A-Za-z]{2,5}[\s-]?\d{2,8})/i)
  return m ? m[1].trim() : undefined
}

function extraerFecha(texto: string): string | undefined {
  const patrones = [
    /\d{4}-\d{2}-\d{2}/,
    /[A-Za-zÀ-ÿ]+[-\s,/]+\d{1,2}[-\s,/]+\d{4}/,
    /\d{1,2}[-\s,/]+[A-Za-zÀ-ÿ]+[-\s,/]+\d{4}/,
    /\d{1,2}[/-]\d{1,2}[/-]\d{4}/,
  ]
  for (const patron of patrones) {
    const m = texto.match(patron)
    if (m) {
      const normalizada = normalizarFecha(m[0])
      if (normalizada) return normalizada
    }
  }
  return undefined
}

function extraerConcepto(texto: string): string | undefined {
  const m = texto.match(/concepto\s*:?\s*(.+)/i)
  // TODO: fallback a "la descripción del primer ítem" cuando no hay una
  // línea "Concepto:" explícita — no se implementa todavía porque sin datos
  // reales de qué formato traen los ítems, cualquier heurística acá
  // adivinaría a ciegas. Mejor dejarlo en blanco para completarlo a mano en
  // Review que arriesgar un concepto equivocado en el Excel final.
  return m ? m[1].trim() : undefined
}

/**
 * Compara el total reconstruido (base+iva, el que se PREFIERE guardar) contra
 * el total detectado independientemente en el texto (el que de verdad
 * imprimió la factura). Cuando el total reconstruido salió de derivar un
 * valor A PARTIR de ese mismo total detectado (branches 1 y 2 de reconcile,
 * donde el IVA se calcula como residuo), esta comparación siempre da igual
 * por construcción — lo cual es correcto: no hay nada independiente que
 * contrastar. El caso que sí puede fallar de verdad es cuando base y % de
 * IVA vienen de fuentes independientes del total (branch 3): ahí, si el
 * total reconstruido no se parece al impreso, algo no cuadra de verdad
 * (un dígito mal leído por OCR, un descuento no contemplado, etc.).
 */
function valoresReconcilian(totalDetectado?: number, totalReconstruido?: number): boolean {
  if (totalDetectado === undefined || totalReconstruido === undefined) return false
  return Math.abs(totalDetectado - totalReconstruido) <= 1
}

/**
 * Punto de entrada real del parser (reemplaza el antiguo parser/index.ts,
 * que solo orquestaba stubs). Recibe el texto crudo de tesseract.js y
 * devuelve tanto los datos extraídos como el status que debería tener el
 * Receipt: 'error' si algo no cuadra (valores o NIT de baja confianza), para
 * que ese recibo salte a la vista en Review en vez de perderse entre los
 * demás.
 */
export function reconcile(rawText: string): ReconcileResult {
  const lineas = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0)

  const candidatoNit = buscarNitEmisor(lineas)
  const razonSocial = extraerRazonSocial(lineas, candidatoNit?.lineaIndex)
  const numero = extraerNumeroFactura(rawText)
  const fecha = extraerFecha(rawText)
  const concepto = extraerConcepto(rawText)

  // `total` es el valor DETECTADO en el texto (usado como pista y, cuando
  // hay suficiente información independiente, como chequeo de consistencia).
  // El total que termina en `data` es el RECONSTRUIDO (base+iva) — ver
  // totalFinal más abajo.
  const total = detectarTotal(rawText)
  const baseExplicita = detectarBaseExplicita(rawText)
  const ivaIncluido = /iva\s+incluido|incluido\s+de\s+iva/i.test(rawText)
  const noResponsableIva = /no\s+responsable\s+de\s+iva/i.test(rawText)
  let porcentajeIva = detectarPorcentajeIva(rawText)
  if (porcentajeIva === undefined && noResponsableIva) porcentajeIva = 0

  let valorBase: number | undefined
  let ivaMonto: number | undefined

  if (noResponsableIva || porcentajeIva === 0) {
    // Sin IVA (INC, no responsable, etc.): toda la venta es base.
    valorBase = baseExplicita ?? total
    ivaMonto = 0
  } else if (ivaIncluido && porcentajeIva !== undefined && total !== undefined) {
    // El total impreso YA incluye el IVA: la base se reconstruye a partir de él.
    valorBase = redondear2(total / (1 + porcentajeIva))
    ivaMonto = redondear2(total - valorBase)
  } else if (baseExplicita !== undefined && porcentajeIva !== undefined) {
    // Base y % de IVA vienen de fuentes independientes del total: el IVA se
    // reconstruye multiplicando (nunca se toma un monto de IVA leído aparte
    // del OCR, más propenso a confundirse con ruido del layout). Este es el
    // único caso donde `total` (detectado abajo) queda libre para servir de
    // chequeo real, en vez de haber sido usado para derivar algo.
    valorBase = baseExplicita
    ivaMonto = redondear2(valorBase * porcentajeIva)
  } else if (baseExplicita !== undefined && total !== undefined) {
    // Sin % de IVA detectado pero sí base y total: el IVA sale por diferencia.
    valorBase = baseExplicita
    ivaMonto = redondear2(total - valorBase)
  }

  // "Preferir siempre los valores reconstruidos sobre los leídos directo por
  // OCR": el total que se guarda es base+iva ya reconstruido, no el leído
  // directo del texto (que solo se usa arriba como insumo/chequeo).
  const totalReconstruido =
    valorBase !== undefined && ivaMonto !== undefined ? redondear2(valorBase + ivaMonto) : undefined
  const totalFinal = totalReconstruido ?? total

  const data: ExtractedData = {
    doc: 'FC',
    numero,
    fecha,
    nit: candidatoNit?.nit,
    dv: candidatoNit?.dv,
    razonSocial,
    concepto,
    valorBase,
    porcentajeIva,
    ivaMonto,
    total: totalFinal,
  }

  const nitOk = candidatoNit?.confianza === 'alta'
  const valoresOk = valoresReconcilian(total, totalReconstruido)
  const status: ReceiptStatus = nitOk && valoresOk ? 'pending' : 'error'

  return { data, status, confianzaNit: candidatoNit?.confianza }
}
