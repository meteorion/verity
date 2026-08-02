import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../auth.js'
import Icon from '../components/Icon.jsx'

const STATUS_LABELS = {
  open:       { label: '待处理', cls: 'bg-amber-100 text-amber-700' },
  notified:   { label: '已通知', cls: 'bg-blue-100 text-blue-700' },
  processing: { label: '处理中', cls: 'bg-indigo-100 text-indigo-700' },
  escalated:  { label: '已升级', cls: 'bg-red-100 text-red-700' },
  resolved:   { label: '已解决', cls: 'bg-green-100 text-green-700' },
  closed:     { label: '已关闭', cls: 'bg-slate-100 text-slate-500' },
}

const TYPE_LABELS = {
  after_sales_refund: '售后退款',
  complaint:          '投诉建议',
  inquiry:            '问题咨询',
  technical_issue:    '技术问题',
}

export default function Tickets() {
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState('')
  const [selected, setSelected] = useState(null)
  const [handlers, setHandlers] = useState([])

  const loadTickets = useCallback(async () => {
    setLoading(true)
    try {
      const url = filterStatus ? `/api/tickets?status=${filterStatus}` : '/api/tickets'
      const res = await apiFetch(url)
      setTickets(await res.json())
    } catch {
      setTickets([])
    } finally {
      setLoading(false)
    }
  }, [filterStatus])

  useEffect(() => { loadTickets() }, [loadTickets])

  useEffect(() => {
    apiFetch('/api/tickets/handlers').then(r => r.json()).then(setHandlers).catch(() => {})
  }, [])

  async function setStatus(ticketId, status) {
    await apiFetch(`/api/tickets/${ticketId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    await loadTickets()
    setSelected(s => s?.ticket_id === ticketId ? { ...s, status } : s)
  }

  async function reassign(ticketId, handlerId) {
    await apiFetch(`/api/tickets/${ticketId}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handler_id: handlerId }),
    })
    await loadTickets()
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex items-center gap-2 flex-wrap">
        {['', 'open', 'notified', 'processing', 'escalated', 'resolved'].map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filterStatus === s
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {s ? (STATUS_LABELS[s]?.label ?? s) : '全部'}
          </button>
        ))}
        <button
          onClick={loadTickets}
          className="ml-auto text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100"
          title="刷新"
        >
          <Icon name="refresh-cw" size={14} />
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-slate-400 text-sm">加载中…</div>
        ) : tickets.length === 0 ? (
          <div className="py-16 text-center text-slate-400 text-sm">暂无工单</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                {['工单号', '类型', '状态', '联系方式', '创建时间', '操作'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tickets.map(t => {
                const st = STATUS_LABELS[t.status] ?? { label: t.status, cls: 'bg-slate-100 text-slate-500' }
                return (
                  <tr
                    key={t.ticket_id}
                    className="hover:bg-slate-50 cursor-pointer"
                    onClick={() => setSelected(t)}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-700">{t.ticket_id}</td>
                    <td className="px-4 py-3 text-slate-600">{TYPE_LABELS[t.ticket_type] ?? t.ticket_type}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{t.contact || '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{t.created_at?.slice(0, 16)}</td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        {t.status === 'notified' && (
                          <button
                            onClick={() => setStatus(t.ticket_id, 'processing')}
                            className="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                          >接单</button>
                        )}
                        {['notified', 'processing', 'escalated'].includes(t.status) && (
                          <button
                            onClick={() => setStatus(t.ticket_id, 'resolved')}
                            className="text-xs px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100"
                          >解决</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail drawer */}
      {selected && (
        <div className="fixed inset-0 bg-black/30 z-50 flex justify-end" onClick={() => setSelected(null)}>
          <div
            className="w-full max-w-sm bg-white h-full shadow-xl overflow-y-auto p-6 space-y-4"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">{selected.ticket_id}</h2>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600">
                <Icon name="x" size={16} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <Row label="类型">{TYPE_LABELS[selected.ticket_type] ?? selected.ticket_type}</Row>
              <Row label="状态">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${(STATUS_LABELS[selected.status] ?? {}).cls ?? ''}`}>
                  {STATUS_LABELS[selected.status]?.label ?? selected.status}
                </span>
              </Row>
              <Row label="会话">{selected.session_id || '—'}</Row>
              <Row label="联系">{selected.contact || '—'}</Row>
              <Row label="创建">{selected.created_at?.slice(0, 19)}</Row>
            </div>
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-medium text-slate-500 mb-2">字段内容</p>
              <pre className="bg-slate-50 rounded-lg p-3 text-xs text-slate-700 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(selected.fields, null, 2)}
              </pre>
            </div>
            {handlers.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-medium text-slate-500 mb-2">转派处理人</p>
                <div className="flex flex-wrap gap-2">
                  {handlers.map(h => (
                    <button
                      key={h.handler_id}
                      onClick={() => reassign(selected.ticket_id, h.handler_id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
                    >
                      {h.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="flex gap-2">
      <span className="text-slate-400 w-12 shrink-0">{label}</span>
      <span className="text-slate-700">{children}</span>
    </div>
  )
}
