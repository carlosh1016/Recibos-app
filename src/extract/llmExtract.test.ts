import { describe, expect, it } from 'vitest'
import { interpretarFacturas } from './llmExtract'

// Factura "buena": NIT con 9 dígitos y base + IVA = total.
const facturaOk = {
  razonSocial: 'CENTRAL PARKING S.A.S.',
  nit: '900123456',
  numero: 'CFLA 1915',
  fecha: '2026-07-17',
  concepto: 'Parqueadero',
  formaPago: 'contado',
  valorBase: 11848.74,
  porcentajeIva: 0.19,
  ivaMonto: 2251.26,
  total: 14100,
  box_2d: [50, 20, 950, 320],
}

const facturaVacia = {
  razonSocial: null,
  nit: null,
  numero: null,
  fecha: null,
  concepto: null,
  formaPago: null,
  valorBase: null,
  porcentajeIva: null,
  ivaMonto: null,
  total: null,
  box_2d: [0, 0, 1000, 1000],
}

describe('interpretarFacturas', () => {
  it('una sola factura: conserva su status y su caja', () => {
    const [f, ...resto] = interpretarFacturas({ facturas: [facturaOk] })
    expect(resto).toHaveLength(0)
    expect(f.status).toBe('ok')
    expect(f.caja).toEqual([50, 20, 950, 320])
    expect(f.data.nit).toBe('900123456')
    expect(f.data.dv).toBeDefined()
  })

  it('varias facturas: ninguna nace "ok", todas van a revisión', () => {
    const facturas = interpretarFacturas({
      facturas: [facturaOk, { ...facturaOk, nit: '830087099', box_2d: [50, 350, 950, 650] }],
    })
    expect(facturas).toHaveLength(2)
    expect(facturas.every((f) => f.status === 'review')).toBe(true)
    expect(facturas.map((f) => f.data.nit)).toEqual(['900123456', '830087099'])
  })

  it('varias facturas: descarta las detecciones sin nada útil', () => {
    const facturas = interpretarFacturas({ facturas: [facturaOk, facturaVacia] })
    expect(facturas).toHaveLength(1)
    expect(facturas[0].data.nit).toBe('900123456')
  })

  it('una sola factura vacía se conserva como "error" (no se descarta)', () => {
    const [f] = interpretarFacturas({ facturas: [facturaVacia] })
    expect(f.status).toBe('error')
  })

  it('caja inválida: la factura se guarda igual, sin recorte', () => {
    const [f] = interpretarFacturas({ facturas: [{ ...facturaOk, box_2d: [1, 2] }] })
    expect(f.caja).toBeUndefined()
    expect(f.status).toBe('ok')
  })

  it('factura sin IVA con base en null: la base es el total (si no, el Excel da $0)', () => {
    const [f] = interpretarFacturas({
      facturas: [{ ...facturaOk, valorBase: null, porcentajeIva: 0, ivaMonto: 0, total: 18500 }],
    })
    expect(f.data.valorBase).toBe(18500)
    expect(f.data.ivaMonto).toBe(0)
    expect(f.status).toBe('ok')
  })

  it('un NIT sin dígitos ("N/A") no tumba la extracción', () => {
    const [f] = interpretarFacturas({ facturas: [{ ...facturaOk, nit: 'N/A' }] })
    expect(f.data.nit).toBeUndefined()
    expect(f.status).toBe('review')
  })

  it('lanza si no hay lista o viene vacía (Capture cae al OCR local)', () => {
    expect(() => interpretarFacturas({})).toThrow()
    expect(() => interpretarFacturas({ facturas: [] })).toThrow()
    expect(() => interpretarFacturas({ facturas: [facturaVacia, facturaVacia] })).toThrow()
  })
})
