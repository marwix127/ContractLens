// Datos deterministas para desarrollo y pruebas QA.
//
// A diferencia de seed-samples.js, este script no llama a Gemini: crea dos
// versiones pequeñas de un contrato y guarda análisis ya preparados. Así se
// pueden probar listados, detalle, dashboard, visor y exportación PDF sin cuota.
require('../src/config/env')

const PDFDocument = require('pdfkit')
const pool = require('../src/db')

const LOCAL_PREFIX = '[QA Local]'

const SAMPLES = [
  {
    filename: `${LOCAL_PREFIX} Servicios v1.pdf`,
    title: 'CONTRATO DE SERVICIOS — VERSIÓN 1',
    rawText: [
      'Partes: Acme S.L. (Cliente) y Consultoría Demo S.L. (Proveedor).',
      'Cláusula 1. Duración: doce meses desde el 1 de enero de 2026.',
      'Cláusula 2. Precio: 1.000 euros mensuales más IVA.',
      'Cláusula 3. Terminación: cualquiera de las partes podrá resolver con 30 días de preaviso.',
      'Cláusula 4. Jurisdicción: tribunales de Madrid y legislación española.'
    ].join('\n\n'),
    analysis: {
      summary: 'Contrato de servicios de doce meses entre Acme S.L. y Consultoría Demo S.L., con una cuota mensual de 1.000 euros y terminación bilateral mediante preaviso.',
      extracted_data: {
        parties: [
          { name: 'Acme S.L.', role: 'Cliente' },
          { name: 'Consultoría Demo S.L.', role: 'Proveedor' }
        ],
        key_dates: [{ label: 'Inicio', date: '1 de enero de 2026' }],
        economic_terms: '1.000 euros mensuales más IVA.',
        duration: 'Doce meses.',
        penalties: 'No especificado.',
        confidentiality: 'No especificado.',
        jurisdiction: 'Madrid; legislación española.',
        termination: 'Preaviso de 30 días para cualquiera de las partes.'
      },
      risks: [
        {
          title: 'Sin cláusula de confidencialidad',
          severity: 'media',
          location: 'Contrato completo',
          explanation: 'No se regulan las obligaciones sobre información confidencial.',
          recommendation: 'Añadir una cláusula de confidencialidad.'
        }
      ]
    }
  },
  {
    filename: `${LOCAL_PREFIX} Servicios v2.pdf`,
    title: 'CONTRATO DE SERVICIOS — VERSIÓN 2',
    rawText: [
      'Partes: Acme S.L. (Cliente) y Consultoría Demo S.L. (Proveedor).',
      'Cláusula 1. Duración: veinticuatro meses desde el 1 de enero de 2026, con renovación automática anual.',
      'Cláusula 2. Precio: 1.500 euros mensuales más IVA.',
      'Cláusula 3. Terminación: el Cliente podrá resolver con 15 días de preaviso. El Proveedor solo podrá resolver por incumplimiento grave.',
      'Cláusula 4. Penalización: la terminación anticipada por el Proveedor conlleva 10.000 euros.',
      'Cláusula 5. Jurisdicción: tribunales de Madrid y legislación española.'
    ].join('\n\n'),
    analysis: {
      summary: 'Segunda versión del contrato de servicios, ampliada a veinticuatro meses, con renovación automática, mayor precio y condiciones de terminación asimétricas.',
      extracted_data: {
        parties: [
          { name: 'Acme S.L.', role: 'Cliente' },
          { name: 'Consultoría Demo S.L.', role: 'Proveedor' }
        ],
        key_dates: [{ label: 'Inicio', date: '1 de enero de 2026' }],
        economic_terms: '1.500 euros mensuales más IVA.',
        duration: 'Veinticuatro meses con renovación automática anual.',
        penalties: '10.000 euros por terminación anticipada del Proveedor.',
        confidentiality: 'No especificado.',
        jurisdiction: 'Madrid; legislación española.',
        termination: 'Facultades de terminación diferentes para cada parte.'
      },
      risks: [
        {
          title: 'Terminación asimétrica',
          severity: 'alta',
          location: 'Cláusula 3',
          explanation: 'El Cliente dispone de una salida ordinaria que no se concede al Proveedor.',
          recommendation: 'Negociar derechos de terminación equivalentes.'
        },
        {
          title: 'Renovación automática',
          severity: 'media',
          location: 'Cláusula 1',
          explanation: 'El contrato se renueva automáticamente sin concretar un plazo de preaviso.',
          recommendation: 'Definir un aviso previo y recordatorios de vencimiento.'
        }
      ]
    }
  }
]

function assertLocalDatabase() {
  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL. Crea .env.local desde .env.local.example.')
  }

  const { hostname } = new URL(process.env.DATABASE_URL)
  const isLocal = ['localhost', '127.0.0.1', '::1'].includes(hostname)
  if (!isLocal && process.env.ALLOW_LOCAL_SEED_ON_REMOTE !== 'true') {
    throw new Error(
      `El seed local se negó a modificar la base remota "${hostname}". ` +
      'Usa una DATABASE_URL local.'
    )
  }
}

function buildPdf(sample) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 })
    const chunks = []

    doc.on('data', chunk => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.font('Helvetica-Bold').fontSize(16).text(sample.title, { align: 'center' })
    doc.moveDown(1.5)

    for (const paragraph of sample.rawText.split('\n\n')) {
      doc.font('Helvetica').fontSize(11).text(paragraph, { align: 'justify' })
      doc.moveDown(0.8)
    }

    doc.end()
  })
}

async function seedLocal() {
  assertLocalDatabase()

  const prepared = await Promise.all(
    SAMPLES.map(async sample => ({ ...sample, pdf: await buildPdf(sample) }))
  )

  try {
    await pool.query('BEGIN')
    await pool.query('DELETE FROM contracts WHERE filename LIKE $1', [`${LOCAL_PREFIX}%`])

    for (const sample of prepared) {
      const { rows } = await pool.query(
        `INSERT INTO contracts (filename, total_pages, raw_text, pdf_data, is_sample)
         VALUES ($1, 1, $2, $3, true)
         RETURNING id`,
        [sample.filename, sample.rawText, sample.pdf]
      )

      await pool.query(
        `INSERT INTO analyses (contract_id, summary, extracted_data, risks)
         VALUES ($1, $2, $3, $4)`,
        [
          rows[0].id,
          sample.analysis.summary,
          sample.analysis.extracted_data,
          JSON.stringify(sample.analysis.risks)
        ]
      )

      console.log(`✓ ${sample.filename}`)
    }

    await pool.query('COMMIT')
    console.log(`Seed local completado: ${prepared.length} contratos sin llamadas a Gemini.`)
  } catch (err) {
    await pool.query('ROLLBACK')
    throw err
  } finally {
    await pool.end()
  }
}

seedLocal().catch(err => {
  const detail = err.errors?.map(item => item.message).filter(Boolean).join('; ') || err.message
  console.error('Error en el seed local:', detail || 'no se pudo conectar con PostgreSQL')
  process.exitCode = 1
})
