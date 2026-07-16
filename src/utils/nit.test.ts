import { describe, expect, it } from 'vitest'
import { esNitConsumidorFinal, normalizeNit } from './nit'

describe('normalizeNit', () => {
  it('parsea formato con puntos: "830.087.099-3"', () => {
    const r = normalizeNit('830.087.099-3')
    expect(r.nit).toBe('830087099')
    expect(r.dvOCR).toBe('3')
    // El DV calculado coincide con el que traía el texto en este caso...
    expect(r.dv).toBe('3')
  })

  it('parsea formato con espacios: "832 006 666-7"', () => {
    const r = normalizeNit('832 006 666-7')
    expect(r.nit).toBe('832006666')
    expect(r.dvOCR).toBe('7')
    // ...pero en este otro caso NO coincide (dv calculado da '0'), y eso es
    // justamente el punto: el DV impreso/leído por OCR no es confiable, por
    // eso el Excel siempre usa `dv` (calculado), nunca `dvOCR`.
    expect(r.dv).toBe('0')
  })

  it('parsea formato sin separadores visuales: "901074741-5"', () => {
    const r = normalizeNit('901074741-5')
    expect(r.nit).toBe('901074741')
    expect(r.dvOCR).toBe('5')
    expect(r.dv).toBe('5')
  })

  it('acepta un NIT sin DV en el texto', () => {
    const r = normalizeNit('901074741')
    expect(r.nit).toBe('901074741')
    expect(r.dvOCR).toBeUndefined()
    expect(r.dv).toBe('5')
  })
})

describe('esNitConsumidorFinal', () => {
  it('detecta el comodín de consumidor final', () => {
    expect(esNitConsumidorFinal('222222222222')).toBe(true)
    expect(esNitConsumidorFinal('222.222.222.222')).toBe(true)
  })

  it('no marca un NIT real como comodín', () => {
    expect(esNitConsumidorFinal('901074741')).toBe(false)
  })
})
