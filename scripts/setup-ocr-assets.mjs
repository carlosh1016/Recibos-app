// Copia a public/tesseract/ los assets que tesseract.js necesita en runtime
// (worker script, los tres builds del core WASM, y el modelo de idioma
// 'spa'), y los descarga/copia desde donde realmente viven:
//   - worker.min.js y los tesseract-core-*.wasm(.js) ya están en
//     node_modules tras `npm install` (son parte de tesseract.js y
//     tesseract.js-core) — no hace falta red para esa parte.
//   - spa.traineddata.gz NO es un paquete npm: tesseract.js lo descarga de
//     un CDN en runtime. Este script lo baja una vez a public/ para que
//     quede empaquetado con la app y el OCR funcione offline desde la
//     primera instalación, sin depender de ese CDN.
//
// Se deja como script MANUAL (no un postinstall automático) a propósito:
// no todos los entornos donde se hace `npm install` tienen salida a
// internet, y no queremos que una instalación normal falle por eso. Correr
// una vez con `npm run setup:ocr` después de clonar el repo.
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
    throw new Error(`No se encontró ${WORKER_SRC}. Corre \`npm install\` primero.`)
  }
  copyFileSync(WORKER_SRC, `${OUT_DIR}/worker.min.js`)
  console.log('worker.min.js copiado')

  for (const variante of CORE_VARIANTS) {
    for (const ext of ['.wasm.js', '.wasm']) {
      const origen = `${CORE_DIR}/${variante}${ext}`
      if (!existsSync(origen)) {
        throw new Error(`No se encontró ${origen}. Corre \`npm install\` primero.`)
      }
      copyFileSync(origen, `${OUT_CORE}/${variante}${ext}`)
    }
  }
  console.log('core de tesseract.js-core (3 variantes lstm) copiado')

  const destinoLang = `${OUT_LANG}/spa.traineddata.gz`
  if (existsSync(destinoLang)) {
    console.log('spa.traineddata.gz ya existe, no se vuelve a descargar')
  } else {
    console.log(`descargando ${LANG_URL} ...`)
    await descargar(LANG_URL, destinoLang)
    console.log('spa.traineddata.gz descargado')
  }

  console.log('\nListo. Assets de OCR en public/tesseract/.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
