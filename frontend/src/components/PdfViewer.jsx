import { useEffect, useRef, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/Page/AnnotationLayer.css'
import 'react-pdf/dist/Page/TextLayer.css'

// Worker de pdf.js servido por Vite desde el propio bundle.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export default function PdfViewer({ file }) {
  const containerRef = useRef(null)
  const [width, setWidth] = useState(0)
  const [numPages, setNumPages] = useState(0)
  const [error, setError] = useState(false)

  // Ajustar el ancho de las páginas al del contenedor.
  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width)
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  if (!file) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-500">
        El documento original no está disponible en esta sesión.
        <br />
        Vuelve a subirlo para visualizarlo.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="rounded-2xl border border-slate-200 bg-slate-100 p-4">
      {error ? (
        <p className="py-10 text-center text-red-600">No se pudo cargar el PDF.</p>
      ) : (
        <Document
          file={file}
          onLoadSuccess={({ numPages }) => setNumPages(numPages)}
          onLoadError={() => setError(true)}
          loading={<p className="py-10 text-center text-slate-500">Cargando documento…</p>}
        >
          <div className="space-y-4">
            {Array.from({ length: numPages }, (_, i) => (
              <div key={i} className="overflow-hidden rounded-lg shadow-sm">
                <Page
                  pageNumber={i + 1}
                  width={width ? width - 32 : undefined}
                  renderAnnotationLayer={false}
                />
                <p className="bg-white py-1 text-center text-xs text-slate-400">
                  Página {i + 1} de {numPages}
                </p>
              </div>
            ))}
          </div>
        </Document>
      )}
    </div>
  )
}
