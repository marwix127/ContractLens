// Prueba el servicio de embeddings: genera vectores y comprueba que
// textos relacionados tienen mayor similitud que textos no relacionados.
require('dotenv').config()
const { embedDocuments, embedQuery, DIMENSIONS } = require('../src/services/embeddings')

function cosine(a, b) {
  return a.reduce((sum, v, i) => sum + v * b[i], 0)
}

async function main() {
  const docs = [
    'CLAUSULA 4. Jurisdiccion. Tribunales de Barcelona, ley espanyola.',
    'CLAUSULA 3. Precio. 1.500 euros mensuales, pagaderos a 30 dias.'
  ]
  const vectors = await embedDocuments(docs)
  console.log('dimensiones:', vectors[0].length, '(esperado:', DIMENSIONS + ')')

  const norm = Math.sqrt(vectors[0].reduce((s, v) => s + v * v, 0))
  console.log('norma del vector:', norm.toFixed(6), '(esperado: ~1.0)')

  const query = await embedQuery('¿Qué tribunales son competentes en caso de disputa?')
  console.log('similitud con cláusula de jurisdicción:', cosine(query, vectors[0]).toFixed(4))
  console.log('similitud con cláusula de precio:      ', cosine(query, vectors[1]).toFixed(4))
  console.log('(la primera debería ser claramente mayor)')
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
