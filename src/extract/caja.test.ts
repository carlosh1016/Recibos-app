import { describe, expect, it } from 'vitest'
import { cajaAPixeles, cajaValida } from './caja'

describe('cajaValida', () => {
  it('acepta una caja [ymin, xmin, ymax, xmax] normal', () => {
    expect(cajaValida([100, 50, 900, 400])).toEqual([100, 50, 900, 400])
  })

  it('recorta a 0-1000 los valores que se salen un poco del rango', () => {
    expect(cajaValida([-5, 0, 1010, 300])).toEqual([0, 0, 1000, 300])
  })

  it('rechaza cajas con forma inválida', () => {
    expect(cajaValida(undefined)).toBeUndefined()
    expect(cajaValida([1, 2, 3])).toBeUndefined()
    expect(cajaValida([0, 0, '900', 400])).toBeUndefined()
    expect(cajaValida([0, 0, Number.NaN, 400])).toBeUndefined()
  })

  it('rechaza cajas invertidas o vacías', () => {
    expect(cajaValida([900, 50, 100, 400])).toBeUndefined()
    expect(cajaValida([100, 400, 900, 400])).toBeUndefined()
  })

  it('rechaza cajas diminutas (menos del 1% de la foto): casi seguro basura', () => {
    expect(cajaValida([500, 500, 550, 550])).toBeUndefined()
  })
})

describe('cajaAPixeles', () => {
  it('convierte a píxeles de la foto real y agrega el margen', () => {
    // Foto 2000x1000; caja = mitad izquierda, de arriba a abajo del centro.
    const r = cajaAPixeles([250, 0, 750, 500], 2000, 1000, 0.1)
    // Ancho de la caja 1000px -> margen 100px; alto 500px -> margen 50px.
    expect(r).toEqual({ x: 0, y: 200, ancho: 1100, alto: 600 })
  })

  it('nunca se sale de la imagen aunque la caja llegue al borde', () => {
    const r = cajaAPixeles([0, 0, 1000, 1000], 800, 600)
    expect(r).toEqual({ x: 0, y: 0, ancho: 800, alto: 600 })
  })
})
