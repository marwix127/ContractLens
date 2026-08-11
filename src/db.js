const { Pool } = require('pg')
const { config } = require('./config/env')

const pool = new Pool({
  // Neon entrega la configuración TLS dentro de la propia URL. La capa de
  // configuración normaliza `sslmode=require` a `verify-full`; la URL local no
  // incluye SSL y mantiene la conexión directa al contenedor de desarrollo.
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 10_000,
  enableChannelBinding: true,
  idleTimeoutMillis: 30_000,
  max: 5
})

pool.on('error', (err) => {
  console.error('Error inesperado en una conexión inactiva de PostgreSQL:', err.message)
})

module.exports = pool
