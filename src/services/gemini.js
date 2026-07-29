const { GoogleGenAI } = require('@google/genai')

let client

// Crear el cliente solo cuando se usa una función de IA. De este modo el
// backend puede servir health checks, contratos sembrados e informes locales
// sin exigir una API key de Gemini durante el arranque.
function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim()
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY no está configurada')
    error.code = 'GEMINI_API_KEY_MISSING'
    throw error
  }

  if (!client) client = new GoogleGenAI({ apiKey })
  return client
}

module.exports = { getGeminiClient }
