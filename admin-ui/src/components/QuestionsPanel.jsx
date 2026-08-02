import { useCallback, useEffect, useState } from 'react'
import Icon from './Icon.jsx'
import { apiFetch } from '../auth.js'

export default function QuestionsPanel({ chunkId }) {
  const [questions, setQuestions] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [addText, setAddText] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const encodedId = encodeURIComponent(chunkId)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/ops/chunks/${encodedId}/questions`)
      if (res.ok) setQuestions((await res.json()).questions ?? [])
    } catch { /* ignore */ }
  }, [encodedId])

  useEffect(() => { load() }, [load])

  async function generate() {
    setGenerating(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/ops/chunks/${encodedId}/questions/generate`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      await load()
    } catch (e) { setError(e.message) }
    finally { setGenerating(false) }
  }

  async function saveEdit(q) {
    if (!editText.trim()) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/ops/chunks/${encodedId}/questions/${q.id}`, {
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
    await apiFetch(`/api/ops/chunks/${encodedId}/questions/${q.id}`, { method: 'DELETE' })
    await load()
  }

  async function addQuestion() {
    if (!addText.trim()) return
    setAdding(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/ops/chunks/${encodedId}/questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: addText }),
      })
      if (!res.ok) throw new Error(await res.text())
      setAddText('')
      await load()
    } catch (e) { setError(e.message) }
    finally { setAdding(false) }
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

      {questions === null && <p className="text-xs text-slate-300">加载中…</p>}
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
                >保存</button>
                <button
                  onClick={() => setEditingId(null)}
                  className="text-[11px] px-1.5 py-0.5 rounded text-slate-400 hover:text-slate-600"
                >取消</button>
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

        {/* Manual add row */}
        <div className="flex items-center gap-1.5 mt-2">
          <input
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addQuestion() }}
            placeholder="手动输入问法…"
            className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-300 placeholder:text-slate-300"
          />
          <button
            onClick={addQuestion}
            disabled={adding || !addText.trim()}
            className="shrink-0 flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 disabled:opacity-40 transition-colors"
          >
            <Icon name="plus" size={11} />
            {adding ? '添加中…' : '添加'}
          </button>
        </div>
      </div>
    </section>
  )
}
