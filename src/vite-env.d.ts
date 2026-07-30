/// <reference types="vite/client" />

// Variables de entorno del build (Vite las inyecta desde .env con el prefijo
// VITE_). NINGUNA es secreta: la única clave sensible (la de Gemini) vive en el
// proxy serverless, nunca en el cliente. Ver .env.example y proxy/README.md.
interface ImportMetaEnv {
  // URL del proxy serverless que reenvía la imagen a Gemini. Si está vacía, la
  // app usa la ruta del mismo dominio (/api/extract, /api/login) — solo hace
  // falta ponerla en dev local para apuntar a `wrangler dev`.
  readonly VITE_LLM_PROXY_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
