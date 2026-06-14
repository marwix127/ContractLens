import { useEffect, useState } from 'react'
import { getAnalysis, analyzeContract } from '../api'
import Dashboard from './Dashboard'
import ChatPanel from './ChatPanel'

export default function ContractView({ contract, onBack }) {
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Reutiliza el análisis guardado; si no existe, lo genera.
        let result = await getAnalysis(contract.id)
        if (!result) result = await analyzeContract(contract.id)
        if (!cancelled) setAnalysis(result)
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [contract.id])

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{contract.filename}</h1>
          <p className="text-sm text-slate-400">{contract.total_pages} páginas</p>
        </div>
        <button
          onClick={onBack}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Subir otro
        </button>
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
            onClick={() => window.location.reload()}
            className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      )}

      {analysis && (
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <Dashboard analysis={analysis} />
          <div className="lg:sticky lg:top-6 lg:h-[calc(100vh-9rem)]">
            <ChatPanel contractId={contract.id} />
          </div>
        </div>
      )}
    </div>
  )
}
