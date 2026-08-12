const { createApp } = require('./src/app')

function buildProductionApp() {
  const { config } = require('./src/config/env')
  const pool = require('./src/db')
  const limiters = require('./src/http/limiters')
  const { createContractsRouter } = require('./src/routes/contracts')

  const contractsRouter = createContractsRouter({
    analysisService: require('./src/services/analysis'),
    appConfig: config,
    chatService: require('./src/services/chat'),
    compareService: require('./src/services/compare'),
    ingestService: require('./src/services/ingest'),
    limiters,
    PdfParser: require('pdf-parse').PDFParse,
    pool,
    reportService: require('./src/services/report')
  })
  const app = createApp({
    appConfig: config,
    contractsLimiter: limiters.contractsLimiter,
    contractsRouter,
    pool
  })

  return { app, config, pool }
}

function startServer() {
  const { app, config, pool } = buildProductionApp()
  const server = app.listen(config.port, () => {
    console.log(`Servidor corriendo en http://localhost:${config.port}`)
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

  return { app, server, shutdown }
}

if (require.main === module) startServer()

module.exports = { buildProductionApp, startServer }
