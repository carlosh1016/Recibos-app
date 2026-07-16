/**
 * Clase propia (no un Error genérico) para que el código que atrapa el
 * rechazo pueda distinguir "se agotó el tiempo" de cualquier otro fallo si
 * alguna vez le importa la diferencia (hoy no la usa nadie para eso, pero es
 * gratis y documenta la intención mejor que un Error a secas).
 */
export class TimeoutError extends Error {
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'TimeoutError'
  }
}

/**
 * Envuelve una promesa para que, si no se resuelve/rechaza dentro de `ms`,
 * el resultado combinado se rechace con TimeoutError. Es la pieza que evita
 * que el pipeline de captura se quede colgado para siempre: sin esto, una
 * promesa externa (ej. la carga de opencv.js) que nunca resuelve ni rechaza
 * deja a la UI esperando indefinidamente sin ningún error que mostrar.
 *
 * OJO: esto NO cancela el trabajo original — `promise` sigue corriendo en
 * segundo plano aunque el timeout ya haya rechazado. Para las promesas que
 * se usan acá (carga de un script, un job de tesseract.js) no hay forma de
 * abortarlas de verdad, así que lo mejor que se puede hacer es dejar de
 * esperarlas y seguir con el fallback.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, mensaje: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(mensaje)), ms)

    promise.then(
      (valor) => {
        clearTimeout(timer)
        resolve(valor)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
