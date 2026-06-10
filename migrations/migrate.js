require('dotenv').config()
const fs = require('fs')
const path = require('path')
const pool = require('../src/db')

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
  try {
    await pool.query(sql)
    console.log('Schema aplicado correctamente')
  } catch (err) {
    console.error('Error aplicando schema:', err.message)
  } finally {
    await pool.end()
  }
}

migrate()
