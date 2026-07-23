// Función serverless de Vercel (Edge) entre la PWA y la API de Gemini.
//
// Es el ESPEJO de proxy/src/worker.ts (la versión Cloudflare que se usa en
// desarrollo local con `wrangler dev`). Mantener el PROMPT y el RESPONSE_SCHEMA
// en sincronía entre ambos. En producción la PWA la llama en el MISMO dominio
// (/api/extract), así que no hay CORS ni URL externa que configurar.
//
// La clave de Gemini vive como variable de entorno de Vercel
// (GEMINI_API_KEY, SIN el prefijo VITE_ → nunca se empaqueta en el navegador).
// El endpoint exige el token compartido (APP_SHARED_TOKEN) como barrera básica
// anti-abuso de la cuota gratuita.

export const config = { runtime: 'edge' }

// Campos que le pedimos a Gemini. Debe mantenerse en sincronía (a mano) con
// ExtractedData del cliente; el cliente valida/sanea igual, así que esto es la
// "forma esperada", no un contrato de confianza.
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    razonSocial: { type: 'STRING', nullable: true },
    nit: { type: 'STRING', nullable: true },
    numero: { type: 'STRING', nullable: true },
    fecha: { type: 'STRING', nullable: true },
    concepto: { type: 'STRING', nullable: true },
    valorBase: { type: 'NUMBER', nullable: true },
    porcentajeIva: { type: 'NUMBER', nullable: true },
    ivaMonto: { type: 'NUMBER', nullable: true },
    total: { type: 'NUMBER', nullable: true },
    formaPago: { type: 'STRING', nullable: true },
  },
} as const

const PROMPT = `Eres un extractor de datos de facturas electrónicas colombianas (tirillas/POS).
Te doy la FOTO de una factura. Devuelve SOLO un JSON con estos campos (usa null si no aparece o no estás seguro):

- razonSocial: nombre del EMISOR/vendedor (no el cliente ni "consumidor final").
- nit: NIT del emisor, SOLO dígitos, sin puntos ni guion ni el dígito de verificación.
- numero: número de la factura (ej. "CFLA 1915").
- fecha: fecha de la factura en formato ISO "YYYY-MM-DD".
- concepto: descripción del producto/servicio principal.
- valorBase: base gravable (número, sin separadores de miles, punto decimal).
- porcentajeIva: IVA como FRACCIÓN (0.19 para 19%, 0.05 para 5%, 0 para exento).
- ivaMonto: valor del IVA en pesos (número).
- total: total a pagar en pesos (número). NO uses el "recibido" ni el "cambio".
- formaPago: "contado" si es efectivo/débito/tarjeta/contado; "credito" si es a crédito; null si no se sabe.

Reglas: los montos son números puros (14100, no "14.100"). Si la factura dice "IVA incluido" y da el total pero no la base, calcula la base = total / (1 + porcentajeIva) e ivaMonto = total - base. Responde únicamente el JSON.`

interface ExtractBody {
  imageBase64?: string
  mimeType?: string
}

export default async function handler(request: Request): Promise<Response> {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
  const json = (body: unknown, status: number): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    })

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }
  if (request.method !== 'POST') {
    return json({ error: 'Método no permitido; usa POST /api/extract' }, 405)
  }

  // Token compartido (barrera anti-abuso de cuota)
  const token = process.env.APP_SHARED_TOKEN
  const auth = request.headers.get('Authorization') || ''
  if (!token || auth !== `Bearer ${token}`) {
    return json({ error: 'No autorizado' }, 401)
  }

  let body: ExtractBody
  try {
    body = (await request.json()) as ExtractBody
  } catch {
    return json({ error: 'Body inválido; se espera JSON { imageBase64, mimeType }' }, 400)
  }

  const { imageBase64, mimeType } = body
  if (!imageBase64 || !mimeType) {
    return json({ error: 'Faltan imageBase64 y/o mimeType' }, 400)
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return json({ error: 'Falta GEMINI_API_KEY en el servidor' }, 500)
  }
  const model = process.env.GEMINI_MODEL || 'gemini-flash-latest'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  let geminiResp: Response
  try {
    geminiResp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }],
          },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    })
  } catch (err) {
    return json({ error: `No se pudo contactar a Gemini: ${String(err)}` }, 502)
  }

  if (!geminiResp.ok) {
    const detalle = await geminiResp.text().catch(() => '')
    return json({ error: `Gemini respondió ${geminiResp.status}`, detalle }, 502)
  }

  let geminiJson: unknown
  try {
    geminiJson = await geminiResp.json()
  } catch {
    return json({ error: 'Respuesta de Gemini no era JSON' }, 502)
  }

  const texto = extraerTextoDeGemini(geminiJson)
  if (texto === null) {
    return json({ error: 'Gemini no devolvió contenido', respuesta: geminiJson }, 502)
  }

  let fields: unknown
  try {
    fields = JSON.parse(texto)
  } catch {
    return json({ error: 'El contenido de Gemini no era JSON parseable', texto }, 502)
  }

  // Se devuelven los campos crudos; el CLIENTE los valida, recomputa el DV y
  // decide el status (misma filosofía que el parser: nunca confiar a ciegas).
  return json({ fields }, 200)
}

/** Navega la estructura de respuesta de Gemini hasta el texto generado. */
function extraerTextoDeGemini(resp: unknown): string | null {
  const r = resp as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
  }
  const parts = r.candidates?.[0]?.content?.parts
  if (!parts) return null
  const texto = parts.map((p) => p.text ?? '').join('')
  return texto || null
}
