// Recuadro de una factura dentro de la foto, tal como lo devuelve el modelo de
// visión. Se usa la convención nativa de Gemini (`box_2d`): [ymin, xmin, ymax,
// xmax] normalizados a 0-1000, independiente de la resolución real de la foto.
// Gemini está entrenado para devolver detecciones en ese formato, así que
// pedírselo así (y no con claves inventadas como {x, y, ancho, alto}) es lo
// que da coordenadas más precisas.
export type Caja = [ymin: number, xmin: number, ymax: number, xmax: number]

export interface Rect {
  x: number
  y: number
  ancho: number
  alto: number
}

// Por debajo de esto (1% del área de la foto) la "caja" casi seguro es basura
// del modelo y no una tirilla real: recortarla dejaría una imagen inservible.
const AREA_MINIMA = 0.01

/**
 * Valida la caja que devolvió el modelo. Nunca se confía a ciegas (igual que
 * con el resto de los campos): si no tiene la forma esperada o es absurda, se
 * devuelve undefined y la factura se guarda con la foto completa, sin recortar.
 */
export function cajaValida(v: unknown): Caja | undefined {
  if (!Array.isArray(v) || v.length !== 4) return undefined
  if (!v.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined

  const [ymin, xmin, ymax, xmax] = (v as number[]).map((n) => Math.min(1000, Math.max(0, n)))
  if (ymax <= ymin || xmax <= xmin) return undefined
  if (((ymax - ymin) / 1000) * ((xmax - xmin) / 1000) < AREA_MINIMA) return undefined

  return [ymin, xmin, ymax, xmax]
}

/**
 * Convierte la caja normalizada a píxeles de la imagen real, con un margen
 * alrededor (fracción del tamaño de la caja): el modelo suele ajustar la caja
 * muy pegada al papel, y cortar medio milímetro de más se come justo el borde
 * donde van el NIT o el total. El resultado nunca se sale de la imagen. En las
 * pruebas la caja de Gemini sigue el TEXTO impreso (no el borde del papel) y la
 * última línea quedaba al ras con 4%; 6% le da aire sin meter la tirilla vecina.
 */
export function cajaAPixeles(caja: Caja, ancho: number, alto: number, margen = 0.06): Rect {
  const [ymin, xmin, ymax, xmax] = caja
  const x0 = (xmin / 1000) * ancho
  const y0 = (ymin / 1000) * alto
  const x1 = (xmax / 1000) * ancho
  const y1 = (ymax / 1000) * alto
  const mx = (x1 - x0) * margen
  const my = (y1 - y0) * margen

  const x = Math.max(0, Math.floor(x0 - mx))
  const y = Math.max(0, Math.floor(y0 - my))
  return {
    x,
    y,
    ancho: Math.min(ancho, Math.ceil(x1 + mx)) - x,
    alto: Math.min(alto, Math.ceil(y1 + my)) - y,
  }
}
