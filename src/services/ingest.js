// Pipeline de ingesta: texto del contrato → chunks → embeddings → tabla chunks.
const pool = require('../db')
const { chunkPages } = require('./chunking')
const { embedDocuments } = require('./embeddings')

// Gemini acepta varios textos por llamada; agrupamos para no saturar la API.
const BATCH_SIZE = 100

// pgvector espera el vector como literal '[v1,v2,...]'.
function toVectorLiteral(vector) {
  return `[${vector.join(',')}]`
}

async function ingestContract(contractId, pages) {
  const chunks = chunkPages(pages)
  if (chunks.length === 0) return { chunksCreated: 0 }

  // Generar embeddings por lotes.
  const embeddings = []
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    const vectors = await embedDocuments(batch.map(c => c.content))
    embeddings.push(...vectors)
  }

  // Inserción masiva en una sola query parametrizada.
  const values = []
  const params = []
  chunks.forEach((chunk, i) => {
    const base = i * 5
    values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::vector)`)
    params.push(
      contractId,
      chunk.content,
      chunk.page_number,
      chunk.clause_reference,
      toVectorLiteral(embeddings[i])
    )
  })

  await pool.query(
    `INSERT INTO chunks (contract_id, content, page_number, clause_reference, embedding)
     VALUES ${values.join(', ')}`,
    params
  )

  return { chunksCreated: chunks.length }
}

module.exports = { ingestContract }
