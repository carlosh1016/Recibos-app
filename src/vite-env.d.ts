/// <reference types="vite/client" />

// Variables de entorno del build (Vite las inyecta desde .env con el prefijo
// VITE_). NINGUNA es secreta: la única clave sensible (la de Gemini) vive en el
// proxy serverless, nunca en el cliente. Ver .env.example y proxy/README.md.
interface ImportMetaEnv {
  // URL del proxy serverless que reenvía la imagen a Gemini. Si está vacía, la
  // app usa solo el pipeline offline de Tesseract (sin ruta LLM).
  readonly VITE_LLM_PROXY_URL?: string
  // Token compartido que el proxy exige para no dejar que cualquiera gaste la
  // cuota. No es un secreto fuerte (va en el bundle), solo una barrera básica.
  readonly VITE_LLM_PROXY_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
