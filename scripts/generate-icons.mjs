// Genera iconos PNG placeholder (cuadrado azul sólido) para el manifest de la PWA.
// No hay herramientas de imagen (ImageMagick/PIL) disponibles en este entorno, así que
// se arma un PNG mínimo a mano usando zlib (que sí viene con Node). Reemplaza estos
// archivos en public/ por un logo real cuando lo tengas.
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { crc32 } from 'node:zlib'

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput) >>> 0, 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

function makePng(size, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0) // width
  ihdr.writeUInt32BE(size, 4) // height
  ihdr.writeUInt8(8, 8) // bit depth
  ihdr.writeUInt8(2, 9) // color type: RGB
  ihdr.writeUInt8(0, 10) // compression
  ihdr.writeUInt8(0, 11) // filter
  ihdr.writeUInt8(0, 12) // interlace

  // Un solo color sólido en toda la imagen, un filtro "none" (0) por fila.
  const rowBytes = size * 3 + 1
  const raw = Buffer.alloc(rowBytes * size)
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowBytes
    raw[rowStart] = 0 // filter type: none
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 3
      raw[px] = r
      raw[px + 1] = g
      raw[px + 2] = b
    }
  }
  const idatData = deflateSync(raw)

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BLUE = [37, 99, 235] // brand.500, coincide con theme_color del manifest

writeFileSync('public/pwa-192x192.png', makePng(192, BLUE))
writeFileSync('public/pwa-512x512.png', makePng(512, BLUE))

console.log('Iconos placeholder generados en public/. Reemplázalos con tu logo real.')
