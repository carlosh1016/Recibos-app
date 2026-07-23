import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, ESTILO_ESTADO, Field, Screen, StatusBadge } from '../components'
import { db } from '../db/db'
import type { ExtractedData, FormaPago, Receipt } from '../types'
import { calcularDV } from '../utils/dv'

// Margen (en pesos) con el que se considera que base+iva "cuadra" con el
// total: el mismo criterio de $1 que usa el parser (ver reconcile.ts), para
// que lo que Review resalta en amarillo coincida con lo que marcó el status.
const MARGEN_CUADRE = 1

// --- Estado del formulario -------------------------------------------------
// Todos los campos se editan como string (aunque algunos representen números):
// deja escribir libremente ("11.8", a medio teclear) sin pelear con el input,
// y la conversión a number se hace solo al calcular/guardar.
interface FormState {
  razonSocial: string
  nit: string
  numero: string
  fecha: string
  valorBase: string
  porcentajeIva: string // como porcentaje entero/decimal, ej. "19"
  total: string
  formaPago: '' | FormaPago
  concepto: string
}

/** Convierte un texto tipo "11.848,74" / "11848.74" / "$ 14.100" a number. */
function aNumero(texto: string): number | undefined {
  const limpio = texto.replace(/[^\d.,]/g, '')
  if (!limpio) return undefined

  const tieneComa = limpio.includes(',')
  const tienePunto = limpio.includes('.')
  let normalizado: string
  if (tieneComa && tienePunto) {
    const decimalEsComa = limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
    normalizado = decimalEsComa ? limpio.replace(/\./g, '').replace(',', '.') : limpio.replace(/,/g, '')
  } else if (tieneComa) {
    const partes = limpio.split(',')
    const ultima = partes[partes.length - 1]
    normalizado = ultima.length === 2 ? `${partes.slice(0, -1).join('')}.${ultima}` : partes.join('')
  } else if (tienePunto) {
    const partes = limpio.split('.')
    const ultima = partes[partes.length - 1]
    normalizado = partes.length > 1 && ultima.length === 2 ? `${partes.slice(0, -1).join('')}.${ultima}` : partes.join('')
  } else {
    normalizado = limpio
  }
  const valor = Number(normalizado)
  return Number.isFinite(valor) ? valor : undefined
}

function textoOUndef(s: string): string | undefined {
  const t = s.trim()
  return t.length > 0 ? t : undefined
}

function receiptAForm(data: ExtractedData): FormState {
  return {
    razonSocial: data.razonSocial ?? '',
    nit: data.nit ?? '',
    numero: data.numero ?? '',
    fecha: data.fecha ?? '',
    valorBase: data.valorBase !== undefined ? String(data.valorBase) : '',
    porcentajeIva: data.porcentajeIva !== undefined ? String(Math.round(data.porcentajeIva * 10000) / 100) : '',
    total: data.total !== undefined ? String(data.total) : '',
    formaPago: data.formaPago ?? '',
    concepto: data.concepto ?? '',
  }
}

const pesos = (n: number | undefined): string =>
  n === undefined
    ? '—'
    : n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })

export function Review() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [idx, setIdx] = useState(0)
  const [form, setForm] = useState<FormState | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const receiptActual = receipts[idx] as Receipt | undefined

  useEffect(() => {
    async function cargar() {
      if (!sessionId) return
      const lista = await db.receipts.where('sessionId').equals(Number(sessionId)).toArray()
      setReceipts(lista)
    }
    void cargar()
  }, [sessionId])

  // Al cambiar de recibo: cargar sus datos al formulario y crear el object URL
  // de la foto (revocando el anterior para no filtrar memoria).
  useEffect(() => {
    if (!receiptActual) {
      setForm(null)
      return
    }
    setForm(receiptAForm(receiptActual.data))

    const url = URL.createObjectURL(receiptActual.imageBlob)
    setPhotoUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [receiptActual])

  const setCampo = useCallback(<K extends keyof FormState>(campo: K, valor: FormState[K]) => {
    setForm((f) => (f ? { ...f, [campo]: valor } : f))
  }, [])

  // Cálculo de IVA/total en vivo desde el formulario, para resaltar la
  // discrepancia mientras se edita.
  const calc = useMemo(() => {
    if (!form) {
      return {
        base: undefined,
        pct: undefined,
        ivaMonto: undefined,
        total: undefined,
        totalCalc: undefined,
        hayDiscrepancia: false,
      }
    }
    const base = aNumero(form.valorBase)
    const pctNum = aNumero(form.porcentajeIva)
    const pct = pctNum !== undefined ? pctNum / 100 : undefined
    const total = aNumero(form.total)
    const ivaMonto = base !== undefined && pct !== undefined ? Math.round(base * pct * 100) / 100 : undefined
    const totalCalc = base !== undefined && ivaMonto !== undefined ? Math.round((base + ivaMonto) * 100) / 100 : undefined
    const hayDiscrepancia = totalCalc !== undefined && total !== undefined && Math.abs(totalCalc - total) > MARGEN_CUADRE
    return { base, pct, ivaMonto, total, totalCalc, hayDiscrepancia }
  }, [form])

  // El DV se muestra en vivo (solo lectura): se recalcula del NIT igual que al
  // guardar, así la usuaria ve de una si tecleó mal el NIT.
  const dvPreview = useMemo(() => {
    const digitos = form?.nit.replace(/\D/g, '') ?? ''
    if (digitos.length < 1 || digitos.length > 15) return ''
    try {
      return calcularDV(digitos)
    } catch {
      return ''
    }
  }, [form?.nit])

  /** Índice del próximo recibo con status != 'ok' (a partir de `desde`, con wrap). */
  function proximoSinRevisar(lista: Receipt[], desde: number): number | null {
    for (let paso = 1; paso <= lista.length; paso++) {
      const j = (desde + paso) % lista.length
      if (j === desde) break
      if (lista[j].status !== 'ok') return j
    }
    return null
  }

  function irSiguiente() {
    const j = proximoSinRevisar(receipts, idx)
    setIdx(j ?? Math.min(idx + 1, receipts.length - 1))
  }

  async function marcarRevisado() {
    if (!receiptActual?.id || !form) return
    setGuardando(true)
    try {
      const nitDigitos = form.nit.replace(/\D/g, '')
      let dv: string | undefined
      if (nitDigitos.length >= 1 && nitDigitos.length <= 15) {
        try {
          dv = calcularDV(nitDigitos)
        } catch {
          dv = undefined
        }
      }

      const data: ExtractedData = {
        ...receiptActual.data,
        doc: 'FC',
        razonSocial: textoOUndef(form.razonSocial),
        nit: nitDigitos || undefined,
        dv,
        numero: textoOUndef(form.numero),
        fecha: textoOUndef(form.fecha),
        valorBase: calc.base,
        porcentajeIva: calc.pct,
        ivaMonto: calc.ivaMonto,
        total: calc.total,
        formaPago: form.formaPago || undefined,
        concepto: textoOUndef(form.concepto),
      }

      await db.receipts.update(receiptActual.id, { data, status: 'ok' })
      // Reflejar el cambio en el estado local sin recargar de Dexie.
      const actualizada = receipts.map(
        (r): Receipt => (r.id === receiptActual.id ? { ...r, data, status: 'ok' } : r),
      )
      setReceipts(actualizada)
      // Avanzar al próximo pendiente usando la lista YA actualizada (el recibo
      // recién marcado cuenta como 'ok', así que no se vuelve a caer en él).
      const j = proximoSinRevisar(actualizada, idx)
      if (j !== null) setIdx(j)
    } finally {
      setGuardando(false)
    }
  }

  async function descartarRecibo() {
    if (!receiptActual?.id) return
    if (!window.confirm('¿Descartar este recibo? Esta acción no se puede deshacer.')) return
    const id = receiptActual.id
    await db.receipts.delete(id)
    const restantes = receipts.filter((r) => r.id !== id)
    setReceipts(restantes)
    // Mantener el índice dentro de rango tras quitar el recibo actual.
    setIdx((i) => Math.max(0, Math.min(i, restantes.length - 1)))
  }

  const pendientes = receipts.filter((r) => r.status !== 'ok').length
  const revisadas = receipts.length - pendientes

  if (receipts.length === 0) {
    return (
      <Screen titulo="Revisar facturas" volverA={`/capture/${sessionId}`} ancho="md">
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">Todavía no hay facturas en esta sesión.</p>
          <Button className="mt-4" onClick={() => navigate(`/capture/${sessionId}`)}>
            Capturar la primera
          </Button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen
      titulo="Revisar facturas"
      subtitulo={`${revisadas} de ${receipts.length} revisadas`}
      volverA={`/capture/${sessionId}`}
      ancho="4xl"
      accion={receiptActual && <StatusBadge status={receiptActual.status} />}
    >
      {/* Progreso de revisión: el estado global de la tarea, siempre visible. */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className="h-full rounded-full bg-green-500 transition-all duration-300"
          style={{ width: `${(revisadas / receipts.length) * 100}%` }}
        />
      </div>

      {/* Tira para saltar entre facturas. El número + color dice el estado de
          cada una sin abrirla. */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {receipts.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setIdx(i)}
            className={`h-9 w-9 rounded-lg border text-xs font-semibold transition-transform ${
              ESTILO_ESTADO[r.status].tarjeta
            } ${i === idx ? 'ring-2 ring-brand-500 ring-offset-1' : 'hover:scale-105'}`}
            aria-current={i === idx ? 'true' : undefined}
            title={`Factura ${i + 1} — ${ESTILO_ESTADO[r.status].texto}`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {receiptActual && form && (
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,340px)_1fr]">
          {/* Foto */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
            {photoUrl ? (
              <img
                src={photoUrl}
                alt={`Factura ${idx + 1}`}
                className="max-h-[60vh] w-full object-contain md:max-h-[70vh]"
              />
            ) : (
              <p className="p-8 text-center text-sm text-slate-400">Cargando foto…</p>
            )}
          </div>

          {/* Formulario */}
          <div className="flex flex-col gap-3">
            <Field
              label="Razón social"
              value={form.razonSocial}
              onChange={(e) => setCampo('razonSocial', e.target.value)}
              placeholder="Nombre del proveedor"
            />

            <div className="grid grid-cols-[1fr_auto] gap-3">
              <Field
                label="NIT"
                value={form.nit}
                onChange={(e) => setCampo('nit', e.target.value)}
                inputMode="numeric"
                mono
              />
              {/* El DV no se edita: se deriva del NIT (módulo 11 de la DIAN), y
                  dejarlo editable solo permitiría guardar una combinación
                  inválida. */}
              <label className="block w-20">
                <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  DV
                </span>
                <input
                  type="text"
                  value={dvPreview}
                  readOnly
                  tabIndex={-1}
                  aria-label="Dígito de verificación (calculado)"
                  className="w-full rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-center font-mono text-base text-slate-500"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field
                label="N.º de factura"
                value={form.numero}
                onChange={(e) => setCampo('numero', e.target.value)}
                mono
              />
              {/* type="date" abre el selector nativo del celular en vez de
                  obligar a teclear "2026-07-17" a mano. */}
              <Field
                label="Fecha"
                type="date"
                value={form.fecha}
                onChange={(e) => setCampo('fecha', e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field
                label="Base"
                value={form.valorBase}
                onChange={(e) => setCampo('valorBase', e.target.value)}
                inputMode="decimal"
                tono={calc.hayDiscrepancia ? 'alerta' : 'normal'}
              />
              <Field
                label="% IVA"
                value={form.porcentajeIva}
                onChange={(e) => setCampo('porcentajeIva', e.target.value)}
                inputMode="decimal"
                tono={calc.hayDiscrepancia ? 'alerta' : 'normal'}
              />
              <Field
                label="Total"
                value={form.total}
                onChange={(e) => setCampo('total', e.target.value)}
                inputMode="decimal"
                tono={calc.hayDiscrepancia ? 'alerta' : 'normal'}
              />
            </div>

            {calc.hayDiscrepancia && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Base + IVA = <strong>{pesos(calc.totalCalc)}</strong> no coincide con el total{' '}
                <strong>{pesos(calc.total)}</strong>. Corrige el campo mal leído.
              </p>
            )}

            <label className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Forma de pago
              </span>
              <select
                value={form.formaPago}
                onChange={(e) => setCampo('formaPago', e.target.value as FormState['formaPago'])}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 outline-none transition-colors focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              >
                <option value="">Sin especificar</option>
                <option value="contado">Contado</option>
                <option value="credito">Crédito</option>
              </select>
            </label>

            <Field
              label="Concepto"
              value={form.concepto}
              onChange={(e) => setCampo('concepto', e.target.value)}
              placeholder="Producto o servicio"
            />

            {/* Un solo primario. "Siguiente" es secundario y "Descartar" no
                tiene fondo, para que nunca compitan con la acción real. */}
            <div className="mt-2 flex flex-col gap-2">
              <Button fullWidth onClick={() => void marcarRevisado()} disabled={guardando}>
                {guardando ? 'Guardando…' : 'Marcar revisada'}
              </Button>
              <div className="flex gap-2">
                <Button variant="secondary" fullWidth onClick={irSiguiente} disabled={guardando}>
                  Siguiente
                </Button>
                <Button variant="danger" onClick={() => void descartarRecibo()} disabled={guardando}>
                  Descartar
                </Button>
              </div>
            </div>

            {/* Texto crudo del OCR, colapsable, para depurar lecturas raras. */}
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-slate-400">Ver texto crudo de la extracción</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-100 p-2 text-xs text-slate-600">
                {receiptActual.rawOCRText || '(vacío)'}
              </pre>
            </details>
          </div>
        </div>
      )}

      {/* Exportar cierra el flujo: va al final, después de revisar. */}
      <div className="mt-6 border-t border-slate-200 pt-4">
        {pendientes > 0 && (
          <p className="mb-2 text-center text-xs text-slate-500">
            Quedan {pendientes} factura{pendientes === 1 ? '' : 's'} sin revisar.
          </p>
        )}
        <Button
          variant="secondary"
          fullWidth
          onClick={() => navigate(`/export/${sessionId}`)}
        >
          Exportar a Excel
        </Button>
      </div>
    </Screen>
  )
}
