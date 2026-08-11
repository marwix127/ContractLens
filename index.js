const { config } = require('./src/config/env')

const express = require('express')
const cors = require('cors')
const contractsRouter = require('./src/routes/contracts')
const pool = require('./src/db')

const app = express()
const PORT = config.port

// En producción, el frontend (Vercel) está en otro origen: permitimos solo el
// configurado en FRONTEND_URL. En local, sin configurar, se permite cualquiera.
// Se normaliza quitando la barra final: el Origin del navegador nunca la lleva
// y CORS compara de forma exacta (una barra de más bloquea todas las llamadas).
const allowedOrigin = config.frontendUrl
app.use(cors({ origin: allowedOrigin || true }))
app.use(express.json())

app.get('/', (req, res) => {
  res.json({ message: 'ContractLens API', status: 'ok' })
})

// Readiness real: además de comprobar Express, verifica que PostgreSQL acepta
// conexiones. Resulta útil para Docker, CI y los smoke tests de Playwright.
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', database: 'ok' })
  } catch (err) {
    console.error('Health check de base de datos falló:', err.message)
    res.status(503).json({ status: 'error', database: 'unavailable' })
  }
})

app.use('/contracts', contractsRouter)

// Manejo centralizado de errores (multer, validación de archivos, etc.)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera el límite de 20 MB' })
  }
  if (err.message === 'Solo se aceptan archivos PDF') {
    return res.status(415).json({ error: err.message })
  }
  console.error(err)
  res.status(500).json({ error: 'Error interno del servidor' })
})

const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`)
})

let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} recibido; cerrando el servidor...`)

  server.close(async (err) => {
    try {
      await pool.end()
    } finally {
      if (err) console.error('Error cerrando el servidor:', err.message)
      process.exit(err ? 1 : 0)
    }
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
