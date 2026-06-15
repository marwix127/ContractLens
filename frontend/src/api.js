// Cliente de la API de ContractLens.
// En desarrollo, VITE_API_BASE está vacía y Vite hace proxy de /contracts al
// backend (ver vite.config.js). En producción se define con la URL del backend
// en Railway (el navegador llama directo; el backend permite CORS).
const API_BASE = import.meta.env.VITE_API_BASE || ''

// URL del PDF original (para el visor).
export const fileUrl = (contractId) => `${API_BASE}/contracts/${contractId}/file`

export async function uploadContract(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_BASE}/contracts`, { method: 'POST', body: form })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error al subir el contrato')
  return data
}

export async function listContracts() {
  const res = await fetch(`${API_BASE}/contracts`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error al listar contratos')
  return data.contracts
}

// Contratos de muestra precargados para probar sin subir nada.
export async function listSamples() {
  const res = await fetch(`${API_BASE}/contracts/samples`)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error al listar ejemplos')
  return data.contracts
}

// Devuelve el análisis guardado, o null si aún no existe (404).
export async function getAnalysis(contractId) {
  const res = await fetch(`${API_BASE}/contracts/${contractId}/analysis`)
  if (res.status === 404) return null
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error al obtener el análisis')
  return data
}

// Genera (y guarda) el análisis con Gemini. Tarda unos segundos.
export async function analyzeContract(contractId) {
  const res = await fetch(`${API_BASE}/contracts/${contractId}/analyze`, { method: 'POST' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Error al generar el análisis')
  return data
}

// Chat con respuesta en streaming (SSE). Invoca los handlers a medida que
// llegan los eventos: onMeta(meta), onDelta(text), onDone(), onError(msg).
export async function streamChat(contractId, question, conversationId, handlers = {}) {
  const res = await fetch(`${API_BASE}/contracts/${contractId}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, conversationId })
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || 'Error en el chat')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // Los eventos SSE se separan por una línea en blanco.
    const blocks = buffer.split('\n\n')
    buffer = blocks.pop() // el último puede estar incompleto

    for (const block of blocks) {
      const dataLine = block.split('\n').find(l => l.startsWith('data:'))
      if (!dataLine) continue
      const event = JSON.parse(dataLine.slice(5).trim())
      if (event.type === 'meta') handlers.onMeta?.(event)
      else if (event.type === 'delta') handlers.onDelta?.(event.text)
      else if (event.type === 'done') handlers.onDone?.()
      else if (event.type === 'error') handlers.onError?.(event.error)
    }
  }
}
