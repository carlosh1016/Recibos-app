// Proxy serverless (Cloudflare Worker) entre la PWA y la API de Gemini.
//
// Por qué existe: la PWA es 100% cliente (sin backend). La clave de Gemini NO
// puede ir en el bundle del navegador (cualquiera la extraería y gastaría la
// cuota). Este Worker guarda la clave como SECRETO de servidor y expone un solo
// endpoint que recibe la imagen recortada de la tirilla, se la manda a Gemini
// pidiendo JSON estructurado, y devuelve los campos de la factura.
//
// Seguridad: como todos los usuarios comparten esta única clave (= una sola
// cuota), el endpoint exige un token compartido (APP_SHARED_TOKEN) en el header
// Authorization. Es una barrera básica para que la URL filtrada no le permita a
// un extraño agotar la cuota; para uso personal es suficiente.

interface Env {
  // Secretos (se cargan con `wrangler secret put ...`, nunca en el repo):
  GEMINI_API_KEY: string
  APP_SHARED_TOKEN: string
  // Variables opcionales (wrangler.toml [vars]):
  GEMINI_MODEL?: string // por defecto gemini-2.5-flash
  ALLOWED_ORIGIN?: string // por defecto '*' (el token es la protección real)
}

// Campos que le pedimos a Gemini. Debe mantenerse en sincronía (a mano, es otro
// deploy) con ExtractedData del cliente. El cliente valida/sanea igual, así que
// esto es la "forma esperada", no un contrato de confianza.
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

function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  })
}

interface ExtractBody {
  imageBase64?: string
  mimeType?: string
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Preflight CORS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) })
    }

    if (request.method !== 'POST') {
      return json({ error: 'Método no permitido; usa POST /extract' }, 405, env)
    }

    // Token compartido (barrera anti-abuso de cuota)
    const auth = request.headers.get('Authorization') || ''
    if (!env.APP_SHARED_TOKEN || auth !== `Bearer ${env.APP_SHARED_TOKEN}`) {
      return json({ error: 'No autorizado' }, 401, env)
    }

    let body: ExtractBody
    try {
      body = (await request.json()) as ExtractBody
    } catch {
      return json({ error: 'Body inválido; se espera JSON { imageBase64, mimeType }' }, 400, env)
    }

    const { imageBase64, mimeType } = body
    if (!imageBase64 || !mimeType) {
      return json({ error: 'Faltan imageBase64 y/o mimeType' }, 400, env)
    }

    const model = env.GEMINI_MODEL || 'gemini-2.5-flash'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`

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
      return json({ error: `No se pudo contactar a Gemini: ${String(err)}` }, 502, env)
    }

    if (!geminiResp.ok) {
      const detalle = await geminiResp.text().catch(() => '')
      return json({ error: `Gemini respondió ${geminiResp.status}`, detalle }, 502, env)
    }

    // Gemini devuelve el JSON pedido como texto dentro de candidates[0].content.parts[0].text
    let geminiJson: unknown
    try {
      geminiJson = await geminiResp.json()
    } catch {
      return json({ error: 'Respuesta de Gemini no era JSON' }, 502, env)
    }

    const texto = extraerTextoDeGemini(geminiJson)
    if (texto === null) {
      return json({ error: 'Gemini no devolvió contenido', respuesta: geminiJson }, 502, env)
    }

    let fields: unknown
    try {
      fields = JSON.parse(texto)
    } catch {
      return json({ error: 'El contenido de Gemini no era JSON parseable', texto }, 502, env)
    }

    // Se devuelven los campos crudos; el CLIENTE los valida, recomputa el DV y
    // decide el status (misma filosofía que el parser: nunca confiar ciegamente).
    return json({ fields }, 200, env)
  },
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
