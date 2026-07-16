import { describe, expect, it } from 'vitest'
import { reconcile } from './reconcile'

describe('reconcile', () => {
  it('reconstruye base/iva desde total + "IVA Incluido" + 19%, y valida que cuadren', () => {
    // NIT con DV correcto (901074741 -> DV 5, ver utils/dv.test.ts) para que
    // el status del recibo dependa solo de si los valores cuadran.
    const texto = `
      FACTURA ELECTRONICA DE VENTA
      Distribuidora Ejemplo SAS
      NIT: 901074741-5

      Concepto: Suministros de oficina

      TOTAL A PAGAR $14.100
      IVA Incluido 19%
      TOTAL A PAGAR $14.100
    `

    const { data, status } = reconcile(texto)

    expect(data.total).toBe(14100)
    expect(data.valorBase).toBe(11848.74)
    expect(data.ivaMonto).toBe(2251.26)
    expect(status).toBe('pending') // base + iva cuadra con total -> no requiere revisión
  })

  it('normaliza el NIT del emisor y valida su DV con el algoritmo DIAN', () => {
    const texto = `
      FACTURA ELECTRONICA DE VENTA
      Comercializadora XYZ SAS
      NIT: 830.087.099-3
      Direccion: Cra 1 # 2-3, Bogota
    `

    const { data, confianzaNit } = reconcile(texto)

    expect(data.nit).toBe('830087099')
    expect(data.dv).toBe('3')
    expect(confianzaNit).toBe('alta')
  })

  it('excluye el NIT del cliente/adquiriente y el comodín de consumidor final', () => {
    const texto = `
      FACTURA ELECTRONICA DE VENTA
      Distribuidora Ejemplo SAS
      NIT: 901074741-5
      Cliente NIT: 222222222222
      Adquiriente NIT: 900999888-1
    `

    const { data, confianzaNit } = reconcile(texto)

    expect(data.nit).toBe('901074741')
    expect(confianzaNit).toBe('alta')
  })

  it('marca status "error" cuando el DV leído no coincide con el calculado (baja confianza)', () => {
    const texto = `
      FACTURA ELECTRONICA DE VENTA
      Distribuidora Ejemplo SAS
      NIT: 901074741-9

      TOTAL A PAGAR $14.100
      IVA Incluido 19%
    `

    const { status, confianzaNit } = reconcile(texto)

    expect(confianzaNit).toBe('baja')
    expect(status).toBe('error')
  })

  it('reconstruye base+iva desde base explícita + % de IVA cuando ambos son independientes del total', () => {
    const texto = `
      FACTURA ELECTRONICA DE VENTA
      Distribuidora Ejemplo SAS
      NIT: 901074741-5

      Subtotal $10.000
      IVA 19%
      TOTAL A PAGAR $11.900
    `

    const { data, status } = reconcile(texto)

    expect(data.valorBase).toBe(10000)
    expect(data.ivaMonto).toBe(1900)
    expect(data.total).toBe(11900) // reconstruido (base+iva), no el leído del texto
    expect(status).toBe('pending')
  })

  it('marca status "error" cuando el total impreso no coincide con base+iva reconstruido', () => {
    const texto = `
      FACTURA ELECTRONICA DE VENTA
      Distribuidora Ejemplo SAS
      NIT: 901074741-5

      Subtotal $10.000
      IVA 19%
      TOTAL A PAGAR $11.000
    `
    // Base (10.000) y % de IVA (19%) son independientes del total impreso
    // (11.000): el total reconstruido da 11.900, que NO se parece al
    // impreso — justo el caso que reconcile() debe marcar para revisión.

    const { data, status } = reconcile(texto)

    expect(data.valorBase).toBe(10000)
    expect(data.ivaMonto).toBe(1900)
    expect(data.total).toBe(11900) // se prefiere el reconstruido, no el leído (11.000)
    expect(status).toBe('error')
  })
})
