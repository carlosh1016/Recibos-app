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
npm install

# 1. Local (opcional): copia .dev.vars.example a .dev.vars y rellena
#    GEMINI_API_KEY y APP_SHARED_TOKEN, luego:
npm run dev            # levanta el Worker en http://localhost:8787

# 2. Producción:
npx wrangler login
npx wrangler secret put GEMINI_API_KEY     # pega tu clave de Gemini
npx wrangler secret put APP_SHARED_TOKEN   # inventa un token largo aleatorio
npm run deploy
# -> imprime la URL, ej. https://recibos-proxy.TU-USUARIO.workers.dev
```

El endpoint es `POST <URL>/` (el Worker atiende cualquier ruta; la app usa la raíz).

## Conectar la PWA

En la raíz del proyecto, copia `.env.example` a `.env` y pon:

```
VITE_LLM_PROXY_URL=https://recibos-proxy.TU-USUARIO.workers.dev
VITE_LLM_PROXY_TOKEN=<el mismo APP_SHARED_TOKEN de arriba>
```

Reinicia `npm run dev` (Vite lee `.env` al arrancar).

## Probar con curl

```bash
IMG=$(base64 -w0 factura.jpg)
curl -s -X POST https://recibos-proxy.TU-USUARIO.workers.dev \
  -H "Authorization: Bearer <APP_SHARED_TOKEN>" \
  -H "Content-Type: application/json" \
  -d "{\"imageBase64\":\"$IMG\",\"mimeType\":\"image/jpeg\"}" | jq
# -> { "fields": { "razonSocial": "...", "nit": "...", "total": ..., ... } }
```

## Contrato

- **Request:** `POST` con `Authorization: Bearer <APP_SHARED_TOKEN>` y body
  `{ imageBase64: string, mimeType: string }`.
- **Response 200:** `{ fields: { razonSocial, nit, numero, fecha, concepto,
  valorBase, porcentajeIva, ivaMonto, total, formaPago } }` (cualquier campo
  puede ser `null`).
- **Errores:** 401 (token), 400 (body), 502 (Gemini falló). El cliente cae al
  pipeline de Tesseract ante cualquier error.

## Seguridad / cuota

Todos los usuarios comparten esta única clave = una sola cuota del free tier
(~1,500 solicitudes/día). El `APP_SHARED_TOKEN` evita que un extraño con la URL
la agote. Para uso personal es suficiente; si distribuyes la app a mucha gente,
endurece con auth por usuario o rate-limit por IP.
