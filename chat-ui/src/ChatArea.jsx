import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getToken } from './auth.js'

const MD_COMPONENTS = {
  p:          ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul:         ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol:         ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li:         ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1:         ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2:         ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0">{children}</h2>,
  h3:         ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
  strong:     ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em:         ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 pl-3 my-2 text-slate-500 italic">{children}</blockquote>,
  a:          ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all">{children}</a>,
  hr:         () => <hr className="my-3 border-slate-200" />,
  code:       ({ inline, className, children }) => inline
    ? <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-mono">{children}</code>
    : <pre className="my-2 p-3 rounded-lg bg-slate-800 text-slate-100 text-xs font-mono overflow-x-auto whitespace-pre"><code className={className}>{children}</code></pre>,
  table:      ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
  th:         ({ children }) => <th className="border border-slate-200 px-2 py-1 bg-slate-50 font-semibold text-left">{children}</th>,
  td:         ({ children }) => <td className="border border-slate-200 px-2 py-1">{children}</td>,
}

// ── Citation helpers ──────────────────────────────────────────────────────

function MarkdownContent({ text, streaming }) {
  return (
    <div className="text-sm text-slate-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {text}
      </ReactMarkdown>
      {streaming && (
        <span className="inline-block w-0.5 h-3.5 bg-indigo-400 ml-0.5 align-text-bottom animate-pulse" />
      )}
    </div>
  )
}

function Sources({ refs }) {
  if (!refs.length) return null
  return (
    <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5">
      <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-2">
        引用了 {refs.length} 个来源
      </p>
      {refs.map((ref) => {
        const label = ref.breadcrumb?.split(' > ')[0].trim() || ref.title || `来源 ${ref.idx}`
        return (
          <div key={ref.idx} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-50 text-indigo-500 font-semibold text-[10px] mt-px">
              {ref.idx}
            </span>
            {ref.source_url
              ? <a href={ref.source_url} target="_blank" rel="noopener noreferrer"
                  className="text-indigo-500 hover:text-indigo-700 hover:underline break-all leading-relaxed">
                  {label}
                </a>
              : <span className="text-slate-500 break-all leading-relaxed">{label}</span>
            }
          </div>
        )
      })}
    </div>
  )
}

// ── Message components ────────────────────────────────────────────────────

function UserMessage({ text }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] bg-slate-100 text-slate-800 rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
        {text}
      </div>
    </div>
  )
}

function AssistantMessage({ msg }) {
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="shrink-0 w-7 h-7 rounded-full bg-indigo-600 flex items-center justify-center mt-0.5">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2"/>
          <circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
          <circle cx="8" cy="16" r="1" fill="white" stroke="none"/>
          <circle cx="16" cy="16" r="1" fill="white" stroke="none"/>
        </svg>
      </div>

      <div className="flex-1 min-w-0 pt-0.5">
        {msg.text ? (
          <>
            <MarkdownContent text={msg.text} streaming={!msg.done} />
            {msg.done && <Sources refs={msg.refs} />}
          </>
        ) : (
          <span className="inline-flex items-center gap-1 text-slate-400 text-sm">
            {msg.done
              ? <span className="italic text-xs">（无回复）</span>
              : [0,1,2].map(i => (
                  <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
                ))
            }
          </span>
        )}
      </div>
    </div>
  )
}

// ── Welcome screen ────────────────────────────────────────────────────────

const SUGGESTIONS = ['怎么申请退款？', '如何成为代理商？', '发票怎么开？', '售后服务流程是什么？']

function Welcome({ onSuggest }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-4 pb-20">
      <div className="w-16 h-16 rounded-3xl bg-indigo-600 flex items-center justify-center mb-5 shadow-xl shadow-indigo-200">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2"/>
          <circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>
          <circle cx="8" cy="16" r="1" fill="white" stroke="none"/>
          <circle cx="16" cy="16" r="1" fill="white" stroke="none"/>
        </svg>
      </div>
      <h1 className="text-2xl font-semibold text-slate-800 mb-2">有什么可以帮您？</h1>
      <p className="text-sm text-slate-500 mb-8">我是智能客服助手，可以解答您关于业务的各类问题</p>
      <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
        {SUGGESTIONS.map(s => (
          <button
            key={s}
            onClick={() => onSuggest(s)}
            className="text-left text-sm text-slate-600 bg-white border border-slate-200 rounded-xl px-4 py-3 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-all shadow-sm leading-relaxed"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Chat Area ─────────────────────────────────────────────────────────────

export default function ChatArea({ conv, onMessage, onToggleSidebar }) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [localMsgs, setLocalMsgs] = useState([])
  const abortRef         = useRef(null)
  const bottomRef        = useRef(null)
  const inputRef         = useRef(null)
  const textareaRef      = useRef(null)
  const sendingSessionRef = useRef(null)  // tracks the session currently being sent

  // Sync messages when user switches to a DIFFERENT conversation from sidebar.
  // Skip when conv.id matches the session we just created in send().
  useEffect(() => {
    if (sendingSessionRef.current && sendingSessionRef.current === conv?.id) return
    setLocalMsgs(conv?.messages || [])
    setStreaming(false)
    abortRef.current?.abort()
  }, [conv?.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [localMsgs])

  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }

  async function send(text) {
    const query = (text ?? input).trim()
    if (!query || streaming) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const sessionId = conv?.id || `chat_${Date.now()}_${Math.random().toString(36).slice(2,7)}`
    sendingSessionRef.current = sessionId  // prevent useEffect from aborting this send

    const userMsg   = { id: Date.now(),     role: 'user',      text: query, refs: [], done: true }
    const asstId    = Date.now() + 1
    const asstMsg   = { id: asstId,         role: 'assistant', text: '',    refs: [], done: false }

    const nextMsgs = [...localMsgs, userMsg, asstMsg]
    setLocalMsgs(nextMsgs)
    setStreaming(true)

    // Notify parent: creates/updates conversation entry
    onMessage(sessionId, [...localMsgs, userMsg], query)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const token = getToken()
      const res = await fetch('/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ session_id: sessionId, message: query, stream: true, options: { top_k: 6, temperature: 0.2 } }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const reader = res.body.getReader()
      const dec    = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const events = buf.split('\n\n')
        buf = events.pop() ?? ''

        for (const ev of events) {
          const line = ev.trim()
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6)
          if (payload === '[DONE]') continue
          if (payload.startsWith('[REFS]')) {
            try {
              const refs = JSON.parse(payload.slice(6))
              let refsUpdated = []
              setLocalMsgs(prev => {
                refsUpdated = prev.map(m => m.id === asstId ? { ...m, refs, done: true } : m)
                return refsUpdated
              })
              onMessage(sessionId, refsUpdated.filter(m => m.done || m.id !== asstId), query)
            } catch {}
            continue
          }
          try {
            const token = JSON.parse(payload)
            setLocalMsgs(prev => prev.map(m => m.id === asstId ? { ...m, text: m.text + token } : m))
          } catch {
            setLocalMsgs(prev => prev.map(m => m.id === asstId ? { ...m, text: m.text + payload } : m))
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        setLocalMsgs(prev => prev.map(m =>
          m.id === asstId ? { ...m, text: '抱歉，请求出现错误，请稍后重试。', done: true } : m
        ))
      }
    } finally {
      sendingSessionRef.current = null
      let finalMsgs = []
      setLocalMsgs(prev => {
        finalMsgs = prev.map(m => m.id === asstId && !m.done ? { ...m, done: true } : m)
        return finalMsgs
      })
      onMessage(sessionId, finalMsgs.filter(m => m.role === 'user' || m.done), null)
      setStreaming(false)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const messages = localMsgs

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Top bar (mobile hamburger) */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 lg:hidden">
        <button onClick={onToggleSidebar} className="text-slate-500 hover:text-slate-800 p-1">
          <MenuIcon />
        </button>
        <span className="text-sm font-medium text-slate-700">智能客服</span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0
          ? <Welcome onSuggest={q => send(q)} />
          : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
              {messages.map(msg =>
                msg.role === 'user'
                  ? <UserMessage key={msg.id} text={msg.text} />
                  : <AssistantMessage key={msg.id} msg={msg} />
              )}
              <div ref={bottomRef} />
            </div>
          )
        }
      </div>

      {/* Input bar */}
      <div className="border-t border-slate-100 bg-white px-4 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-3 border border-slate-200 rounded-2xl px-4 py-3 bg-white focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all shadow-sm">
            <textarea
              ref={el => { textareaRef.current = el; inputRef.current = el }}
              value={input}
              onChange={e => { setInput(e.target.value); resizeTextarea() }}
              onKeyDown={handleKeyDown}
              disabled={streaming}
              rows={1}
              placeholder="发送消息…（Shift+Enter 换行）"
              className="flex-1 bg-transparent text-sm text-slate-800 resize-none focus:outline-none placeholder:text-slate-300 leading-relaxed disabled:opacity-60 max-h-40"
              style={{ minHeight: '24px' }}
            />
            <button
              onClick={() => send()}
              disabled={!input.trim() || streaming}
              className="shrink-0 w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-300 text-white flex items-center justify-center transition-colors"
            >
              {streaming ? <StopIcon /> : <SendIcon />}
            </button>
          </div>
          <p className="text-center text-[11px] text-slate-300 mt-2">
            AI 回复仅供参考，如需人工服务请联系客服
          </p>
        </div>
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9l20-7z"/>
    </svg>
  )
}
function StopIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2"/>
    </svg>
  )
}
function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  )
}
