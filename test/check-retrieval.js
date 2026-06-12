// Verifica que los chunks se guardaron con embeddings y que la búsqueda
// vectorial por coseno devuelve el chunk relevante a una pregunta.
require('dotenv').config()
const pool = require('../src/db')
const { embedQuery } = require('../src/services/embeddings')

async function main() {
  const contractId = process.argv[2]

  const { rows: stored } = await pool.query(
    `SELECT page_number, clause_reference, embedding IS NOT NULL AS tiene_emb,
            vector_dims(embedding) AS dims
     FROM chunks WHERE contract_id = $1 ORDER BY page_number`,
    [contractId]
  )
  console.log('chunks guardados:', stored.length)
  stored.forEach(r => console.log(`  [pag ${r.page_number}] emb=${r.tiene_emb} dims=${r.dims} ref="${(r.clause_reference || 'preambulo').slice(0, 50)}"`))

  // Búsqueda semántica: pregunta → embedding → top 3 chunks por coseno.
  const pregunta = '¿Dónde se resuelven los conflictos legales?'
  const qVec = await embedQuery(pregunta)
  const { rows: hits } = await pool.query(
    `SELECT clause_reference, page_number,
            1 - (embedding <=> $1::vector) AS similitud
     FROM chunks WHERE contract_id = $2
     ORDER BY embedding <=> $1::vector LIMIT 3`,
    [`[${qVec.join(',')}]`, contractId]
  )
  console.log(`\nPregunta: "${pregunta}"`)
  console.log('Top 3 chunks por similitud:')
  hits.forEach((h, i) => console.log(`  ${i + 1}. (${h.similitud.toFixed(3)}) [pag ${h.page_number}] ${(h.clause_reference || 'preambulo').slice(0, 60)}`))

  await pool.end()
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
