import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge, Button, Select } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { apiFetch } from '../auth.js'

function fmtDate(iso) {
  if (!iso) return '-'
  return String(iso).replace('T', ' ').slice(0, 16)
}

function fmtDateInput(iso) {
  if (!iso) return ''
  return String(iso).slice(0, 16).replace(' ', 'T')
}

function arrStr(arr) {
  if (!arr || !arr.length) return '-'
  return arr.join(', ')
}

export default function Chunks() {
  const [chunks, setChunks] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [documents, setDocuments] = useState([])

  const [docFilter, setDocFilter] = useState('')
  const [keyword, setKeyword] = useState('')
  const [inputKw, setInputKw] = useState('')
  const [page, setPage] = useState(0)
  const pageSize = 50

  const [viewingChunk, setViewingChunk] = useState(null)   // null | chunk object
  const [editingChunk, setEditingChunk] = useState(null)   // null | chunk object | 'new'
  const [showImport, setShowImport] = useState(false)

  const loadDocuments = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ops/documents?status=all&limit=500')
      if (res.ok) {
        const data = await res.json()
        setDocuments(data.documents ?? [])
      }
    } catch { /* ignore */ }
  }, [])

  const loadChunks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(pageSize),
        offset: String(page * pageSize),
      })
      if (docFilter) params.set('doc_id', docFilter)
      if (keyword) params.set('keyword', keyword)
      const res = await apiFetch(`/api/ops/chunks?${params}`)
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setChunks(data.chunks ?? [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [docFilter, keyword, page])

  useEffect(() => { loadDocuments() }, [loadDocuments])
  useEffect(() => { setPage(0) }, [docFilter, keyword])
  useEffect(() => { loadChunks() }, [loadChunks])

  async function deleteChunk(chunk_id) {
    if (!confirm('确认删除该知识块？此操作不可恢复。')) return
    try {
      const res = await apiFetch(`/api/ops/chunks/${chunk_id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      if (viewingChunk?.chunk_id === chunk_id) setViewingChunk(null)
      loadChunks()
    } catch (e) {
      alert(`删除失败：${e.message}`)
    }
  }

  async function saveChunk(payload) {
    const { chunk_id, doc_id, ...fields } = payload
    const isNew = !chunk_id
    const url = isNew
      ? `/api/ops/documents/${doc_id}/chunks`
      : `/api/ops/chunks/${chunk_id}`
    const res = await apiFetch(url, {
      method: isNew ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    if (!res.ok) throw new Error(await res.text())
    const updated = await res.json()
    setEditingChunk(null)
    // Refresh the viewing panel if it was the same chunk
    if (viewingChunk?.chunk_id === chunk_id) {
      setViewingChunk({ ...viewingChunk, ...updated })
    }
    loadChunks()
  }

  const [exportFmt, setExportFmt] = useState('csv')
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function exportChunks(fmt) {
    setExporting(true)
    setExportMenuOpen(false)
    try {
      const params = new URLSearchParams({ format: fmt })
      if (docFilter) params.set('doc_id', docFilter)
      if (keyword) params.set('keyword', keyword)
      const res = await apiFetch(`/api/ops/chunks/export?${params}`)
      if (!res.ok) throw new Error(await res.text())
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chunks_export.${fmt}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`导出失败：${e.message}`)
    } finally {
      setExporting(false)
    }
  }

  const docOptions = useMemo(() => [
    { value: '', label: '全部文档' },
    ...documents.map((d) => ({ value: d.doc_id, label: d.title || d.doc_id })),
  ], [documents])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={docFilter}
            onChange={setDocFilter}
            options={docOptions}
            className="w-52"
            size="sm"
          />
          <div className="flex items-center gap-1 border border-slate-200 rounded-lg px-2 bg-white">
            <Icon name="search" size={13} className="text-slate-400 shrink-0" />
            <input
              value={inputKw}
              onChange={(e) => setInputKw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setKeyword(inputKw) }}
              placeholder="搜索内容 / 标题 / 路径…"
              className="text-xs py-1.5 pr-1 w-48 outline-none bg-transparent"
            />
            {inputKw && (
              <button onClick={() => { setInputKw(''); setKeyword('') }} className="text-slate-300 hover:text-slate-500">
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setKeyword(inputKw)}>搜索</Button>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex items-center">
            <button
              onClick={() => exportChunks(exportFmt)}
              disabled={exporting || total === 0}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-l-xl border border-slate-200 bg-slate-50 text-slate-500 hover:bg-white hover:border-slate-300 disabled:opacity-40 transition-colors"
            >
              <Icon name="download" size={13} />
              {exporting ? '导出中…' : `导出 ${exportFmt.toUpperCase()}`}
            </button>
            <button
              onClick={() => setExportMenuOpen((v) => !v)}
              disabled={exporting || total === 0}
              className="flex items-center px-1.5 py-1.5 rounded-r-xl border border-l-0 border-slate-200 bg-slate-50 text-slate-400 hover:bg-white hover:border-slate-300 disabled:opacity-40 transition-colors"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {exportMenuOpen && (
              <div className="absolute top-full right-0 mt-1 bg-white border border-slate-100 rounded-xl shadow-lg py-1 z-20 min-w-[80px]">
                {['csv', 'jsonl'].map((fmt) => (
                  <button
                    key={fmt}
                    onClick={() => { setExportFmt(fmt); setExportMenuOpen(false) }}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors ${
                      exportFmt === fmt ? 'bg-indigo-50 text-indigo-600 font-medium' : 'text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button size="sm" onClick={() => setShowImport(true)}>
            <Icon name="upload" size={14} />
            导入
          </Button>
          <Button size="sm" variant="primary" onClick={() => setEditingChunk('new')}>
            <Icon name="plus" size={14} />
            新增 Chunk
          </Button>
        </div>
      </div>

      {/* Summary */}
      {!loading && (
        <p className="text-xs text-slate-400">
          共 {total} 条{docFilter ? `（已过滤：${documents.find(d => d.doc_id === docFilter)?.title ?? docFilter}）` : ''}
          {keyword ? `，关键词「${keyword}」` : ''}
        </p>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="max-h-[600px] overflow-auto">
          <table className="w-full text-sm table-fixed">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-100 sticky top-0 bg-white z-10">
                <th className="w-8 px-3 py-2 font-medium">#</th>
                <th className="w-[18%] px-2 py-2 font-medium">所属文档</th>
                <th className="w-[22%] px-2 py-2 font-medium">标题 / 路径</th>
                <th className="px-2 py-2 font-medium">内容预览</th>
                <th className="w-20 px-2 py-2 font-medium">版本</th>
                <th className="w-32 px-2 py-2 font-medium">更新时间</th>
                <th className="w-32 px-2 py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-slate-400">加载中…</td>
                </tr>
              )}
              {!loading && error && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-red-500">
                    {error}
                    <button className="ml-2 text-indigo-500 underline" onClick={loadChunks}>重试</button>
                  </td>
                </tr>
              )}
              {!loading && !error && chunks.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-xs text-slate-400">暂无数据</td>
                </tr>
              )}
              {!loading && !error && chunks.map((c, idx) => (
                <tr
                  key={c.chunk_id}
                  className={`border-b border-slate-50 last:border-0 hover:bg-slate-50 cursor-pointer ${viewingChunk?.chunk_id === c.chunk_id ? 'bg-indigo-50/60' : ''}`}
                  onClick={() => setViewingChunk(c)}
                >
                  <td className="px-3 py-2.5 text-xs text-slate-400">{page * pageSize + idx + 1}</td>
                  <td className="px-2 py-2.5 overflow-hidden">
                    <p className="text-xs text-slate-700 truncate" title={c.doc_title}>{c.doc_title}</p>
                    <p className="text-[10px] text-slate-400 font-mono truncate" title={c.doc_id}>{c.doc_id}</p>
                  </td>
                  <td className="px-2 py-2.5 overflow-hidden">
                    {c.title && (
                      <p className="text-xs font-medium text-slate-700 truncate" title={c.title}>{c.title}</p>
                    )}
                    {c.breadcrumb && (
                      <p className="text-[10px] text-slate-400 truncate" title={c.breadcrumb}>{c.breadcrumb}</p>
                    )}
                    {!c.title && !c.breadcrumb && (
                      <span className="text-[10px] text-slate-300">—</span>
                    )}
                    <p className="text-[11px] text-indigo-400 font-mono truncate mt-1 select-all" title={c.chunk_id}>{c.chunk_id}</p>
                  </td>
                  <td className="px-2 py-2.5">
                    <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">{c.content}</p>
                  </td>
                  <td className="px-2 py-2.5">
                    {c.version
                      ? <Badge tone="blue">{c.version}</Badge>
                      : <span className="text-[10px] text-slate-300">—</span>
                    }
                  </td>
                  <td className="px-2 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{fmtDate(c.updated_at)}</td>
                  <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => setEditingChunk(c)}>编辑</Button>
                      <Button size="sm" variant="danger" onClick={() => deleteChunk(c.chunk_id)}>删除</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>共 {total} 条，第 {page + 1} / {totalPages} 页</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
            <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {viewingChunk && (
        <ChunkDetailDrawer
          chunk={viewingChunk}
          onClose={() => setViewingChunk(null)}
          onEdit={() => { setEditingChunk(viewingChunk); setViewingChunk(null) }}
          onDelete={() => deleteChunk(viewingChunk.chunk_id)}
        />
      )}

      {/* Modals */}
      {editingChunk && (
        <ChunkEditModal
          chunk={editingChunk === 'new' ? null : editingChunk}
          documents={documents}
          defaultDocId={docFilter}
          onClose={() => setEditingChunk(null)}
          onSave={saveChunk}
        />
      )}

      {showImport && (
        <ImportModal
          documents={documents}
          onClose={() => setShowImport(false)}
          onSuccess={() => { setShowImport(false); loadChunks(); loadDocuments() }}
        />
      )}
    </div>
  )
}

// ── Chunk Detail Drawer ────────────────────────────────────────────────────

function MetaRow({ label, value, mono }) {
  if (!value || value === '-') return null
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-[11px] text-slate-400 w-24 shrink-0 pt-0.5">{label}</span>
      <span className={`text-xs text-slate-700 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function TagList({ label, items }) {
  if (!items || !items.length) return null
  return (
    <div className="flex gap-2 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-[11px] text-slate-400 w-24 shrink-0 pt-0.5">{label}</span>
      <div className="flex flex-wrap gap-1">
        {items.map((t) => (
          <span key={t} className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px] text-slate-600 font-mono">{t}</span>
        ))}
      </div>
    </div>
  )
}

// ── Questions Panel (多问法) ───────────────────────────────────────────────

function QuestionsPanel({ chunkId }) {
  const [questions, setQuestions] = useState(null)   // null = loading
  const [generating, setGenerating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/ops/chunks/${chunkId}/questions`)
      if (res.ok) setQuestions((await res.json()).questions ?? [])
    } catch { /* ignore */ }
  }, [chunkId])

  useEffect(() => { load() }, [load])

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/ops/chunks/${chunkId}/questions/generate`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      await load()
    } catch (e) { setError(e.message) }
    finally { setGenerating(false) }
  }

  async function saveEdit(q) {
    if (!editText.trim()) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/ops/chunks/${chunkId}/questions/${q.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: editText }),
      })
      if (!res.ok) throw new Error(await res.text())
      setEditingId(null)
      await load()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  async function deleteQ(q) {
    await apiFetch(`/api/ops/chunks/${chunkId}/questions/${q.id}`, { method: 'DELETE' })
    await load()
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
          多问法扩充
          {questions && <span className="ml-1.5 font-normal normal-case text-slate-300">({questions.length})</span>}
        </p>
        <button
          onClick={generate}
          disabled={generating}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-40 transition-colors"
        >
          <Icon name="refresh-cw" size={11} className={generating ? 'animate-spin' : ''} />
          {generating ? '生成中…' : '生成问法'}
        </button>
      </div>

      {error && <p className="text-[11px] text-red-500 mb-2">{error}</p>}

      {questions === null && (
        <p className="text-xs text-slate-300">加载中…</p>
      )}
      {questions !== null && questions.length === 0 && (
        <p className="text-xs text-slate-300">暂无问法，点击"生成问法"让 AI 生成</p>
      )}

      <div className="space-y-1.5">
        {(questions ?? []).map((q) => (
          <div key={q.id} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 bg-slate-50 hover:bg-indigo-50/40 transition-colors">
            {editingId === q.id ? (
              <div className="flex-1 flex gap-1.5">
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(q); if (e.key === 'Escape') setEditingId(null) }}
                  className="flex-1 text-xs border border-indigo-300 rounded px-1.5 py-0.5 outline-none"
                />
                <button
                  onClick={() => saveEdit(q)}
                  disabled={saving}
                  className="text-[11px] px-2 py-0.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                >
                  保存
                </button>
                <button
                  onClick={() => setEditingId(null)}
                  className="text-[11px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-600"
                >
                  取消
                </button>
              </div>
            ) : (
              <>
                <span className="flex-1 text-xs text-slate-700 leading-relaxed pt-0.5">{q.question}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    onClick={() => { setEditingId(q.id); setEditText(q.question) }}
                    className="text-slate-400 hover:text-indigo-500"
                    title="编辑"
                  >
                    <Icon name="edit" size={12} />
                  </button>
                  <button
                    onClick={() => deleteQ(q)}
                    className="text-slate-400 hover:text-red-500"
                    title="删除"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function ChunkDetailDrawer({ chunk, onClose, onEdit, onDelete }) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/20" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-[500px] bg-white shadow-xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <div>
            <p className="text-sm font-semibold text-slate-800">Chunk 详情</p>
            <p className="text-[11px] text-indigo-400 font-mono mt-0.5 select-all">{chunk.chunk_id}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={onEdit}>
              <Icon name="edit" size={13} />
              编辑
            </Button>
            <Button size="sm" variant="danger" onClick={onDelete}>
              <Icon name="trash" size={13} />
              删除
            </Button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 ml-1">
              <Icon name="x" size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Basic info */}
          <section>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">基本信息</p>
            <div>
              <MetaRow label="所属文档" value={chunk.doc_title || chunk.doc_id} />
              <MetaRow label="文档 ID" value={chunk.doc_id} mono />
              <MetaRow label="标题" value={chunk.title} />
              <MetaRow label="路径" value={chunk.breadcrumb} />
              <MetaRow label="版本" value={chunk.version} />
              <MetaRow label="更新时间" value={fmtDate(chunk.updated_at)} />
            </div>
          </section>

          {/* Access control */}
          <section>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">访问控制</p>
            <div>
              <TagList label="ACL" items={chunk.acl} />
              <TagList label="地区" items={chunk.region} />
              <TagList label="产品线" items={chunk.product_line} />
            </div>
            {!chunk.acl?.length && !chunk.region?.length && !chunk.product_line?.length && (
              <p className="text-xs text-slate-300">（公开访问，无访问控制）</p>
            )}
          </section>

          {/* Validity */}
          <section>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">有效期</p>
            <div>
              <MetaRow label="生效时间" value={fmtDate(chunk.effective_from)} />
              <MetaRow label="失效时间" value={fmtDate(chunk.effective_to)} />
            </div>
            {!chunk.effective_from && !chunk.effective_to && (
              <p className="text-xs text-slate-300">（永久有效）</p>
            )}
          </section>

          {/* Source */}
          {(chunk.source_url || chunk.parent_chunk_id) && (
            <section>
              <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">来源</p>
              <div>
                <MetaRow label="来源 URL" value={chunk.source_url} mono />
                <MetaRow label="父 Chunk" value={chunk.parent_chunk_id} mono />
                <MetaRow label="父路径" value={chunk.parent_path} />
              </div>
            </section>
          )}

          {/* Content */}
          <section>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              内容
              <span className="ml-2 font-normal normal-case text-slate-300">({chunk.content?.length ?? 0} 字符)</span>
            </p>
            <div className="bg-slate-50 rounded-lg p-3 max-h-80 overflow-y-auto text-xs text-slate-700 leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ ...props }) => <h1 className="text-sm font-bold mt-3 mb-1 first:mt-0" {...props} />,
                  h2: ({ ...props }) => <h2 className="text-xs font-bold mt-2 mb-1 first:mt-0" {...props} />,
                  h3: ({ ...props }) => <h3 className="text-xs font-semibold mt-2 mb-1 first:mt-0" {...props} />,
                  p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                  ul: ({ ...props }) => <ul className="list-disc list-inside mb-2 space-y-0.5" {...props} />,
                  ol: ({ ...props }) => <ol className="list-decimal list-inside mb-2 space-y-0.5" {...props} />,
                  li: ({ ...props }) => <li className="text-xs" {...props} />,
                  code: ({ className, children, ...props }) => {
                    const isBlock = className?.startsWith('language-')
                    return isBlock
                      ? <code className="block bg-slate-200 text-slate-800 rounded p-2 font-mono text-[11px] overflow-x-auto" {...props}>{children}</code>
                      : <code className="bg-slate-200 text-slate-800 rounded px-0.5 font-mono" {...props}>{children}</code>
                  },
                  pre: ({ ...props }) => <pre className="my-1.5 rounded overflow-hidden" {...props} />,
                  strong: ({ ...props }) => <strong className="font-semibold" {...props} />,
                  em: ({ ...props }) => <em className="italic" {...props} />,
                  blockquote: ({ ...props }) => <blockquote className="border-l-2 border-slate-300 pl-2 text-slate-500 my-2" {...props} />,
                  a: ({ ...props }) => <a className="text-indigo-500 underline" target="_blank" rel="noreferrer" {...props} />,
                  table: ({ ...props }) => <table className="text-[11px] border-collapse w-full mb-2" {...props} />,
                  th: ({ ...props }) => <th className="border border-slate-200 px-1.5 py-0.5 bg-slate-100 font-semibold text-left" {...props} />,
                  td: ({ ...props }) => <td className="border border-slate-200 px-1.5 py-0.5" {...props} />,
                }}
              >
                {chunk.content ?? ''}
              </ReactMarkdown>
            </div>
          </section>

          {/* Questions augmentation */}
          {!chunk.is_parent && <QuestionsPanel chunkId={chunk.chunk_id} />}
        </div>
      </div>
    </>
  )
}

// ── Chunk Edit / New Modal ─────────────────────────────────────────────────

function FieldLabel({ children, required }) {
  return (
    <label className="text-xs text-slate-500">
      {children}
      {required && <span className="text-red-400 ml-0.5">*</span>}
    </label>
  )
}

function TextInput({ value, onChange, placeholder, mono }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs ${mono ? 'font-mono' : ''}`}
      placeholder={placeholder}
    />
  )
}

function ChunkEditModal({ chunk, documents, defaultDocId, onClose, onSave }) {
  const isNew = !chunk?.chunk_id
  const [docId, setDocId] = useState(chunk?.doc_id ?? defaultDocId ?? documents[0]?.doc_id ?? '')
  const [title, setTitle] = useState(chunk?.title ?? '')
  const [breadcrumb, setBreadcrumb] = useState(chunk?.breadcrumb ?? '')
  const [content, setContent] = useState(chunk?.content ?? '')
  const [version, setVersion] = useState(chunk?.version ?? '')
  const [sourceUrl, setSourceUrl] = useState(chunk?.source_url ?? '')
  // Arrays stored as comma-separated strings in the UI
  const [aclStr, setAclStr] = useState((chunk?.acl ?? []).join(', '))
  const [regionStr, setRegionStr] = useState((chunk?.region ?? []).join(', '))
  const [effectiveFrom, setEffectiveFrom] = useState(fmtDateInput(chunk?.effective_from))
  const [effectiveTo, setEffectiveTo] = useState(fmtDateInput(chunk?.effective_to))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const docOptions = documents.map((d) => ({ value: d.doc_id, label: d.title || d.doc_id }))

  function parseArr(str) {
    return str.split(',').map(s => s.trim()).filter(Boolean)
  }

  async function handleSubmit() {
    if (!content.trim()) { setError('内容不能为空'); return }
    if (isNew && !docId) { setError('请选择所属文档'); return }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        chunk_id: chunk?.chunk_id,
        doc_id: docId,
        title,
        breadcrumb,
        content,
        version: version || null,
        source_url: sourceUrl || null,
        acl: parseArr(aclStr).length ? parseArr(aclStr) : null,
        region: parseArr(regionStr).length ? parseArr(regionStr) : null,
        effective_from: effectiveFrom || null,
        effective_to: effectiveTo || null,
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

          {isNew && (
            <div>
              <FieldLabel required>所属文档</FieldLabel>
              <Select
                value={docId}
                onChange={setDocId}
                options={docOptions}
                className="w-full mt-1"
                size="md"
              />
            </div>
          )}

          {/* Row 1: title + version */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>标题</FieldLabel>
              <TextInput value={title} onChange={setTitle} placeholder="章节标题（可选）" />
            </div>
            <div>
              <FieldLabel>版本</FieldLabel>
              <TextInput value={version} onChange={setVersion} placeholder="如 1.0、2.1" />
            </div>
          </div>

          {/* Row 2: breadcrumb */}
          <div>
            <FieldLabel>路径（Breadcrumb）</FieldLabel>
            <TextInput value={breadcrumb} onChange={setBreadcrumb} placeholder="文档标题 > 章节 > 小节" />
          </div>

          {/* Row 3: source_url */}
          <div>
            <FieldLabel>来源 URL</FieldLabel>
            <TextInput value={sourceUrl} onChange={setSourceUrl} placeholder="https://..." mono />
          </div>

          {/* Row 4: acl + region */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>ACL（逗号分隔）</FieldLabel>
              <TextInput
                value={aclStr}
                onChange={setAclStr}
                placeholder="role:admin, role:ops"
                mono
              />
              <p className="text-[10px] text-slate-400 mt-0.5">留空 = 公开</p>
            </div>
            <div>
              <FieldLabel>地区（逗号分隔）</FieldLabel>
              <TextInput
                value={regionStr}
                onChange={setRegionStr}
                placeholder="global, cn"
                mono
              />
            </div>
          </div>

          {/* Row 5: effective_from + effective_to */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>生效时间</FieldLabel>
              <input
                type="datetime-local"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
              />
            </div>
            <div>
              <FieldLabel>失效时间</FieldLabel>
              <input
                type="datetime-local"
                value={effectiveTo}
                onChange={(e) => setEffectiveTo(e.target.value)}
                className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs"
              />
            </div>
          </div>

          {/* Content */}
          <div>
            <FieldLabel required>内容</FieldLabel>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-xs resize-y font-mono leading-relaxed"
              placeholder="知识块内容"
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>

        {/* Footer */}
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

// ── Import Modal ───────────────────────────────────────────────────────────

function ImportModal({ documents, onClose, onSuccess }) {
  const [file, setFile] = useState(null)
  const [mode, setMode] = useState('existing')
  const [docId, setDocId] = useState(documents[0]?.doc_id ?? '')
  const [newDocTitle, setNewDocTitle] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState(null)

  const docOptions = documents.map((d) => ({ value: d.doc_id, label: d.title || d.doc_id }))

  async function handleSubmit() {
    if (!file) { setError('请选择 JSONL 文件'); return }
    if (mode === 'existing' && !docId) { setError('请选择目标文档'); return }
    if (mode === 'new' && !newDocTitle.trim()) { setError('请输入新文档名称'); return }

    setImporting(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (mode === 'existing') {
        fd.append('doc_id', docId)
      } else {
        fd.append('doc_title', newDocTitle.trim())
      }
      const res = await apiFetch('/api/ops/chunks/import', { method: 'POST', body: fd })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.detail || await res.text())
      }
      const result = await res.json()
      alert(`导入成功：${result.imported} 条 chunk，文档 ID: ${result.doc_id}`)
      onSuccess()
    } catch (e) {
      setError(e.message)
      setImporting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">导入 Chunks</h3>
          <button onClick={onClose} disabled={importing} className="text-slate-400 hover:text-slate-600">
            <Icon name="x" size={18} />
          </button>
        </div>

        <label className="block border-2 border-dashed border-slate-200 rounded-lg py-8 text-center text-slate-400 text-sm cursor-pointer hover:border-indigo-200 hover:bg-slate-50/50 transition-colors">
          <Icon name="upload" size={20} className="mx-auto mb-2" />
          {file ? (
            <span className="text-slate-700 font-medium">{file.name}</span>
          ) : (
            <>点击选择文件</>
          )}
          <p className="text-xs mt-1 text-slate-300">
            JSONL：每行 {`{"content":"...","title":"...","breadcrumb":"...","version":"1.0"}`}
          </p>
          <p className="text-xs text-slate-300">
            CSV：首行为列名，必须含 content 列，可选 title / breadcrumb / version
          </p>
          <input
            type="file"
            className="hidden"
            accept=".jsonl,.json,.csv,.txt"
            onChange={(e) => setFile(e.target.files[0] ?? null)}
          />
        </label>

        <div>
          <p className="text-xs text-slate-500 mb-2">目标文档</p>
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => setMode('existing')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                mode === 'existing'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              选择已有文档
            </button>
            <button
              type="button"
              onClick={() => setMode('new')}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                mode === 'new'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              新建文档
            </button>
          </div>

          {mode === 'existing' ? (
            <Select
              value={docId}
              onChange={setDocId}
              options={docOptions}
              className="w-full"
              size="md"
            />
          ) : (
            <input
              value={newDocTitle}
              onChange={(e) => setNewDocTitle(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
              placeholder="输入新文档名称"
            />
          )}
        </div>

        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose} disabled={importing}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={importing}>
            {importing ? '导入中…' : '开始导入'}
          </Button>
        </div>
      </div>
    </div>
  )
}
