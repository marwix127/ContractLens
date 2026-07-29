require('../src/config/env')
const fs = require('fs')
const path = require('path')
const pool = require('../src/db')

async function migrate() {
  const file = process.argv[2] || 'schema.sql'
  const sql = fs.readFileSync(path.join(__dirname, file), 'utf8')
  try {
    await pool.query(sql)
    console.log(`Migración aplicada correctamente: ${file}`)
  } catch (err) {
    const detail = err.errors?.map(item => item.message).filter(Boolean).join('; ') || err.message
    console.error('Error aplicando migración:', detail || 'no se pudo conectar con PostgreSQL')
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

migrate()
