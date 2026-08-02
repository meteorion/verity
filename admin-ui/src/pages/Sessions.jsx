import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Card, Table, Badge, Button, Select } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { apiFetch } from '../auth.js'
import { MD_COMPONENTS } from '../components/mdComponents.jsx'

const INTENT_LABEL = {
  after_sales_refund: '售后退款',
  product_inquiry: '产品咨询',
  complaint: '投诉',
  invoice: '发票',
  faq: 'FAQ 精准命中',
  chitchat: '闲聊',
  reject: '安全拦截',
  unknown: '未识别',
}

function fmtTime(ts) {
  if (!ts) return '-'
  const d = new Date(ts * 1000)
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function intentLabel(intent) {
  return INTENT_LABEL[intent] || intent || '-'
}

export default function Sessions() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [filterIntent, setFilterIntent] = useState('全部')
  const [onlyTransferred, setOnlyTransferred] = useState(false)
  const [selected, setSelected] = useState(null)

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/v1/sessions?limit=200')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSessions(data.sessions || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSessions() }, [fetchSessions])

  // Auto-refresh every 15s
  useEffect(() => {
    const id = setInterval(fetchSessions, 15000)
    return () => clearInterval(id)
  }, [fetchSessions])

  const intents = useMemo(() => {
    const set = new Set(sessions.map(s => intentLabel(s.last_intent)))
    return ['全部', ...set]
  }, [sessions])

  const filtered = useMemo(() => {
    return sessions.filter(s => {
      const matchIntent = filterIntent === '全部' || intentLabel(s.last_intent) === filterIntent
      const matchTransfer = !onlyTransferred || s.transferred
      return matchIntent && matchTransfer
    })
  }, [sessions, filterIntent, onlyTransferred])

  const columns = [
    {
      key: 'session_id',
      header: '会话 ID',
      render: (row) => (
        <div>
          <p className="font-mono text-xs text-slate-700 truncate max-w-[160px]">{row.session_id}</p>
          <p className="text-xs text-slate-400 mt-0.5">{row.uid || '匿名'} · {row.region}</p>
        </div>
      ),
    },
    {
      key: 'last_query',
      header: '最近问题',
      render: (row) => (
        <p className="max-w-xs truncate text-sm text-slate-700">{row.last_query || '-'}</p>
      ),
    },
    {
      key: 'last_intent',
      header: '最近意图',
      render: (row) => <Badge tone="blue">{intentLabel(row.last_intent)}</Badge>,
    },
    {
      key: 'turn_count',
      header: '轮次',
      render: (row) => <span className="text-slate-600 font-medium">{row.turn_count}</span>,
    },
    {
      key: 'status',
      header: '状态',
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          {row.transferred
            ? <Badge tone="purple">已转人工</Badge>
            : <Badge tone="green">正常</Badge>
          }
        </div>
      ),
    },
    {
      key: 'updated_at',
      header: '最近活跃',
      render: (row) => <span className="text-xs text-slate-500">{fmtTime(row.updated_at)}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <Card
        title="会话监控"
        action={
          <div className="flex items-center gap-2 text-xs">
            <Select value={filterIntent} onChange={setFilterIntent} options={intents} />
            <label className="flex items-center gap-1.5 text-slate-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyTransferred}
                onChange={e => setOnlyTransferred(e.target.checked)}
              />
              仅看转人工
            </label>
            <button
              onClick={fetchSessions}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 disabled:opacity-50"
            >
              <Icon name="refresh-cw" size={12} className={loading ? 'animate-spin' : ''} />
              刷新
            </button>
          </div>
        }
      >
        {error && (
          <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-3">
            加载失败：{error}
          </div>
        )}
        {!error && sessions.length === 0 && !loading && (
          <div className="text-center text-slate-400 text-sm py-10">
            暂无会话数据，从对话测试或 API 发起对话后将在此展示。
          </div>
        )}
        <Table
          columns={columns}
          rows={filtered}
          rowKey="session_id"
          onRowClick={setSelected}
        />
      </Card>

      {selected && (
        <SessionModal sessionId={selected.session_id} onClose={() => setSelected(null)} />
      )}
    </div>
  )
}

function SessionModal({ sessionId, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`/v1/sessions/${encodeURIComponent(sessionId)}`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-5xl flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">会话详情</h3>
            <p className="text-xs font-mono text-slate-400 mt-0.5">{sessionId}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {loading && (
            <div className="text-center text-slate-400 text-sm py-10">加载中…</div>
          )}
          {error && (
            <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">加载失败：{error}</div>
          )}
          {data && (
            <>
              {/* Session meta */}
              <div className="grid grid-cols-3 gap-3 text-xs bg-slate-50 rounded-lg px-3 py-2.5">
                <Info label="用户 UID" value={data.uid || '匿名'} />
                <Info label="角色" value={(data.roles || []).join(', ') || '-'} />
                <Info label="区域" value={data.region || '-'} />
                <Info label="轮次" value={data.turn_count} />
                <Info label="状态" value={data.transferred ? '已转人工' : '正常'} />
                <Info label="创建时间" value={fmtTime(data.created_at)} />
              </div>

              {/* Conversation turns */}
              <div className="space-y-5">
                {(data.turns || []).map((turn, idx, arr) => (
                  <TurnCard key={turn.turn_id} turn={turn} isLatest={idx === arr.length - 1} />
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end px-5 py-3 border-t border-slate-100 flex-shrink-0">
          <Button size="sm" onClick={onClose}>关闭</Button>
        </div>
      </div>
    </div>
  )
}

function TurnCard({ turn, isLatest }) {
  const [showChunks, setShowChunks] = useState(false)

  return (
    <div className="space-y-2">
      {/* Turn header */}
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="font-medium text-slate-500">第 {turn.turn_id} 轮</span>
        {turn.intent && <Badge tone="blue">{intentLabel(turn.intent)}</Badge>}
        {turn.faq_hit && <Badge tone="green">FAQ 命中</Badge>}
        {turn.cache_hit && <Badge tone="blue">缓存</Badge>}
        {turn.transferred && <Badge tone="purple">转人工</Badge>}
        <div className="ml-auto flex items-center gap-2 shrink-0">
          {turn.first_token_ms != null && (
            <span title="首字延迟">{turn.first_token_ms}ms↑</span>
          )}
          {turn.total_ms != null && (
            <span title="总耗时" className={turn.first_token_ms != null ? 'text-slate-300' : ''}>
              {(turn.total_ms / 1000).toFixed(2)}s
            </span>
          )}
          <span>{fmtTime(turn.created_at)}</span>
        </div>
      </div>

      {/* User bubble */}
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-indigo-50 text-indigo-900 rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed">
          {turn.query}
        </div>
      </div>

      {/* Assistant bubble */}
      <div className="flex justify-start">
        <div className="max-w-[80%] bg-slate-100 text-slate-800 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed">
          {turn.answer
            ? <TurnAnswer answer={turn.answer} />
            : <span className="italic text-slate-400">（无回复）</span>}
        </div>
      </div>

      {/* Transfer reason */}
      {turn.transfer_reason && (
        <div className="text-xs text-violet-600 bg-violet-50 rounded-lg px-3 py-1.5">
          转人工原因：{turn.transfer_reason}
        </div>
      )}

      {/* Chunks toggle */}
      {turn.chunks && turn.chunks.length > 0 && (
        <div>
          <button
            onClick={() => setShowChunks(v => !v)}
            className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
          >
            <Icon name={showChunks ? 'chevron-up' : 'chevron-down'} size={12} />
            {turn.chunks.length} 个引用 Chunk
          </button>
          {showChunks && (
            <div className="mt-1.5 space-y-1">
              {turn.chunks.map((c, i) => (
                <div key={i} className="flex items-start gap-2 text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 font-semibold flex items-center justify-center text-[10px]">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 truncate">{c.title || c.chunk_id}</p>
                    {c.breadcrumb && <p className="text-slate-400 truncate">{c.breadcrumb}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function TurnAnswer({ answer }) {
  return (
    <div className="text-sm text-slate-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
        {answer}
      </ReactMarkdown>
    </div>
  )
}

function Info({ label, value }) {
  return (
    <div>
      <p className="text-slate-400 mb-0.5">{label}</p>
      <p className="text-slate-700 font-medium">{value}</p>
    </div>
  )
}
