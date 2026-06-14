// Reintentos con backoff exponencial para errores transitorios de Gemini.
// La API de Gemini Flash devuelve 429 (rate limit) y 503 (sobrecarga) con
// cierta frecuencia bajo demanda; reintentar suele resolverlo.
const RETRYABLE = [429, 503]
const MAX_RETRIES = 3

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Ejecuta `fn` y reintenta si lanza un error transitorio. Sirve tanto para
// generateContent como para generateContentStream (se le pasa un closure).
async function withGeminiRetry(fn) {
  let lastErr
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!RETRYABLE.includes(err.status) || attempt === MAX_RETRIES) throw err
      const delay = 1000 * 2 ** attempt // 1s, 2s, 4s
      console.warn(`Gemini ${err.status}, reintento ${attempt + 1}/${MAX_RETRIES} en ${delay}ms`)
      await sleep(delay)
    }
  }
  throw lastErr
}

module.exports = { withGeminiRetry }
