const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const projectRoot = path.resolve(__dirname, '..', '..')

// En desarrollo preferimos .env.local. En producción, las variables inyectadas
// por la plataforma conservan prioridad porque dotenv no sobrescribe valores
// existentes.
const requestedFile = process.env.ENV_FILE
const candidates = requestedFile
  ? [path.resolve(process.cwd(), requestedFile)]
  : [
      path.join(projectRoot, '.env.local'),
      path.join(projectRoot, '.env')
    ]

const envFile = candidates.find(candidate => fs.existsSync(candidate))
// Si ENV_FILE se indicó expresamente, ese archivo es la fuente seleccionada y
// debe prevalecer incluso sobre variables heredadas por la terminal. Sin
// ENV_FILE (caso Koyeb), las variables inyectadas por la plataforma mantienen
// la prioridad habitual.
if (envFile) dotenv.config({ path: envFile, quiet: true, override: Boolean(requestedFile) })

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`[config] Falta la variable obligatoria ${name}`)
  return value
}

function parsePort(value) {
  const port = Number(value || 3000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('[config] PORT debe ser un entero entre 1 y 65535')
  }
  return port
}

function parseHttpUrl(name, value, { requiredInProduction = false } = {}) {
  const normalized = value?.trim().replace(/\/+$/, '') || ''
  if (!normalized) {
    if (requiredInProduction && process.env.NODE_ENV === 'production') {
      throw new Error(`[config] Falta la variable obligatoria ${name} en producción`)
    }
    return null
  }

  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new Error(`[config] ${name} debe ser una URL válida`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`[config] ${name} debe usar http:// o https://`)
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`[config] ${name} debe contener solo el origen, sin ruta, credenciales, query ni hash`)
  }
  return parsed.origin
}

let databaseUrl = required('DATABASE_URL')
let parsedDatabaseUrl
try {
  parsedDatabaseUrl = new URL(databaseUrl)
} catch {
  throw new Error('[config] DATABASE_URL debe ser una URL válida de PostgreSQL')
}
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error('[config] DATABASE_URL debe usar postgres:// o postgresql://')
}

// Neon entrega actualmente `sslmode=require`. node-postgres lo interpreta como
// verificación completa, pero avisa de que su semántica cambiará en la próxima
// versión mayor. Hacemos explícita la garantía esperada y conservamos el resto
// de parámetros de la URL proporcionada por Neon.
if (parsedDatabaseUrl.hostname.endsWith('.neon.tech') && parsedDatabaseUrl.searchParams.get('sslmode') === 'require') {
  parsedDatabaseUrl.searchParams.set('sslmode', 'verify-full')
  databaseUrl = parsedDatabaseUrl.toString()
}

const config = Object.freeze({
  databaseUrl,
  env: process.env.NODE_ENV || 'development',
  frontendUrl: parseHttpUrl('FRONTEND_URL', process.env.FRONTEND_URL, { requiredInProduction: true }),
  port: parsePort(process.env.PORT)
})

module.exports = { config, envFile }
