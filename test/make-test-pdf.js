// Genera un PDF mínimo válido de 2 páginas para probar el endpoint de upload.
const fs = require('fs')
const path = require('path')

const page1Text = [
  'CONTRATO DE PRESTACION DE SERVICIOS',
  'CLAUSULA 1. Objeto. El presente contrato tiene por objeto la prestacion',
  'de servicios de consultoria informatica.',
  'CLAUSULA 2. Duracion. Un anyo desde la fecha de firma, renovable.'
]
const page2Text = [
  'CLAUSULA 3. Precio. 1.500 euros mensuales, pagaderos a 30 dias.',
  'CLAUSULA 4. Jurisdiccion. Tribunales de Barcelona, ley espanyola.',
  'Firmado el 1 de junio de 2026.'
]

function contentStream(lines) {
  const ops = lines.map((l, i) => `${i === 0 ? '72 720 Td' : '0 -20 Td'} (${l}) Tj`).join(' ')
  return `BT /F1 11 Tf ${ops} ET`
}

const streams = [contentStream(page1Text), contentStream(page2Text)]

const objects = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
  `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,
  `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
]

let pdf = '%PDF-1.4\n'
const offsets = []
objects.forEach((obj, i) => {
  offsets.push(pdf.length)
  pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`
})

const xrefStart = pdf.length
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
offsets.forEach(o => { pdf += `${String(o).padStart(10, '0')} 00000 n \n` })
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

const out = path.join(__dirname, 'contrato-test.pdf')
fs.writeFileSync(out, pdf, 'latin1')
console.log('PDF generado:', out, `(${pdf.length} bytes)`)
