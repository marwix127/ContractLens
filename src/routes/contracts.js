const { Router } = require('express')
const multer = require('multer')
const { PDFParse } = require('pdf-parse')
const pool = require('../db')
const { ingestContract } = require('../services/ingest')

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

module.exports = router
