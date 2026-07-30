// Espejo de api/_lib/authToken.ts para el Worker de Cloudflare (dev local con
// `wrangler dev`). Web Crypto (crypto.subtle) es el mismo estándar en ambos
// runtimes, así que la lógica es idéntica — ver el original para el porqué de
// cada decisión (HMAC-SHA256 único primitivo, token auto-verificable sin
// estado, comparación de contraseña vía subtle.verify en vez de `===`).

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

export async function signToken(secreto: string, expiryMs: number): Promise<string> {
  const clave = await importarClave(secreto)
  const firma = await crypto.subtle.sign(
    'HMAC',
    clave,
    new TextEncoder().encode(`${PREFIJO_TOKEN}:${expiryMs}`),
  )
  return `${expiryMs}.${bytesAHex(firma)}`
}

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

export async function verificarPassword(recibida: string, real: string, secreto: string): Promise<boolean> {
  const clave = await importarClave(secreto)
  const firmaReal = await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(real))
  return crypto.subtle.verify('HMAC', clave, firmaReal, new TextEncoder().encode(recibida))
}
