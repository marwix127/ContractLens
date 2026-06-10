require('dotenv').config()
const pool = require('../src/db')

async function check() {
  const ext = await pool.query("SELECT extname, extversion FROM pg_extension WHERE extname = 'vector'")
  console.log('pgvector:', ext.rows.length ? `v${ext.rows[0].extversion}` : 'NO INSTALADO')

  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
  console.log('tablas:', tables.rows.map(r => r.table_name).join(', '))

  const idx = await pool.query("SELECT indexname FROM pg_indexes WHERE tablename = 'chunks'")
  console.log('indices chunks:', idx.rows.map(r => r.indexname).join(', '))

  const dim = await pool.query("SELECT atttypmod FROM pg_attribute WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'")
  console.log('dimension embedding:', dim.rows[0]?.atttypmod)

  await pool.end()
}

check().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
