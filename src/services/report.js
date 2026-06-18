// Genera un informe PDF profesional a partir del análisis guardado.
const PDFDocument = require('pdfkit')

const INK = '#0f172a'      // slate-900
const MUTED = '#64748b'    // slate-500
const ACCENT = '#4f46e5'   // indigo-600
const LINE = '#e2e8f0'     // slate-200

const SEVERITY_COLOR = { alta: '#dc2626', media: '#d97706', baja: '#64748b' }

const FIELDS = [
  ['duration', 'Duración'],
  ['economic_terms', 'Condiciones económicas'],
  ['jurisdiction', 'Jurisdicción y ley aplicable'],
  ['penalties', 'Penalizaciones'],
  ['confidentiality', 'Confidencialidad / no competencia'],
  ['termination', 'Terminación']
]

const DISCLAIMER =
  'Este informe ha sido generado automáticamente con fines informativos y no constituye asesoramiento legal. Debe ser revisado por un profesional cualificado.'

function heading(doc, text) {
  doc.moveDown(1)
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(13).text(text)
  doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2).strokeColor(LINE).stroke()
  doc.moveDown(0.6)
  doc.fillColor(INK).font('Helvetica').fontSize(11)
}

function field(doc, label, value) {
  doc.font('Helvetica-Bold').fillColor(MUTED).fontSize(9).text(label.toUpperCase())
  doc.font('Helvetica').fillColor(INK).fontSize(11).text(value || 'No especificado')
  doc.moveDown(0.5)
}

function buildAnalysisPdf({ filename, analysis }) {
  const data = analysis.extracted_data || {}
  const risks = analysis.risks || []

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 })
    const chunks = []
    doc.on('data', c => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // Cabecera
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(22).text('ContractLens')
    doc.fillColor(MUTED).font('Helvetica').fontSize(11).text('Informe de análisis de contrato')
    doc.moveDown(0.8)
    doc.fillColor(INK).font('Helvetica-Bold').fontSize(14).text(filename.replace(/\.pdf$/i, ''))
    doc.fillColor(MUTED).font('Helvetica').fontSize(9)
      .text(`Generado el ${new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`)

    // Resumen ejecutivo
    heading(doc, 'Resumen ejecutivo')
    doc.text(analysis.summary || 'No disponible', { align: 'justify' })

    // Partes
    heading(doc, 'Partes involucradas')
    if (data.parties?.length) {
      data.parties.forEach(p => doc.text(`• ${p.name} — ${p.role}`))
    } else {
      doc.fillColor(MUTED).text('No especificado').fillColor(INK)
    }

    // Fechas clave
    heading(doc, 'Fechas clave')
    if (data.key_dates?.length) {
      data.key_dates.forEach(d => doc.text(`• ${d.label}: ${d.date}`))
    } else {
      doc.fillColor(MUTED).text('No especificado').fillColor(INK)
    }

    // Datos clave
    heading(doc, 'Datos clave')
    FIELDS.forEach(([key, label]) => field(doc, label, data[key]))

    // Riesgos
    heading(doc, `Riesgos detectados (${risks.length})`)
    if (risks.length) {
      risks.forEach((r, i) => {
        if (i > 0) doc.moveDown(0.6)
        doc.font('Helvetica-Bold').fillColor(INK).fontSize(11)
          .text(r.title, { continued: true })
        doc.font('Helvetica-Bold').fillColor(SEVERITY_COLOR[r.severity] || MUTED)
          .text(`   [${(r.severity || '').toUpperCase()}]`)
        if (r.location) doc.font('Helvetica-Oblique').fillColor(MUTED).fontSize(9).text(r.location)
        doc.font('Helvetica').fillColor(INK).fontSize(10).text(r.explanation, { align: 'justify' })
        if (r.recommendation) {
          doc.font('Helvetica-Oblique').fillColor(MUTED).fontSize(10)
            .text(`Recomendación: ${r.recommendation}`, { align: 'justify' })
        }
      })
    } else {
      doc.fillColor(MUTED).text('No se detectaron riesgos.').fillColor(INK)
    }

    // Disclaimer
    doc.moveDown(1.5)
    doc.moveTo(doc.x, doc.y).lineTo(doc.page.width - doc.page.margins.right, doc.y).strokeColor(LINE).stroke()
    doc.moveDown(0.5)
    doc.font('Helvetica-Oblique').fillColor(MUTED).fontSize(8).text(`⚠ ${DISCLAIMER}`, { align: 'center' })

    doc.end()
  })
}

module.exports = { buildAnalysisPdf }
