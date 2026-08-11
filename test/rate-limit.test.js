const test = require('node:test')
const assert = require('node:assert/strict')
const express = require('express')
const { createRateLimiters } = require('../src/http/rate-limit')

async function startServer(app) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const { port } = server.address()
  return { baseUrl: `http://127.0.0.1:${port}`, server }
}

async function withServer(options, run) {
  const app = express()
  const limiters = createRateLimiters(options)

  app.get('/health', (req, res) => res.json({ status: 'ok' }))
  app.get('/contracts', limiters.contractsLimiter, (req, res) => res.json({ ok: true }))
  app.post(
    '/upload',
    ...limiters.uploadAdmissionLimiters,
    limiters.aiConcurrencyLimiter,
    ...limiters.aiCostLimiters,
    (req, res) => res.json({ ok: true })
  )
  app.post(
    '/analyze',
    ...limiters.aiAdmissionLimiters,
    limiters.aiConcurrencyLimiter,
    ...limiters.aiCostLimiters,
    (req, res) => res.json({ ok: true })
  )
  app.post(
    '/chat',
    ...limiters.aiAdmissionLimiters,
    limiters.aiConcurrencyLimiter,
    ...limiters.aiCostLimiters,
    (req, res) => res.json({ ok: true })
  )
  app.post('/cached', ...limiters.aiAdmissionLimiters, (req, res) => res.json({ cached: true }))

  const { baseUrl, server } = await startServer(app)

  try {
    await run(baseUrl)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

test('devuelve 429 y cabeceras estándar sin limitar health', async () => {
  await withServer({ contractsPer15Minutes: 2 }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/contracts`)).status, 200)
    assert.equal((await fetch(`${baseUrl}/contracts`)).status, 200)

    const blocked = await fetch(`${baseUrl}/contracts`)
    assert.equal(blocked.status, 429)
    assert.match(blocked.headers.get('ratelimit') || '', /r=0/)
    assert.match(blocked.headers.get('ratelimit-policy') || '', /contracts-per-ip/)
    assert.ok(blocked.headers.get('retry-after'))
    assert.equal(blocked.headers.get('x-ratelimit-limit'), null)
    assert.match((await blocked.json()).error, /Demasiadas peticiones/)

    assert.equal((await fetch(`${baseUrl}/health`)).status, 200)
  })
})

test('comparte la cuota de IA entre endpoints', async () => {
  await withServer({ aiGlobalPerDay: 50, aiGlobalPerMinute: 50, aiPerHour: 2 }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/analyze`, { method: 'POST' })).status, 200)
    assert.equal((await fetch(`${baseUrl}/chat`, { method: 'POST' })).status, 200)

    const blocked = await fetch(`${baseUrl}/analyze`, { method: 'POST' })
    assert.equal(blocked.status, 429)
    assert.match((await blocked.json()).error, /operaciones con IA/)
  })
})

test('aplica a las subidas una cuota adicional', async () => {
  await withServer({
    aiGlobalPerDay: 50,
    aiGlobalPerMinute: 50,
    aiPerHour: 50,
    uploadsPerHour: 1
  }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/upload`, { method: 'POST' })).status, 200)

    const blocked = await fetch(`${baseUrl}/upload`, { method: 'POST' })
    assert.equal(blocked.status, 429)
    assert.match((await blocked.json()).error, /límite de subidas/)
  })
})

test('el bucket global frena abuso distribuido', async () => {
  await withServer({
    aiGlobalPerDay: 50,
    aiGlobalPerMinute: 2,
    aiPerHour: 50,
    trustCloudflare: true
  }, async (baseUrl) => {
    const request = (ip) => fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip }
    })

    assert.equal((await request('198.51.100.1')).status, 200)
    assert.equal((await request('198.51.100.2')).status, 200)
    assert.equal((await request('198.51.100.3')).status, 429)
  })
})

test('las respuestas cacheadas no consumen la cuota global de ejecución', async () => {
  await withServer({
    aiGlobalPerDay: 1,
    aiGlobalPerMinute: 10,
    aiPerHour: 10
  }, async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/cached`, { method: 'POST' })).status, 200)
    assert.equal((await fetch(`${baseUrl}/cached`, { method: 'POST' })).status, 200)
    assert.equal((await fetch(`${baseUrl}/analyze`, { method: 'POST' })).status, 200)

    const blocked = await fetch(`${baseUrl}/chat`, { method: 'POST' })
    assert.equal(blocked.status, 429)
    assert.match((await blocked.json()).error, /cuota diaria/)
  })
})

test('rechaza concurrencia antes de iniciar otra operación', async () => {
  const app = express()
  const limiters = createRateLimiters({
    aiConcurrency: 1,
    aiConcurrencyPerIp: 1,
    aiGlobalPerDay: 50,
    aiGlobalPerMinute: 50,
    aiPerHour: 50,
    trustCloudflare: true
  })

  let releaseFirst
  let markStarted
  const started = new Promise(resolve => { markStarted = resolve })
  const gate = new Promise(resolve => { releaseFirst = resolve })
  app.post('/ai', ...limiters.aiAdmissionLimiters, limiters.aiConcurrencyLimiter, ...limiters.aiCostLimiters, async (req, res) => {
    markStarted()
    await gate
    res.json({ ok: true })
  })

  const { baseUrl, server } = await startServer(app)
  const url = `${baseUrl}/ai`

  try {
    const first = fetch(url, { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.1' } })
    await started
    const blocked = await fetch(url, { method: 'POST', headers: { 'CF-Connecting-IP': '198.51.100.2' } })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '5')
    assert.match((await blocked.json()).error, /en curso/)
    releaseFirst()
    assert.equal((await first).status, 200)
  } finally {
    releaseFirst()
    await new Promise(resolve => server.close(resolve))
  }
})

test('ignora X-Forwarded-For y agrupa un CF-Connecting-IP inválido', async () => {
  await withServer({ contractsPer15Minutes: 1, trustCloudflare: true }, async (baseUrl) => {
    const first = await fetch(`${baseUrl}/contracts`, {
      headers: { 'CF-Connecting-IP': 'no-es-una-ip', 'X-Forwarded-For': '198.51.100.1' }
    })
    const blocked = await fetch(`${baseUrl}/contracts`, {
      headers: { 'CF-Connecting-IP': 'tampoco', 'X-Forwarded-For': '203.0.113.2' }
    })

    assert.equal(first.status, 200)
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('cache-control'), 'private, no-store')
  })
})

test('mantiene el slot si el cliente aborta durante el trabajo', { timeout: 5_000 }, async () => {
  const app = express()
  const limiters = createRateLimiters({
    aiConcurrency: 1,
    aiConcurrencyPerIp: 1,
    aiGlobalPerDay: 50,
    aiGlobalPerMinute: 50,
    aiPerHour: 50,
    trustCloudflare: true
  })

  let markStarted
  let releaseWork
  const started = new Promise(resolve => { markStarted = resolve })
  const work = new Promise(resolve => { releaseWork = resolve })
  app.post('/ai', limiters.aiConcurrencyLimiter, async (req, res) => {
    markStarted()
    try {
      await work
      res.json({ ok: true })
    } finally {
      res.locals.releaseAiSlot?.()
    }
  })

  const { baseUrl, server } = await startServer(app)
  const url = `${baseUrl}/ai`
  const controller = new AbortController()

  try {
    const first = fetch(url, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.1' },
      signal: controller.signal
    }).catch(err => err)
    await started
    controller.abort()

    const blocked = await fetch(url, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.2' }
    })
    assert.equal(blocked.status, 429)

    releaseWork()
    assert.equal((await first).name, 'AbortError')
    await new Promise(resolve => setTimeout(resolve, 20))

    const accepted = await fetch(url, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.2' }
    })
    assert.equal(accepted.status, 200)
  } finally {
    releaseWork()
    await new Promise(resolve => server.close(resolve))
  }
})

test('no adquiere un slot tras abortar durante la validación previa', { timeout: 5_000 }, async () => {
  const app = express()
  const limiters = createRateLimiters({
    aiConcurrency: 1,
    aiConcurrencyPerIp: 1,
    trustCloudflare: true
  })

  let markPreparing
  let markPrepared
  const preparing = new Promise(resolve => { markPreparing = resolve })
  const prepared = new Promise(resolve => { markPrepared = resolve })
  app.post(
    '/ai',
    (req, res, next) => {
      markPreparing()
      setTimeout(() => {
        next()
        markPrepared()
      }, 50)
    },
    limiters.aiConcurrencyLimiter,
    (req, res) => res.json({ ok: true })
  )

  const { baseUrl, server } = await startServer(app)
  const controller = new AbortController()

  try {
    const aborted = fetch(`${baseUrl}/ai`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.1' },
      signal: controller.signal
    }).catch(err => err)
    await preparing
    controller.abort()
    await prepared
    assert.equal((await aborted).name, 'AbortError')

    const accepted = await fetch(`${baseUrl}/ai`, {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.2' }
    })
    assert.equal(accepted.status, 200)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
