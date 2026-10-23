// Función serverless de Vercel (Edge) entre la PWA y OpenRouter, que a su vez
// enruta al modelo de visión configurado (por defecto Gemini 2.5 Flash Lite).
// En producción la PWA la llama en el MISMO dominio (/api/extract), así que no
// hay CORS ni URL externa que configurar. En dev local la sirve el propio
// `pnpm run dev` (ver el plugin apiLocal en vite.config.ts).
//
// La clave de OpenRouter vive como variable de entorno de Vercel
// (OPENROUTER_API_KEY, SIN el prefijo VITE_ → nunca se empaqueta en el
// navegador). El endpoint exige un token de sesión (emitido por api/login.ts
// tras validar la contraseña compartida — ver api/_lib/authToken.ts) como
// Bearer token.

import { verifyToken } from './_lib/authToken'

export const config = { runtime: 'edge' }

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
// Se elige con OPENROUTER_MODEL en Vercel para poder cambiar de modelo sin
// tocar código. Default: el más barato de la familia Gemini con buena lectura
// de imágenes (ver la comparación de modelos de OpenRouter).
const MODELO_POR_DEFECTO = 'google/gemini-2.5-flash-lite'
// Respaldo automático de OpenRouter (parámetro `models`): si el principal
// responde 429 o está caído, lo intenta con este en la MISMA petición. Pasa de
// verdad: el pool compartido de Google AI Studio para flash-lite devolvió 429
// en las primeras pruebas, y sin respaldo esa foto caía al OCR local. Este se
// sirve además desde Vertex (otro pool), y es de la misma familia (mismo
// formato de box_2d). Cuesta ~3x más, pero solo se paga cuando se usa.
const MODELO_RESPALDO = 'google/gemini-3.1-flash-lite'

// Campos que le pedimos al modelo. Debe mantenerse en sincronía (a mano) con
// ExtractedData del cliente; el cliente valida/sanea igual, así que esto es la
// "forma esperada", no un contrato de confianza. Es JSON Schema estándar en
// modo `strict` (formato de OpenAI que OpenRouter traduce a cada proveedor):
// strict exige listar TODOS los campos en `required` y cerrar el objeto con
// additionalProperties: false; "no aparece" se expresa con null, no omitiendo.
const CAMPOS_TEXTO = ['razonSocial', 'nit', 'numero', 'fecha', 'concepto', 'formaPago'] as const
const CAMPOS_NUMERO = ['valorBase', 'porcentajeIva', 'ivaMonto', 'total'] as const

// Una foto puede traer VARIAS facturas, así que la respuesta es una lista. Cada
// factura trae además `box_2d`: dónde está dentro de la foto, en la convención
// nativa de Gemini (ver src/extract/caja.ts), para recortarla en el cliente.
const FACTURA_SCHEMA = {
  type: 'object',
  properties: {
    ...Object.fromEntries(CAMPOS_TEXTO.map((c) => [c, { type: ['string', 'null'] }])),
    ...Object.fromEntries(CAMPOS_NUMERO.map((c) => [c, { type: ['number', 'null'] }])),
    box_2d: { type: 'array', items: { type: 'number' } },
  },
  required: [...CAMPOS_TEXTO, ...CAMPOS_NUMERO, 'box_2d'],
  additionalProperties: false,
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: { facturas: { type: 'array', items: FACTURA_SCHEMA } },
  required: ['facturas'],
  additionalProperties: false,
}

const PROMPT = `Eres un extractor de datos de facturas electrónicas colombianas (tirillas/POS).
Te doy una FOTO que puede contener UNA o VARIAS facturas (tirillas puestas una al lado de la otra).
Devuelve SOLO un JSON { "facturas": [...] } con un objeto POR CADA factura que veas, en orden de izquierda a derecha y de arriba a abajo.

MUY IMPORTANTE con varias facturas: cada objeto lleva SOLO los datos impresos en ESA tirilla. Nunca mezcles el NIT, el total ni ningún otro dato de una factura con otra. Si un dato de una tirilla no se lee, usa null en vez de tomarlo de otra.

Campos de cada factura (usa null si no aparece o no estás seguro):

- box_2d: recuadro de la tirilla COMPLETA dentro de la foto, como [ymin, xmin, ymax, xmax] normalizado de 0 a 1000. Debe cubrir todo el papel de esa factura, de borde a borde.
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

  // Token de sesión (ver api/login.ts): el servidor no guarda nada, solo
  // recalcula la firma HMAC y confirma que no haya expirado.
  const secreto = process.env.APP_AUTH_SECRET
  const auth = request.headers.get('Authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!secreto || !bearer || !(await verifyToken(bearer, secreto))) {
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

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return json({ error: 'Falta OPENROUTER_API_KEY en el servidor' }, 500)
  }
  const model = process.env.OPENROUTER_MODEL || MODELO_POR_DEFECTO

  let llmResp: Response
  try {
    llmResp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        // Opcional: nombre con el que la app aparece en el panel de OpenRouter.
        'X-Title': 'Recibos App',
      },
      body: JSON.stringify({
        models: model === MODELO_RESPALDO ? [model] : [model, MODELO_RESPALDO],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            ],
          },
        ],
        temperature: 0,
        // Tope de salida: cada factura pesa ~250 tokens de JSON; 3000 alcanza
        // para una foto con varias y solo evita que una respuesta desbocada
        // se cobre entera.
        max_tokens: 3000,
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'factura', strict: true, schema: RESPONSE_SCHEMA },
        },
        provider: {
          // Solo proveedores que soporten response_format (si no, el modelo
          // podría devolver texto libre en vez del JSON pedido).
          require_parameters: true,
          // Son facturas reales con NIT y montos: excluir proveedores que
          // guarden los datos o los usen para entrenar.
          data_collection: 'deny',
        },
      }),
    })
  } catch (err) {
    return json({ error: `No se pudo contactar a OpenRouter: ${String(err)}` }, 502)
  }

  if (!llmResp.ok) {
    const detalle = await llmResp.text().catch(() => '')
    return json({ error: `OpenRouter respondió ${llmResp.status}`, detalle: detalle.slice(0, 500) }, 502)
  }

  let llmJson: unknown
  try {
    llmJson = await llmResp.json()
  } catch {
    return json({ error: 'Respuesta de OpenRouter no era JSON' }, 502)
  }

  const texto = extraerTextoDeRespuesta(llmJson)
  if (texto === null) {
    return json({ error: 'El modelo no devolvió contenido' }, 502)
  }

  let parseado: { facturas?: unknown }
  try {
    parseado = JSON.parse(quitarCercoMarkdown(texto)) as { facturas?: unknown }
  } catch {
    return json({ error: 'El contenido del modelo no era JSON parseable', texto: texto.slice(0, 500) }, 502)
  }
  if (!Array.isArray(parseado?.facturas)) {
    return json({ error: 'El modelo no devolvió la lista "facturas"', texto: texto.slice(0, 500) }, 502)
  }

  // Se devuelven los campos crudos; el CLIENTE los valida, recomputa el DV y
  // decide el status (misma filosofía que el parser: nunca confiar a ciegas).
  return json({ facturas: parseado.facturas }, 200)
}

/** Navega la respuesta (formato chat completions) hasta el texto generado. */
function extraerTextoDeRespuesta(resp: unknown): string | null {
  const r = resp as { choices?: { message?: { content?: string | null } }[] }
  const texto = r.choices?.[0]?.message?.content
  return typeof texto === 'string' && texto.trim() ? texto : null
}

/**
 * Algunos modelos envuelven el JSON en un bloque ```json ... ``` aunque se les
 * pida JSON puro. Se quita el cerco si viene; si no, el texto queda igual.
 */
function quitarCercoMarkdown(texto: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(texto)
  return m ? m[1] : texto
}
