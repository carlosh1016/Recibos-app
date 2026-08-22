// Copia a public/tesseract/ los assets que tesseract.js necesita en runtime
// (worker script, los tres builds del core WASM, y el modelo de idioma
// 'spa'), y los descarga/copia desde donde realmente viven:
//   - worker.min.js y los tesseract-core-*.wasm(.js) ya están en
//     node_modules tras `pnpm install` (son parte de tesseract.js y
//     tesseract.js-core) — no hace falta red para esa parte.
//   - spa.traineddata.gz NO es un paquete npm: tesseract.js lo descarga de
//     un CDN en runtime. Este script lo baja una vez a public/ para que
//     quede empaquetado con la app y el OCR funcione offline desde la
//     primera instalación, sin depender de ese CDN.
//
// Corre automáticamente como `postinstall` tras `pnpm install` (ver
// package.json), para que al clonar en una máquina nueva los assets se
// generen solos y no haya que acordarse de un paso manual — ese olvido era
// justo la causa del "NetworkError: worker.min.js failed to load". Igual se
// puede correr a mano con `pnpm run setup:ocr`.
//
// CLAVE: este script NUNCA debe hacer fallar el `pnpm install`. La copia de
// worker + core sale de node_modules (siempre presente después de instalar,
// no necesita red). Solo la descarga del traineddata necesita internet, y si
// falla (entorno sin salida a la red, CDN caído) se avisa con un warning
// pero se sigue con exit 0: el resto de la app queda instalable, y basta
// volver a correr `pnpm run setup:ocr` con conexión para completar el OCR.
import { existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { get } from 'node:https'
import { createWriteStream } from 'node:fs'

const CORE_DIR = 'node_modules/tesseract.js-core'
const WORKER_SRC = 'node_modules/tesseract.js/dist/worker.min.js'

const OUT_DIR = 'public/tesseract'
const OUT_CORE = `${OUT_DIR}/core`
const OUT_LANG = `${OUT_DIR}/lang`

// Las 3 variantes "lstm" (createWorker por defecto usa OEM.LSTM_ONLY): con
// las 3 presentes, la propia detección de soporte SIMD de tesseract.js
// (via wasm-feature-detect) elige la más rápida que el navegador soporte,
// en vez de fijar una sola y dejar sin OCR a navegadores viejos.
const CORE_VARIANTS = ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']

const LANG_URL = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz'

function descargar(url, destino) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`GET ${url} -> ${res.statusCode}`))
        return
      }
      const archivo = createWriteStream(destino)
      res.pipe(archivo)
      archivo.on('finish', () => archivo.close(resolve))
    }).on('error', reject)
  })
}

async function main() {
  mkdirSync(OUT_CORE, { recursive: true })
  mkdirSync(OUT_LANG, { recursive: true })

  if (!existsSync(WORKER_SRC)) {
    throw new Error(`No se encontró ${WORKER_SRC}. Corre \`pnpm install\` primero.`)
  }
  copyFileSync(WORKER_SRC, `${OUT_DIR}/worker.min.js`)
  console.log('worker.min.js copiado')

  for (const variante of CORE_VARIANTS) {
    for (const ext of ['.wasm.js', '.wasm']) {
      const origen = `${CORE_DIR}/${variante}${ext}`
      if (!existsSync(origen)) {
        throw new Error(`No se encontró ${origen}. Corre \`pnpm install\` primero.`)
      }
      copyFileSync(origen, `${OUT_CORE}/${variante}${ext}`)
    }
  }
  console.log('core de tesseract.js-core (3 variantes lstm) copiado')

  const destinoLang = `${OUT_LANG}/spa.traineddata.gz`
  if (existsSync(destinoLang)) {
    console.log('spa.traineddata.gz ya existe, no se vuelve a descargar')
  } else {
    // La descarga es el ÚNICO paso que necesita red. Si falla, no se aborta
    // todo (ver el comentario de cabecera): se avisa y se sigue, dejando el
    // resto de los assets ya copiados. `pnpm run setup:ocr` con internet
    // completa lo que falte.
    console.log(`descargando ${LANG_URL} ...`)
    try {
      await descargar(LANG_URL, destinoLang)
      console.log('spa.traineddata.gz descargado')
    } catch (err) {
      console.warn(
        `\n[setup:ocr] ADVERTENCIA: no se pudo descargar el modelo de idioma 'spa' ` +
          `(${err instanceof Error ? err.message : err}).\n` +
          `El OCR no funcionará hasta que corras \`pnpm run setup:ocr\` con conexión a internet.`,
      )
      return
    }
  }

  console.log('\nListo. Assets de OCR en public/tesseract/.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
