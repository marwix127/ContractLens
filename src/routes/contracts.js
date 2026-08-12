const { Router } = require('express')
const multer = require('multer')
const { contentDisposition } = require('../http/content-disposition')

function createContractsRouter({
  analysisService,
  appConfig,
  chatService,
  compareService,
  ingestService,
  limiters,
  logger = console,
  PdfParser,
  pool,
  reportService
} = {}) {
  const required = {
    analysisService,
    appConfig,
    chatService,
    compareService,
    ingestService,
    limiters,
    PdfParser,
    pool,
    reportService
  }
  const missing = Object.entries(required).filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) {
    throw new TypeError(`createContractsRouter requiere: ${missing.join(', ')}`)
  }

  const { analyzeContract, DISCLAIMER } = analysisService
  const { chat, chatStream, ConversationNotFoundError } = chatService
  const { compareContracts } = compareService
  const { ingestContract } = ingestService
  const { buildAnalysisPdf } = reportService
  const {
    aiAdmissionLimiters,
    aiConcurrencyLimiter,
    aiCostLimiters,
    uploadAdmissionLimiters
  } = limiters
  const config = appConfig
  const router = Router()

// Un :id que no sea un UUID válido haría fallar la consulta a Postgres con un
// 500; lo interceptamos y devolvemos 404 de forma centralizada para todas las
// rutas /contracts/:id/*.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
router.param('id', (req, res, next, id) => {
  if (!UUID_RE.test(id)) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }
  next()
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: config.limits.maxUploadMb * 1024 * 1024,
    fields: 0,
    parts: 2
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Solo se aceptan archivos PDF'))
    }
    cb(null, true)
  }
})

async function parseUploadedPdf(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo. Envíalo en el campo "file" como multipart/form-data.' })
  }

  const parser = new PdfParser({ data: req.file.buffer })
  let result
  try {
    result = await parser.getText()
  } catch (err) {
    logger.error('Error leyendo PDF:', err)
    return res.status(422).json({ error: 'No se pudo procesar el PDF. ¿Es un archivo válido?' })
  } finally {
    try {
      await parser.destroy()
    } catch (err) {
      logger.error('Error liberando el parser de PDF:', err.message)
    }
  }

  if (!result.text || result.text.trim().length === 0) {
    return res.status(422).json({
      error: 'El PDF no contiene texto extraíble. Puede ser un documento escaneado sin OCR.'
    })
  }
  if (result.total > config.limits.maxPdfPages) {
    return res.status(413).json({
      error: `El PDF supera el límite de ${config.limits.maxPdfPages} páginas de la demo.`
    })
  }
  if (result.text.length > config.limits.maxPdfTextChars) {
    return res.status(413).json({
      error: 'El PDF contiene demasiado texto para procesarlo de forma segura en la demo.'
    })
  }

  res.locals.pdfResult = result
  next()
}

// POST /contracts — subir un PDF y extraer su texto
router.post(
  '/',
  ...uploadAdmissionLimiters,
  aiConcurrencyLimiter,
  upload.single('file'),
  parseUploadedPdf,
  ...aiCostLimiters,
  async (req, res) => {
    const result = res.locals.pdfResult
    let contractId
    try {
      const { rows } = await pool.query(
        `INSERT INTO contracts (filename, total_pages, raw_text, pdf_data)
         VALUES ($1, $2, $3, $4)
         RETURNING id, filename, total_pages, uploaded_at`,
        [req.file.originalname, result.total, result.text, req.file.buffer]
      )
      contractId = rows[0].id

      // Chunking + embeddings + guardado en pgvector.
      const { chunksCreated } = await ingestContract(contractId, result.pages)

      return res.status(201).json({
        contract: rows[0],
        textLength: result.text.length,
        chunksCreated
      })
    } catch (err) {
      logger.error('Error indexando PDF:', err)
      if (contractId) {
        try {
          await pool.query('DELETE FROM contracts WHERE id = $1', [contractId])
        } catch (cleanupError) {
          logger.error('No se pudo limpiar el contrato tras fallar la ingesta:', cleanupError)
        }
      }
      return res.status(502).json({ error: 'No se pudo indexar el contrato. Inténtalo de nuevo más tarde.' })
    } finally {
      res.locals.releaseAiSlot?.()
    }
  }
)

// GET /contracts — solo las muestras salvo opt-in local explícito. Así, una
// variable NODE_ENV ausente nunca expone por accidente documentos de usuarios.
router.get('/', async (req, res) => {
  const where = config.exposeAllContracts ? '' : 'WHERE is_sample = true'
  const { rows } = await pool.query(
    `SELECT id, filename, total_pages, uploaded_at FROM contracts ${where} ORDER BY uploaded_at DESC`
  )
  res.json({ contracts: rows })
})

// GET /contracts/samples — contratos de muestra precargados para el demo.
// Debe ir ANTES de /:id, o "samples" se interpretaría como un id.
router.get('/samples', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, filename, total_pages, uploaded_at FROM contracts WHERE is_sample = true ORDER BY filename'
  )
  res.json({ contracts: rows })
})

// GET /contracts/:id/file — sirve el PDF original.
router.get('/:id/file', async (req, res) => {
  const { rows } = await pool.query('SELECT pdf_data, filename FROM contracts WHERE id = $1', [req.params.id])
  if (rows.length === 0 || !rows[0].pdf_data) {
    return res.status(404).json({ error: 'PDF no disponible' })
  }
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  res.setHeader('Content-Disposition', contentDisposition('inline', rows[0].filename))
  res.send(rows[0].pdf_data)
})

// GET /contracts/:id — detalle de un contrato
router.get('/:id', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, filename, total_pages, uploaded_at FROM contracts WHERE id = $1',
    [req.params.id]
  )
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }
  res.json({ contract: rows[0] })
})

async function prepareAnalysis(req, res, next) {
  const { rows: cached } = await pool.query(
    `SELECT id, summary, extracted_data, risks, created_at
     FROM analyses WHERE contract_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [req.params.id]
  )
  if (cached.length > 0) {
    return res.json({
      analysisId: cached[0].id,
      summary: cached[0].summary,
      extracted_data: cached[0].extracted_data,
      risks: cached[0].risks,
      disclaimer: DISCLAIMER,
      cached: true
    })
  }

  const { rows } = await pool.query(
    'SELECT raw_text FROM contracts WHERE id = $1',
    [req.params.id]
  )
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }

  res.locals.contractText = rows[0].raw_text
  next()
}

// POST /contracts/:id/analyze — análisis inicial con Gemini Flash (5-15 s)
router.post('/:id/analyze', ...aiAdmissionLimiters, prepareAnalysis, aiConcurrencyLimiter, ...aiCostLimiters, async (req, res) => {
  try {
    const analysis = await analyzeContract(res.locals.contractText)

    // La consulta inicial evita regenerar un análisis ya persistido.
    const { rows: saved } = await pool.query(
      `INSERT INTO analyses (contract_id, summary, extracted_data, risks)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [req.params.id, analysis.summary, analysis.extracted_data, JSON.stringify(analysis.risks)]
    )

    res.status(201).json({ analysisId: saved[0].id, ...analysis })
  } catch (err) {
    logger.error('Error en análisis:', err)
    res.status(502).json({ error: 'No se pudo generar el análisis con el modelo.' })
  } finally {
    res.locals.releaseAiSlot?.()
  }
})

// GET /contracts/:id/analysis — obtener el análisis guardado
router.get('/:id/analysis', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT summary, extracted_data, risks, created_at
     FROM analyses WHERE contract_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [req.params.id]
  )
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Este contrato aún no tiene análisis. Lanza POST /contracts/:id/analyze.' })
  }
  res.json({ ...rows[0], disclaimer: DISCLAIMER })
})

// GET /contracts/:id/analysis/pdf — descarga el análisis como informe PDF
router.get('/:id/analysis/pdf', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.summary, a.extracted_data, a.risks, c.filename
     FROM analyses a JOIN contracts c ON c.id = a.contract_id
     WHERE a.contract_id = $1
     ORDER BY a.created_at DESC LIMIT 1`,
    [req.params.id]
  )
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Este contrato aún no tiene análisis.' })
  }

  try {
    const pdf = await buildAnalysisPdf({ filename: rows[0].filename, analysis: rows[0] })
    const safeName = rows[0].filename.replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_')
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Content-Disposition', contentDisposition('attachment', `analisis-${safeName}.pdf`))
    res.send(pdf)
  } catch (err) {
    logger.error('Error generando el informe PDF:', err)
    res.status(500).json({ error: 'No se pudo generar el informe PDF.' })
  }
})

async function prepareChatRequest(req, res, next) {
  const { question, conversationId } = req.body || {}
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Falta "question" en el cuerpo de la petición.' })
  }
  if (question.trim().length > config.limits.maxQuestionChars) {
    return res.status(400).json({ error: `La pregunta no puede superar ${config.limits.maxQuestionChars} caracteres.` })
  }
  if (conversationId != null && (typeof conversationId !== 'string' || !UUID_RE.test(conversationId))) {
    return res.status(400).json({ error: 'conversationId no es válido.' })
  }

  // Verificar que el contrato existe y tiene chunks indexados.
  const { rows } = await pool.query('SELECT 1 FROM contracts WHERE id = $1', [req.params.id])
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }

  if (conversationId) {
    const { rows: conversations } = await pool.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND contract_id = $2',
      [conversationId, req.params.id]
    )
    if (conversations.length === 0) {
      return res.status(404).json({ error: 'La conversación no pertenece a este contrato' })
    }
  }

  res.locals.chatQuestion = question.trim()
  res.locals.conversationId = conversationId
  next()
}

// POST /contracts/:id/chat — pregunta sobre el contrato (RAG con Gemini)
router.post('/:id/chat', ...aiAdmissionLimiters, prepareChatRequest, aiConcurrencyLimiter, ...aiCostLimiters, async (req, res) => {
  try {
    const result = await chat(req.params.id, res.locals.chatQuestion, res.locals.conversationId)
    res.json({ ...result, disclaimer: DISCLAIMER })
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      return res.status(404).json({ error: err.message })
    }
    logger.error('Error en el chat:', err)
    res.status(502).json({ error: 'No se pudo generar la respuesta.' })
  } finally {
    res.locals.releaseAiSlot?.()
  }
})

// POST /contracts/:id/chat/stream — igual que /chat pero con respuesta SSE
router.post('/:id/chat/stream', ...aiAdmissionLimiters, prepareChatRequest, aiConcurrencyLimiter, ...aiCostLimiters, async (req, res) => {
  // Cabeceras Server-Sent Events.
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'private, no-store, no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)

  try {
    for await (const event of chatStream(req.params.id, res.locals.chatQuestion, res.locals.conversationId)) {
      if (event.type === 'meta') event.disclaimer = DISCLAIMER
      send(event)
    }
  } catch (err) {
    if (err instanceof ConversationNotFoundError) {
      send({ type: 'error', error: err.message })
      return
    }
    logger.error('Error en el chat (stream):', err)
    send({ type: 'error', error: 'No se pudo generar la respuesta.' })
  } finally {
    res.end()
    res.locals.releaseAiSlot?.()
  }
})

async function prepareComparison(req, res, next) {
  const { fromId, toId } = req.body || {}
  if (!fromId || !toId) {
    return res.status(400).json({ error: 'Faltan "fromId" y "toId".' })
  }
  if (fromId === toId) {
    return res.status(400).json({ error: 'Selecciona dos contratos distintos.' })
  }
  if (!UUID_RE.test(fromId) || !UUID_RE.test(toId)) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }

  const { rows } = await pool.query(
    'SELECT id, filename, raw_text FROM contracts WHERE id = ANY($1::uuid[])',
    [[fromId, toId]]
  )
  const before = rows.find(r => r.id === fromId)
  const after = rows.find(r => r.id === toId)
  if (!before || !after) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }

  res.locals.comparisonBefore = before
  res.locals.comparisonAfter = after
  next()
}

// POST /contracts/compare — compara dos versiones de un contrato.
// Body: { fromId, toId } (versión anterior y nueva).
router.post('/compare', ...aiAdmissionLimiters, prepareComparison, aiConcurrencyLimiter, ...aiCostLimiters, async (req, res) => {
  const before = res.locals.comparisonBefore
  const after = res.locals.comparisonAfter
  try {
    const comparison = await compareContracts(before.raw_text, after.raw_text)
    res.json({
      from: { id: before.id, filename: before.filename },
      to: { id: after.id, filename: after.filename },
      ...comparison,
      disclaimer: DISCLAIMER
    })
  } catch (err) {
    logger.error('Error en la comparación:', err)
    res.status(502).json({ error: 'No se pudo generar la comparación.' })
  } finally {
    res.locals.releaseAiSlot?.()
  }
})

  return router
}

module.exports = { createContractsRouter }
