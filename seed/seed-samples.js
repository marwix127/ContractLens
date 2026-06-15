// Siembra contratos de muestra para el demo: genera PDFs ficticios con pdfkit,
// los pasa por el mismo pipeline real (extracción → chunking → embeddings →
// análisis) y los marca como is_sample. Reejecutable: borra las muestras previas.
require('dotenv').config()
const PDFDocument = require('pdfkit')
const { PDFParse } = require('pdf-parse')
const pool = require('../src/db')
const { ingestContract } = require('../src/services/ingest')
const { analyzeContract } = require('../src/services/analysis')

function buildPdf({ title, clauses }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 60 })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    doc.fontSize(16).font('Helvetica-Bold').text(title, { align: 'center' })
    doc.moveDown(1.5)
    clauses.forEach(c => {
      doc.fontSize(12).font('Helvetica-Bold').text(c.h)
      doc.fontSize(11).font('Helvetica').text(c.b, { align: 'justify' })
      doc.moveDown(0.8)
    })
    doc.end()
  })
}

const SAMPLES = [
  {
    filename: 'NDA - Acuerdo de Confidencialidad.pdf',
    title: 'ACUERDO DE CONFIDENCIALIDAD (NDA)',
    clauses: [
      { h: 'Entre las partes', b: 'De una parte, TecnoVentura S.L., con CIF B-12345678 y domicilio en Madrid (la "Parte Reveladora"); y de otra, Innovexa Solutions Ltd., con sede en Dublín, Irlanda (la "Parte Receptora").' },
      { h: 'Cláusula 1. Objeto', b: 'Las partes intercambiarán información confidencial con el fin de evaluar una posible colaboración comercial. Se considera confidencial toda información técnica, comercial o financiera revelada por cualquier medio.' },
      { h: 'Cláusula 2. Obligaciones de confidencialidad', b: 'La Parte Receptora se obliga a mantener la información en estricto secreto y a no divulgarla a terceros sin autorización previa por escrito. Esta obligación se extiende a empleados, asesores y subcontratistas.' },
      { h: 'Cláusula 3. Duración', b: 'El presente acuerdo tendrá una duración de cinco (5) años desde la fecha de firma. Las obligaciones de confidencialidad sobrevivirán indefinidamente tras la terminación del acuerdo.' },
      { h: 'Cláusula 4. Penalización', b: 'El incumplimiento de las obligaciones de confidencialidad conllevará una penalización de 500.000 euros por cada infracción, sin perjuicio de la reclamación de daños adicionales.' },
      { h: 'Cláusula 5. Ley aplicable y jurisdicción', b: 'El presente acuerdo se rige por la legislación de Irlanda. Cualquier controversia se someterá a los tribunales de Dublín, con renuncia expresa a cualquier otro fuero.' },
      { h: 'Cláusula 6. Firma', b: 'Firmado por ambas partes el 15 de enero de 2026.' }
    ]
  },
  {
    filename: 'Contrato de Servicios de Consultoría.pdf',
    title: 'CONTRATO DE PRESTACIÓN DE SERVICIOS DE CONSULTORÍA',
    clauses: [
      { h: 'Partes', b: 'De una parte, Comercial Ibérica S.A. (el "Cliente"); de otra, Marta Ruiz Gómez, profesional autónoma (la "Consultora").' },
      { h: 'Cláusula 1. Objeto', b: 'La Consultora prestará servicios de consultoría en transformación digital, incluyendo auditoría de procesos, recomendaciones estratégicas y acompañamiento en la implantación.' },
      { h: 'Cláusula 2. Duración y renovación', b: 'El contrato tendrá una duración inicial de doce (12) meses desde su firma. Se renovará automáticamente por períodos anuales sucesivos salvo preaviso escrito de cualquiera de las partes con al menos 90 días de antelación.' },
      { h: 'Cláusula 3. Honorarios', b: 'El Cliente abonará 3.500 euros mensuales más IVA, pagaderos dentro de los 60 días siguientes a la emisión de cada factura.' },
      { h: 'Cláusula 4. Exclusividad', b: 'Durante la vigencia del contrato y los dos años posteriores, la Consultora no podrá prestar servicios a ninguna empresa del sector, con independencia del ámbito geográfico.' },
      { h: 'Cláusula 5. Propiedad intelectual', b: 'Todos los entregables y desarrollos resultantes de los servicios serán propiedad exclusiva del Cliente.' },
      { h: 'Cláusula 6. Terminación', b: 'El Cliente podrá resolver el contrato en cualquier momento mediante preaviso de 15 días. La Consultora únicamente podrá resolverlo por incumplimiento grave del Cliente.' },
      { h: 'Cláusula 7. Ley aplicable', b: 'El contrato se rige por la legislación española y se somete a los juzgados y tribunales de Barcelona. Firmado el 3 de febrero de 2026.' }
    ]
  },
  {
    filename: 'Contrato de Arrendamiento de Local.pdf',
    title: 'CONTRATO DE ARRENDAMIENTO DE LOCAL COMERCIAL',
    clauses: [
      { h: 'Partes', b: 'De una parte, Inmuebles del Sur S.L. (el "Arrendador"); de otra, Cafetería La Esquina S.L. (el "Arrendatario").' },
      { h: 'Cláusula 1. Objeto', b: 'El Arrendador cede en arrendamiento el local comercial sito en la calle Mayor 24, bajo, de Sevilla, para su uso exclusivo como establecimiento de hostelería.' },
      { h: 'Cláusula 2. Duración', b: 'El plazo de arrendamiento es de cinco (5) años desde el 1 de marzo de 2026. El Arrendatario renuncia expresamente al derecho de prórroga forzosa.' },
      { h: 'Cláusula 3. Renta', b: 'La renta mensual es de 1.800 euros, que se actualizará anualmente conforme al IPC. El impago de una sola mensualidad facultará al Arrendador para resolver el contrato de forma inmediata.' },
      { h: 'Cláusula 4. Fianza', b: 'El Arrendatario entrega dos mensualidades en concepto de fianza. Adicionalmente, deposita una garantía de seis mensualidades de renta.' },
      { h: 'Cláusula 5. Penalización por desistimiento', b: 'En caso de que el Arrendatario abandone el local antes de la finalización del contrato, deberá abonar la totalidad de las rentas pendientes hasta el vencimiento, sin posibilidad de reducción.' },
      { h: 'Cláusula 6. Obras y conservación', b: 'Cualquier obra requiere autorización escrita del Arrendador. Las mejoras realizadas quedarán en beneficio del inmueble sin derecho a compensación.' },
      { h: 'Cláusula 7. Ley aplicable', b: 'El contrato se rige por la Ley de Arrendamientos Urbanos y demás legislación española aplicable. Firmado el 20 de febrero de 2026.' }
    ]
  }
]

async function seed() {
  try {
    const del = await pool.query('DELETE FROM contracts WHERE is_sample = true')
    if (del.rowCount) console.log(`Eliminadas ${del.rowCount} muestras anteriores`)

    for (const sample of SAMPLES) {
      const buffer = await buildPdf(sample)
      const parser = new PDFParse({ data: buffer })
      const result = await parser.getText()

      const { rows } = await pool.query(
        `INSERT INTO contracts (filename, total_pages, raw_text, pdf_data, is_sample)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [sample.filename, result.total, result.text, buffer]
      )
      const id = rows[0].id

      const { chunksCreated } = await ingestContract(id, result.pages)

      const analysis = await analyzeContract(result.text)
      await pool.query(
        `INSERT INTO analyses (contract_id, summary, extracted_data, risks)
         VALUES ($1, $2, $3, $4)`,
        [id, analysis.summary, analysis.extracted_data, JSON.stringify(analysis.risks)]
      )

      await parser.destroy()
      console.log(`✓ ${sample.filename} — ${result.total} págs, ${chunksCreated} chunks, ${analysis.risks.length} riesgos`)
    }

    console.log('\nSeed completado.')
  } catch (err) {
    console.error('Error en el seed:', err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}

seed()
