// Verifica que el análisis se guardó como JSONB consultable en la BD.
require('dotenv').config()
const pool = require('../src/db')

async function main() {
  const { rows } = await pool.query(
    `SELECT
       length(summary) AS resumen_chars,
       jsonb_array_length(risks) AS num_riesgos,
       jsonb_array_length(extracted_data->'parties') AS num_partes,
       extracted_data->>'jurisdiction' AS jurisdiccion,
       (SELECT count(*) FROM jsonb_array_elements(risks) r
        WHERE r->>'severity' = 'alta') AS riesgos_altos
     FROM analyses
     ORDER BY created_at DESC LIMIT 1`
  )
  console.log(rows[0])
  await pool.end()
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
