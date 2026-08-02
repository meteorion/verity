import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge, Button, Select } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import QuestionsPanel from '../components/QuestionsPanel.jsx'
import { BUSINESS_LINES as BUSINESS_LINE_OPTIONS } from '../config.js'
import { apiFetch } from '../auth.js'

const ACL_OPTIONS = [
  { value: 'role:public',   label: '公开',   desc: '所有用户（含游客）' },
  { value: 'role:customer', label: '客户',   desc: '已登录客户' },
  { value: 'role:agent',    label: '客服',   desc: '客服人员' },
  { value: 'role:admin',    label: '管理员', desc: '仅管理员' },
]

const ACL_TONE = {
  'role:public':   'bg-slate-100 text-slate-600',
  'role:customer': 'bg-blue-50 text-blue-600',
  'role:agent':    'bg-indigo-50 text-indigo-600',
  'role:admin':    'bg-violet-50 text-violet-600',
}

// Catch-all ('global' project group / 'role:public' access) is mutually
// exclusive with specific entries: picking it clears the rest; picking a
// specific entry drops the catch-all. Empty selection falls back to catch-all.
function toggleExclusive(list, value, catchAll) {
  if (value === catchAll) return [catchAll]
  const rest = list.filter((v) => v !== catchAll)
  const next = rest.includes(value) ? rest.filter((v) => v !== value) : [...rest, value]
  return next.length ? next : [catchAll]
}

// Pill multi-select with a visually distinct, mutually-exclusive catch-all
// (rendered first, separated by a divider). Shared by the project-group and
// access-permission selectors so their behaviour and look stay identical.
function PillSelect({ options, selected, catchAll, onToggle, disabled = false, size = 'md' }) {
  const shape = size === 'sm' ? 'px-2 py-0.5 rounded' : 'px-3 py-1 rounded-full'
  const pill = (o, activeCls) => {
    const active = selected.includes(o.key)
    return (
      <button
        key={o.key}
        type="button"
        onClick={() => onToggle(o.key)}
        disabled={disabled}
        title={o.title}
        className={`${shape} text-xs font-medium transition-colors ${
          active ? activeCls : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
        }`}
      >
        {o.label}
      </button>
    )
  }
  const catchOpt = options.find((o) => o.key === catchAll)
  const rest = options.filter((o) => o.key !== catchAll)
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {catchOpt && pill(catchOpt, 'bg-slate-600 text-white')}
      {catchOpt && rest.length > 0 && <span className="text-slate-200 select-none">|</span>}
      {rest.map((o) => pill(o, 'bg-indigo-600 text-white'))}
    </div>
  )
}

const DOC_TYPE_OPTIONS = [
  { value: '', label: '—— 不限 ——' },
  { value: 'faq', label: 'FAQ' },
  { value: 'manual', label: '操作手册' },
  { value: 'policy', label: '政策说明' },
  { value: 'announcement', label: '公告' },
  { value: 'other', label: '其他' },
]
const CATEGORY_OPTIONS = [
  { value: '', label: '—— 不限 ——' },
  { value: 'product', label: '产品' },
  { value: 'after_sales', label: '售后' },
  { value: 'complaint', label: '投诉' },
  { value: 'inquiry', label: '咨询' },
  { value: 'general', label: '通用' },
]
const TAG_PRESETS = ['高优', '紧急', '外部', '常见问题', 'VIP', '退款', '发货', '会员']
const tagPillOptions = TAG_PRESETS.map(t => ({ key: t, label: t }))

const aclPillOptions = ACL_OPTIONS.map((o) => ({ key: o.value, label: o.label, title: o.desc }))
const groupPillOptions = (groups) => groups.map((g) => ({ key: g.group_id, label: g.name }))

const STATUS_LABEL = {
  active: '已生效',
  pending: '待审核',
  rejected: '已驳回',
  expired: '已过期'
}

const BUSINESS_LINES = ['全部业务线', ...BUSINESS_LINE_OPTIONS]
const PIPELINE_STEPS = ['文档解析', '数据清洗', 'PII 识别与脱敏', '层级化切分', '向量化', '写入索引']

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审核' },
  { key: 'rejected', label: '已驳回' },
  { key: 'expired', label: '已过期' }
]

function fmtDate(iso) {
  if (!iso) return '-'
  return String(iso).replace('T', ' ').slice(0, 16)
}

function scoreColor(score) {
  if (score >= 80) return { ring: '#639922', text: 'text-emerald-600' }
  if (score >= 60) return { ring: '#BA7517', text: 'text-amber-600' }
  return { ring: '#A32D2D', text: 'text-red-600' }
}

function ScoreRing({ score }) {
  if (score == null) return <span className="text-xs text-slate-300">—</span>
  const c = scoreColor(score)
  return (
    <div
      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
      style={{ background: `conic-gradient(${c.ring} ${score * 3.6}deg, #e2e8f0 0deg)` }}
    >
      <div className={`w-[22px] h-[22px] rounded-full bg-white flex items-center justify-center text-[10px] font-medium ${c.text}`}>
        {score}
      </div>
    </div>
  )
}

function StatCard({ label, value, tone = 'slate', highlight = false }) {
  const toneText = { slate: 'text-slate-900', amber: 'text-amber-600', red: 'text-red-600', green: 'text-emerald-600' }
  return (
    <div className={`rounded-xl p-4 ${highlight ? 'bg-red-50' : 'bg-white border border-slate-200'}`}>
      <p className={`text-xs mb-1 ${highlight ? 'text-red-600' : 'text-slate-500'}`}>{label}</p>
      <p className={`text-2xl font-semibold ${toneText[tone]}`}>{value}</p>
    </div>
  )
}

export default function KnowledgeBase() {
  const [documents, setDocuments] = useState([])
  const [groups, setGroups] = useState([])
  const [metrics, setMetrics] = useState({ chunk_count: 0, doc_count: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [businessLine, setBusinessLine] = useState('全部业务线')
  const [groupFilter, setGroupFilter] = useState('')
  const [keyword, setKeyword] = useState('')
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [detailId, setDetailId] = useState(null)
  const [showUpload, setShowUpload] = useState(false)

  const loadDocs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [active, pending, rejected, metricsRes, groupsRes] = await Promise.all([
        apiFetch('/api/ops/documents?status=active&limit=200').then((r) => r.json()),
        apiFetch('/api/ops/documents?status=pending&limit=200').then((r) => r.json()),
        apiFetch('/api/ops/documents?status=rejected&limit=200').then((r) => r.json()),
        apiFetch('/api/ops/metrics').then((r) => r.json()),
        apiFetch('/api/ops/groups').then((r) => r.json()),
      ])
      const all = [
        ...(active.documents ?? []),
        ...(pending.documents ?? []),
        ...(rejected.documents ?? []),
      ]
      setDocuments(all)
      setMetrics(metricsRes)
      setGroups(groupsRes.groups ?? [])
      setDetailId((prev) => prev ?? all[0]?.doc_id ?? null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  const pendingCount = documents.filter((d) => d.status === 'pending').length
  const rejectedCount = documents.filter((d) => d.status === 'rejected').length
  const expiredCount = documents.filter((d) => d.status === 'expired').length

  const filtered = useMemo(() => {
    return documents.filter((d) => {
      const matchFilter =
        filter === 'all' ||
        (filter === 'pending' && d.status === 'pending') ||
        (filter === 'rejected' && d.status === 'rejected') ||
        (filter === 'expired' && d.status === 'expired')
      const matchLine = businessLine === '全部业务线' || d.business_line === businessLine
      const matchGroup = !groupFilter || (d.group_ids ?? []).includes(groupFilter)
      const matchKw = !keyword || d.title.includes(keyword) || d.doc_id.includes(keyword)
      return matchFilter && matchLine && matchGroup && matchKw
    })
  }, [documents, filter, businessLine, groupFilter, keyword])

  const detailDoc = documents.find((d) => d.doc_id === detailId) ?? documents[0] ?? null
  const allChecked = filtered.length > 0 && filtered.every((d) => selectedIds.has(d.doc_id))

  function toggleSelect(doc_id) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(doc_id)) next.delete(doc_id)
      else next.add(doc_id)
      return next
    })
  }

  function toggleSelectAll(checked) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      filtered.forEach((d) => {
        if (checked) next.add(d.doc_id)
        else next.delete(d.doc_id)
      })
      return next
    })
  }

  async function disableDoc(doc_id) {
    try {
      const res = await apiFetch(`/api/ops/documents/${doc_id}/disable`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      await loadDocs()
    } catch (e) {
      alert(`下架失败：${e.message}`)
    }
  }

  async function deleteDoc(doc_id) {
    if (!confirm('确认删除？文档及所有知识块将被永久移除，无法恢复。')) return
    try {
      const res = await apiFetch(`/api/ops/documents/${doc_id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      if (detailId === doc_id) setDetailId(null)
      await loadDocs()
    } catch (e) {
      alert(`删除失败：${e.message}`)
    }
  }

  async function rebuildDoc(doc_id, file = null) {
    const body = file ? (() => { const fd = new FormData(); fd.append('file', file); return fd })() : undefined
    const res = await apiFetch(`/api/ops/documents/${doc_id}/rebuild`, { method: 'POST', body })
    if (!res.ok) throw new Error(await res.text())
    await loadDocs()
  }

  async function bulkDisable() {
    try {
      await Promise.all(
        [...selectedIds].map((id) =>
          apiFetch(`/api/ops/documents/${id}/disable`, { method: 'POST' })
        )
      )
      setSelectedIds(new Set())
      await loadDocs()
    } catch (e) {
      alert(`批量下架失败：${e.message}`)
    }
  }

  async function bulkDelete() {
    if (!confirm(`确认删除选中的 ${selectedIds.size} 份文档？此操作不可恢复。`)) return
    try {
      await Promise.all(
        [...selectedIds].map((id) =>
          apiFetch(`/api/ops/documents/${id}`, { method: 'DELETE' })
        )
      )
      setSelectedIds(new Set())
      await loadDocs()
    } catch (e) {
      alert(`批量删除失败：${e.message}`)
    }
  }

  const groupLabels = Object.fromEntries(groups.map((g) => [g.group_id, g.name]))
  const groupSelectOptions = [
    { value: '', label: '全部项目组' },
    ...groups.map((g) => ({ value: g.group_id, label: g.name })),
  ]

  if (error) {
    return (
      <div className="flex items-center gap-2 justify-center h-48 text-sm text-red-500">
        加载失败：{error}
        <button className="text-indigo-500 underline" onClick={loadDocs}>重试</button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="生效文档" value={loading ? '…' : metrics.doc_count} />
        <StatCard label="待审核" value={loading ? '…' : pendingCount} tone="amber" />
        <StatCard label="知识块总数" value={loading ? '…' : metrics.chunk_count} tone="green" />
        <StatCard label="知识更新时效" value="≤ 15min" tone="green" />
      </div>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2">
          {FILTERS.map((f) => {
            const count =
              f.key === 'all' ? documents.length :
              f.key === 'pending' ? pendingCount :
              f.key === 'rejected' ? rejectedCount :
              expiredCount
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filter === f.key ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {f.label} {count}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={businessLine} onChange={setBusinessLine} options={BUSINESS_LINES} />
          <Select
            value={groupFilter}
            onChange={setGroupFilter}
            options={groupSelectOptions}
          />
          <div className="relative">
            <Icon name="search" size={14} className="absolute left-2 top-2 text-slate-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索文档标题 / doc_id"
              className="text-xs border border-slate-200 rounded-lg pl-7 pr-2 py-1.5 w-52"
            />
          </div>
          <Button variant="primary" size="sm" onClick={() => setShowUpload(true)}>
            <Icon name="upload" size={14} />
            上传文档
          </Button>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-indigo-50 rounded-lg px-4 py-2 text-sm">
          <span className="text-indigo-700">已选择 {selectedIds.size} 项</span>
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={bulkDisable}>批量下架</Button>
            <Button size="sm" variant="danger" onClick={bulkDelete}>批量删除</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>取消选择</Button>
          </div>
        </div>
      )}

      <div className="flex bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex-1 min-w-0 max-h-[520px] overflow-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100 sticky top-0 bg-white">
                <th className="w-10 px-4 py-2 font-medium">
                  <input type="checkbox" checked={allChecked} onChange={(e) => toggleSelectAll(e.target.checked)} />
                </th>
                <th className="w-52 px-2 py-2 font-medium">文档</th>
                <th className="w-28 px-2 py-2 font-medium">项目组</th>
                <th className="w-16 px-2 py-2 font-medium">准入分</th>
                <th className="w-20 px-2 py-2 font-medium">状态</th>
                <th className="w-36 px-2 py-2 font-medium">更新时间</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">加载中…</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">暂无数据</td>
                </tr>
              )}
              {!loading && filtered.map((d) => (
                <tr
                  key={d.doc_id}
                  onClick={() => setDetailId(d.doc_id)}
                  className={`border-b border-slate-50 last:border-0 cursor-pointer ${
                    detailId === d.doc_id ? 'bg-indigo-50/60' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.has(d.doc_id)} onChange={() => toggleSelect(d.doc_id)} />
                  </td>
                  <td className="px-2 py-2.5 overflow-hidden">
                    <p className="font-medium text-slate-800 truncate">{d.title}</p>
                    <p className="text-xs text-slate-400 truncate">{d.doc_id} · {d.business_line}</p>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {(d.group_ids ?? []).map((gid) => (
                        <span key={gid} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-600 font-medium">
                          {groupLabels[gid] ?? gid}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2.5"><ScoreRing score={d.admission_score} /></td>
                  <td className="px-2 py-2.5">
                    <Badge tone={d.status === 'active' ? 'green' : d.status === 'pending' ? 'amber' : 'slate'}>
                      {STATUS_LABEL[d.status] ?? d.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-2.5 text-slate-500 whitespace-nowrap">{fmtDate(d.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="hidden lg:block">
          <DetailPanel doc={detailDoc} onDisable={disableDoc} onDelete={deleteDoc} onRebuild={rebuildDoc} groups={groups} onGroupsChange={loadDocs} />
        </div>
      </div>

      {showUpload && (
        <UploadModal
          groups={groups}
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); loadDocs() }}
        />
      )}
    </div>
  )
}

function DocEditModal({ doc, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: doc.title ?? '',
    owner_email: doc.owner_email ?? '',
    business_line: doc.business_line ?? '',
    version: doc.version ?? '',
    source_url: doc.source_url ?? '',
    effective_from: doc.effective_from ? String(doc.effective_from).slice(0, 16).replace(' ', 'T') : '',
    effective_to: doc.effective_to ? String(doc.effective_to).slice(0, 16).replace(' ', 'T') : '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function handleSubmit() {
    setSaving(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/ops/documents/${doc.doc_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(await res.text())
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">编辑文档信息</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 block mb-1">标题 <span className="text-red-400">*</span></label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">Owner 邮箱</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              value={form.owner_email}
              onChange={(e) => set('owner_email', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">业务线</label>
            <Select
              className="w-full"
              value={form.business_line}
              onChange={(v) => set('business_line', v)}
              options={BUSINESS_LINE_OPTIONS}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">版本</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              value={form.version}
              onChange={(e) => set('version', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 block mb-1">原文链接</label>
            <input
              type="url"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              placeholder="https://"
              value={form.source_url}
              onChange={(e) => set('source_url', e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-slate-500 block mb-1">生效时间</label>
              <input
                type="datetime-local"
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
                value={form.effective_from}
                onChange={(e) => set('effective_from', e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 block mb-1">失效时间</label>
              <input
                type="datetime-local"
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-indigo-400"
                value={form.effective_to}
                onChange={(e) => set('effective_to', e.target.value)}
              />
            </div>
          </div>
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={saving || !form.title.trim()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function DetailPanel({ doc, onDisable, onDelete, onRebuild, groups, onGroupsChange }) {
  const [saving, setSaving] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showRebuild, setShowRebuild] = useState(false)
  const [showChunks, setShowChunks] = useState(false)
  const [showAdmission, setShowAdmission] = useState(false)
  const docGroupIds = doc?.group_ids ?? []
  const docAcl = doc?.acl ?? ['role:public']

  async function toggleAcl(role) {
    if (!doc) return
    const final = toggleExclusive(docAcl, role, 'role:public')
    setSaving(true)
    try {
      await apiFetch(`/api/ops/documents/${doc.doc_id}/acl`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acl: final }),
      })
      onGroupsChange()
    } finally {
      setSaving(false)
    }
  }

  async function toggleGroup(gid) {
    if (!doc) return
    const final = toggleExclusive(docGroupIds, gid, 'global')
    setSaving(true)
    try {
      await apiFetch(`/api/ops/documents/${doc.doc_id}/groups`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_ids: final }),
      })
      onGroupsChange()
    } finally {
      setSaving(false)
    }
  }

  if (!doc) {
    return <div className="w-96 shrink-0 border-l border-slate-100 p-4 text-sm text-slate-400">选择左侧文档查看详情</div>
  }
  return (
    <div className="w-96 shrink-0 border-l border-slate-100 p-4 text-sm space-y-3 overflow-y-auto max-h-[520px]">
      <div>
        <p className="font-medium text-slate-800">{doc.title}</p>
        <p className="text-xs text-slate-400 mt-0.5">{doc.doc_id}</p>
      </div>

      <DetailRow label="Owner" value={doc.owner_email} />
      <DetailRow label="来源类型" value={doc.source_type} />
      <DetailRow label="版本" value={doc.version} />
      <DetailRow label="生效时间" value={fmtDate(doc.effective_from)} />
      <DetailRow label="失效时间" value={fmtDate(doc.effective_to)} />
      {doc.source_url && (
        <div className="flex items-center justify-between border-b border-slate-50 pb-1.5 text-xs">
          <span className="text-slate-400 shrink-0">原文链接</span>
          <a
            href={doc.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-indigo-500 underline truncate max-w-[150px]"
            title={doc.source_url}
          >
            {doc.source_url}
          </a>
        </div>
      )}

      <DetailRow
        label="切分参数"
        value={`${doc.chunk_size ?? 600} / ${doc.chunk_overlap ?? 80} tokens`}
      />

      <div className="flex items-center justify-between border-b border-slate-50 pb-1.5 text-xs">
        <span className="text-slate-400">Chunk 数</span>
        <div className="flex items-center gap-2">
          <span className="text-slate-700">{doc.chunk_count ?? '—'}</span>
          <button
            onClick={() => setShowChunks(true)}
            className="text-indigo-500 hover:text-indigo-700 underline"
          >
            管理
          </button>
        </div>
      </div>
      <div>
        <p className="text-xs text-slate-400 mb-2">项目组归属 {saving && <span className="text-indigo-400">保存中…</span>}</p>
        <PillSelect
          options={groupPillOptions(groups)}
          selected={docGroupIds}
          catchAll="global"
          onToggle={toggleGroup}
          disabled={saving}
          size="sm"
        />
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-2">访问权限 {saving && <span className="text-indigo-400">保存中…</span>}</p>
        <PillSelect
          options={aclPillOptions}
          selected={docAcl}
          catchAll="role:public"
          onToggle={toggleAcl}
          disabled={saving}
          size="sm"
        />
      </div>

      <div className="flex items-center justify-between border-b border-slate-50 pb-1.5 text-xs">
        <span className="text-slate-400">准入分析</span>
        <div className="flex items-center gap-2">
          <ScoreRing score={doc.admission_score} />
          <button
            onClick={() => setShowAdmission(true)}
            className="text-indigo-500 hover:text-indigo-700 underline"
          >
            查看分析
          </button>
        </div>
      </div>

      <div className="pt-2 flex gap-2 flex-wrap">
        <Button size="sm" onClick={() => setShowEdit(true)}>编辑</Button>
        <Button size="sm" variant="primary" className="w-20" disabled={saving} onClick={() => setShowRebuild(true)}>重构</Button>
        {doc.status !== 'rejected' && (
          <Button size="sm" variant="warning" className="w-20" disabled={saving} onClick={() => onDisable(doc.doc_id)}>下架</Button>
        )}
        <Button size="sm" variant="danger-solid" className="w-20" disabled={saving} onClick={() => onDelete(doc.doc_id)}>删除</Button>
      </div>

      {showEdit && (
        <DocEditModal
          doc={doc}
          onClose={() => setShowEdit(false)}
          onSaved={onGroupsChange}
        />
      )}

      {showRebuild && (
        <RebuildModal
          doc={doc}
          onClose={() => setShowRebuild(false)}
          onRebuild={onRebuild}
        />
      )}

      {showChunks && (
        <ChunksModal doc={doc} onClose={() => setShowChunks(false)} />
      )}

      {showAdmission && (
        <AdmissionModal doc={doc} onClose={() => setShowAdmission(false)} />
      )}
    </div>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 pb-1.5 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 text-right max-w-[150px] truncate" title={value}>{value ?? '-'}</span>
    </div>
  )
}

function UploadModal({ groups, onClose, onSuccess }) {
  const [file, setFile] = useState(null)
  const [owner, setOwner] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [version, setVersion] = useState('1.0')
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [effectiveTo, setEffectiveTo] = useState('')
  const [businessLine, setBusinessLine] = useState(BUSINESS_LINE_OPTIONS[0])
  const [selectedGroups, setSelectedGroups] = useState(['global'])
  const [selectedAcl, setSelectedAcl] = useState(['role:public'])
  const [chunkSize, setChunkSize] = useState('600')
  const [chunkOverlap, setChunkOverlap] = useState('80')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  function toggleAclRole(role) {
    setSelectedAcl((prev) => toggleExclusive(prev, role, 'role:public'))
  }

  function toggleGroup(gid) {
    setSelectedGroups((prev) => toggleExclusive(prev, gid, 'global'))
  }

  async function handleSubmit() {
    if (!file) { setUploadError('请选择文件'); return }
    if (!owner) { setUploadError('请填写 Owner 邮箱'); return }

    setUploading(true)
    setUploadError(null)
    try {
      const docId = `doc_${Date.now()}`
      const fd = new FormData()
      fd.append('file', file)
      fd.append('doc_id', docId)
      fd.append('owner', owner)
      fd.append('business_line', businessLine)
      fd.append('group_ids', selectedGroups.join(','))
      fd.append('acl_roles', selectedAcl.join(','))
      if (sourceUrl.trim()) fd.append('source_url', sourceUrl.trim())
      fd.append('version', version.trim() || '1.0')
      if (effectiveFrom) fd.append('effective_from', effectiveFrom)
      if (effectiveTo) fd.append('effective_to', effectiveTo)
      if (chunkSize) fd.append('chunk_size', chunkSize)
      if (chunkOverlap) fd.append('chunk_overlap', chunkOverlap)

      const res = await apiFetch('/api/pipeline/ingest', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      onSuccess()
    } catch (e) {
      setUploadError(e.message)
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">上传知识文档</h3>
          <button onClick={onClose} disabled={uploading} className="text-slate-400 hover:text-slate-600">
            <Icon name="x" size={18} />
          </button>
        </div>

        <label className="block border-2 border-dashed border-slate-200 rounded-lg py-14 text-center text-slate-400 text-sm cursor-pointer hover:border-indigo-200 hover:bg-slate-50/50 transition-colors">
          <Icon name="upload" size={22} className="mx-auto mb-2" />
          {file ? (
            <span className="text-slate-700">{file.name}</span>
          ) : (
            <>拖拽文件到此处，或点击选择</>
          )}
          <p className="text-xs mt-1">支持 PDF / Word / Markdown，单文件 ≤ 50MB</p>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx,.doc,.md,.txt"
            onChange={(e) => setFile(e.target.files[0] ?? null)}
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">业务线</label>
            <Select
              value={businessLine}
              onChange={setBusinessLine}
              options={BUSINESS_LINE_OPTIONS}
              className="w-full mt-1"
              size="md"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">Owner</label>
            <input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              placeholder="owner@company.com"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-slate-500">版本</label>
            <input
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              placeholder="1.0"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">生效日期 <span className="text-slate-300">（可选）</span></label>
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">失效日期 <span className="text-slate-300">（可选）</span></label>
            <input
              type="date"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-500">切分大小 <span className="text-slate-300">tokens</span></label>
            <input
              type="number"
              min="100"
              max="4000"
              value={chunkSize}
              onChange={(e) => setChunkSize(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              placeholder="600"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">重叠大小 <span className="text-slate-300">tokens</span></label>
            <input
              type="number"
              min="0"
              max="500"
              value={chunkOverlap}
              onChange={(e) => setChunkOverlap(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              placeholder="80"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-500">原文链接 <span className="text-slate-300">（可选）</span></label>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            placeholder="https://wiki.company.com/page/..."
            type="url"
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 block mb-2">项目组归属</label>
          <PillSelect
            options={groupPillOptions(groups)}
            selected={selectedGroups}
            catchAll="global"
            onToggle={toggleGroup}
          />
        </div>

        <div>
          <label className="text-xs text-slate-500 block mb-2">访问权限</label>
          <PillSelect
            options={aclPillOptions}
            selected={selectedAcl}
            catchAll="role:public"
            onToggle={toggleAclRole}
          />
          <p className="text-[11px] text-slate-400 mt-1.5">
            公开：所有人可见 / 客户：已登录 / 客服、管理员：内部权限
          </p>
        </div>

        {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}

        <p className="text-xs text-slate-400">
          上传后将自动执行：解析 → PII 脱敏 → 层级化切分（{chunkSize}/{chunkOverlap} tokens）→ 向量化入库，预计 15 分钟内生效。
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button size="sm" onClick={onClose} disabled={uploading}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={uploading}>
            {uploading ? '上传中…' : '开始上传'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function RebuildModal({ doc, onClose, onRebuild }) {
  const [file, setFile] = useState(null)
  const [rebuilding, setRebuilding] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit() {
    setRebuilding(true)
    setError(null)
    try {
      await onRebuild(doc.doc_id, file || null)
      onClose()
    } catch (e) {
      setError(e.message)
      setRebuilding(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">重构文档</h3>
          <button onClick={onClose} disabled={rebuilding} className="text-slate-400 hover:text-slate-600">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          <span className="font-medium text-slate-700">{doc.title}</span>
          <span className="ml-2 text-slate-400">{doc.doc_id}</span>
        </div>

        <label className="block border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-400 text-xs cursor-pointer hover:border-indigo-200 hover:bg-slate-50/50 transition-colors">
          <Icon name="upload" size={18} className="mx-auto mb-1.5" />
          {file ? (
            <span className="text-slate-700 font-medium">{file.name}</span>
          ) : (
            <>
              <p>上传新文件替换原始文档</p>
              <p className="mt-0.5 text-slate-300">不选文件则沿用磁盘上的原文件重构</p>
            </>
          )}
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx,.doc,.md,.txt"
            onChange={(e) => setFile(e.target.files[0] ?? null)}
          />
        </label>

        {file && (
          <button
            className="text-xs text-slate-400 hover:text-slate-600 underline"
            onClick={() => setFile(null)}
          >
            取消文件选择，改用原文件
          </button>
        )}

        <p className="text-xs text-amber-600">重构期间旧知识块会被清除，文档暂时不可检索。</p>

        {error && <p className="text-xs text-red-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose} disabled={rebuilding}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={rebuilding}>
            {rebuilding ? '重构中…' : '开始重构'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ChunksModal({ doc, onClose }) {
  const [chunks, setChunks] = useState([])
  const [loading, setLoading] = useState(false)
  const [chunkModal, setChunkModal] = useState(null)

  const loadChunks = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/ops/documents/${doc.doc_id}/chunks`)
      const data = await res.json()
      setChunks(data.chunks ?? [])
    } catch {
      setChunks([])
    } finally {
      setLoading(false)
    }
  }, [doc.doc_id])

  useEffect(() => { loadChunks() }, [loadChunks])

  async function deleteChunk(chunk_id) {
    if (!confirm('确认删除该知识块？此操作不可恢复。')) return
    try {
      const res = await apiFetch(`/api/ops/chunks/${encodeURIComponent(chunk_id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      await loadChunks()
    } catch (e) {
      alert(`删除失败：${e.message}`)
    }
  }

  async function saveChunk({ chunk_id, title, breadcrumb, content, version, source_url, acl, region, effective_from, effective_to, doc_type, category, tags }) {
    const isNew = !chunk_id
    const url = isNew
      ? `/api/ops/documents/${doc.doc_id}/chunks`
      : `/api/ops/chunks/${encodeURIComponent(chunk_id)}`
    const res = await apiFetch(url, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, breadcrumb, content, version, source_url, acl, region, effective_from, effective_to, doc_type, category, tags }),
    })
    if (!res.ok) throw new Error(await res.text())
    setChunkModal(null)
    await loadChunks()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-6xl flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">知识块管理</h3>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-lg">
              {doc.title} · {doc.doc_id}
              {!loading && <span className="ml-2 text-slate-300">共 {chunks.length} 块</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <Button size="sm" variant="primary" onClick={() => setChunkModal({ chunk: null })}>
              <Icon name="plus" size={13} />
              新增知识块
            </Button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading && (
            <p className="text-xs text-slate-400 text-center py-12">加载中…</p>
          )}
          {!loading && chunks.length === 0 && (
            <p className="text-xs text-slate-400 text-center py-12">该文档暂无知识块</p>
          )}
          {chunks.map((c, idx) => (
            <div key={c.chunk_id} className="border border-slate-100 rounded-xl p-4 hover:border-slate-200 transition-colors">
              <div className="flex items-start gap-4">
                {/* Index */}
                <span className="text-xs text-slate-300 font-mono w-6 shrink-0 pt-0.5 text-right">{idx + 1}</span>

                {/* Content */}
                <div className="flex-1 min-w-0 space-y-1.5">
                  {(c.breadcrumb || c.title) && (
                    <p className="text-xs font-medium text-slate-600">
                      {c.breadcrumb || c.title}
                    </p>
                  )}
                  <div className="text-xs text-slate-700 leading-relaxed bg-slate-50 rounded-lg px-3 py-2 mt-1">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ ...p }) => <p className="font-semibold mb-1" {...p} />,
                        h2: ({ ...p }) => <p className="font-semibold mb-1" {...p} />,
                        h3: ({ ...p }) => <p className="font-semibold mb-0.5" {...p} />,
                        p: ({ ...p }) => <p className="mb-1 last:mb-0" {...p} />,
                        ul: ({ ...p }) => <ul className="list-disc list-inside mb-1" {...p} />,
                        ol: ({ ...p }) => <ol className="list-decimal list-inside mb-1" {...p} />,
                        code: ({ ...p }) => <code className="bg-slate-200 rounded px-0.5 font-mono text-[11px]" {...p} />,
                        pre: ({ ...p }) => <pre className="bg-slate-200 rounded p-1.5 font-mono text-[11px] overflow-x-auto my-1" {...p} />,
                        a: ({ ...p }) => <span className="text-indigo-500 underline" {...p} />,
                        table: ({ ...p }) => <table className="text-[11px] border-collapse mb-1" {...p} />,
                        th: ({ ...p }) => <th className="border border-slate-200 px-1.5 py-0.5 bg-slate-100 font-semibold text-left" {...p} />,
                        td: ({ ...p }) => <td className="border border-slate-200 px-1.5 py-0.5" {...p} />,
                      }}
                    >
                      {c.content ?? ''}
                    </ReactMarkdown>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <p className="text-[11px] text-slate-300 font-mono">{c.chunk_id}</p>
                    {c.version && (
                      <span className="text-[11px] text-indigo-400 font-medium">v{c.version}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-1.5 shrink-0">
                  <Button size="sm" onClick={() => setChunkModal({ chunk: c })}>编辑</Button>
                  <Button size="sm" variant="danger" onClick={() => deleteChunk(c.chunk_id)}>删除</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {chunkModal && (
        <ChunkEditModal
          chunk={chunkModal.chunk}
          onClose={() => setChunkModal(null)}
          onSave={saveChunk}
        />
      )}
    </div>
  )
}

function AdmissionModal({ doc, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    apiFetch(`/api/ops/documents/${doc.doc_id}/admission`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [doc.doc_id])

  const statusTone = data?.status === 'active' ? 'green' : data?.status === 'pending' ? 'amber' : 'slate'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg flex flex-col" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-slate-800">准入分析</h3>
            <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">{doc.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-4">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading && <p className="text-xs text-slate-400 text-center py-10">分析中…</p>}
          {error && <p className="text-xs text-red-500 text-center py-10">{error}</p>}

          {data && (
            <>
              {/* Score summary */}
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <svg width="72" height="72" viewBox="0 0 72 72">
                    <circle cx="36" cy="36" r="30" fill="none" stroke="#e2e8f0" strokeWidth="6" />
                    <circle cx="36" cy="36" r="30" fill="none"
                      stroke={data.admission_score >= 80 ? '#22c55e' : data.admission_score >= 60 ? '#f59e0b' : '#ef4444'}
                      strokeWidth="6"
                      strokeDasharray={`${(data.admission_score / 100) * 188.5} 188.5`}
                      strokeLinecap="round"
                      transform="rotate(-90 36 36)"
                    />
                  </svg>
                  <span className={`absolute inset-0 flex items-center justify-center text-lg font-bold ${
                    data.admission_score >= 80 ? 'text-emerald-600' : data.admission_score >= 60 ? 'text-amber-600' : 'text-red-600'
                  }`}>{data.admission_score ?? '—'}</span>
                </div>
                <div className="space-y-1">
                  <Badge tone={statusTone}>{STATUS_LABEL[data.status] ?? data.status}</Badge>
                  <p className="text-xs text-slate-500">{data.chunk_count} 个有效知识块</p>
                  <p className="text-xs text-slate-400">满分 100 · 60 分生效</p>
                </div>
              </div>

              {/* Dimension bars */}
              <div className="space-y-3">
                {(data.dimensions ?? []).map((dim) => {
                  const pct = Math.round((dim.score / dim.max) * 100)
                  const barColor =
                    pct >= 80 ? 'bg-emerald-400' :
                    pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
                  return (
                    <div key={dim.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-700">{dim.label}</span>
                        <span className="text-xs tabular-nums text-slate-500">
                          {dim.score} <span className="text-slate-300">/ {dim.max}</span>
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${barColor}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5">{dim.detail}</p>
                    </div>
                  )
                })}
              </div>

              {/* Issues */}
              {data.issues?.length > 0 && (
                <div className="bg-amber-50 rounded-lg px-4 py-3 space-y-1.5">
                  <p className="text-xs font-medium text-amber-700 mb-2">诊断建议</p>
                  {data.issues.map((issue, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
                      <Icon name="alert" size={12} className="shrink-0 mt-0.5" />
                      <span>{issue}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.issues?.length === 0 && (
                <div className="bg-emerald-50 rounded-lg px-4 py-3 flex items-center gap-2 text-xs text-emerald-700">
                  <Icon name="check" size={13} />
                  文档质量良好，无明显问题
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ChunkEditModal({ chunk, onClose, onSave }) {
  const isNew = !chunk?.chunk_id
  const [title, setTitle] = useState(chunk?.title ?? '')
  const [breadcrumb, setBreadcrumb] = useState(chunk?.breadcrumb ?? '')
  const [content, setContent] = useState(chunk?.content ?? '')
  const [version, setVersion] = useState(chunk?.version ?? '')
  const [sourceUrl, setSourceUrl] = useState(chunk?.source_url ?? '')
  const [aclStr, setAclStr] = useState((chunk?.acl ?? []).join(', '))
  const [regionStr, setRegionStr] = useState((chunk?.region ?? []).join(', '))
  const [effectiveFrom, setEffectiveFrom] = useState(chunk?.effective_from ? String(chunk.effective_from).slice(0, 16).replace(' ', 'T') : '')
  const [effectiveTo, setEffectiveTo] = useState(chunk?.effective_to ? String(chunk.effective_to).slice(0, 16).replace(' ', 'T') : '')
  const [docType, setDocType] = useState(chunk?.doc_type ?? '')
  const [category, setCategory] = useState(chunk?.category ?? '')
  const [tags, setTags] = useState(chunk?.tags ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function parseArr(str) {
    return str.split(',').map(s => s.trim()).filter(Boolean)
  }

  async function handleSubmit() {
    if (!content.trim()) { setError('内容不能为空'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        chunk_id: chunk?.chunk_id,
        title,
        breadcrumb,
        content,
        version: version.trim() || null,
        source_url: sourceUrl.trim() || null,
        acl: parseArr(aclStr).length ? parseArr(aclStr) : null,
        region: parseArr(regionStr).length ? parseArr(regionStr) : null,
        effective_from: effectiveFrom || null,
        effective_to: effectiveTo || null,
        doc_type: docType || null,
        category: category || null,
        tags: tags.length ? tags : null,
      })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800">{isNew ? '新增知识块' : '编辑知识块'}</h3>
          <button onClick={onClose} disabled={saving} className="text-slate-400 hover:text-slate-600">
            <Icon name="x" size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {!isNew && (
            <div className="text-[11px] text-slate-400 bg-slate-50 rounded px-2 py-1 font-mono truncate">
              {chunk.chunk_id}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">标题</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                placeholder="章节标题（可选）" />
            </div>
            <div>
              <label className="text-xs text-slate-500">版本</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
                placeholder={chunk?.version ?? '如 1.0、2.1'} />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500">路径（Breadcrumb）</label>
            <input value={breadcrumb} onChange={(e) => setBreadcrumb(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
              placeholder="文档标题 > 章节 > 小节" />
          </div>

          <div>
            <label className="text-xs text-slate-500">来源 URL</label>
            <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono"
              placeholder="https://..." />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">ACL <span className="text-slate-300">（逗号分隔）</span></label>
              <input value={aclStr} onChange={(e) => setAclStr(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono"
                placeholder="role:admin, role:ops" />
              <p className="text-[10px] text-slate-400 mt-0.5">留空 = 公开</p>
            </div>
            <div>
              <label className="text-xs text-slate-500">地区 <span className="text-slate-300">（逗号分隔）</span></label>
              <input value={regionStr} onChange={(e) => setRegionStr(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-mono"
                placeholder="global, cn" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">生效时间</label>
              <input type="datetime-local" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
            </div>
            <div>
              <label className="text-xs text-slate-500">失效时间</label>
              <input type="datetime-local" value={effectiveTo} onChange={(e) => setEffectiveTo(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500">文档类型</label>
              <Select value={docType} onChange={setDocType} options={DOC_TYPE_OPTIONS} className="w-full mt-1" size="sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500">分类</label>
              <Select value={category} onChange={setCategory} options={CATEGORY_OPTIONS} className="w-full mt-1" size="sm" />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-500 block mb-1.5">标签</label>
            <PillSelect
              options={tagPillOptions}
              selected={tags}
              onToggle={(t) => setTags(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
              size="sm"
            />
          </div>

          <div>
            <label className="text-xs text-slate-500">内容 <span className="text-red-400">*</span></label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)}
              rows={7}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs resize-y font-mono leading-relaxed"
              placeholder="知识块内容" />
          </div>

          {!isNew && (
            <div className="border-t border-slate-100 pt-4">
              <QuestionsPanel chunkId={chunk.chunk_id} />
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">
          <Button size="sm" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}
