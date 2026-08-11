const { config } = require('./src/config/env')

const express = require('express')
const cors = require('cors')
const contractsRouter = require('./src/routes/contracts')
const pool = require('./src/db')
const { contractsLimiter } = require('./src/http/limiters')

const app = express()
const PORT = config.port

// Render coloca un proxy inmediato delante del proceso. Nunca usamos `true`,
// porque confiar en una cadena arbitraria permitiría falsear la IP. El
// limitador obtiene el cliente desde CF-Connecting-IP y no depende de este
// ajuste, que queda para la semántica general de Express.
app.set('trust proxy', config.isRender ? 1 : false)
app.disable('x-powered-by')

// En producción, el frontend (Vercel) está en otro origen: permitimos solo el
// configurado en FRONTEND_URL. En local, sin configurar, se permite cualquiera.
// Se normaliza quitando la barra final: el Origin del navegador nunca la lleva
// y CORS compara de forma exacta (una barra de más bloquea todas las llamadas).
const allowedOrigin = config.frontendUrl
app.use(cors({
  allowedHeaders: ['Content-Type'],
  exposedHeaders: ['RateLimit', 'RateLimit-Policy', 'Retry-After'],
  methods: ['GET', 'POST', 'OPTIONS'],
  origin: (origin, callback) => {
    if (!allowedOrigin || !origin || origin === allowedOrigin) return callback(null, true)
    callback(null, false)
  }
}))
app.use((req, res, next) => {
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  next()
})

app.get('/', (req, res) => {
  res.json({ message: 'ContractLens API', status: 'ok' })
})

// Readiness real: además de comprobar Express, verifica que PostgreSQL acepta
// conexiones. El resultado se comparte durante diez segundos para que un
// sondeo agresivo no se convierta en un bypass contra Neon.
const HEALTH_CACHE_MS = 10_000
let databaseHealth = { expiresAt: 0, ok: false }
let databaseHealthInFlight = null

async function databaseIsReady() {
  if (Date.now() < databaseHealth.expiresAt) return databaseHealth.ok
  if (databaseHealthInFlight) return databaseHealthInFlight

  databaseHealthInFlight = pool.query('SELECT 1')
    .then(() => true)
    .catch((err) => {
      console.error('Health check de base de datos falló:', err.message)
      return false
    })
    .then((ok) => {
      databaseHealth = { expiresAt: Date.now() + HEALTH_CACHE_MS, ok }
      return ok
    })
    .finally(() => {
      databaseHealthInFlight = null
    })

  return databaseHealthInFlight
}

app.get('/health', async (req, res) => {
  const ready = await databaseIsReady()
  if (ready) return res.json({ status: 'ok', database: 'ok' })
  res.status(503).json({ status: 'error', database: 'unavailable' })
})

// Health queda fuera de los límites. En la API, el limitador se ejecuta antes
// de parsear JSON para rechazar abuso sin dedicar memoria al cuerpo.
app.use(
  '/contracts',
  (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store')
    next()
  },
  contractsLimiter,
  express.json({ limit: '16kb' }),
  contractsRouter
)

// Manejo centralizado de errores (multer, validación de archivos, etc.)
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `El archivo supera el límite de ${config.limits.maxUploadMb} MB` })
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'El cuerpo JSON supera el límite permitido' })
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo JSON no es válido' })
  }
  if (typeof err.code === 'string' && err.code.startsWith('LIMIT_')) {
    return res.status(400).json({ error: 'La subida debe contener un único PDF en el campo "file"' })
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
