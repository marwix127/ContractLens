const net = require('node:net')
const { DAY, HOUR, MINUTE, ipKeyGenerator, rateLimit } = require('express-rate-limit')

function clientKeyGenerator({ trustCloudflare = false } = {}) {
  return (req) => {
    if (trustCloudflare) {
      const cloudflareIp = req.get('cf-connecting-ip')?.trim()
      return cloudflareIp && net.isIP(cloudflareIp)
        ? ipKeyGenerator(cloudflareIp)
        : 'render:unknown'
    }

    const directIp = req.ip || req.socket.remoteAddress
    return directIp && net.isIP(directIp)
      ? ipKeyGenerator(directIp)
      : 'local:unknown'
  }
}

function createLimiter({ identifier, keyGenerator, limit, message, windowMs }) {
  return rateLimit({
    identifier,
    keyGenerator,
    legacyHeaders: false,
    limit,
    message: { error: message },
    passOnStoreError: false,
    standardHeaders: 'draft-8',
    windowMs,
    handler: (req, res, next, options) => {
      res.setHeader('Cache-Control', 'private, no-store')
      res.status(options.statusCode).json(options.message)
    }
  })
}

function createConcurrencyLimiter({ keyGenerator, maxGlobal, maxPerClient }) {
  let activeGlobal = 0
  const activeByClient = new Map()

  return (req, res, next) => {
    // Si el cliente se fue durante una validación asíncrona anterior, no
    // adquirimos un slot que ya no tendría respuesta con la que liberarse.
    if (req.aborted || res.destroyed || res.writableEnded) return

    const clientKey = keyGenerator(req)
    const activeForClient = activeByClient.get(clientKey) || 0

    if (activeGlobal >= maxGlobal || activeForClient >= maxPerClient) {
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('Retry-After', '5')
      return res.status(429).json({
        error: 'Ya hay demasiadas operaciones con IA en curso. Inténtalo de nuevo en unos segundos.'
      })
    }

    activeGlobal += 1
    activeByClient.set(clientKey, activeForClient + 1)

    let released = false
    const release = () => {
      if (released) return
      released = true
      activeGlobal -= 1
      const remaining = (activeByClient.get(clientKey) || 1) - 1
      if (remaining > 0) activeByClient.set(clientKey, remaining)
      else activeByClient.delete(clientKey)
    }

    // `close` puede ocurrir mientras Gemini sigue trabajando. Liberar ahí
    // permitiría superar el máximo cancelando el fetch. Interceptamos `end`
    // para mantener el slot hasta que el handler haya terminado realmente;
    // `finish` queda como respaldo y la función es idempotente.
    const originalEnd = res.end
    res.end = function (...args) {
      try {
        return originalEnd.apply(this, args)
      } finally {
        release()
      }
    }
    res.locals.releaseAiSlot = release
    res.once('finish', release)
    next()
  }
}

function createRateLimiters({
  aiConcurrency = 3,
  aiConcurrencyPerIp = 1,
  aiGlobalPerDay = 100,
  aiGlobalPerMinute = 10,
  aiPerHour = 15,
  contractsPer15Minutes = 120,
  trustCloudflare = false,
  uploadsPerHour = 3
} = {}) {
  const clientKey = clientKeyGenerator({ trustCloudflare })
  const globalKey = () => 'global'

  const contractsLimiter = createLimiter({
    identifier: 'contracts-per-ip',
    keyGenerator: clientKey,
    limit: contractsPer15Minutes,
    message: 'Demasiadas peticiones. Espera unos minutos antes de continuar.',
    windowMs: 15 * MINUTE
  })

  const uploadLimiter = createLimiter({
    identifier: 'uploads-per-ip',
    keyGenerator: clientKey,
    limit: uploadsPerHour,
    message: 'Has alcanzado el límite de subidas de la demo. Inténtalo más tarde.',
    windowMs: HOUR
  })

  // Una sola cuota por visitante compartida entre análisis, chat, comparación
  // y subida. Cambiar de endpoint no permite reiniciar el contador.
  const aiPerIpLimiter = createLimiter({
    identifier: 'ai-per-ip',
    keyGenerator: clientKey,
    limit: aiPerHour,
    message: 'Has alcanzado el límite temporal de operaciones con IA.',
    windowMs: HOUR
  })

  const aiConcurrencyLimiter = createConcurrencyLimiter({
    keyGenerator: clientKey,
    maxGlobal: aiConcurrency,
    maxPerClient: aiConcurrencyPerIp
  })

  // Los dos buckets globales reducen el impacto de abuso distribuido. El
  // MemoryStore es suficiente para la instancia única de la demo y falla de
  // forma conservadora; al escalar habrá que sustituirlo por un store externo.
  const aiGlobalBurstLimiter = createLimiter({
    identifier: 'ai-global-burst',
    keyGenerator: globalKey,
    limit: aiGlobalPerMinute,
    message: 'La demo está recibiendo demasiadas operaciones con IA. Inténtalo en un minuto.',
    windowMs: MINUTE
  })
  const aiGlobalDailyLimiter = createLimiter({
    identifier: 'ai-global-daily',
    keyGenerator: globalKey,
    limit: aiGlobalPerDay,
    message: 'La demo ha alcanzado su cuota diaria de IA. Inténtalo más tarde.',
    windowMs: DAY
  })

  // La admisión por IP se aplica antes de validar para frenar basura barata.
  // Concurrencia y cuotas globales se aplican solo cuando la petición ya está
  // validada y va a ejecutar embeddings o generación con Gemini.
  const aiAdmissionLimiters = [aiPerIpLimiter]
  const aiCostLimiters = [aiGlobalBurstLimiter, aiGlobalDailyLimiter]

  return {
    aiAdmissionLimiters,
    aiConcurrencyLimiter,
    aiCostLimiters,
    contractsLimiter,
    uploadAdmissionLimiters: [uploadLimiter, ...aiAdmissionLimiters]
  }
}

module.exports = { clientKeyGenerator, createConcurrencyLimiter, createRateLimiters }
