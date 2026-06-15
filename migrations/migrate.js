require('dotenv').config()
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
    console.error('Error aplicando migración:', err.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

migrate()
