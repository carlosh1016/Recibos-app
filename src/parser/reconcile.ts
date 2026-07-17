import type { ExtractedData, FormaPago, ReceiptStatus } from '../types'
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
  // 'review' para que Review lo priorice; solo nace en 'error' si no se
  // rescató nada útil. Ver ReceiptStatus para el detalle de cada estado.
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

// Techo plausible para un total de factura: descarta de una vez números que
// en realidad son un NIT (9-11 dígitos -> cientos/miles de millones), un CUFE,
// o un número de resolución DIAN, que si no se acotara podrían ganar el
// fallback de "el valor más grande" y meterse como total.
const TOTAL_MAXIMO_PLAUSIBLE = 100_000_000

// Piso plausible para una base/total en pesos colombianos: sirve para
// descartar "montos" que en realidad son ruido del OCR (ej. un "$" que se leyó
// como "8", o un dígito suelto). En COP no hay facturas de menos de $100.
const MONTO_MINIMO_PLAUSIBLE = 100

/**
 * Primer monto "de verdad" dentro de un fragmento: el primero que parsea a un
 * número >= MONTO_MINIMO_PLAUSIBLE. Así se salta el ruido tipo "Subtotal: 8
 * 14.100,00", donde el "8" (un "$" mal leído) es un token numérico pero no un
 * monto real. Admite montos partidos por el OCR con un espacio ("14,100, 00").
 */
function primerMontoPlausible(fragmento: string): number | undefined {
  // Un dígito seguido de dígitos/./,/espacio y cerrado por dígito: captura
  // "14,100, 00" completo. El espacio (no el salto de línea) permite el corte
  // que mete el OCR entre los miles y los decimales.
  const regex = /\d[\d., ]*\d|\d/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(fragmento))) {
    const monto = parseMonto(match[0])
    if (monto !== undefined && monto >= MONTO_MINIMO_PLAUSIBLE && monto <= TOTAL_MAXIMO_PLAUSIBLE) {
      return monto
    }
  }
  return undefined
}

// Líneas cuyo monto NO es el total: lo que el cliente entregó ("Recibido"),
// el vuelto ("Cambio"/"Devuelta"). Si no se excluyeran, el fallback de "el
// monto más grande" podría tomar los $50.100 de "Recibido" como total y, con
// un NIT válido, marcar el recibo como 'ok' con un total equivocado.
const LINEA_NO_ES_TOTAL = /recib|cambio|vuelt|devuel/i

/**
 * Todos los montos "tipo dinero" del texto: tokens con separadores de miles
 * (1.234 / 1,234) o con decimales (1234,56). Se excluyen bloques de puros
 * dígitos sin separador (un NIT, un teléfono o un número de factura no son
 * montos), los que superan el techo plausible, y los que están en líneas de
 * Recibido/Cambio. Devuelve los valores parseados para el fallback de
 * detectarTotal.
 */
function detectarMontos(texto: string): number[] {
  const montos: number[] = []
  // Número con al menos un separador de miles (\d{1,3}([.,]\d{3})+, admite
  // decimales al final) o con decimales (\d+[.,]\d{2}). Se ignora un "$"
  // previo si lo hay: no cambia el valor, solo delimita.
  const regex = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2}/g
  // Se recorre por línea para poder descartar líneas de Recibido/Cambio.
  for (const linea of texto.split(/\r?\n/)) {
    if (LINEA_NO_ES_TOTAL.test(linea)) continue
    let match: RegExpExecArray | null
    while ((match = regex.exec(linea))) {
      const monto = parseMonto(match[0])
      if (monto !== undefined && monto <= TOTAL_MAXIMO_PLAUSIBLE) montos.push(monto)
    }
  }
  return montos
}

/**
 * TOTAL: "el valor grande junto a 'TOTAL A PAGAR' o 'Total'". Suele
 * repetirse en la factura (encabezado + pie), así que se toma el valor más
 * frecuente entre todas las coincidencias en vez del primero o el último.
 *
 * Detalles que impone el OCR real (ver factura de parqueadero de ejemplo):
 * - "TOTAL" se lee mal ("T0TAL", "TUTAL"): [O0U] en la 2ª letra.
 * - Entre la etiqueta y el monto aparece basura ("TOTAL A PAGAR ===> $"):
 *   se puentea con [^\d\n]{0,25} (cualquier no-dígito, sin cruzar de línea).
 * - \b antes de la etiqueta para NO matchear "Subtotal" (no hay borde de
 *   palabra entre "sub" y "total", así que \bTOTAL lo excluye solo).
 * - El monto puede venir partido por un espacio ("14,100, 00"): el grupo
 *   captura dígitos/./,/espacio y parseMonto quita el espacio.
 * Si NINGUNA etiqueta matchea, último recurso: el monto más grande del texto,
 * pero marcado como NO confiable (`confiable: false`) — un total adivinado así
 * (podría ser el "Recibido", un valor asegurado, etc.) nunca debe alcanzar por
 * sí solo para dar el recibo por 'ok'; a lo sumo queda en 'review'.
 */
interface TotalDetectado {
  valor: number
  // true si vino de una etiqueta "TOTAL" real; false si es la conjetura del
  // fallback "monto más grande".
  confiable: boolean
}

function detectarTotal(texto: string): TotalDetectado | undefined {
  const candidatos: number[] = []
  const regex = /\bT[O0U]TAL[^\d\n]{0,25}(\d[\d., ]*\d|\d)/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(texto))) {
    const monto = parseMonto(match[1])
    if (monto !== undefined && monto >= MONTO_MINIMO_PLAUSIBLE && monto <= TOTAL_MAXIMO_PLAUSIBLE) {
      candidatos.push(monto)
    }
  }

  if (candidatos.length > 0) {
    // Más frecuente; a igual frecuencia, el mayor.
    const conteo = new Map<number, number>()
    for (const c of candidatos) conteo.set(c, (conteo.get(c) ?? 0) + 1)
    let mejor = candidatos[0]
    let mejorConteo = 0
    for (const c of candidatos) {
      const n = conteo.get(c) ?? 0
      if (n > mejorConteo || (n === mejorConteo && c > mejor)) {
        mejor = c
        mejorConteo = n
      }
    }
    return { valor: mejor, confiable: true }
  }

  // Fallback: sin etiqueta "total" legible, el monto más grande del texto.
  const montos = detectarMontos(texto)
  if (montos.length === 0) return undefined
  return { valor: Math.max(...montos), confiable: false }
}

/**
 * BASE gravable. Se prueba "base" (servicio/gravable) ANTES que "subtotal":
 * en la factura real la línea confiable es "Base Servicio: $ 11.848,74",
 * mientras que "Subtotal: 8 14.100,00" trae ruido (el "8") y en realidad
 * repite el total, no la base. primerMontoPlausible salta ese "8".
 */
function detectarBaseExplicita(texto: string): number | undefined {
  const etiquetas = [/base(?:\s*(?:gravable|servicio))?/gi, /subtotal/gi]
  for (const etiqueta of etiquetas) {
    let match: RegExpExecArray | null
    while ((match = etiqueta.exec(texto))) {
      const ventana = texto.slice(match.index + match[0].length, match.index + match[0].length + 30)
      const monto = primerMontoPlausible(ventana)
      if (monto !== undefined) return monto
    }
  }
  return undefined
}

/**
 * % IVA: 19, 5 o 0 cerca de "IVA"/"Incluido". Dos pasadas:
 *  1. Con "%" explícito ("19 %", "19%", "19.00%") — la señal más limpia. Se
 *     admiten decimales antes del "%" porque muchas facturas imprimen "19.00%".
 *  2. Sin "%": el OCR se lo come seguido ("Impu:- 19.008 IVA"), así que se
 *     acepta el número de tasa (19 o 5, con decimales o no) pegado a "IVA".
 *     No se busca "0" sin "%" porque un "0" suelto es demasiado común y daría
 *     falsos 0% de IVA.
 */
function detectarPorcentajeIva(texto: string): number | undefined {
  const centros = [...texto.matchAll(/iva|incluido/gi)].map((m) => m.index ?? 0)

  // Pasada 1: con signo "%" (admite decimales, ej. "19.00%").
  for (const centro of centros) {
    const alrededor = texto.slice(Math.max(0, centro - 22), centro + 22)
    for (const pct of [19, 5, 0]) {
      if (new RegExp(`\\b${pct}(?:[.,]\\d{1,2})?\\s?%`).test(alrededor)) return pct / 100
    }
  }

  // Pasada 2: sin "%", tasa (19/5) pegada a "IVA" — cubre "19.008 IVA".
  for (const centro of centros) {
    const alrededor = texto.slice(Math.max(0, centro - 22), centro + 22)
    for (const pct of [19, 5]) {
      if (new RegExp(`\\b${pct}(?:[.,]\\d{1,3})?\\b`).test(alrededor)) return pct / 100
    }
  }

  return undefined
}

/** Forma de pago: efectivo/contado -> 'contado', crédito/tarjeta de crédito -> 'credito'. */
function detectarFormaPago(texto: string): FormaPago | undefined {
  if (/cr[eé]dito/i.test(texto)) return 'credito'
  if (/efectivo|contado|d[eé]bito|tarjeta/i.test(texto)) return 'contado'
  return undefined
}

interface CandidatoNit {
  nit: string
  dv: string
  dvOCR: string
  confianza: 'alta' | 'baja'
  lineaIndex: number
}

/** Arma un CandidatoNit a partir de un bloque de dígitos ya limpio, o undefined si no es válido. */
function evaluarBloqueNit(soloDigitos: string, lineaIndex: number): CandidatoNit | undefined {
  if (soloDigitos === NIT_CONSUMIDOR_FINAL) return undefined
  // NIT de 9-10 dígitos + 1 dígito de DV = 10-11 dígitos en total.
  if (soloDigitos.length < 10 || soloDigitos.length > 11) return undefined

  const nit = soloDigitos.slice(0, -1)
  const dvOCR = soloDigitos.slice(-1)
  const dv = calcularDV(nit)
  return { nit, dv, dvOCR, confianza: dv === dvOCR ? 'alta' : 'baja', lineaIndex }
}

/**
 * NIT del emisor: se busca solo en las primeras 8 líneas (ahí es donde las
 * facturas colombianas casi siempre imprimen los datos del emisor). El DV se
 * separa tomando el ÚLTIMO dígito del bloque numérico completo (después de
 * quitar puntos/espacios/guiones) en vez de buscar un guion explícito — el
 * guion se pierde seguido en el OCR, pero el dígito sigue estando ahí.
 *
 * Dos pasadas, en orden de preferencia:
 *  1. Líneas ETIQUETADAS con "NIT": es la señal más fuerte de que ese número
 *     es el NIT del emisor. Se prefiere una con DV válido; si solo hay una con
 *     DV que no cuadra (OCR se comió un dígito), se guarda como respaldo.
 *  2. Sin etiqueta: cuando el OCR es tan ruidoso que ni "NIT" se leyó, se
 *     escanea cualquier bloque de 10-11 dígitos del encabezado, pero SOLO se
 *     acepta si su DV calculado coincide (algoritmo DIAN). Ese match del DV es
 *     lo que evita tomar un teléfono o un número de factura como NIT.
 */
function buscarNitEmisor(lineas: string[]): CandidatoNit | undefined {
  // Bloques de 10-11 dígitos admitiendo puntos/espacios/guiones intercalados.
  const NIT_CANDIDATO = /\d[\d.\s-]{8,18}\d/g
  const limite = Math.min(8, lineas.length)

  let etiquetadoBaja: CandidatoNit | undefined
  let sinEtiquetaAlta: CandidatoNit | undefined

  for (let i = 0; i < limite; i++) {
    const linea = lineas[i]
    if (PALABRAS_EXCLUYEN_NIT.test(linea)) continue
    const etiquetada = /nit/i.test(linea)

    for (const match of linea.matchAll(NIT_CANDIDATO)) {
      const soloDigitos = match[0].replace(/[.\s-]/g, '')
      const candidato = evaluarBloqueNit(soloDigitos, i)
      if (!candidato) continue

      if (etiquetada) {
        // Etiquetado + DV válido: la mejor evidencia posible, se devuelve ya.
        if (candidato.confianza === 'alta') return candidato
        // Etiquetado pero DV no cuadra: respaldo por si no aparece nada mejor.
        etiquetadoBaja ??= candidato
      } else if (candidato.confianza === 'alta') {
        // Sin etiqueta pero con DV válido: se guarda; solo gana si no hubo
        // ningún candidato etiquetado (ver el return de abajo).
        sinEtiquetaAlta ??= candidato
      }
      // Sin etiqueta y DV inválido: se ignora (demasiados falsos positivos).
    }
  }

  // Preferencia: etiquetado-alta ya salió con return. Acá, un DV válido sin
  // etiqueta le gana a un etiquetado con DV roto (el DV correcto pesa más que
  // la etiqueta ruidosa).
  return sinEtiquetaAlta ?? etiquetadoBaja
}

function esMayoriaAlfabetica(linea: string): boolean {
  const limpia = linea.trim()
  if (limpia.length < 3) return false
  const alfabeticos = (limpia.match(/[a-zA-ZÀ-ÿ]/g) ?? []).length
  return alfabeticos / limpia.length > 0.6
}

// Palabras de líneas del encabezado que NO son la razón social: rótulos de la
// factura ("FACTURA ELECTRONICA DE VENTA"), y ruido típico del OCR como
// "Recibido"/"Reóbido" (que si aparece como primera línea alfabética se colaba
// como nombre del emisor). Se saltan para llegar al nombre real del negocio.
const LINEA_NO_ES_RAZON_SOCIAL = /factura|electr[oó]nica|\bventa\b|recib|re[oó]bido|consumidor|adquiriente|cliente/i

/** Primera línea "mayormente texto" (y no un rótulo/ruido) antes de la línea del NIT. */
function extraerRazonSocial(lineas: string[], lineaNit: number | undefined): string | undefined {
  const limite = lineaNit ?? Math.min(8, lineas.length)
  for (let i = 0; i < limite; i++) {
    const linea = lineas[i].trim()
    // Mínimo 6 caracteres: descarta líneas cortas tipo "au", "Nr." o "Tel:".
    if (linea.length < 6) continue
    if (!esMayoriaAlfabetica(linea)) continue
    if (LINEA_NO_ES_RAZON_SOCIAL.test(linea)) continue
    return linea
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
 * Receipt: 'ok' si NIT válido + total sin discrepancia, 'review' si se sacó
 * algo pero no cuadra perfecto (lo normal con OCR ruidoso), y 'error' solo
 * como último recurso cuando no se rescató nada útil. Ver ReceiptStatus.
 */
export function reconcile(rawText: string): ReconcileResult {
  const lineas = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0)

  const candidatoNit = buscarNitEmisor(lineas)
  const razonSocial = extraerRazonSocial(lineas, candidatoNit?.lineaIndex)
  const numero = extraerNumeroFactura(rawText)
  const fecha = extraerFecha(rawText)
  const concepto = extraerConcepto(rawText)
  const formaPago = detectarFormaPago(rawText)

  // `total` es el valor DETECTADO en el texto (usado como pista y, cuando
  // hay suficiente información independiente, como chequeo de consistencia).
  // El total que termina en `data` es el RECONSTRUIDO (base+iva) — ver
  // totalFinal más abajo. `totalDetectadoConfiable` distingue un total leído
  // de una etiqueta "TOTAL" real de una conjetura del fallback (ver detectarTotal).
  const totalDetectado = detectarTotal(rawText)
  const total = totalDetectado?.valor
  const totalDetectadoConfiable = totalDetectado?.confiable ?? false
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
    formaPago,
  }

  // Estado en 3 niveles (ver ReceiptStatus). 'error' es el ÚLTIMO recurso: solo
  // cuando no se rescató NADA útil. Con OCR ruidoso, lo normal es 'review'.
  const nitValido = candidatoNit?.confianza === 'alta'
  // Un total CONFIABLE es el reconstruido (base+iva) o el leído de una etiqueta
  // "TOTAL" real — NO la conjetura del fallback "monto más grande", que podría
  // ser el Recibido/Cambio y daría un 'ok' con total equivocado.
  const totalConfiable = totalReconstruido !== undefined || totalDetectadoConfiable
  const tieneTotalConfiable = totalFinal !== undefined && totalConfiable
  // Discrepancia REAL: se reconstruyó base+iva Y se detectó un total impreso
  // independiente, y no coinciden por más de $1 (ver valoresReconcilian).
  const hayDiscrepancia =
    totalReconstruido !== undefined && total !== undefined && !valoresReconcilian(total, totalReconstruido)
  const hayAlgoUtil = candidatoNit !== undefined || totalFinal !== undefined || razonSocial !== undefined

  let status: ReceiptStatus
  if (nitValido && tieneTotalConfiable && !hayDiscrepancia) {
    status = 'ok'
  } else if (hayAlgoUtil) {
    status = 'review'
  } else {
    status = 'error'
  }

  return { data, status, confianzaNit: candidatoNit?.confianza }
}
