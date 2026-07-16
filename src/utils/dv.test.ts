import { describe, expect, it } from 'vitest'
import { calcularDV } from './dv'

describe('calcularDV', () => {
  // Estos dos casos están verificados a mano con el algoritmo DIAN (módulo 11,
  // pesos [3,7,13,17,19,23,29,37,41,43,47,53,59,67,71], derecha a izquierda) y
  // coinciden con el DV que traían los ejemplos reales de recibos.
  it('calcula correctamente NITs conocidos', () => {
    expect(calcularDV('830087099')).toBe('3')
    expect(calcularDV('901074741')).toBe('5')
  })

  it('ignora puntos/espacios/guiones si se le pasan sin normalizar', () => {
    expect(calcularDV('830.087.099')).toBe('3')
  })

  it('usa dv = resto cuando resto < 2', () => {
    // 832006666 -> suma % 11 == 0 -> dv = 0 (resto < 2, no se le resta a 11)
    expect(calcularDV('832006666')).toBe('0')
  })

  it('lanza error si no hay dígitos', () => {
    expect(() => calcularDV('abc')).toThrow()
  })

  it('lanza error si el NIT excede los 15 dígitos que cubre la tabla de pesos', () => {
    expect(() => calcularDV('1234567890123456')).toThrow()
  })
})
