// Verifica el chunker de forma aislada (sin API ni BD).
const { chunkPages } = require('../src/services/chunking')

const pages = [
  {
    num: 1,
    text: [
      'CONTRATO DE PRESTACION DE SERVICIOS',
      'Entre ACME S.L. (el Cliente) y Juan Perez (el Proveedor).',
      'CLAUSULA 1. Objeto. El presente contrato regula la prestacion de servicios de consultoria.',
      'CLAUSULA 2. Duracion. Un anyo desde la firma, con renovacion automatica salvo preaviso.'
    ].join('\n')
  },
  {
    num: 2,
    text: [
      'CLAUSULA 3. Precio. 1.500 euros mensuales pagaderos a 30 dias.',
      'Articulo 4. Jurisdiccion. Tribunales de Barcelona, ley espanyola.',
      'CLAUSULA 5. Confidencialidad. Las partes guardaran secreto sobre la informacion intercambiada.'
    ].join('\n')
  }
]

const chunks = chunkPages(pages)
console.log('total chunks:', chunks.length)
console.log('')
for (const c of chunks) {
  console.log(`[pag ${c.page_number}] ref="${c.clause_reference}"`)
  console.log('   ', c.content.slice(0, 70).replace(/\n/g, ' ') + '...')
}
