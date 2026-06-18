import { useEffect, useState } from 'react'
import { listContracts, compareContracts } from '../api'

const TYPE_STYLES = {
  añadido: 'bg-green-100 text-green-700',
  eliminado: 'bg-red-100 text-red-700',
  modificado: 'bg-amber-100 text-amber-700'
}

const IMPACT_STYLES = {
  alto: 'bg-red-100 text-red-700',
  medio: 'bg-amber-100 text-amber-700',
  bajo: 'bg-slate-100 text-slate-600'
}

function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      {title && <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>}
      {children}
    </section>
  )
}

export default function CompareView({ onBack }) {
  const [contracts, setContracts] = useState([])
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    listContracts().then(setContracts).catch(() => {})
  }, [])

  async function handleCompare() {
    if (!fromId || !toId || fromId === toId || loading) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      setResult(await compareContracts(fromId, toId))
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const sameSelected = fromId && toId && fromId === toId

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Comparar versiones</h1>
          <p className="text-sm text-slate-400">Detecta qué cambió entre dos versiones de un contrato</p>
        </div>
        <button
          onClick={onBack}
          className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Volver
        </button>
      </div>

      <Card>
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-end">
          <Selector label="Versión anterior" value={fromId} onChange={setFromId} contracts={contracts} />
          <div className="hidden pb-2 text-slate-400 sm:block">→</div>
          <Selector label="Versión nueva" value={toId} onChange={setToId} contracts={contracts} />
        </div>
        {sameSelected && (
          <p className="mt-3 text-sm text-amber-600">Selecciona dos contratos distintos.</p>
        )}
        <button
          onClick={handleCompare}
          disabled={!fromId || !toId || sameSelected || loading}
          className="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {loading ? 'Comparando…' : 'Comparar'}
        </button>
        {loading && (
          <p className="mt-3 text-center text-sm text-slate-500">
            La IA está leyendo ambos contratos y detectando los cambios. Puede tardar entre 10 segundos y un minuto.
          </p>
        )}
      </Card>

      {error && (
        <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      {result && (
        <div className="mt-6 space-y-6">
          <Card title="Resumen de cambios">
            <p className="leading-relaxed text-slate-700">{result.summary}</p>
          </Card>

          <Card title={`Cambios detectados (${result.changes?.length || 0})`}>
            {result.changes?.length ? (
              <ul className="space-y-4">
                {result.changes.map((c, i) => (
                  <li key={i} className="rounded-xl border border-slate-200 p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${TYPE_STYLES[c.type] || ''}`}>{c.type}</span>
                      <span className="font-medium text-slate-800">{c.category}</span>
                      <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${IMPACT_STYLES[c.impact] || IMPACT_STYLES.bajo}`}>
                        impacto {c.impact}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{c.description}</p>
                    {(c.before || c.after) && (
                      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                        <div className="rounded-lg bg-red-50 p-2 text-red-800">
                          <span className="text-xs font-medium uppercase text-red-400">Antes</span>
                          <p>{c.before || '—'}</p>
                        </div>
                        <div className="rounded-lg bg-green-50 p-2 text-green-800">
                          <span className="text-xs font-medium uppercase text-green-500">Después</span>
                          <p>{c.after || '—'}</p>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            ) : <p className="text-slate-400">No se detectaron cambios sustantivos.</p>}
          </Card>

          <Card title="Cambio en el perfil de riesgo">
            <p className="leading-relaxed text-slate-700">{result.risk_assessment}</p>
          </Card>

          {result.disclaimer && (
            <p className="text-center text-xs text-slate-400">{result.disclaimer}</p>
          )}
        </div>
      )}
    </div>
  )
}

function Selector({ label, value, onChange, contracts }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
      >
        <option value="">Selecciona un contrato…</option>
        {contracts.map((c) => (
          <option key={c.id} value={c.id}>{c.filename}</option>
        ))}
      </select>
    </label>
  )
}
