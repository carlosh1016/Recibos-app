// Núcleo criptográfico compartido por api/login.ts y api/extract.ts (y su
// espejo proxy/src/authToken.ts, para el Worker de Cloudflare usado en dev
// local). Un solo primitivo — HMAC-SHA256 vía Web Crypto — para dos usos:
// firmar/verificar el token de sesión y comparar la contraseña sin una
// comparación de strings insegura ante ataques de temporización.
//
// El prefijo `_` en el nombre de la carpeta excluye este archivo del ruteo
// automático de Vercel: no se convierte en un endpoint público.

const PREFIJO_TOKEN = 'recibos-auth-v1'

async function importarClave(secreto: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

function bytesAHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function hexABytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Emite un token `expiry.hmac` que se verifica a sí mismo: el servidor no
 * necesita guardar nada (no hay tabla de sesiones ni base de datos).
 */
export async function signToken(secreto: string, expiryMs: number): Promise<string> {
  const clave = await importarClave(secreto)
  const firma = await crypto.subtle.sign(
    'HMAC',
    clave,
    new TextEncoder().encode(`${PREFIJO_TOKEN}:${expiryMs}`),
  )
  return `${expiryMs}.${bytesAHex(firma)}`
}

/**
 * Verifica firma + vigencia de un token emitido por signToken(). La firma se
 * chequea con crypto.subtle.verify (comparación a tiempo constante); nunca se
 * confía en el `expiry` sin validar antes la firma.
 */
export async function verifyToken(token: string, secreto: string): Promise<boolean> {
  const punto = token.indexOf('.')
  if (punto === -1) return false

  const expiryTexto = token.slice(0, punto)
  const expiryMs = Number(expiryTexto)
  if (!Number.isFinite(expiryMs)) return false

  const firmaBytes = hexABytes(token.slice(punto + 1))
  if (!firmaBytes) return false

  const clave = await importarClave(secreto)
  const firmaValida = await crypto.subtle.verify(
    'HMAC',
    clave,
    firmaBytes,
    new TextEncoder().encode(`${PREFIJO_TOKEN}:${expiryTexto}`),
  )
  return firmaValida && Date.now() < expiryMs
}

/**
 * Compara la contraseña recibida contra la real sin comparar strings
 * directamente: firma la real con HMAC y usa crypto.subtle.verify (que
 * recalcula el HMAC de la recibida y compara en tiempo constante) en vez de
 * `===`, que se corta en el primer carácter distinto.
 */
export async function verificarPassword(recibida: string, real: string, secreto: string): Promise<boolean> {
  const clave = await importarClave(secreto)
  const firmaReal = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(real))
  return crypto.subtle.verify('HMAC', clave, firmaReal, new TextEncoder().encode(recibida))
}
