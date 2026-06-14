// Análisis inicial del contrato con Gemini Flash y structured output.
// Una sola llamada con todo el contrato en contexto → JSON garantizado por
// schema (resumen, datos clave y riesgos). Ver secciones 4 y 5 del doc.
const { GoogleGenAI, Type } = require('@google/genai')
const { withGeminiRetry } = require('./retry')

const MODEL = 'gemini-3.5-flash'

const DISCLAIMER =
  'Este análisis no constituye asesoramiento legal y debe ser revisado por un profesional.'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Resumen ejecutivo del contrato en 3-5 frases.'
    },
    parties: {
      type: Type.ARRAY,
      description: 'Partes involucradas con su nombre y rol.',
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING }
        },
        required: ['name', 'role']
      }
    },
    key_dates: {
      type: Type.ARRAY,
      description: 'Fechas clave: firma, inicio, vencimiento, renovación.',
      items: {
        type: Type.OBJECT,
        properties: {
          label: { type: Type.STRING },
          date: { type: Type.STRING }
        },
        required: ['label', 'date']
      }
    },
    economic_terms: {
      type: Type.STRING,
      description: 'Importes y condiciones económicas relevantes.'
    },
    duration: {
      type: Type.STRING,
      description: 'Duración del contrato y condiciones de renovación.'
    },
    penalties: {
      type: Type.STRING,
      description: 'Cláusulas de penalización, si existen.'
    },
    confidentiality: {
      type: Type.STRING,
      description: 'Confidencialidad y no competencia, si existen.'
    },
    jurisdiction: {
      type: Type.STRING,
      description: 'Jurisdicción y ley aplicable.'
    },
    termination: {
      type: Type.STRING,
      description: 'Causas de terminación del contrato.'
    },
    risks: {
      type: Type.ARRAY,
      description: 'Cláusulas inusuales, ambiguas o desfavorables detectadas.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ['alta', 'media', 'baja'] },
          location: { type: Type.STRING, description: 'Página y/o cláusula.' },
          explanation: { type: Type.STRING },
          recommendation: { type: Type.STRING }
        },
        required: ['title', 'severity', 'explanation']
      }
    }
  },
  required: [
    'summary', 'parties', 'key_dates', 'economic_terms', 'duration',
    'penalties', 'confidentiality', 'jurisdiction', 'termination', 'risks'
  ]
}

const SYSTEM_INSTRUCTION = `Eres un asistente experto en análisis de contratos comerciales. Tu función es identificar cláusulas inusuales, ambiguas o desfavorables, y extraer la información clave del contrato.

Al detectar riesgos, presta especial atención a:
- Cláusulas de penalización desproporcionadas
- Renovaciones automáticas
- Ausencia de límite de responsabilidad
- Jurisdicción extranjera inesperada
- Cláusulas de exclusividad amplias
- Términos de pago abusivos
- Cesión unilateral del contrato

Responde siempre en español. Si un dato no aparece en el contrato, indícalo explícitamente con "No especificado" en lugar de inventarlo.`

async function analyzeContract(rawText) {
  const response = await withGeminiRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: `Analiza el siguiente contrato y devuelve el análisis estructurado.\n\n--- CONTRATO ---\n${rawText}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema
    }
  }))

  const data = JSON.parse(response.text)

  // Separar según el schema de la tabla analyses: summary / extracted_data / risks.
  const { summary, risks, ...extracted_data } = data

  return {
    summary,
    extracted_data,
    risks,
    disclaimer: DISCLAIMER
  }
}

module.exports = { analyzeContract, DISCLAIMER }
