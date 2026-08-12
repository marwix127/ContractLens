const express = require('express')
const cors = require('cors')

const HEALTH_CACHE_MS = 10_000

function createApp({
  appConfig,
  contractsLimiter,
  contractsRouter,
  healthCacheMs = HEALTH_CACHE_MS,
  logger = console,
  pool
} = {}) {
  if (!appConfig || !contractsLimiter || !contractsRouter || !pool) {
    throw new TypeError('createApp requiere appConfig, pool, contractsLimiter y contractsRouter')
  }

  const app = express()
  app.set('trust proxy', appConfig.isRender ? 1 : false)
  app.disable('x-powered-by')

  const allowedOrigin = appConfig.frontendUrl
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

  // Readiness con una caché breve para que un sondeo agresivo no se convierta
  // en un bypass contra Neon. Cada instancia de app conserva su propio estado.
  let databaseHealth = { expiresAt: 0, ok: false }
  let databaseHealthInFlight = null

  async function databaseIsReady() {
    if (Date.now() < databaseHealth.expiresAt) return databaseHealth.ok
    if (databaseHealthInFlight) return databaseHealthInFlight

    databaseHealthInFlight = pool.query('SELECT 1')
      .then(() => true)
      .catch((err) => {
        logger.error('Health check de base de datos falló:', err.message)
        return false
      })
      .then((ok) => {
        databaseHealth = { expiresAt: Date.now() + healthCacheMs, ok }
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

  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `El archivo supera el límite de ${appConfig.limits.maxUploadMb} MB` })
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
    logger.error(err)
    res.status(500).json({ error: 'Error interno del servidor' })
  })

  return app
}

module.exports = { createApp }
