// Chat RAG sobre un contrato con Gemini.
// Flujo: pregunta → embedding → retrieval top-K en pgvector → respuesta con
// citas (página + cláusula) y manejo explícito de "no lo sé".
// Expone dos variantes: chat() (respuesta completa) y chatStream() (SSE).
const { GoogleGenAI } = require('@google/genai')
const pool = require('../db')
const { embedQuery } = require('./embeddings')
const { withGeminiRetry } = require('./retry')

const MODEL = 'gemini-3.5-flash'
const TOP_K = 5

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const SYSTEM_INSTRUCTION = `Eres un asistente que responde preguntas sobre un contrato concreto. Reglas estrictas:

1. Responde ÚNICAMENTE con la información del CONTEXTO que se te proporciona. No uses conocimiento externo ni inventes cláusulas.
2. Si la respuesta no está en el contexto, dilo claramente: "No encuentro esa información en el documento." No especules.
3. Cita siempre tus fuentes indicando la página y, si está disponible, la cláusula (por ejemplo: "(Página 2, Cláusula 4)").
4. Responde en español, de forma clara y concisa.
5. Recuerda que tu respuesta es informativa y no constituye asesoramiento legal.`

// pgvector espera el vector como literal '[v1,v2,...]'.
function toVectorLiteral(vector) {
  return `[${vector.join(',')}]`
}

async function ensureConversation(contractId, conversationId) {
  if (conversationId) return conversationId
  const { rows } = await pool.query(
    'INSERT INTO conversations (contract_id) VALUES ($1) RETURNING id',
    [contractId]
  )
  return rows[0].id
}

async function retrieveChunks(contractId, question) {
  const qVec = await embedQuery(question)
  const { rows } = await pool.query(
    `SELECT content, page_number, clause_reference,
            1 - (embedding <=> $1::vector) AS similarity
     FROM chunks
     WHERE contract_id = $2
     ORDER BY embedding <=> $1::vector
     LIMIT ${TOP_K}`,
    [toVectorLiteral(qVec), contractId]
  )
  return rows
}

function buildContext(chunks) {
  return chunks
    .map((c, i) => {
      const ref = c.clause_reference ? ` | ${c.clause_reference}` : ''
      return `[Fragmento ${i + 1} | Página ${c.page_number}${ref}]\n${c.content}`
    })
    .join('\n\n')
}

// Prepara todo lo necesario para una respuesta: conversación, historial,
// contexto recuperado y citas. Compartido por chat() y chatStream().
async function prepareChat(contractId, question, conversationId) {
  conversationId = await ensureConversation(contractId, conversationId)

  const { rows: history } = await pool.query(
    'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at',
    [conversationId]
  )

  const chunks = await retrieveChunks(contractId, question)
  const context = buildContext(chunks)

  const contents = history.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }))
  contents.push({
    role: 'user',
    parts: [{ text: `CONTEXTO recuperado del contrato:\n\n${context}\n\n---\nPregunta: ${question}` }]
  })

  const citations = chunks.map(c => ({
    page: c.page_number,
    clause: c.clause_reference,
    similarity: Number(c.similarity.toFixed(3))
  }))

  return { conversationId, contents, citations }
}

// Persiste el turno (la pregunta original, sin el contexto adjunto).
async function persistTurn(conversationId, question, answer, citations) {
  await pool.query(
    'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
    [conversationId, 'user', question]
  )
  await pool.query(
    'INSERT INTO messages (conversation_id, role, content, citations) VALUES ($1, $2, $3, $4)',
    [conversationId, 'assistant', answer, JSON.stringify(citations)]
  )
}

// Respuesta completa (no streaming).
async function chat(contractId, question, conversationId) {
  const { conversationId: cid, contents, citations } = await prepareChat(contractId, question, conversationId)

  const response = await withGeminiRetry(() => ai.models.generateContent({
    model: MODEL,
    contents,
    config: { systemInstruction: SYSTEM_INSTRUCTION }
  }))

  const answer = response.text
  await persistTurn(cid, question, answer, citations)
  return { conversationId: cid, answer, citations }
}

// Respuesta en streaming. Generador que emite eventos:
//   { type: 'meta', conversationId, citations }  — una vez, al principio
//   { type: 'delta', text }                      — por cada fragmento de texto
//   { type: 'done' }                             — al terminar (tras persistir)
async function* chatStream(contractId, question, conversationId) {
  const { conversationId: cid, contents, citations } = await prepareChat(contractId, question, conversationId)

  yield { type: 'meta', conversationId: cid, citations }

  // El 503/429 de Gemini se lanza al iniciar el stream (antes de emitir nada),
  // así que reintentar la apertura es seguro: ya hemos enviado 'meta' pero aún
  // ningún 'delta'.
  const stream = await withGeminiRetry(() => ai.models.generateContentStream({
    model: MODEL,
    contents,
    config: { systemInstruction: SYSTEM_INSTRUCTION }
  }))

  let answer = ''
  for await (const chunk of stream) {
    const text = chunk.text
    if (text) {
      answer += text
      yield { type: 'delta', text }
    }
  }

  await persistTurn(cid, question, answer, citations)
  yield { type: 'done' }
}

module.exports = { chat, chatStream }
