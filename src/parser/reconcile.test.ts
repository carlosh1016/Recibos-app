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
    expect(status).toBe('ok') // NIT válido + base+iva cuadra con total -> no requiere revisión
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

  it('marca status "review" (no "error") cuando el DV leído no coincide con el calculado (baja confianza)', () => {
    const texto = `
      FACTURA ELECTRONICA DE VENTA
      Distribuidora Ejemplo SAS
      NIT: 901074741-9

      TOTAL A PAGAR $14.100
      IVA Incluido 19%
    `

    const { status, confianzaNit } = reconcile(texto)

    // El NIT no valida el DV, pero SÍ se extrajo algo útil (total, razón
    // social): eso es 'review' (ojo humano), no 'error' (nada rescatable).
    expect(confianzaNit).toBe('baja')
    expect(status).toBe('review')
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
    expect(status).toBe('ok')
  })

  it('marca status "review" cuando el total impreso no coincide con base+iva reconstruido', () => {
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
    // Hay discrepancia real (11.900 vs 11.000 impreso) pero se extrajo de todo:
    // es 'review' para corregir a mano, no 'error'.
    expect(status).toBe('review')
  })

  it('detecta el total aunque el OCR lea "TOTAL" con ruido ("T0TAL")', () => {
    const texto = `
      Distribuidora Ejemplo SAS
      NIT: 901074741-5
      T0TAL A PAGAR $ 25.000
    `

    const { data, status } = reconcile(texto)

    expect(data.total).toBe(25000)
    expect(status).toBe('ok') // NIT válido + total presente, sin reconstrucción que contradiga
  })

  it('encuentra el NIT del emisor aunque no venga precedido de "NIT" (exige DV válido)', () => {
    const texto = `
      CENTRAL PARKING SYSTEM COLOMBIA SAS
      9010747415
      FACTURA DE VENTA
      TOTAL A PAGAR $14.100
    `

    const { data, confianzaNit } = reconcile(texto)

    expect(data.nit).toBe('901074741')
    expect(data.dv).toBe('5')
    expect(confianzaNit).toBe('alta')
  })

  it('cuando no hay etiqueta "total" legible, cae al monto más grande del texto', () => {
    const texto = `
      Tienda Ejemplo SAS
      NIT: 901074741-5
      Valor pagado 45.900
      Su cambio 4.100
    `

    const { data } = reconcile(texto)

    expect(data.total).toBe(45900)
  })

  // Regresión con OCR REAL de una factura de parqueadero (Central Parking),
  // tal cual lo entregó tesseract.js: ruidoso, con "TOTAL A PAGAR ===>", el
  // monto partido "14,100, 00", "Subtotal: 8 ..." (el 8 es un "$" mal leído),
  // "Base Servicio", y "19.008 IVA" sin signo "%". El NIT del emisor quedó
  // ilegible, así que el recibo debe caer en 'review' (no 'error') con los
  // valores monetarios bien reconstruidos para que el usuario solo agregue el NIT.
  it('extrae los valores correctos de un OCR real muy ruidoso (factura de parqueadero)', () => {
    const texto = `o . N—. E - -.
CENTRAL PARKINU SYSTEM COLOMBIA $.A:5 o Y BE 2
Ss parcuEICEIO e LS A |. Em a. «D
Ñ Nr, AM LISOO La DO 1 _——— me AT
> CARRERA 10A 8 1348 - 19 — 6 6 6
A a FACTURA ELECTRONICA — A, a
- .0 4 Factura CFLA 1915 ' TI 0 > a!
Entrada 4 2026-05-16 09:56 a a
Salida 2026-05-16 11:30 TT
Parqueadero $ 14,100,00
Subtotal: 8 14.100,00 Du
Ajuste: $ 0,00 >
TOTAL A PAGAR ===> $ 14,100, 00
3 IVA Incluido :
Base Servicio: $ 11.848,74
Impu:- 19.008 IVA $ 2.251,26
TOTAL A PAGAR — ==> $ 14.100,00
Forma de Pago ':- -Efectivo
Recibido: $ 50.100,00
Cambio .: $ 36.000,00
Cliente: CC 222222222222
Consumidor final`

    const { data, status } = reconcile(texto)

    expect(data.total).toBe(14100)
    expect(data.valorBase).toBe(11848.74)
    expect(data.ivaMonto).toBe(2251.26)
    expect(data.porcentajeIva).toBe(0.19)
    expect(data.formaPago).toBe('contado')
    expect(data.fecha).toBe('2026-05-16')
    expect(data.razonSocial).toContain('CENTRAL PARKIN')
    expect(data.numero).toContain('CFLA')
    // El comodín de consumidor final NUNCA debe tomarse como NIT del emisor.
    expect(data.nit).not.toBe('22222222222')
    // NIT del emisor ilegible -> no hay DV válido -> 'review', no 'ok' ni 'error'.
    expect(status).toBe('review')
  })

  // Test de INTEGRACIÓN con el ground truth acordado: el texto OCR que
  // tesseract.js debe entregar con una buena foto de esta factura de
  // parqueadero, y todos los campos exactos que el parser debe producir.
  // Ejercita juntos: NIT + DV DIAN, razón social, número, fecha (parte de un
  // "YYYY-MM-DD HH:MM"), concepto, total más-frecuente entre 3 apariciones,
  // "IVA Incluido" + 19.00% -> base/iva reconstruidos, forma de pago, y status 'ok'.
  it('extrae TODOS los campos correctos del ground truth (factura de parqueadero, buena foto)', () => {
    const texto = `CENTRAL PARKING SYSTEM COLOMBIA S.A.S
NIT: 830.087.099-3
PARQUEADERO CAFAM LISBOA
CARRERA 10A # 134A - 19

FACTURA ELECTRONICA
Factura CFLA 1915
Concepto : PARQUEO - Normal
Placa/Codigo : NLR462
Entrada : 2026-05-16 09:56
Salida : 2026-05-16 11:30
Tiempo : 01:34
Tarifa : CARRO
150

Placa : NLR462
Nombre :

Cnt Descripcion Subtotal
1 Parqueadero $ 14.100,00

Subtotal: $ 14.100,00
Ajuste: $ 0,00

TOTAL A PAGAR ===> $ 14.100,00
IVA Incluido

DESGLOSE DE SERVICIO

Base Servicio: $ 11.848,74
Impu: 19.00% IVA $ 2.251,26
TOTAL A PAGAR ===> $ 14.100,00

Forma de Pago : Efectivo
Recibido: $ 50.100,00
Cambio : $ 36.000,00`

    const { data, status, confianzaNit } = reconcile(texto)

    expect(data.nit).toBe('830087099')
    expect(data.dv).toBe('3')
    expect(confianzaNit).toBe('alta')
    expect(data.razonSocial).toBe('CENTRAL PARKING SYSTEM COLOMBIA S.A.S')
    expect(data.numero).toBe('CFLA 1915')
    expect(data.fecha).toBe('2026-05-16')
    expect(data.valorBase).toBe(11848.74)
    expect(data.porcentajeIva).toBe(0.19)
    expect(data.ivaMonto).toBe(2251.26)
    expect(data.total).toBe(14100)
    expect(data.concepto).toBe('PARQUEO - Normal')
    expect(data.formaPago).toBe('contado')
    expect(status).toBe('ok')
  })

  it('NO toma el monto de "Recibido"/"Cambio" como total (evita un total falso con NIT válido)', () => {
    // OCR donde el total salió ilegible ("---") y los únicos montos legibles
    // son el efectivo recibido y el cambio. El NIT sí es válido, así que sin
    // esta protección el fallback marcaría 'ok' con total = 50.100 (¡el
    // recibido!). Debe quedar sin total y en 'review'.
    const texto = `
      ALGUN COMERCIO SAS
      830.087.099-3
      TOTAL A PAGAR ---
      Recibido: $ 50.100,00
      Cambio: $ 36.000,00
    `

    const { data, status } = reconcile(texto)

    expect(data.nit).toBe('830087099')
    expect(data.total).toBeUndefined()
    expect(status).toBe('review')
  })

  it('marca "error" solo cuando no se rescata nada útil (ni NIT, ni total, ni razón social)', () => {
    const texto = `
      #$%& ~~~ |||
      ?? .. ,,
    `

    const { data, status } = reconcile(texto)

    expect(data.nit).toBeUndefined()
    expect(data.total).toBeUndefined()
    expect(status).toBe('error')
  })
})
