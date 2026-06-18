import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { getAnalysis, analyzeContract, fileUrl, analysisPdfUrl } from '../api'
import Dashboard from './Dashboard'
import ChatPanel from './ChatPanel'

// El visor arrastra pdf.js (~1 MB); se carga solo al abrir la pestaña Documento.
const PdfViewer = lazy(() => import('./PdfViewer'))

export default function ContractView({ contract, file, onBack }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('analisis')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Reutiliza el análisis guardado; si no existe, lo genera.
      let result = await getAnalysis(contract.id)
      if (!result) result = await analyzeContract(contract.id)
      setAnalysis(result)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [contract.id])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{contract.filename}</h1>
          <p className="text-sm text-slate-400">{contract.total_pages} páginas</p>
        </div>
        <div className="flex gap-2">
          {analysis && (
            <a
              href={analysisPdfUrl(contract.id)}
              className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
            >
              Exportar PDF
            </a>
          )}
          <button
            onClick={onBack}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Subir otro
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-20">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-indigo-600" />
          <p className="mt-4 text-slate-600">Analizando el contrato con IA…</p>
          <p className="mt-1 text-sm text-slate-400">Resumen, datos clave y detección de riesgos.</p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-700">{error}</p>
          <button
            onClick={load}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      )}

      {analysis && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <div>
            <div className="mb-4 inline-flex rounded-xl border border-slate-200 bg-white p-1">
              <TabButton active={tab === 'analisis'} onClick={() => setTab('analisis')}>Análisis</TabButton>
              <TabButton active={tab === 'documento'} onClick={() => setTab('documento')}>Documento</TabButton>
            </div>
            {tab === 'analisis' ? (
              <Dashboard analysis={analysis} />
            ) : (
              <Suspense fallback={<p className="py-10 text-center text-slate-500">Cargando visor…</p>}>
                {/* File en memoria si lo acabamos de subir; si no (ejemplos), lo sirve el backend. */}
                <PdfViewer file={file || fileUrl(contract.id)} />
              </Suspense>
            )}
          </div>
          <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-9rem)]">
            <ChatPanel contractId={contract.id} />
          </div>
        </div>
      )}
    </div>
  )
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-4 py-1.5 text-sm font-medium transition
        ${active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
    >
      {children}
    </button>
  )
}
