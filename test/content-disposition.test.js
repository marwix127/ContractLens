const test = require('node:test')
const assert = require('node:assert/strict')
const { contentDisposition } = require('../src/http/content-disposition')

test('codifica nombres Unicode y conserva un fallback ASCII', () => {
  const header = contentDisposition('inline', 'Distribución Comercial — v1 (original).pdf')

  assert.equal(
    header,
    'inline; filename="Distribucion Comercial _ v1 (original).pdf"; ' +
      "filename*=UTF-8''Distribuci%C3%B3n%20Comercial%20%E2%80%94%20v1%20%28original%29.pdf"
  )
})

test('evita caracteres de control, comillas y barras en el fallback', () => {
  const header = contentDisposition('attachment', 'contrato\\"\r\n.pdf')

  assert.match(header, /^attachment; filename="contrato____\.pdf";/)
  assert.doesNotMatch(header.split('; filename*=')[0], /[\r\n\\]/)
})

test('rechaza dispositions no previstas', () => {
  assert.throws(() => contentDisposition('form-data', 'contrato.pdf'), /no soportado/)
})
