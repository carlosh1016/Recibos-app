// Función serverless de Vercel (Edge) que valida la contraseña compartida y
// emite el token que api/extract.ts exige. Es el ESPEJO de la ruta /login en
// proxy/src/worker.ts (versión Cloudflare para dev local con `wrangler dev`).
//
// No hay base de datos ni tabla de sesiones: el token se verifica a sí mismo
// (ver api/_lib/authToken.ts). La contraseña y el secreto de firma viven como
// variables de entorno de Vercel (APP_PASSWORD, APP_AUTH_SECRET — SIN el
// prefijo VITE_, así que nunca se empaquetan en el navegador).

import { signToken, verificarPassword } from './_lib/authToken'

export const config = { runtime: 'edge' }

const NOVENTA_DIAS_MS = 90 * 24 * 60 * 60 * 1000

interface LoginBody {
  password?: string
}

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default async function handler(request: Request): Promise<Response> {
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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
    return json({ error: 'Método no permitido; usa POST /api/login' }, 405)
  }

  const password = process.env.APP_PASSWORD
  const secreto = process.env.APP_AUTH_SECRET
  if (!password || !secreto) {
    return json({ error: 'Login no configurado en el servidor' }, 500)
  }

  let body: LoginBody
  try {
    body = (await request.json()) as LoginBody
  } catch {
    return json({ error: 'Body inválido; se espera JSON { password }' }, 400)
  }

  if (!body.password || !(await verificarPassword(body.password, password, secreto))) {
    // Sin contador ni BD, pero un retraso fijo sí es gratis y sin estado: no
    // elimina la fuerza bruta, solo la hace impráctica para un intento naive.
    await esperar(400)
    return json({ error: 'Contraseña incorrecta' }, 401)
  }

  const token = await signToken(secreto, Date.now() + NOVENTA_DIAS_MS)
  return json({ token }, 200)
}
