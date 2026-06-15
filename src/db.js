const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway no exige SSL (ni en la red interna ni en el proxy público). Se deja
  // como opt-in vía DATABASE_SSL por si se usa un Postgres que sí lo requiera.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
})

module.exports = pool
