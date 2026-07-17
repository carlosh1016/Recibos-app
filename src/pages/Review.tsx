import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { db } from '../db/db'
import type { ExtractedData, FormaPago, Receipt, ReceiptStatus } from '../types'
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

// --- Badge de estado -------------------------------------------------------
const BADGE: Record<ReceiptStatus, { texto: string; clases: string }> = {
  ok: { texto: 'OK', clases: 'bg-green-100 text-green-800 border-green-300' },
  review: { texto: 'Revisar', clases: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
  error: { texto: 'Error', clases: 'bg-red-100 text-red-800 border-red-300' },
}

function Badge({ status }: { status: ReceiptStatus }) {
  const b = BADGE[status]
  return <span className={`rounded border px-2 py-0.5 text-xs font-medium ${b.clases}`}>{b.texto}</span>
}

// --- Campo de formulario reutilizable --------------------------------------
interface CampoProps {
  label: string
  value: string
  onChange: (v: string) => void
  resaltar?: boolean
  placeholder?: string
  inputMode?: 'text' | 'numeric' | 'decimal'
}

function Campo({ label, value, onChange, resaltar, placeholder, inputMode }: CampoProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>
      <input
        type="text"
        inputMode={inputMode}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded border px-2 py-1.5 text-sm outline-none focus:border-brand-500 ${
          resaltar ? 'border-yellow-400 bg-yellow-50' : 'border-gray-300'
        }`}
      />
    </label>
  )
}

export function Review() {
  const { sessionId } = useParams<{ sessionId: string }>()
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

  if (receipts.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold text-brand-700">Revisar recibos</h1>
        <p className="mt-1 text-sm text-gray-600">Sesión #{sessionId}</p>
        <p className="mt-6 text-sm text-gray-500">Todavía no hay recibos en esta sesión.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-brand-700">Revisar recibos</h1>
          <p className="mt-1 text-sm text-gray-600">
            Sesión #{sessionId} — {receipts.length} recibo(s), {pendientes} sin revisar
          </p>
        </div>
        {receiptActual && <Badge status={receiptActual.status} />}
      </div>

      {/* Tira de miniaturas/estado para saltar entre recibos */}
      <div className="mt-4 flex flex-wrap gap-1">
        {receipts.map((r, i) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setIdx(i)}
            className={`h-8 w-8 rounded border text-xs font-medium ${
              i === idx ? 'ring-2 ring-brand-500 ' : ''
            }${BADGE[r.status].clases}`}
            title={`Recibo #${r.id} — ${r.status}`}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {receiptActual && form && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Foto */}
          <div className="rounded border border-gray-200 bg-gray-50 p-2">
            {photoUrl ? (
              <img src={photoUrl} alt={`Recibo ${idx + 1}`} className="max-h-[70vh] w-full rounded object-contain" />
            ) : (
              <p className="p-4 text-sm text-gray-400">Cargando foto…</p>
            )}
          </div>

          {/* Formulario */}
          <div className="space-y-3">
            <Campo label="Razón social" value={form.razonSocial} onChange={(v) => setCampo('razonSocial', v)} />
            <div className="grid grid-cols-2 gap-3">
              <Campo label="NIT" value={form.nit} onChange={(v) => setCampo('nit', v)} inputMode="numeric" />
              <Campo label="Número de factura" value={form.numero} onChange={(v) => setCampo('numero', v)} />
            </div>
            <Campo
              label="Fecha (YYYY-MM-DD)"
              value={form.fecha}
              onChange={(v) => setCampo('fecha', v)}
              placeholder="2026-07-17"
            />

            <div className="grid grid-cols-3 gap-3">
              <Campo
                label="Base (VALOR)"
                value={form.valorBase}
                onChange={(v) => setCampo('valorBase', v)}
                inputMode="decimal"
                resaltar={calc.hayDiscrepancia}
              />
              <Campo
                label="% IVA"
                value={form.porcentajeIva}
                onChange={(v) => setCampo('porcentajeIva', v)}
                inputMode="decimal"
                resaltar={calc.hayDiscrepancia}
              />
              <Campo
                label="Total"
                value={form.total}
                onChange={(v) => setCampo('total', v)}
                inputMode="decimal"
                resaltar={calc.hayDiscrepancia}
              />
            </div>

            {calc.hayDiscrepancia && (
              <p className="rounded bg-yellow-50 px-2 py-1.5 text-xs text-yellow-800">
                Base + IVA ={' '}
                {calc.totalCalc?.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })}{' '}
                no coincide con el Total{' '}
                {calc.total?.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 })}.
                Corrige el campo mal leído.
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">Forma de pago</span>
                <select
                  value={form.formaPago}
                  onChange={(e) => setCampo('formaPago', e.target.value as FormState['formaPago'])}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm outline-none focus:border-brand-500"
                >
                  <option value="">—</option>
                  <option value="contado">Contado</option>
                  <option value="credito">Crédito</option>
                </select>
              </label>
            </div>

            <Campo label="Concepto" value={form.concepto} onChange={(v) => setCampo('concepto', v)} />

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => void marcarRevisado()}
                disabled={guardando}
                className="flex-1 rounded bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {guardando ? 'Guardando…' : 'Marcar revisado'}
              </button>
              <button
                type="button"
                onClick={irSiguiente}
                disabled={guardando}
                className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Siguiente
              </button>
              <button
                type="button"
                onClick={() => void descartarRecibo()}
                disabled={guardando}
                title="Descartar este recibo"
                className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                Descartar
              </button>
            </div>

            {/* Texto crudo del OCR, colapsable, para depurar lecturas raras. */}
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-gray-400">Ver texto OCR crudo</summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-xs text-gray-600">
                {receiptActual.rawOCRText || '(vacío)'}
              </pre>
            </details>
          </div>
        </div>
      )}
    </div>
  )
}
