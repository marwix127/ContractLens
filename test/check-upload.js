require('dotenv').config()
const pool = require('../src/db')

pool.query(
  "SELECT filename, total_pages, length(raw_text) AS len, strpos(raw_text, 'CLAUSULA 3') > 0 AS tiene_pag2 FROM contracts"
).then(r => {
  console.log(r.rows)
  return pool.end()
})
