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
// ENV_FILE (caso Render), las variables inyectadas por la plataforma mantienen
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

function parsePositiveInteger(name, value, fallback, { max = 1_000_000 } = {}) {
  const normalized = value?.trim()
  if (!normalized) return fallback
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`[config] ${name} debe ser un entero positivo`)
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`[config] ${name} debe estar entre 1 y ${max}`)
  }
  return parsed
}

function parseBoolean(name, value, fallback = false) {
  const normalized = value?.trim().toLowerCase()
  if (!normalized) return fallback
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new Error(`[config] ${name} debe ser true o false`)
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
  exposeAllContracts: parseBoolean('EXPOSE_ALL_CONTRACTS', process.env.EXPOSE_ALL_CONTRACTS),
  frontendUrl: parseHttpUrl('FRONTEND_URL', process.env.FRONTEND_URL, { requiredInProduction: true }),
  isRender: process.env.RENDER === 'true',
  limits: Object.freeze({
    maxPdfPages: parsePositiveInteger('MAX_PDF_PAGES', process.env.MAX_PDF_PAGES, 100, { max: 1_000 }),
    maxPdfTextChars: parsePositiveInteger('MAX_PDF_TEXT_CHARS', process.env.MAX_PDF_TEXT_CHARS, 300_000),
    maxQuestionChars: parsePositiveInteger('MAX_QUESTION_CHARS', process.env.MAX_QUESTION_CHARS, 2_000, { max: 20_000 }),
    maxUploadMb: parsePositiveInteger('MAX_UPLOAD_MB', process.env.MAX_UPLOAD_MB, 5, { max: 20 })
  }),
  rateLimits: Object.freeze({
    aiConcurrency: parsePositiveInteger('MAX_AI_CONCURRENCY', process.env.MAX_AI_CONCURRENCY, 3, { max: 20 }),
    aiConcurrencyPerIp: parsePositiveInteger('MAX_AI_CONCURRENCY_PER_IP', process.env.MAX_AI_CONCURRENCY_PER_IP, 1, { max: 10 }),
    aiGlobalPerDay: parsePositiveInteger('RATE_LIMIT_AI_GLOBAL_PER_DAY', process.env.RATE_LIMIT_AI_GLOBAL_PER_DAY, 100),
    aiGlobalPerMinute: parsePositiveInteger('RATE_LIMIT_AI_GLOBAL_PER_MINUTE', process.env.RATE_LIMIT_AI_GLOBAL_PER_MINUTE, 10),
    aiPerHour: parsePositiveInteger('RATE_LIMIT_AI_PER_HOUR', process.env.RATE_LIMIT_AI_PER_HOUR, 15),
    contractsPer15Minutes: parsePositiveInteger('RATE_LIMIT_CONTRACTS_PER_15_MIN', process.env.RATE_LIMIT_CONTRACTS_PER_15_MIN, 120),
    uploadsPerHour: parsePositiveInteger('RATE_LIMIT_UPLOADS_PER_HOUR', process.env.RATE_LIMIT_UPLOADS_PER_HOUR, 3)
  }),
  port: parsePort(process.env.PORT)
})

module.exports = { config, envFile }
