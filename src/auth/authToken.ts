// Cliente del token de sesión: se guarda en localStorage y se valida
// decodificando el `expiry` que trae (formato `expiry.firma`, ver
// api/_lib/authToken.ts). Esto NO verifica la firma —no hay forma de hacerlo
// sin el secreto del servidor— así que `isTokenValid()` es solo una guía de
// UX (evita mostrar el login si ya hay un token con pinta de vigente) y
// funciona offline, sin red. La barrera de seguridad real vive en
// api/extract.ts, que sí verifica la firma en el servidor.

const CLAVE_TOKEN = 'recibos-auth-token'

// Igual que geminiExtract.ts: sin VITE_LLM_PROXY_URL se usa la ruta del mismo
// dominio (la función serverless de Vercel); con ella (dev local apuntando a
// `wrangler dev`) se añade el path que el Worker despacha a /login.
const LOGIN_URL = import.meta.env.VITE_LLM_PROXY_URL
  ? `${import.meta.env.VITE_LLM_PROXY_URL}/login`
  : '/api/login'

export function getToken(): string | null {
  return localStorage.getItem(CLAVE_TOKEN)
}

export function setToken(token: string): void {
  localStorage.setItem(CLAVE_TOKEN, token)
}

export function clearToken(): void {
  localStorage.removeItem(CLAVE_TOKEN)
}

/** Decodifica el `expiry` del token y compara con la hora actual. Sin red. */
export function isTokenValid(): boolean {
  const token = getToken()
  if (!token) return false
  const punto = token.indexOf('.')
  if (punto === -1) return false
  const expiry = Number(token.slice(0, punto))
  return Number.isFinite(expiry) && Date.now() < expiry
}

/** Valida la contraseña contra /api/login y guarda el token si es correcta. */
export async function login(password: string): Promise<void> {
  const resp = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })

  if (!resp.ok) {
    const detalle = (await resp.json().catch(() => null)) as { error?: string } | null
    throw new Error(detalle?.error || `El login respondió ${resp.status}`)
  }

  const body = (await resp.json()) as { token: string }
  setToken(body.token)
}
