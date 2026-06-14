const SEVERITY_STYLES = {
  alta: 'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baja: 'bg-slate-100 text-slate-600'
}

// Campos de texto de extracted_data, en orden de presentación.
const FIELDS = [
  ['duration', 'Duración'],
  ['economic_terms', 'Condiciones económicas'],
  ['jurisdiction', 'Jurisdicción y ley aplicable'],
  ['penalties', 'Penalizaciones'],
  ['confidentiality', 'Confidencialidad / no competencia'],
  ['termination', 'Terminación']
]

function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      {children}
    </section>
  )
}

export default function Dashboard({ analysis }) {
  const data = analysis.extracted_data || {}
  const risks = analysis.risks || []

  return (
    <div className="space-y-6">
      <Card title="Resumen ejecutivo">
        <p className="leading-relaxed text-slate-700">{analysis.summary}</p>
      </Card>

      <div className="grid gap-6 sm:grid-cols-2">
        <Card title="Partes involucradas">
          {data.parties?.length ? (
            <ul className="space-y-2">
              {data.parties.map((p, i) => (
                <li key={i} className="text-slate-700">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-slate-500"> — {p.role}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-400">No especificado</p>}
        </Card>

        <Card title="Fechas clave">
          {data.key_dates?.length ? (
            <ul className="space-y-2">
              {data.key_dates.map((d, i) => (
                <li key={i} className="flex justify-between gap-4 text-slate-700">
                  <span className="text-slate-500">{d.label}</span>
                  <span className="font-medium">{d.date}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-slate-400">No especificado</p>}
        </Card>
      </div>

      <Card title="Datos clave">
        <dl className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(([key, label]) => (
            <div key={key}>
              <dt className="text-sm font-medium text-slate-500">{label}</dt>
              <dd className="mt-0.5 text-slate-700">{data[key] || 'No especificado'}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card title={`Riesgos detectados (${risks.length})`}>
        {risks.length ? (
          <ul className="space-y-4">
            {risks.map((r, i) => (
              <li key={i} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <h4 className="font-medium text-slate-800">{r.title}</h4>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLES[r.severity] || SEVERITY_STYLES.baja}`}>
                    {r.severity}
                  </span>
                </div>
                {r.location && <p className="mt-1 text-xs text-slate-400">{r.location}</p>}
                <p className="mt-2 text-sm text-slate-600">{r.explanation}</p>
                {r.recommendation && (
                  <p className="mt-2 text-sm text-slate-600">
                    <span className="font-medium text-slate-700">Recomendación: </span>{r.recommendation}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="text-slate-400">No se detectaron riesgos.</p>}
      </Card>
    </div>
  )
}
