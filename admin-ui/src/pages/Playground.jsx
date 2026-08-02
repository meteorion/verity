import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Card, Badge, Button, Select } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { apiFetch } from '../auth.js'
import { MD_COMPONENTS } from '../components/mdComponents.jsx'

// 调试台：
//   "运行测试"  → POST /v1/chat  SSE 流式，展示首字延迟
//   "调试运行"  → POST /v1/debug 非流式，额外返回 chunks / trace

export default function Playground() {
  const [query, setQuery] = useState('')
  const [role, setRole] = useState('agent')
  const [projectGroup, setProjectGroup] = useState('')
  const [groups, setGroups] = useState([])
  const [topK, setTopK] = useState(6)
  const [temperature, setTemperature] = useState(0.2)

  useEffect(() => {
    apiFetch('/api/ops/groups')
      .then((r) => r.json())
      .then((d) => setGroups(d.groups ?? []))
      .catch(() => {})
  }, [])

  // streaming state
  const [streaming, setStreaming] = useState(false)
  const [answer, setAnswer] = useState('')
  const [refs, setRefs] = useState([])
  const [firstTokenMs, setFirstTokenMs] = useState(null)
  const [totalMs, setTotalMs] = useState(null)
  const [streamMeta, setStreamMeta] = useState(null)  // {cache_hit, faq_hit, intent}
  const [streamError, setStreamError] = useState(null)
  const [sessionId, setSessionId] = useState(() => `play_${Date.now()}`)
  const abortRef = useRef(null)
  // debug state
  const [debugging, setDebugging] = useState(false)
  const [debugResult, setDebugResult] = useState(null)
  const [debugError, setDebugError] = useState(null)

  // ── new session ───────────────────────────────────────────
  function newSession() {
    setSessionId(`play_${Date.now()}`)
    setAnswer('')
    setRefs([])
    setFirstTokenMs(null)
    setTotalMs(null)
    setStreamMeta(null)
    setStreamError(null)
    setDebugResult(null)
    setDebugError(null)
  }

  // ── streaming run ─────────────────────────────────────────
  async function runStream() {
    if (streaming) { abortRef.current?.abort(); return }

    setStreaming(true)
    setAnswer('')
    setRefs([])
    setFirstTokenMs(null)
    setTotalMs(null)
    setStreamMeta(null)
    setStreamError(null)
    setDebugResult(null)

    const t0 = performance.now()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      const res = await apiFetch('/v1/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UID': 'debug_user',
          'X-Roles': role,
          'X-Region': 'default',
          ...(projectGroup ? { 'X-Project-Group': projectGroup } : {}),
        },
        body: JSON.stringify({ session_id: sessionId, message: query, stream: true, options: { top_k: topK, temperature } }),
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)

      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      let firstToken = true

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
            try { setRefs(JSON.parse(payload.slice(6))) } catch {}
            continue
          }
          if (payload.startsWith('[META]')) {
            try { setStreamMeta(JSON.parse(payload.slice(6))) } catch {}
            continue
          }
          if (firstToken) { setFirstTokenMs(Math.round(performance.now() - t0)); firstToken = false }
          try { setAnswer((p) => p + JSON.parse(payload)) } catch { setAnswer((p) => p + payload) }
        }
      }
      setTotalMs(Math.round(performance.now() - t0))
    } catch (e) {
      if (e.name !== 'AbortError') setStreamError(e.message)
    } finally {
      setStreaming(false)
    }
  }

  // ── debug run ─────────────────────────────────────────────
  async function runDebug() {
    if (debugging) return

    setDebugging(true)
    setAnswer('')
    setRefs([])
    setDebugResult(null)
    setDebugError(null)
    setFirstTokenMs(null)
    setTotalMs(null)
    setStreamMeta(null)

    try {
      const res = await apiFetch('/v1/debug', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-UID': 'debug_user',
          'X-Roles': role,
          'X-Region': 'default',
          ...(projectGroup ? { 'X-Project-Group': projectGroup } : {}),
        },
        body: JSON.stringify({ session_id: sessionId, message: query, options: { top_k: topK, temperature } }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      const data = await res.json()
      setAnswer(data.answer || '')
      setRefs(data.refs || [])
      setTotalMs(data.total_ms)
      setDebugResult(data)
    } catch (e) {
      setDebugError(e.message)
    } finally {
      setDebugging(false)
    }
  }

  const hasResult = answer || streaming || debugging || streamError || debugError

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
      {/* ── Left: input + answer ── */}
      <div className="xl:col-span-2 space-y-5">
        <Card title="测试输入">
          <div className="space-y-3">
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={4}
              disabled={streaming || debugging}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300 disabled:bg-slate-50"
              placeholder="输入模拟用户问题…"
            />
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <label className="flex items-center gap-1.5">
                  Top-K
                  <input type="number" value={topK} onChange={(e) => setTopK(Number(e.target.value))}
                    className="w-14 border border-slate-200 rounded px-1.5 py-0.5" />
                </label>
                <label className="flex items-center gap-1.5" title="0 = 确定性输出，>0 = 随机采样">
                  temperature
                  <input type="number" step="0.1" min="0" max="1" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))}
                    className="w-14 border border-slate-200 rounded px-1.5 py-0.5" />
                </label>
                <label className="flex items-center gap-1.5">
                  身份角色
                  <Select value={role} onChange={setRole} options={['customer', 'agent']} />
                </label>
                <label className="flex items-center gap-1.5">
                  项目组
                  <Select
                    value={projectGroup}
                    onChange={setProjectGroup}
                    options={[
                      { value: '', label: '不限' },
                      ...groups.map((g) => ({ value: g.group_id, label: g.name })),
                    ]}
                  />
                </label>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={newSession} disabled={streaming || debugging} title="开启新会话，清空当前结果">
                  <Icon name="plus" size={14} />
                  新会话
                </Button>
                <Button variant={streaming ? 'danger' : 'default'} size="sm" onClick={runStream} disabled={debugging}>
                  <Icon name={streaming ? 'x' : 'play'} size={14} />
                  {streaming ? '停止' : '运行测试'}
                </Button>
                <Button variant="primary" size="sm" onClick={runDebug} disabled={streaming || debugging}>
                  <Icon name="search" size={14} />
                  {debugging ? '调试中…' : '调试运行'}
                </Button>
              </div>
            </div>
          </div>
        </Card>

        <Card title="生成结果">
          {!hasResult && (
            <p className="text-sm text-slate-400">运行测试后在此处查看结果</p>
          )}
          {(streaming || debugging) && !answer && (
            <p className="text-sm text-slate-400 animate-pulse">正在检索与生成…</p>
          )}
          {(answer || streaming) && (
            <div>
              <AnswerText text={answer} streaming={streaming} />
              {refs.length > 0 && <RefList refs={refs} />}
            </div>
          )}
          {(streamError || debugError) && (
            <p className="text-sm text-red-500">错误：{streamError || debugError}</p>
          )}
          {debugResult && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-2 text-xs text-slate-500">
              <span>意图：<span className="font-medium text-slate-700">{debugResult.intent ?? '—'}</span></span>
              {debugResult.faq_hit && <Badge tone="green">FAQ 命中</Badge>}
              {debugResult.cache_hit && <Badge tone="blue">语义缓存命中</Badge>}
              <span>总耗时：<span className="font-medium text-slate-700">{debugResult.total_ms} ms</span></span>
            </div>
          )}
        </Card>

        {/* Chunks — only after debug run */}
        {debugResult?.chunks?.length > 0 && (
          <Card title={`检索命中片段（${debugResult.chunks.length} 个）`}>
            <div className="space-y-3">
              {debugResult.chunks.map((c, i) => (
                <div key={c.chunk_id ?? i} className="border border-slate-100 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 text-[10px] font-semibold rounded-full bg-indigo-100 text-indigo-600">{i + 1}</span>
                      <p className="text-xs text-slate-400 truncate">{c.breadcrumb || c.title || c.doc_id}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {c.source_url && (
                        <a href={c.source_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-indigo-400 hover:text-indigo-600" title={c.source_url}>↗</a>
                      )}
                      {c.score != null && (
                        <Badge tone={c.score >= 0.8 ? 'green' : c.score >= 0.65 ? 'amber' : 'red'}>
                          {c.score.toFixed(3)}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-slate-700 line-clamp-4">{c.content}</p>
                  <p className="text-xs text-slate-400 mt-1 font-mono">{c.chunk_id}</p>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* ── Right: latency + trace ── */}
      <div className="space-y-5">
        <Card title="延迟 & 指标">
          <div className="space-y-3 text-sm">
            <Metric label="首字延迟"
              value={firstTokenMs != null ? `${firstTokenMs} ms` : '—'}
              tone={firstTokenMs != null ? (firstTokenMs > 2000 ? 'amber' : 'green') : 'slate'} />
            <Metric label="总耗时"
              value={totalMs != null ? `${(totalMs / 1000).toFixed(2)} s` : '—'}
              tone="slate" />
            {(streamMeta || debugResult) && <>
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <Metric label="语义缓存"
                  value={(streamMeta ?? debugResult).cache_hit ? '命中' : '未命中'}
                  tone={(streamMeta ?? debugResult).cache_hit ? 'green' : 'slate'} />
                <Metric label="FAQ 命中"
                  value={(streamMeta ?? debugResult).faq_hit ? '命中' : '未命中'}
                  tone={(streamMeta ?? debugResult).faq_hit ? 'green' : 'slate'} />
                {(streamMeta ?? debugResult).intent && (
                  <Metric label="识别意图"
                    value={(streamMeta ?? debugResult).intent}
                    tone="slate" />
                )}
              </div>
            </>}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs text-slate-400">Session ID</p>
                <button
                  onClick={newSession}
                  disabled={streaming || debugging}
                  className="text-[10px] text-indigo-400 hover:text-indigo-600 disabled:opacity-40"
                  title="开启新会话"
                >
                  + 新会话
                </button>
              </div>
              <p className="text-xs font-mono text-slate-500 break-all">{sessionId}</p>
            </div>
          </div>
        </Card>

        <Card title="全链路 Trace">
          {!debugResult ? (
            <p className="text-xs text-slate-400">点击"调试运行"后显示各节点耗时</p>
          ) : debugResult.spans.length === 0 ? (
            <p className="text-xs text-slate-400">无 span 数据</p>
          ) : (
            <div className="space-y-2.5">
              {debugResult.spans.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div>
                    <p className="text-slate-700 font-medium">{t.span}</p>
                    <p className="text-slate-400">{t.detail}</p>
                  </div>
                  <span className={`font-medium tabular-nums ${t.latency_ms > 500 ? 'text-amber-600' : 'text-slate-500'}`}>
                    {t.latency_ms} ms
                  </span>
                </div>
              ))}
              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-sm">
                <span className="text-slate-500">合计</span>
                <span className="font-semibold text-emerald-600">{(debugResult.total_ms / 1000).toFixed(2)} s</span>
              </div>
            </div>
          )}
        </Card>

        <Card title="安全与合规">
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-center gap-2">
              <Icon name="check" size={14} className="text-emerald-500" />
              ACL 过滤：{role} 角色仅命中 public 知识
            </li>
            <li className="flex items-center gap-2">
              <Icon name="check" size={14} className="text-emerald-500" />
              提示注入扫描：词表过滤已启用
            </li>
            <li className="flex items-center gap-2">
              <Icon name="alert" size={14} className="text-amber-500" />
              NLI 校验：由 NLI_PROVIDER 环境变量决定
            </li>
          </ul>
        </Card>
      </div>
    </div>
  )
}

function Metric({ label, value, tone = 'slate' }) {
  const toneText = { slate: 'text-slate-700', green: 'text-emerald-600', amber: 'text-amber-600' }
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${toneText[tone]}`}>{value}</span>
    </div>
  )
}

function AnswerText({ text, streaming }) {
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

function RefList({ refs }) {
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
