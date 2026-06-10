const { GoogleGenAI } = require('@google/genai')

const MODEL = 'gemini-embedding-001'
const DIMENSIONS = 1536 // debe coincidir con vector(1536) en el schema

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// Gemini no normaliza los vectores cuando outputDimensionality < 3072.
// Sin normalizar, la distancia coseno de pgvector da resultados sesgados.
function normalize(vector) {
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0))
  return vector.map(v => v / norm)
}

async function embed(texts, taskType) {
  const res = await ai.models.embedContent({
    model: MODEL,
    contents: texts,
    config: { outputDimensionality: DIMENSIONS, taskType }
  })
  return res.embeddings.map(e => normalize(e.values))
}

// Para indexar chunks de contratos
async function embedDocuments(texts) {
  return embed(texts, 'RETRIEVAL_DOCUMENT')
}

// Para las preguntas del usuario en el chat
async function embedQuery(text) {
  const [vector] = await embed([text], 'RETRIEVAL_QUERY')
  return vector
}

module.exports = { embedDocuments, embedQuery, DIMENSIONS }
