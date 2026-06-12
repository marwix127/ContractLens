// Chunking semántico de contratos por cláusulas.
//
// Estrategia: detectar encabezados de cláusula/artículo con regex y partir el
// texto en esos límites. Cada chunk conserva la página donde empieza y la
// referencia de la cláusula, lo que permite citas precisas en el chat RAG.

// Encabezados típicos en contratos (ES): "CLÁUSULA PRIMERA", "Cláusula 1.",
// "Artículo 5", "ESTIPULACIÓN 3ª", etc. Se buscan a principio de línea.
const CLAUSE_HEADER = /^[ \t]*(cl[áa]usula|art[íi]culo|estipulaci[óo]n|secci[óo]n)\b[^\n]*/gim

// Cláusulas muy largas se subdividen para no exceder el contexto del modelo de
// embeddings ni diluir la relevancia en el retrieval.
const MAX_CHARS = 1200
const OVERLAP = 150

// Une las páginas en un solo texto y guarda, para cada posición de carácter,
// a qué página pertenece. Así una cláusula que cruza páginas conserva la
// página donde empezó su encabezado.
function buildText(pages) {
  let fullText = ''
  const pageBreaks = [] // { offset, page }
  for (const page of pages) {
    pageBreaks.push({ offset: fullText.length, page: page.num })
    fullText += page.text + '\n'
  }
  return { fullText, pageBreaks }
}

function pageAt(offset, pageBreaks) {
  let page = pageBreaks[0]?.page ?? 1
  for (const brk of pageBreaks) {
    if (brk.offset <= offset) page = brk.page
    else break
  }
  return page
}

// Subdivide un texto largo en trozos de MAX_CHARS con solapamiento, cortando
// preferentemente en límites de frase para no partir ideas a la mitad.
function splitLong(text) {
  if (text.length <= MAX_CHARS) return [text]
  const parts = []
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + MAX_CHARS, text.length)
    if (end < text.length) {
      const lastStop = text.lastIndexOf('. ', end)
      if (lastStop > start + MAX_CHARS / 2) end = lastStop + 1
    }
    parts.push(text.slice(start, end).trim())
    if (end >= text.length) break
    start = end - OVERLAP
  }
  return parts.filter(p => p.length > 0)
}

// Limpia y resume el encabezado para usarlo como clause_reference.
function clauseRef(headerLine) {
  return headerLine.trim().replace(/\s+/g, ' ').slice(0, 120)
}

function chunkPages(pages) {
  const { fullText, pageBreaks } = buildText(pages)

  // Localizar todos los encabezados de cláusula con su posición.
  const headers = []
  let m
  CLAUSE_HEADER.lastIndex = 0
  while ((m = CLAUSE_HEADER.exec(fullText)) !== null) {
    headers.push({ index: m.index, line: m[0] })
  }

  const segments = []

  // Texto antes de la primera cláusula (preámbulo, partes, etc.).
  if (headers.length === 0 || headers[0].index > 0) {
    const end = headers.length ? headers[0].index : fullText.length
    const preamble = fullText.slice(0, end).trim()
    if (preamble) segments.push({ text: preamble, index: 0, ref: null })
  }

  // Una sección por cada encabezado, hasta el siguiente.
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index
    const end = i + 1 < headers.length ? headers[i + 1].index : fullText.length
    const text = fullText.slice(start, end).trim()
    if (text) segments.push({ text, index: start, ref: clauseRef(headers[i].line) })
  }

  // Expandir segmentos largos y materializar los chunks finales.
  const chunks = []
  for (const seg of segments) {
    for (const piece of splitLong(seg.text)) {
      chunks.push({
        content: piece,
        page_number: pageAt(seg.index, pageBreaks),
        clause_reference: seg.ref
      })
    }
  }

  return chunks
}

module.exports = { chunkPages }
