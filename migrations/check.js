require('../src/config/env')
const pool = require('../src/db')

async function check() {
  const ext = await pool.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'")
  if (!ext.rows.length) throw new Error('La extensión pgvector no está instalada')
  console.log('pgvector:', `v${ext.rows[0].extversion}`)

  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
  const tableNames = tables.rows.map(r => r.table_name)
  const expectedTables = ['analyses', 'chunks', 'contracts', 'conversations', 'messages']
  const missingTables = expectedTables.filter(name => !tableNames.includes(name))
  if (missingTables.length) throw new Error(`Faltan tablas: ${missingTables.join(', ')}`)
  console.log('tablas:', tableNames.join(', '))

  const idx = await pool.query("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'chunks'")
  const indexNames = idx.rows.map(r => r.indexname)
  const embeddingIndex = idx.rows.find(r => r.indexname === 'chunks_embedding_idx')
  if (!embeddingIndex) throw new Error('Falta el índice chunks_embedding_idx')
  if (!/\bUSING hnsw\b/i.test(embeddingIndex.indexdef)) {
    throw new Error('chunks_embedding_idx no utiliza HNSW; ejecuta npm run migrate:hnsw')
  }
  console.log('indices chunks:', indexNames.join(', '))
  console.log('indice vectorial: HNSW')

  const dim = await pool.query("SELECT atttypmod FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'")
  console.log('dimension embedding:', dim.rows[0]?.atttypmod)
}

check()
  .catch(e => {
    const detail = e.errors?.map(item => item.message).filter(Boolean).join('; ') || e.message
    console.error('ERROR:', detail || 'no se pudo conectar con PostgreSQL')
    process.exitCode = 1
  })
  .finally(() => pool.end())
