function encodeRfc5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function asciiFallback(filename) {
  const normalized = filename
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .trim()

  return normalized || 'documento.pdf'
}

function contentDisposition(disposition, filename) {
  if (!['inline', 'attachment'].includes(disposition)) {
    throw new TypeError('Disposition no soportado')
  }

  const original = String(filename || 'documento.pdf')
  return `${disposition}; filename="${asciiFallback(original)}"; filename*=UTF-8''${encodeRfc5987(original)}`
}

module.exports = { contentDisposition }
