// Cadena de modelos Gemini con fallback + reintentos para errores transitorios.
//
// Cada modelo tiene su PROPIA cuota (el límite es por modelo), así que si el
// modelo principal se agota (429) o está saturado (503), se pasa al siguiente.
// - 429 (cuota): no tiene sentido reintentar el mismo modelo → se salta ya.
// - 503 (sobrecarga): se reintenta el mismo modelo con backoff antes de saltar.
//
// La cadena es configurable con GEMINI_MODELS (lista separada por comas).
const MODELS = (process.env.GEMINI_MODELS ||
  'gemini-3.5-flash,gemini-3-flash-preview,gemini-2.5-flash')
  .split(',').map(s => s.trim()).filter(Boolean)

const RETRYABLE = [429, 503]
const MAX_RETRIES_PER_MODEL = 2 // para 503 (sobrecarga) y timeouts

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Timeouts de red (modelo saturado que tarda demasiado). No traen status HTTP.
function isTimeout(err) {
  const code = err?.code || err?.cause?.code
  return code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'ETIMEDOUT' ||
    /timeout/i.test(err?.message || '')
}

// Ejecuta `fn(model)` probando cada modelo de la cadena. `fn` recibe el id del
// modelo y devuelve una promesa (sirve para generateContent y
// generateContentStream). Devuelve el primer resultado correcto.
async function withGeminiFallback(fn) {
  let lastErr
  for (let m = 0; m < MODELS.length; m++) {
    const model = MODELS[m]
    const isLastModel = m === MODELS.length - 1

    for (let attempt = 0; attempt <= MAX_RETRIES_PER_MODEL; attempt++) {
      try {
        return await fn(model)
      } catch (err) {
        lastErr = err
        const timeout = isTimeout(err)
        if (!RETRYABLE.includes(err.status) && !timeout) throw err // no transitorio → fallar ya

        // Cuota agotada: reintentar el mismo modelo no ayuda, saltar al siguiente.
        if (err.status === 429) {
          if (!isLastModel) console.warn(`Gemini 429 (cuota) en ${model} → cambiando a ${MODELS[m + 1]}`)
          break
        }

        // Sobrecarga (503) o timeout: reintentar el mismo modelo antes de saltar.
        const reason = timeout ? 'timeout' : '503'
        if (attempt === MAX_RETRIES_PER_MODEL) {
          if (!isLastModel) console.warn(`Gemini ${reason} en ${model} → cambiando a ${MODELS[m + 1]}`)
          break
        }
        const delay = 1000 * 2 ** attempt // 1s, 2s
        console.warn(`Gemini ${reason} en ${model}, reintento ${attempt + 1}/${MAX_RETRIES_PER_MODEL} en ${delay}ms`)
        await sleep(delay)
      }
    }
  }
  throw lastErr
}

module.exports = { withGeminiFallback }
