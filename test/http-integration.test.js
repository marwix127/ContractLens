const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const { createApp } = require('../src/app')
const { createContractsRouter } = require('../src/routes/contracts')
const { createRateLimiters } = require('../src/http/rate-limit')

const FRONTEND_ORIGIN = 'https://portfolio.example'
const CONTRACT_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'

test('el composition root de producción se construye sin abrir un puerto', () => {
  const projectRoot = path.resolve(__dirname, '..')
  const script = `
    const { buildProductionApp } = require('./index')
    const { app, pool } = buildProductionApp()
    if (typeof app.listen !== 'function') process.exit(2)
    pool.end().then(() => process.exit(0), () => process.exit(3))
  `

  execFileSync(process.execPath, ['-e', script], {
    cwd: projectRoot,
    env: {
      ...process.env,
      DATABASE_URL: 'postgresql://contractlens:contractlens@127.0.0.1:1/contractlens',
      ENV_FILE: 'test/.env-ci-does-not-exist',
      FRONTEND_URL: FRONTEND_ORIGIN,
      NODE_ENV: 'test',
      RENDER: 'false'
    },
    stdio: 'pipe',
    timeout: 10_000
  })
})

class FakePdfParser {
  constructor({ data }) {
    this.data = data
  }

  async getText() {
    return {
      pages: [{ num: 1, text: 'Cláusula 1. Contrato de prueba.' }],
      text: 'Cláusula 1. Contrato de prueba.',
      total: 1
    }
  }

  async destroy() {}
}

class ConversationNotFoundError extends Error {}

function createFixture({
  healthCacheMs = 10_000,
  isRender = false,
  poolQuery,
  rateLimits = {},
  serviceOverrides = {}
} = {}) {
  const calls = { pool: [] }
  const pool = {
    query: async (sql, params) => {
      calls.pool.push({ sql, params })
      if (poolQuery) return poolQuery(sql, params, calls)
      if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] }
      throw new Error(`Consulta no simulada: ${sql}`)
    }
  }
  const config = {
    exposeAllContracts: false,
    frontendUrl: FRONTEND_ORIGIN,
    isRender,
    limits: {
      maxPdfPages: 100,
      maxPdfTextChars: 300_000,
      maxQuestionChars: 2_000,
      maxUploadMb: 1
    }
  }
  const limiters = createRateLimiters({
    aiConcurrency: 3,
    aiConcurrencyPerIp: 1,
    aiGlobalPerDay: 100,
    aiGlobalPerMinute: 10,
    aiPerHour: 15,
    contractsPer15Minutes: 120,
    trustCloudflare: isRender,
    uploadsPerHour: 3,
    ...rateLimits
  })

  const services = {
    analysisService: {
      DISCLAIMER: 'Aviso legal de prueba',
      analyzeContract: async () => { throw new Error('Gemini analysis no debe ejecutarse') }
    },
    chatService: {
      ConversationNotFoundError,
      chat: async () => { throw new Error('Gemini chat no debe ejecutarse') },
      chatStream: async function * () { throw new Error('Gemini stream no debe ejecutarse') }
    },
    compareService: {
      compareContracts: async () => { throw new Error('Gemini compare no debe ejecutarse') }
    },
    ingestService: {
      ingestContract: async () => { throw new Error('Gemini embeddings no debe ejecutarse') }
    },
    reportService: {
      buildAnalysisPdf: async () => { throw new Error('PDF report no debe ejecutarse') }
    },
    ...serviceOverrides
  }
  const logger = { error() {} }
  const router = createContractsRouter({
    ...services,
    appConfig: config,
    limiters,
    logger,
    PdfParser: FakePdfParser,
    pool
  })
  const app = createApp({
    appConfig: config,
    contractsLimiter: limiters.contractsLimiter,
    contractsRouter: router,
    healthCacheMs,
    logger,
    pool
  })

  return { app, calls, config, pool }
}

async function withServer(fixture, run) {
  const server = await new Promise((resolve) => {
    const instance = fixture.app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const { port } = server.address()

  try {
    await run(`http://127.0.0.1:${port}`, fixture)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('expone estado y cabeceras seguras con CORS exacto', async () => {
  await withServer(createFixture(), async (baseUrl) => {
    const allowed = await fetch(baseUrl, { headers: { Origin: FRONTEND_ORIGIN } })
    assert.equal(allowed.status, 200)
    assert.deepEqual(await allowed.json(), { message: 'ContractLens API', status: 'ok' })
    assert.equal(allowed.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN)
    assert.match(allowed.headers.get('vary') || '', /Origin/)
    assert.equal(allowed.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(allowed.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(allowed.headers.get('x-powered-by'), null)

    const denied = await fetch(baseUrl, { headers: { Origin: 'https://evil.example' } })
    assert.equal(denied.status, 200)
    assert.equal(denied.headers.get('access-control-allow-origin'), null)

    const preflight = await fetch(`${baseUrl}/contracts`, {
      method: 'OPTIONS',
      headers: {
        Origin: FRONTEND_ORIGIN,
        'Access-Control-Request-Headers': 'content-type',
        'Access-Control-Request-Method': 'POST'
      }
    })
    assert.equal(preflight.status, 204)
    assert.equal(preflight.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN)
    assert.match(preflight.headers.get('access-control-allow-methods') || '', /POST/)
  })
})

test('health devuelve 200/503 y comparte caché e in-flight', async () => {
  let checks = 0
  let release
  const firstCheck = new Promise(resolve => { release = resolve })
  const fixture = createFixture({
    poolQuery: async (sql) => {
      if (sql !== 'SELECT 1') throw new Error(`Consulta inesperada: ${sql}`)
      checks += 1
      await firstCheck
      return { rows: [{}] }
    }
  })

  await withServer(fixture, async (baseUrl) => {
    const first = fetch(`${baseUrl}/health`)
    const second = fetch(`${baseUrl}/health`)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(checks, 1)
    release()
    assert.equal((await first).status, 200)
    assert.equal((await second).status, 200)
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200)
    assert.equal(checks, 1)
  })

  await withServer(createFixture({
    poolQuery: async () => { throw new Error('database offline') }
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { status: 'error', database: 'unavailable' })
  })
})

test('rechaza JSON malformado o superior a 16 KiB antes de la base de datos', async () => {
  await withServer(createFixture(), async (baseUrl, { calls }) => {
    const endpoint = `${baseUrl}/contracts/${CONTRACT_ID}/chat`
    const malformed = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: FRONTEND_ORIGIN },
      body: '{'
    })
    assert.equal(malformed.status, 400)
    assert.equal((await malformed.json()).error, 'El cuerpo JSON no es válido')

    const oversized = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: FRONTEND_ORIGIN },
      body: JSON.stringify({ question: 'x'.repeat(17_000) })
    })
    assert.equal(oversized.status, 413)
    assert.equal(oversized.headers.get('cache-control'), 'private, no-store')
    assert.equal(oversized.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN)
    assert.equal(calls.pool.length, 0)
  })
})

test('valida UUID, preguntas y conversaciones antes de ejecutar IA', async () => {
  await withServer(createFixture({
    poolQuery: async (sql) => {
      if (sql.includes('SELECT 1 FROM contracts')) return { rows: [{}] }
      if (sql.includes('SELECT 1 FROM conversations')) return { rows: [] }
      throw new Error(`Consulta inesperada: ${sql}`)
    }
  }), async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/contracts/no-es-uuid`)).status, 404)

    const empty = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '   ' })
    })
    assert.equal(empty.status, 400)

    const long = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'x'.repeat(2_001) })
    })
    assert.equal(long.status, 400)

    const wrongConversation = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '¿Qué plazo tiene?', conversationId: CONVERSATION_ID })
    })
    assert.equal(wrongConversation.status, 404)
    assert.match((await wrongConversation.json()).error, /no pertenece/)
  })
})

test('el listado es privado por defecto y el análisis cacheado no llama a Gemini', async () => {
  let analysisCalls = 0
  const cachedAnalysis = {
    id: '33333333-3333-4333-8333-333333333333',
    summary: 'Resumen guardado',
    extracted_data: { duration: '12 meses' },
    risks: [],
    created_at: new Date().toISOString()
  }
  const fixture = createFixture({
    poolQuery: async (sql) => {
      if (sql.includes('FROM contracts') && sql.includes('ORDER BY uploaded_at')) {
        assert.match(sql, /WHERE is_sample = true/)
        return { rows: [{ id: CONTRACT_ID, filename: 'muestra.pdf', total_pages: 1 }] }
      }
      if (sql.includes('FROM analyses')) return { rows: [cachedAnalysis] }
      throw new Error(`Consulta inesperada: ${sql}`)
    },
    serviceOverrides: {
      analysisService: {
        DISCLAIMER: 'Aviso legal de prueba',
        analyzeContract: async () => { analysisCalls += 1 }
      }
    }
  })

  await withServer(fixture, async (baseUrl) => {
    const list = await fetch(`${baseUrl}/contracts`)
    assert.equal(list.status, 200)
    assert.equal((await list.json()).contracts.length, 1)

    const analysis = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/analyze`, { method: 'POST' })
    assert.equal(analysis.status, 200)
    assert.equal((await analysis.json()).cached, true)
    assert.equal(analysisCalls, 0)
  })
})

test('genera y persiste un análisis nuevo con el servicio inyectado', async () => {
  let analysisCalls = 0
  const fixture = createFixture({
    poolQuery: async (sql, params) => {
      if (sql.includes('FROM analyses')) return { rows: [] }
      if (sql.includes('SELECT raw_text FROM contracts')) return { rows: [{ raw_text: 'Texto del contrato' }] }
      if (sql.includes('INSERT INTO analyses')) {
        assert.equal(params[0], CONTRACT_ID)
        return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] }
      }
      throw new Error(`Consulta inesperada: ${sql}`)
    },
    serviceOverrides: {
      analysisService: {
        DISCLAIMER: 'Aviso legal de prueba',
        analyzeContract: async (text) => {
          analysisCalls += 1
          assert.equal(text, 'Texto del contrato')
          return {
            summary: 'Resumen nuevo',
            extracted_data: { duration: '12 meses' },
            risks: [],
            disclaimer: 'Aviso legal de prueba'
          }
        }
      }
    }
  })

  await withServer(fixture, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/analyze`, { method: 'POST' })
    assert.equal(response.status, 201)
    assert.equal((await response.json()).summary, 'Resumen nuevo')
    assert.equal(analysisCalls, 1)
  })
})

test('sirve un PDF Unicode con headers seguros', async () => {
  await withServer(createFixture({
    poolQuery: async (sql) => {
      if (sql.includes('SELECT pdf_data')) {
        return { rows: [{ pdf_data: Buffer.from('%PDF-test'), filename: 'Distribución — v1.pdf' }] }
      }
      throw new Error(`Consulta inesperada: ${sql}`)
    }
  }), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/file`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /application\/pdf/)
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin')
    assert.match(response.headers.get('content-disposition') || '', /filename\*=UTF-8''/)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  })
})

test('Multer rechaza subidas ausentes, no PDF y superiores al límite', async () => {
  await withServer(createFixture({ rateLimits: { uploadsPerHour: 20, aiPerHour: 20 } }), async (baseUrl, { calls }) => {
    const missing = await fetch(`${baseUrl}/contracts`, { method: 'POST' })
    assert.equal(missing.status, 400)

    const wrongType = new FormData()
    wrongType.append('file', new Blob(['texto'], { type: 'text/plain' }), 'contrato.txt')
    const unsupported = await fetch(`${baseUrl}/contracts`, { method: 'POST', body: wrongType })
    assert.equal(unsupported.status, 415)

    const oversized = new FormData()
    oversized.append('file', new Blob([Buffer.alloc(1024 * 1024 + 1)], { type: 'application/pdf' }), 'grande.pdf')
    const tooLarge = await fetch(`${baseUrl}/contracts`, { method: 'POST', body: oversized })
    assert.equal(tooLarge.status, 413)

    const unexpectedField = new FormData()
    unexpectedField.append('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'contrato.pdf')
    unexpectedField.append('title', 'campo no permitido')
    assert.equal((await fetch(`${baseUrl}/contracts`, { method: 'POST', body: unexpectedField })).status, 400)

    const twoFiles = new FormData()
    twoFiles.append('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'uno.pdf')
    twoFiles.append('file', new Blob(['%PDF'], { type: 'application/pdf' }), 'dos.pdf')
    assert.equal((await fetch(`${baseUrl}/contracts`, { method: 'POST', body: twoFiles })).status, 400)
    assert.equal(calls.pool.length, 0)
  })
})

test('sube un PDF válido sin red y elimina el contrato si falla la ingesta', async () => {
  let ingestCalls = 0
  const deleted = []
  const fixture = createFixture({
    poolQuery: async (sql, params) => {
      if (sql.includes('INSERT INTO contracts')) {
        return { rows: [{ id: CONTRACT_ID, filename: 'contrato.pdf', total_pages: 1, uploaded_at: new Date() }] }
      }
      if (sql.includes('DELETE FROM contracts')) {
        deleted.push(params[0])
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`Consulta inesperada: ${sql}`)
    },
    rateLimits: { uploadsPerHour: 20, aiPerHour: 20 },
    serviceOverrides: {
      ingestService: {
        ingestContract: async () => {
          ingestCalls += 1
          if (ingestCalls === 2) throw new Error('embedding offline')
          return { chunksCreated: 2 }
        }
      }
    }
  })

  await withServer(fixture, async (baseUrl) => {
    const upload = () => {
      const form = new FormData()
      form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'contrato.pdf')
      return fetch(`${baseUrl}/contracts`, { method: 'POST', body: form })
    }

    const created = await upload()
    assert.equal(created.status, 201)
    assert.equal((await created.json()).chunksCreated, 2)

    const failed = await upload()
    assert.equal(failed.status, 502)
    assert.deepEqual(deleted, [CONTRACT_ID])
  })
})

test('emite chat SSE con meta, delta y done', async () => {
  const fixture = createFixture({
    poolQuery: async (sql) => {
      if (sql.includes('SELECT 1 FROM contracts')) return { rows: [{}] }
      throw new Error(`Consulta inesperada: ${sql}`)
    },
    serviceOverrides: {
      chatService: {
        ConversationNotFoundError,
        chat: async () => { throw new Error('chat normal no esperado') },
        chatStream: async function * () {
          yield { type: 'meta', conversationId: CONVERSATION_ID, citations: [{ page: 1 }] }
          yield { type: 'delta', text: 'Respuesta' }
          yield { type: 'done' }
        }
      }
    }
  })

  await withServer(fixture, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '¿Qué dice?' })
    })
    const body = await response.text()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') || '', /text\/event-stream/)
    assert.equal(response.headers.get('cache-control'), 'private, no-store, no-cache, no-transform')
    assert.match(body, /event: meta/)
    assert.match(body, /event: delta/)
    assert.match(body, /event: done/)
    assert.match(body, /Aviso legal de prueba/)
  })
})

test('responde al chat JSON y compara contratos con servicios simulados', async () => {
  const secondContractId = '44444444-4444-4444-8444-444444444444'
  const fixture = createFixture({
    poolQuery: async (sql) => {
      if (sql.includes('SELECT 1 FROM contracts')) return { rows: [{}] }
      if (sql.includes('FROM contracts') && sql.includes('ANY')) {
        return {
          rows: [
            { id: CONTRACT_ID, filename: 'v1.pdf', raw_text: 'Versión uno' },
            { id: secondContractId, filename: 'v2.pdf', raw_text: 'Versión dos' }
          ]
        }
      }
      throw new Error(`Consulta inesperada: ${sql}`)
    },
    rateLimits: { aiConcurrencyPerIp: 2 },
    serviceOverrides: {
      chatService: {
        ConversationNotFoundError,
        chat: async (contractId, question) => ({
          answer: `Respuesta a ${question}`,
          citations: [{ page: 1 }],
          conversationId: CONVERSATION_ID
        }),
        chatStream: async function * () {}
      },
      compareService: {
        compareContracts: async (before, after) => ({
          changes: [{ category: 'duración', type: 'modificado', impact: 'medio' }],
          risk_assessment: `${before} -> ${after}`,
          summary: 'Cambios encontrados'
        })
      }
    }
  })

  await withServer(fixture, async (baseUrl) => {
    const chat = await fetch(`${baseUrl}/contracts/${CONTRACT_ID}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '¿Cuál es la duración?' })
    })
    assert.equal(chat.status, 200)
    assert.match((await chat.json()).answer, /duración/)

    const comparison = await fetch(`${baseUrl}/contracts/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromId: CONTRACT_ID, toId: secondContractId })
    })
    assert.equal(comparison.status, 200)
    const result = await comparison.json()
    assert.equal(result.summary, 'Cambios encontrados')
    assert.equal(result.changes.length, 1)
    assert.equal(result.disclaimer, 'Aviso legal de prueba')
  })
})

test('el wiring real devuelve 429 antes de Multer y no confía en X-Forwarded-For', async () => {
  const fixture = createFixture({
    rateLimits: { contractsPer15Minutes: 20, uploadsPerHour: 1, aiPerHour: 20 }
  })

  await withServer(fixture, async (baseUrl) => {
    const request = (xff) => fetch(`${baseUrl}/contracts`, {
      method: 'POST',
      headers: { Origin: FRONTEND_ORIGIN, 'X-Forwarded-For': xff }
    })
    assert.equal((await request('198.51.100.1')).status, 400)
    const blocked = await request('203.0.113.2')
    assert.equal(blocked.status, 429)
    assert.ok(blocked.headers.get('retry-after'))
    assert.match(blocked.headers.get('ratelimit-policy') || '', /uploads-per-ip/)
    assert.equal(blocked.headers.get('cache-control'), 'private, no-store')
    assert.equal(blocked.headers.get('access-control-allow-origin'), FRONTEND_ORIGIN)
  })
})

test('cada app aísla sus contadores y el modo Render usa CF-Connecting-IP', async () => {
  const options = {
    isRender: true,
    rateLimits: { contractsPer15Minutes: 1, uploadsPerHour: 20 }
  }

  await withServer(createFixture(options), async (baseUrl) => {
    const request = (cfIp, xff) => fetch(`${baseUrl}/contracts/no-es-uuid`, {
      headers: { 'CF-Connecting-IP': cfIp, 'X-Forwarded-For': xff }
    })
    assert.equal((await request('198.51.100.1', '203.0.113.1')).status, 404)
    assert.equal((await request('198.51.100.1', '203.0.113.2')).status, 429)
    assert.equal((await request('198.51.100.2', '203.0.113.2')).status, 404)
  })

  // Una app nueva crea stores nuevos: el primer request de la misma IP vuelve
  // a entrar aunque el fixture anterior agotase su bucket.
  await withServer(createFixture(options), async (baseUrl) => {
    const response = await fetch(`${baseUrl}/contracts/no-es-uuid`, {
      headers: { 'CF-Connecting-IP': '198.51.100.1' }
    })
    assert.equal(response.status, 404)
  })
})
