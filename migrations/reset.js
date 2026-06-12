// Vacía los datos de todas las tablas (mantiene el schema).
// Borrar contracts arrastra chunks, analyses, conversations y messages
// gracias a ON DELETE CASCADE.
require('dotenv').config()
const pool = require('../src/db')

async function reset() {
  try {
    const { rowCount } = await pool.query('DELETE FROM contracts')
    console.log(`Borrados ${rowCount} contratos (y sus chunks/análisis/chats en cascada)`)
  } catch (err) {
    console.error('Error vaciando la BD:', err.message)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

reset()
