// Comparación de dos versiones de un contrato con Gemini y structured output.
// Una sola llamada con ambos textos en contexto → JSON con el resumen de
// cambios, la lista detallada (añadido/eliminado/modificado) y el cambio en el
// perfil de riesgo.
const { GoogleGenAI, Type } = require('@google/genai')
const { withGeminiFallback } = require('./retry')

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    summary: {
      type: Type.STRING,
      description: 'Resumen ejecutivo de los cambios principales entre ambas versiones.'
    },
    changes: {
      type: Type.ARRAY,
      description: 'Lista de cambios concretos detectados.',
      items: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, description: 'Área del cambio: precio, duración, penalización, jurisdicción, partes, etc.' },
          type: { type: Type.STRING, enum: ['añadido', 'eliminado', 'modificado'] },
          description: { type: Type.STRING, description: 'Qué cambió, en lenguaje claro.' },
          before: { type: Type.STRING, description: 'Texto o valor en la versión anterior. "—" si no existía.' },
          after: { type: Type.STRING, description: 'Texto o valor en la versión nueva. "—" si se eliminó.' },
          impact: { type: Type.STRING, enum: ['alto', 'medio', 'bajo'] }
        },
        required: ['category', 'type', 'description', 'impact']
      }
    },
    risk_assessment: {
      type: Type.STRING,
      description: 'Cómo cambia el perfil de riesgo global y a qué parte favorecen los cambios.'
    }
  },
  required: ['summary', 'changes', 'risk_assessment']
}

const SYSTEM_INSTRUCTION = `Eres un experto en análisis de contratos. Recibes dos versiones de un mismo contrato (una anterior y una nueva) y tu tarea es identificar los cambios relevantes entre ellas.

Para cada cambio indica:
- la categoría (precio, duración, penalización, jurisdicción, confidencialidad, partes, etc.),
- el tipo (añadido, eliminado o modificado),
- una descripción clara,
- el valor anterior y el nuevo cuando aplique,
- el impacto (alto/medio/bajo).

Céntrate en cambios sustantivos (económicos, de obligaciones, de riesgo), no en diferencias triviales de redacción. Valora cómo cambia el perfil de riesgo y a quién favorecen los cambios. Responde en español y no inventes cambios que no estén en los textos.`

async function compareContracts(textBefore, textAfter) {
  const response = await withGeminiFallback((model) => ai.models.generateContent({
    model,
    contents: `Compara estas dos versiones de un contrato e identifica los cambios.\n\n=== VERSIÓN ANTERIOR ===\n${textBefore}\n\n=== VERSIÓN NUEVA ===\n${textAfter}`,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema
    }
  }))

  return JSON.parse(response.text)
}

module.exports = { compareContracts }
