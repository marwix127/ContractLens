import { useEffect, useRef, useState } from 'react'
import { uploadContract, listSamples } from '../api'

export default function UploadScreen({ onUploaded }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [samples, setSamples] = useState([])

  useEffect(() => {
    listSamples().then(setSamples).catch(() => {})
  }, [])

  const MAX_BYTES = 20 * 1024 * 1024 // 20 MB, igual que el límite del backend

  function pickFile(f) {
    setError(null)
    if (!f) return
    if (f.type !== 'application/pdf') {
      setError('Solo se aceptan archivos PDF.')
      return
    }
    if (f.size > MAX_BYTES) {
      setError('El archivo supera el límite de 20 MB.')
      return
    }
    setFile(f)
  }

  function onDrop(e) {
    e.preventDefault()
    setDragging(false)
    pickFile(e.dataTransfer.files?.[0])
  }

  async function handleUpload() {
    if (!file || loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await uploadContract(file)
      onUploaded(result.contract, file)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed p-10 text-center transition
          ${dragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-300 bg-white hover:border-indigo-400'}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => pickFile(e.target.files?.[0])}
        />
        <svg className="mx-auto mb-4 h-12 w-12 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        {file ? (
          <p className="font-medium text-slate-700">{file.name}</p>
        ) : (
          <>
            <p className="font-medium text-slate-700">Arrastra un contrato en PDF aquí</p>
            <p className="mt-1 text-sm text-slate-500">o haz clic para seleccionarlo</p>
          </>
        )}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <button
        onClick={handleUpload}
        disabled={!file || loading}
        className="mt-6 w-full rounded-xl bg-indigo-600 px-4 py-3 font-medium text-white transition
          hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {loading ? 'Procesando contrato…' : 'Analizar contrato'}
      </button>

      {loading && (
        <p className="mt-3 text-center text-sm text-slate-500">
          Extrayendo texto, generando embeddings e indexando. Puede tardar unos segundos.
        </p>
      )}

      {samples.length > 0 && (
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-3 text-sm text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            o prueba con un ejemplo
            <span className="h-px flex-1 bg-slate-200" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {samples.map((s) => (
              <button
                key={s.id}
                onClick={() => onUploaded(s, null)}
                className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-indigo-400 hover:shadow-sm"
              >
                <svg className="mb-2 h-6 w-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                </svg>
                <p className="text-sm font-medium leading-snug text-slate-700">{s.filename.replace('.pdf', '')}</p>
                <p className="mt-1 text-xs text-slate-400">{s.total_pages} págs · ejemplo</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
