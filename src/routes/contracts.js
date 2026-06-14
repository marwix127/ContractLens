const { Router } = require('express')
const multer = require('multer')
const { PDFParse } = require('pdf-parse')
const pool = require('../db')
const { ingestContract } = require('../services/ingest')
const { analyzeContract, DISCLAIMER } = require('../services/analysis')
const { chat, chatStream } = require('../services/chat')

const router = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      return cb(new Error('Solo se aceptan archivos PDF'))
    }
    cb(null, true)
  }
})

// POST /contracts — subir un PDF y extraer su texto
router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Falta el archivo. Envíalo en el campo "file" como multipart/form-data.' })
  }

  const parser = new PDFParse({ data: req.file.buffer })
  try {
    const result = await parser.getText()

    if (!result.text || result.text.trim().length === 0) {
      return res.status(422).json({
        error: 'El PDF no contiene texto extraíble. Puede ser un documento escaneado sin OCR.'
      })
    }

    const { rows } = await pool.query(
      `INSERT INTO contracts (filename, total_pages, raw_text)
       VALUES ($1, $2, $3)
       RETURNING id, filename, total_pages, uploaded_at`,
      [req.file.originalname, result.total, result.text]
    )

    // Chunking + embeddings + guardado en pgvector.
    const { chunksCreated } = await ingestContract(rows[0].id, result.pages)

    res.status(201).json({
      contract: rows[0],
      textLength: result.text.length,
      chunksCreated
    })
  } catch (err) {
    console.error('Error procesando PDF:', err)
    res.status(422).json({ error: 'No se pudo procesar el PDF. ¿Es un archivo válido?' })
  } finally {
    await parser.destroy()
  }
})

// GET /contracts — listar contratos subidos
router.get('/', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, filename, total_pages, uploaded_at FROM contracts ORDER BY uploaded_at DESC'
  )
  res.json({ contracts: rows })
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

// POST /contracts/:id/analyze — análisis inicial con Gemini Flash (5-15 s)
router.post('/:id/analyze', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT raw_text FROM contracts WHERE id = $1',
    [req.params.id]
  )
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }

  try {
    const analysis = await analyzeContract(rows[0].raw_text)

    // upsert: un análisis por contrato; re-analizar reemplaza el anterior.
    const { rows: saved } = await pool.query(
      `INSERT INTO analyses (contract_id, summary, extracted_data, risks)
       VALUES ($1, $2, $3, $4)
       RETURNING id, created_at`,
      [req.params.id, analysis.summary, analysis.extracted_data, JSON.stringify(analysis.risks)]
    )

    res.status(201).json({ analysisId: saved[0].id, ...analysis })
  } catch (err) {
    console.error('Error en análisis:', err)
    res.status(502).json({ error: 'No se pudo generar el análisis con el modelo.' })
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

// POST /contracts/:id/chat — pregunta sobre el contrato (RAG con Gemini)
router.post('/:id/chat', async (req, res) => {
  const { question, conversationId } = req.body || {}
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Falta "question" en el cuerpo de la petición.' })
  }

  // Verificar que el contrato existe y tiene chunks indexados.
  const { rows } = await pool.query('SELECT 1 FROM contracts WHERE id = $1', [req.params.id])
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }

  try {
    const result = await chat(req.params.id, question.trim(), conversationId)
    res.json({ ...result, disclaimer: DISCLAIMER })
  } catch (err) {
    console.error('Error en el chat:', err)
    res.status(502).json({ error: 'No se pudo generar la respuesta.' })
  }
})

// POST /contracts/:id/chat/stream — igual que /chat pero con respuesta SSE
router.post('/:id/chat/stream', async (req, res) => {
  const { question, conversationId } = req.body || {}
  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Falta "question" en el cuerpo de la petición.' })
  }

  const { rows } = await pool.query('SELECT 1 FROM contracts WHERE id = $1', [req.params.id])
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Contrato no encontrado' })
  }

  // Cabeceras Server-Sent Events.
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (event) => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)

  try {
    for await (const event of chatStream(req.params.id, question.trim(), conversationId)) {
      if (event.type === 'meta') event.disclaimer = DISCLAIMER
      send(event)
    }
  } catch (err) {
    console.error('Error en el chat (stream):', err)
    send({ type: 'error', error: 'No se pudo generar la respuesta.' })
  } finally {
    res.end()
  }
})

module.exports = router
