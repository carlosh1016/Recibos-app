# Proxy de extracción (Gemini) — Cloudflare Worker

Reenvía la imagen recortada de la tirilla a la API de Gemini y devuelve los
campos de la factura en JSON. Existe para que la **clave de Gemini nunca esté en
el cliente**: vive aquí como secreto de servidor.

La PWA sigue siendo 100% cliente; este Worker es un componente aparte y opcional.
Si no lo despliegas (o dejas `VITE_LLM_PROXY_URL` vacío), la app usa solo el OCR
offline de Tesseract.

## Requisitos

- Una cuenta de Cloudflare (free tier sirve).
- Una clave de Gemini: https://aistudio.google.com/app/apikey (Get API key).

## Puesta en marcha

```bash
cd proxy
pnpm install

# 1. Local (opcional): copia .dev.vars.example a .dev.vars y rellena
#    GEMINI_API_KEY, APP_PASSWORD y APP_AUTH_SECRET, luego:
pnpm run dev            # levanta el Worker en http://localhost:8787

# 2. Producción:
pnpm exec wrangler login
pnpm exec wrangler secret put GEMINI_API_KEY     # pega tu clave de Gemini
pnpm exec wrangler secret put APP_PASSWORD       # la contraseña compartida
pnpm exec wrangler secret put APP_AUTH_SECRET    # string aleatorio (openssl rand -hex 32)
pnpm run deploy
# -> imprime la URL, ej. https://recibos-proxy.TU-USUARIO.workers.dev
```

Dos endpoints: `POST <URL>/login` (valida la contraseña y emite el token de
sesión) y `POST <URL>/` (extracción; cualquier ruta que no sea `/login`).

## Conectar la PWA

En la raíz del proyecto, copia `.env.example` a `.env` y pon:

```
VITE_LLM_PROXY_URL=https://recibos-proxy.TU-USUARIO.workers.dev
```

Reinicia `pnpm run dev` (Vite lee `.env` al arrancar). Ya no hace falta un
token en el cliente: la pantalla de login pide la contraseña y guarda el
token que devuelve `/login`.

## Probar con curl

```bash
# 1. Login: obtiene el token de sesión
TOKEN=$(curl -s -X POST https://recibos-proxy.TU-USUARIO.workers.dev/login \
  -H "Content-Type: application/json" \
  -d '{"password":"<APP_PASSWORD>"}' | jq -r .token)

# 2. Extract: usa el token como Bearer
IMG=$(base64 -w0 factura.jpg)
curl -s -X POST https://recibos-proxy.TU-USUARIO.workers.dev \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"imageBase64\":\"$IMG\",\"mimeType\":\"image/jpeg\"}" | jq
# -> { "fields": { "razonSocial": "...", "nit": "...", "total": ..., ... } }
```

## Contrato

- **`POST /login`:** body `{ password: string }` → `{ token: string }` (200) o
  401 si la contraseña es incorrecta. El token es autoverificable (firma HMAC
  + expiración a 90 días); el servidor no guarda sesiones.
- **`POST /` (extract):** `Authorization: Bearer <token>` + body
  `{ imageBase64: string, mimeType: string }`.
- **Response 200:** `{ fields: { razonSocial, nit, numero, fecha, concepto,
  valorBase, porcentajeIva, ivaMonto, total, formaPago } }` (cualquier campo
  puede ser `null`).
- **Errores:** 401 (token ausente/inválido/expirado, o contraseña
  incorrecta en `/login`), 400 (body), 502 (Gemini falló). El cliente cae al
  pipeline de Tesseract ante cualquier error en `/` (extract).

## Seguridad / cuota

Todos los usuarios comparten esta única clave = una sola cuota del free tier
(~1,500 solicitudes/día). El token de sesión (emitido solo tras la contraseña
correcta) evita que un extraño con la URL la agote. Para uso personal es
suficiente; si distribuyes la app a mucha gente, endurece con auth por usuario
o rate-limit por IP.
