// Heurística 4: detectar el formato de fecha y normalizarlo a ISO
// 'YYYY-MM-DD'. Formatos soportados: ISO ("2026-05-23"), DD/MM/YYYY
// ("14/06/2026"), MM/DD/YYYY ("05/15/2026") y mes en texto ("May-13-2026" o
// "13-May-2026", español o inglés, abreviado o completo).
const MESES: Record<string, string> = {
  ene: '01', enero: '01', jan: '01', january: '01',
  feb: '02', febrero: '02', february: '02',
  mar: '03', marzo: '03', march: '03',
  abr: '04', abril: '04', apr: '04', april: '04',
  may: '05', mayo: '05',
  jun: '06', junio: '06', june: '06',
  jul: '07', julio: '07', july: '07',
  ago: '08', agosto: '08', aug: '08', august: '08',
  sep: '09', sept: '09', septiembre: '09', september: '09',
  oct: '10', octubre: '10', october: '10',
  nov: '11', noviembre: '11', november: '11',
  dic: '12', diciembre: '12', dec: '12', december: '12',
}

/**
 * Recibe un fragmento de texto que YA se identificó como una fecha (ver
 * extraerFecha en reconcile.ts, que busca el patrón dentro del texto crudo
 * del OCR) y lo normaliza a 'YYYY-MM-DD'. Devuelve undefined si el texto no
 * calza con ninguno de los formatos soportados.
 */
export function normalizarFecha(textoFecha: string): string | undefined {
  const t = textoFecha.trim()

  // ISO: ya viene en el formato final.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t

  // Mes en texto, mes primero: "May-13-2026", "May 13, 2026".
  let m = t.match(/([A-Za-zÀ-ÿ]+)[-\s,/]+(\d{1,2})[-\s,/]+(\d{4})/)
  if (m) {
    const mes = MESES[m[1].toLowerCase()]
    if (mes) return `${m[3]}-${mes}-${m[2].padStart(2, '0')}`
  }

  // Mes en texto, día primero: "13-May-2026", "13 May 2026".
  m = t.match(/(\d{1,2})[-\s,/]+([A-Za-zÀ-ÿ]+)[-\s,/]+(\d{4})/)
  if (m) {
    const mes = MESES[m[2].toLowerCase()]
    if (mes) return `${m[3]}-${mes}-${m[1].padStart(2, '0')}`
  }

  // Numérico DD/MM/YYYY o MM/DD/YYYY (con '/' o '-' como separador).
  m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) {
    const a = Number(m[1])
    const b = Number(m[2])
    const anio = m[3]

    let dia: number
    let mes: number
    if (a > 12) {
      // `a` no puede ser mes -> tiene que ser el día. Sin ambigüedad.
      dia = a
      mes = b
    } else if (b > 12) {
      // `b` no puede ser mes -> `a` tiene que ser el mes. Sin ambigüedad.
      mes = a
      dia = b
    } else {
      // Ambos <= 12: ambiguo de verdad (ej. "05/06/2026"). Colombia usa
      // DD/MM/YYYY por convención, así que se resuelve a eso por defecto.
      dia = a
      mes = b
    }

    return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  }

  return undefined
}
