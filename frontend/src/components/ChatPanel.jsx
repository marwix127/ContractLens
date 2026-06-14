import { useEffect, useRef, useState } from 'react'
import { streamChat } from '../api'

const SUGGESTIONS = [
  '¿Cuáles son los riesgos principales?',
  '¿Cuándo vence el contrato?',
  '¿Qué penalizaciones incluye?'
]

function Citations({ citations }) {
  if (!citations?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {citations.map((c, i) => (
        <span key={i} className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500 ring-1 ring-slate-200">
          Pág. {c.page}{c.clause ? ` · ${c.clause.split('.')[0]}` : ''}
        </span>
      ))}
    </div>
  )
}

export default function ChatPanel({ contractId }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const conversationId = useRef(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Actualiza el último mensaje (el del asistente en curso) de forma inmutable.
  function updateLast(patch) {
    setMessages(prev => {
      const copy = [...prev]
      copy[copy.length - 1] = { ...copy[copy.length - 1], ...patch }
      return copy
    })
  }

  async function send(question) {
    const q = (question ?? input).trim()
    if (!q || streaming) return
    setInput('')
    setStreaming(true)
    setMessages(prev => [
      ...prev,
      { role: 'user', content: q },
      { role: 'assistant', content: '', citations: null, pending: true }
    ])

    let answer = ''
    try {
      await streamChat(contractId, q, conversationId.current, {
        onMeta: (meta) => {
          conversationId.current = meta.conversationId
          updateLast({ citations: meta.citations })
        },
        onDelta: (text) => {
          answer += text
          updateLast({ content: answer, pending: false })
        },
        onError: (msg) => updateLast({ content: `⚠️ ${msg}`, pending: false })
      })
    } catch (err) {
      updateLast({ content: `⚠️ ${err.message}`, pending: false })
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-5 py-3">
        <h3 className="font-semibold text-slate-800">Pregunta sobre el contrato</h3>
        <p className="text-xs text-slate-400">Respuestas con citas a página y cláusula</p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-500">Prueba a preguntar:</p>
            {SUGGESTIONS.map(s => (
              <button
                key={s}
                onClick={() => send(s)}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div className={m.role === 'user'
              ? 'max-w-[85%] rounded-2xl bg-indigo-600 px-4 py-2 text-white'
              : 'max-w-[90%] rounded-2xl bg-slate-100 px-4 py-2 text-slate-800'}>
              {m.pending && !m.content
                ? <span className="inline-flex gap-1 text-slate-400"><Dot /><Dot /><Dot /></span>
                : <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>}
              {m.role === 'assistant' && <Citations citations={m.citations} />}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send() }}
        className="flex gap-2 border-t border-slate-200 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe tu pregunta…"
          className="flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={streaming || !input.trim()}
          className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-slate-300"
        >
          Enviar
        </button>
      </form>
    </div>
  )
}

function Dot() {
  return <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
}
