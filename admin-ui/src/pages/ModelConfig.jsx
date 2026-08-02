import { useState, useEffect, useCallback } from 'react'
import Icon from '../components/Icon.jsx'
import { apiFetch } from '../auth.js'

async function fetchSettings() {
  const res = await apiFetch('/api/settings')
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}
async function saveSettings(payload) {
  const res = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(payload) })
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `${res.status}`) }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ModelConfig() {
  const [settings, setSettings] = useState(null)
  const [editing, setEditing] = useState(null) // 'llm' | 'embedding' | 'ragas' | 'kb'
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setSettings(await fetchSettings()) }
    catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-500">{error}</p>}

      {/* Row 1 — four config.txt cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <ConfigCard
          title="大语言模型"
          tag="LLM"
          tagColor="blue"
          loading={!settings}
          fields={settings ? [
            { label: '模型',       value: settings.llm_model },
            { label: 'API',        value: settings.llm_api_base, mono: true, truncate: true },
            { label: 'Key',        value: settings.llm_api_key_masked, mono: true },
            { label: 'Max Tokens', value: settings.llm_max_tokens },
            { label: 'Temperature',value: settings.llm_temperature },
          ] : []}
          onEdit={() => setEditing('llm')}
        />
        <ConfigCard
          title="Embedding 模型"
          tag="向量"
          tagColor="purple"
          loading={!settings}
          fields={settings ? [
            { label: '模型', value: settings.embedding_model },
            { label: 'API',  value: settings.embedding_api_base || '共用 LLM', mono: true, truncate: true },
            { label: 'Key',  value: settings.embedding_api_key_masked || '共用 LLM', mono: true },
          ] : []}
          onEdit={() => setEditing('embedding')}
        />
        <ConfigCard
          title="Ragas 评估"
          tag="评估"
          tagColor="amber"
          loading={!settings}
          fields={settings ? [
            { label: '评估模型', value: settings.ragas_llm_model },
            { label: 'Key',     value: '共用 LLM', mono: true },
            { label: 'API',     value: '共用 LLM', mono: true },
          ] : []}
          onEdit={() => setEditing('ragas')}
        />
        <ConfigCard
          title="知识库"
          tag="检索/切分"
          tagColor="teal"
          loading={!settings}
          fields={settings ? [
            { label: 'Top-K',       value: settings.retrieval_top_k },
            { label: '候选池',      value: settings.retrieval_top_vector },
            { label: 'Rerank 阈值', value: settings.rerank_threshold },
            { label: '分块大小',    value: `${settings.chunk_size} tokens` },
            { label: '分块重叠',    value: `${settings.chunk_overlap} tokens` },
          ] : []}
          onEdit={() => setEditing('kb')}
        />
      </div>

      {/* Row 2 — prompt versions */}
      <PromptVersions />

      {/* Edit modals */}
      {editing === 'llm' && (
        <LLMEditModal
          initial={settings}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
      {editing === 'embedding' && (
        <EmbeddingEditModal
          initial={settings}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
      {editing === 'ragas' && (
        <RagasEditModal
          initial={settings}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
      {editing === 'kb' && (
        <KbEditModal
          initial={settings}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

// ─── Config display card ──────────────────────────────────────────────────────

const TAG_STYLES = {
  blue:   'bg-blue-50 text-blue-600',
  purple: 'bg-violet-50 text-violet-600',
  amber:  'bg-amber-50 text-amber-600',
  teal:   'bg-teal-50 text-teal-600',
}

function ConfigCard({ title, tag, tagColor, fields, onEdit, loading }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${TAG_STYLES[tagColor]}`}>
            {tag}
          </span>
        </div>
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="编辑"
        >
          <Icon name="edit" size={14} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[1,2,3].map(i => <div key={i} className="h-3.5 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : (
        <dl className="space-y-2">
          {fields.map(({ label, value, mono, truncate }) => (
            <div key={label} className="flex items-baseline gap-2">
              <dt className="text-[11px] text-slate-400 w-20 shrink-0">{label}</dt>
              <dd className={`text-xs text-slate-700 min-w-0 ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : ''}`}
                title={truncate ? String(value) : undefined}>
                {value ?? '—'}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

// ─── Edit modals ──────────────────────────────────────────────────────────────

function LLMEditModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    llm_model: initial?.llm_model ?? '',
    llm_api_base: initial?.llm_api_base ?? '',
    llm_api_key: '',
    llm_max_tokens: initial?.llm_max_tokens ?? 800,
    llm_temperature: initial?.llm_temperature ?? 0.2,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (f, v) => setForm(p => ({ ...p, [f]: v }))

  async function save() {
    setSaving(true); setError('')
    try {
      const p = { ...form }
      if (!p.llm_api_key) delete p.llm_api_key
      await saveSettings(p); onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <EditModal title="编辑 LLM 配置" onClose={onClose} onSave={save} saving={saving} error={error}>
      <FormRow label="模型名称">
        <Input value={form.llm_model} onChange={v => set('llm_model', v)} placeholder="qwen-plus" />
      </FormRow>
      <FormRow label="API Base URL">
        <Input value={form.llm_api_base} onChange={v => set('llm_api_base', v)} />
      </FormRow>
      <FormRow label="API Key" hint={initial?.llm_api_key_masked || '未配置'}>
        <Input type="password" value={form.llm_api_key} onChange={v => set('llm_api_key', v)} placeholder="留空保留原密钥" />
      </FormRow>
      <div className="grid grid-cols-2 gap-4">
        <FormRow label="Max Tokens">
          <Input type="number" min={1} max={8000} value={form.llm_max_tokens} onChange={v => set('llm_max_tokens', Number(v))} />
        </FormRow>
        <FormRow label="Temperature">
          <Input type="number" min={0} max={2} step={0.05} value={form.llm_temperature} onChange={v => set('llm_temperature', Number(v))} />
        </FormRow>
      </div>
    </EditModal>
  )
}

function EmbeddingEditModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    embedding_model: initial?.embedding_model ?? '',
    embedding_api_base: initial?.embedding_api_base ?? '',
    embedding_api_key: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (f, v) => setForm(p => ({ ...p, [f]: v }))

  async function save() {
    setSaving(true); setError('')
    try {
      const p = { ...form }
      if (!p.embedding_api_key) delete p.embedding_api_key
      await saveSettings(p); onSaved()
    } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <EditModal title="编辑 Embedding 配置" onClose={onClose} onSave={save} saving={saving} error={error}>
      <FormRow label="模型名称">
        <Input value={form.embedding_model} onChange={v => set('embedding_model', v)} placeholder="text-embedding-v3" />
      </FormRow>
      <FormRow label="API Base URL" hint="留空共用 LLM">
        <Input value={form.embedding_api_base} onChange={v => set('embedding_api_base', v)} placeholder="留空共用 LLM" />
      </FormRow>
      <FormRow label="API Key" hint={initial?.embedding_api_key_masked || '共用 LLM'}>
        <Input type="password" value={form.embedding_api_key} onChange={v => set('embedding_api_key', v)} placeholder="留空共用 LLM 密钥" />
      </FormRow>
    </EditModal>
  )
}

function RagasEditModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({ ragas_llm_model: initial?.ragas_llm_model ?? '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    setSaving(true); setError('')
    try { await saveSettings(form); onSaved() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <EditModal title="编辑 Ragas 评估配置" onClose={onClose} onSave={save} saving={saving} error={error}>
      <FormRow label="评估模型">
        <Input value={form.ragas_llm_model} onChange={v => setForm({ ragas_llm_model: v })} placeholder="qwen-turbo" />
      </FormRow>
      <p className="text-xs text-slate-400 mt-1 pl-[7.5rem]">API Key 与 Base URL 与 LLM 共用，保存后评估引擎自动重置。</p>
    </EditModal>
  )
}

// ─── Knowledge Base edit modal ────────────────────────────────────────────────

const _NI = 'w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400'

function KbEditModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    retrieval_top_k:      initial?.retrieval_top_k      ?? 6,
    retrieval_top_vector: initial?.retrieval_top_vector  ?? 50,
    rerank_threshold:     initial?.rerank_threshold      ?? 0.38,
    chunk_size:           initial?.chunk_size            ?? 600,
    chunk_overlap:        initial?.chunk_overlap         ?? 80,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function num(k, v) { setForm(f => ({ ...f, [k]: Number(v) || 0 })) }

  async function save() {
    setSaving(true); setError('')
    try { await saveSettings(form); onSaved() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <EditModal title="编辑知识库配置" onClose={onClose} onSave={save} saving={saving} error={error}>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">检索</p>
      <FormRow label="检索 Top-K" hint="每次检索返回的知识块数量，影响答案覆盖度">
        <input type="number" min="1" max="20" value={form.retrieval_top_k}
          onChange={e => num('retrieval_top_k', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="向量候选池" hint="向量召回候选数，越大精度越高但延迟增加">
        <input type="number" min="10" max="200" value={form.retrieval_top_vector}
          onChange={e => num('retrieval_top_vector', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="Rerank 阈值" hint="Rerank 分数过滤阈值（0–1），仅在 RERANK_PROVIDER=local 时生效">
        <input type="number" min="0" max="1" step="0.01" value={form.rerank_threshold}
          onChange={e => num('rerank_threshold', e.target.value)} className={_NI} />
      </FormRow>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100 mt-2">切分</p>
      <FormRow label="分块大小" hint="单块 token 上限，变更后重新入库才生效">
        <input type="number" min="100" max="2000" step="50" value={form.chunk_size}
          onChange={e => num('chunk_size', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="分块重叠" hint="相邻块共享的 token 数，保留上下文连贯性">
        <input type="number" min="0" max="500" step="10" value={form.chunk_overlap}
          onChange={e => num('chunk_overlap', e.target.value)} className={_NI} />
      </FormRow>
    </EditModal>
  )
}

// ─── Prompt versions ──────────────────────────────────────────────────────────

function PromptVersions() {
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [cache, setCache] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ version: '', note: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const res = await apiFetch('/api/ops/prompts')
      setPrompts([...(((await res.json()).prompts) || [])].reverse())
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  async function openView(version) {
    let content = cache[version]
    if (content === undefined) {
      try {
        const res = await apiFetch(`/api/ops/prompts/${encodeURIComponent(version)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        content = (await res.json()).content ?? ''
        setCache(c => ({ ...c, [version]: content }))
      } catch (e) {
        setError(e.message)
        return
      }
    }
    setViewing({ version, content })
  }

  async function activate(version) {
    setActivating(version)
    try {
      await apiFetch(`/api/ops/prompts/${encodeURIComponent(version)}/activate`, { method: 'POST' })
      await load()
    } finally { setActivating(null) }
  }

  async function create() {
    if (!newForm.version.trim() || !newForm.content.trim()) return
    setSaving(true); setError('')
    try {
      const res = await apiFetch('/api/ops/prompts', { method: 'POST', body: JSON.stringify(newForm) })
      if (res.status === 409) { setError(`"${newForm.version}" 已存在`); return }
      if (!res.ok) { setError((await res.json().catch(() => ({}))).detail || '保存失败'); return }
      setShowNew(false); setNewForm({ version: '', note: '', content: '' }); await load()
    } catch { setError('网络错误') } finally { setSaving(false) }
  }

  function openNew() {
    const active = prompts.find(p => p.is_active)
    if (active && cache[active.version]) setNewForm(f => ({ ...f, content: cache[active.version] }))
    setError(''); setShowNew(true)
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-800">Prompt 版本</span>
          <button onClick={openNew}
            className="h-7 px-3 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors">
            + 新建
          </button>
        </div>

        {loading ? (
          <div className="px-5 py-4 text-sm text-slate-400">加载中…</div>
        ) : prompts.length === 0 ? (
          <div className="px-5 py-4 text-sm text-slate-400">暂无版本</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {prompts.map(p => (
              <div key={p.version}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${p.is_active ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${p.is_active ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${p.is_active ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {p.version}
                    </span>
                    {p.is_active && (
                      <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded uppercase tracking-wide">
                        生产
                      </span>
                    )}
                    {p.note && <span className="text-xs text-slate-400">{p.note}</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
                    {p.created_at?.replace('T', ' ').slice(0, 16)}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  <GhostBtn onClick={() => openView(p.version)}>查看</GhostBtn>
                  {!p.is_active && (
                    <GhostBtn disabled={activating === p.version} onClick={() => activate(p.version)}>
                      {activating === p.version ? '激活中…' : '激活'}
                    </GhostBtn>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showNew && (
        <ModalShell title="新建 Prompt 版本" onClose={() => setShowNew(false)} wide>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <FormRow label="版本号 *">
              <Input placeholder="v4.0.0" value={newForm.version}
                onChange={v => setNewForm(f => ({ ...f, version: v }))} />
            </FormRow>
            <FormRow label="说明">
              <Input placeholder="简短描述" value={newForm.note}
                onChange={v => setNewForm(f => ({ ...f, note: v }))} />
            </FormRow>
          </div>
          <FormRow label="内容 *">
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono h-60 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400"
              value={newForm.content} onChange={e => setNewForm(f => ({ ...f, content: e.target.value }))} />
          </FormRow>
          {error && <p className="text-xs text-red-500 mt-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <GhostBtn onClick={() => { setShowNew(false); setError('') }}>取消</GhostBtn>
            <button disabled={!newForm.version.trim() || !newForm.content.trim() || saving}
              onClick={create}
              className="h-7 px-4 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
              {saving ? '保存中…' : '保存版本'}
            </button>
          </div>
        </ModalShell>
      )}

      {viewing && (
        <ModalShell title={
          <span className="flex items-center gap-2">
            {viewing.version}
            {prompts.find(p => p.version === viewing.version)?.is_active && (
              <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded uppercase tracking-wide">生产</span>
            )}
          </span>
        } onClose={() => setViewing(null)} tall wide>
          <pre className="text-xs text-slate-700 whitespace-pre-wrap font-mono leading-relaxed">{viewing.content}</pre>
        </ModalShell>
      )}
    </>
  )
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function EditModal({ title, children, onClose, onSave, saving, error }) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="space-y-3">
        {children}
      </div>
      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-4">
        <GhostBtn onClick={onClose}>取消</GhostBtn>
        <button onClick={onSave} disabled={saving}
          className="h-7 px-4 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </ModalShell>
  )
}

function ModalShell({ title, onClose, children, tall, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white rounded-xl shadow-xl border border-slate-200 w-full mx-4 flex flex-col ${wide ? 'max-w-3xl' : 'max-w-lg'} ${tall ? 'max-h-[80vh]' : ''}`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 shrink-0">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className={`p-5 ${tall ? 'overflow-y-auto flex-1' : ''}`}>{children}</div>
      </div>
    </div>
  )
}

function FormRow({ label, hint, children }) {
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-1 min-w-0">
        <label className="text-xs font-medium text-slate-600 shrink-0">{label}</label>
        {hint && (
          <span className="text-xs text-slate-400 truncate min-w-0 cursor-default" title={hint}>
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

function Input({ type = 'text', value, onChange, placeholder, min, max, step }) {
  return (
    <input
      type={type} value={value ?? ''} placeholder={placeholder}
      min={min} max={max} step={step}
      autoComplete={type === 'password' ? 'new-password' : undefined}
      onChange={e => onChange(e.target.value)}
      className="w-full h-8 border border-slate-200 rounded-lg px-2.5 text-sm text-slate-800 placeholder:text-slate-300
        focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-colors"
    />
  )
}

function GhostBtn({ children, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="h-7 px-2.5 text-xs text-slate-500 rounded-md hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40 transition-colors">
      {children}
    </button>
  )
}
