import { useState } from 'react'
import UploadScreen from './components/UploadScreen'
import ContractView from './components/ContractView'
import CompareView from './components/CompareView'

export default function App() {
  const [contract, setContract] = useState(null)
  const [file, setFile] = useState(null)
  const [comparing, setComparing] = useState(false)

  function handleUploaded(contract, file) {
    setContract(contract)
    setFile(file)
  }

  function renderMain() {
    if (contract) {
      return <ContractView contract={contract} file={file} onBack={() => { setContract(null); setFile(null) }} />
    }
    if (comparing) {
      return <CompareView onBack={() => setComparing(false)} />
    }
    return (
      <>
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Sube un contrato para analizarlo</h1>
          <p className="mt-3 text-slate-600">
            Resumen ejecutivo, datos clave, detección de riesgos y chat con citas — en minutos.
          </p>
          <button
            onClick={() => setComparing(true)}
            className="mt-4 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            ¿Tienes dos versiones? Compáralas →
          </button>
        </div>
        <UploadScreen onUploaded={handleUploaded} />
      </>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-6 py-4">
          <button
            onClick={() => { setContract(null); setFile(null); setComparing(false) }}
            className="text-xl font-semibold tracking-tight text-indigo-600"
          >
            ContractLens
          </button>
          <span className="text-sm text-slate-400">· Análisis de contratos con IA</span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        {renderMain()}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <p className="mx-auto max-w-6xl px-6 py-4 text-center text-xs text-slate-500">
          ⚠️ ContractLens proporciona un análisis automatizado con fines informativos. No sustituye el
          asesoramiento de un profesional legal.
        </p>
      </footer>
    </div>
  )
}
