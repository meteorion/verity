import { useState, useEffect, useCallback, useRef } from 'react'
import Icon from '../components/Icon.jsx'
import { Badge, Button } from '../components/ui.jsx'
import { apiFetch } from '../auth.js'
import { useBasicConfig, updateBasicConfig } from '../config.js'

// ── Tab 定义 ───────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'model',  label: '模型配置' },
  { key: 'basic',  label: '基础配置' },
  { key: 'ticket', label: '工单配置' },
]

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function Config() {
  const [tab, setTab] = useState('model')
  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-white border border-slate-200 rounded-xl p-1 w-fit">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-indigo-600 text-white'
                : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'model'  && <ModelTab />}
      {tab === 'basic'  && <BasicTab />}
      {tab === 'ticket' && <TicketTab />}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 模型配置
// ══════════════════════════════════════════════════════════════════════════════

async function fetchSettings() {
  const res = await apiFetch('/api/settings')
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}
async function saveSettings(payload) {
  const res = await apiFetch('/api/settings', { method: 'PUT', body: JSON.stringify(payload) })
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || `${res.status}`) }
}

function ModelTab() {
  const [settings, setSettings] = useState(null)
  const [editing, setEditing] = useState(null) // 'llm' | 'embedding' | 'ragas' | 'kb' | 'flags'
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setSettings(await fetchSettings()) }
    catch (e) { setError(e.message) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">
      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <ConfigCard
          title="大语言模型" tag="LLM" tagColor="blue" loading={!settings}
          fields={settings ? [
            { label: '模型',        value: settings.llm_model },
            { label: 'API',         value: settings.llm_api_base, mono: true, truncate: true },
            { label: 'Key',         value: settings.llm_api_key_masked, mono: true },
            { label: 'Max Tokens',  value: settings.llm_max_tokens },
            { label: 'Temperature', value: settings.llm_temperature },
          ] : []}
          onEdit={() => setEditing('llm')}
        />
        <ConfigCard
          title="Embedding 模型" tag="向量" tagColor="purple" loading={!settings}
          fields={settings ? [
            { label: '模型', value: settings.embedding_model },
            { label: 'API',  value: settings.embedding_api_base || '共用 LLM', mono: true, truncate: true },
            { label: 'Key',  value: settings.embedding_api_key_masked || '共用 LLM', mono: true },
          ] : []}
          onEdit={() => setEditing('embedding')}
        />
        <ConfigCard
          title="Ragas 评估" tag="评估" tagColor="amber" loading={!settings}
          fields={settings ? [
            { label: '评估模型', value: settings.ragas_llm_model },
            { label: 'Key',     value: '共用 LLM', mono: true },
            { label: 'API',     value: '共用 LLM', mono: true },
          ] : []}
          onEdit={() => setEditing('ragas')}
        />
        <ConfigCard
          title="知识库" tag="检索/切分" tagColor="teal" loading={!settings}
          fields={settings ? [
            { label: 'Top-K',       value: settings.retrieval_top_k },
            { label: '候选池',      value: settings.retrieval_top_vector },
            { label: 'Rerank 阈值', value: settings.rerank_threshold },
            { label: '分块大小',    value: `${settings.chunk_size} tokens` },
            { label: '分块重叠',    value: `${settings.chunk_overlap} tokens` },
          ] : []}
          onEdit={() => setEditing('kb')}
        />
        <ConfigCard
          title="检索优化" tag="A/B" tagColor="rose" loading={!settings}
          fields={settings ? [
            { label: '语义缓存',     value: settings.use_cache                ? '启用' : '关闭', active: settings.use_cache },
            { label: '稀疏检索',     value: settings.use_sparse               ? '启用' : '关闭', active: settings.use_sparse },
            { label: '问题增强',     value: settings.use_question_augmentation ? '启用' : '关闭', active: settings.use_question_augmentation },
            { label: 'Small-to-Big', value: settings.use_small_to_big         ? '启用' : '关闭', active: settings.use_small_to_big },
          ] : []}
          onEdit={() => setEditing('flags')}
        />
      </div>

      <PromptVersions />

      {editing === 'llm' && (
        <LLMEditModal initial={settings} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
      {editing === 'embedding' && (
        <EmbeddingEditModal initial={settings} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
      {editing === 'ragas' && (
        <RagasEditModal initial={settings} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
      {editing === 'kb' && (
        <KbEditModal initial={settings} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
      {editing === 'flags' && (
        <RetrievalFlagsEditModal initial={settings} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />
      )}
    </div>
  )
}

const TAG_STYLES = {
  blue:   'bg-blue-50 text-blue-600',
  purple: 'bg-violet-50 text-violet-600',
  amber:  'bg-amber-50 text-amber-600',
  teal:   'bg-teal-50 text-teal-600',
  rose:   'bg-rose-50 text-rose-600',
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
        <button onClick={onEdit} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" title="编辑">
          <Icon name="edit" size={14} />
        </button>
      </div>
      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map(i => <div key={i} className="h-3.5 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : (
        <dl className="space-y-2">
          {fields.map(({ label, value, mono, truncate, active }) => (
            <div key={label} className="flex items-baseline gap-2">
              <dt className="text-[11px] text-slate-400 w-20 shrink-0">{label}</dt>
              {active !== undefined ? (
                <dd className={`text-[10px] font-semibold px-1.5 py-0.5 rounded leading-none ${active ? 'text-teal-600 bg-teal-50' : 'text-slate-400 bg-slate-100'}`}>
                  {value}
                </dd>
              ) : (
                <dd className={`text-xs text-slate-700 min-w-0 ${mono ? 'font-mono' : ''} ${truncate ? 'truncate' : ''}`}
                  title={truncate ? String(value) : undefined}>
                  {value ?? '—'}
                </dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

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
      <FormRow label="模型名称"><Input value={form.llm_model} onChange={v => set('llm_model', v)} placeholder="qwen-plus" /></FormRow>
      <FormRow label="API Base URL"><Input value={form.llm_api_base} onChange={v => set('llm_api_base', v)} /></FormRow>
      <FormRow label="API Key" hint={initial?.llm_api_key_masked || '未配置'}>
        <Input type="password" value={form.llm_api_key} onChange={v => set('llm_api_key', v)} placeholder="留空保留原密钥" />
      </FormRow>
      <div className="grid grid-cols-2 gap-4">
        <FormRow label="Max Tokens"><Input type="number" min={1} max={8000} value={form.llm_max_tokens} onChange={v => set('llm_max_tokens', Number(v))} /></FormRow>
        <FormRow label="Temperature"><Input type="number" min={0} max={2} step={0.05} value={form.llm_temperature} onChange={v => set('llm_temperature', Number(v))} /></FormRow>
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
      <FormRow label="模型名称"><Input value={form.embedding_model} onChange={v => set('embedding_model', v)} placeholder="text-embedding-v3" /></FormRow>
      <FormRow label="API Base URL" hint="留空共用 LLM"><Input value={form.embedding_api_base} onChange={v => set('embedding_api_base', v)} placeholder="留空共用 LLM" /></FormRow>
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
      <FormRow label="评估模型"><Input value={form.ragas_llm_model} onChange={v => setForm({ ragas_llm_model: v })} placeholder="qwen-turbo" /></FormRow>
      <p className="text-xs text-slate-400 mt-1 pl-[7.5rem]">API Key 与 Base URL 与 LLM 共用，保存后评估引擎自动重置。</p>
    </EditModal>
  )
}

const _NI = 'w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400'

function KbEditModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    retrieval_top_k:       initial?.retrieval_top_k       ?? 6,
    retrieval_top_vector:  initial?.retrieval_top_vector  ?? 50,
    rerank_threshold:      initial?.rerank_threshold      ?? 0.38,
    dense_score_threshold: initial?.dense_score_threshold ?? 0.0,
    rrf_alpha:             initial?.rrf_alpha             ?? 0.6,
    ef_search:             initial?.ef_search             ?? 40,
    chunk_size:            initial?.chunk_size            ?? 600,
    chunk_overlap:         initial?.chunk_overlap         ?? 80,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const num = (k, v) => setForm(f => ({ ...f, [k]: Number(v) || 0 }))

  async function save() {
    setSaving(true); setError('')
    try { await saveSettings(form); onSaved() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <EditModal title="编辑知识库配置" onClose={onClose} onSave={save} saving={saving} error={error}>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100">检索</p>
      <FormRow label="检索 Top-K" hint="每次检索返回的知识块数量，影响答案覆盖度">
        <input type="number" min="1" max="20" value={form.retrieval_top_k} onChange={e => num('retrieval_top_k', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="向量候选池" hint="向量召回候选数，越大精度越高但延迟增加">
        <input type="number" min="10" max="200" value={form.retrieval_top_vector} onChange={e => num('retrieval_top_vector', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="Rerank 阈值" hint="Rerank 分数过滤阈值（0–1），仅在 RERANK_PROVIDER=local 时生效">
        <input type="number" min="0" max="1" step="0.01" value={form.rerank_threshold} onChange={e => num('rerank_threshold', e.target.value)} className={_NI} />
      </FormRow>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100 mt-2">向量高级</p>
      <FormRow label="密集阈值" hint="cosine 相似度最低分（0 = 不过滤），过低可能引入噪声">
        <input type="number" min="0" max="1" step="0.01" value={form.dense_score_threshold} onChange={e => num('dense_score_threshold', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="RRF α" hint="加权 RRF 中密集路径的权重（0–1），1-α 为稀疏权重">
        <input type="number" min="0" max="1" step="0.05" value={form.rrf_alpha} onChange={e => num('rrf_alpha', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="ef_search" hint="HNSW 搜索扩展因子，越大召回率越高、延迟越高">
        <input type="number" min="10" max="500" step="10" value={form.ef_search} onChange={e => num('ef_search', e.target.value)} className={_NI} />
      </FormRow>
      <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pb-1 border-b border-slate-100 mt-2">切分</p>
      <FormRow label="分块大小" hint="单块 token 上限，变更后重新入库才生效">
        <input type="number" min="100" max="2000" step="50" value={form.chunk_size} onChange={e => num('chunk_size', e.target.value)} className={_NI} />
      </FormRow>
      <FormRow label="分块重叠" hint="相邻块共享的 token 数，保留上下文连贯性">
        <input type="number" min="0" max="500" step="10" value={form.chunk_overlap} onChange={e => num('chunk_overlap', e.target.value)} className={_NI} />
      </FormRow>
    </EditModal>
  )
}

function RetrievalFlagsEditModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    use_cache:                 initial?.use_cache                 ?? true,
    use_sparse:                initial?.use_sparse                ?? true,
    use_question_augmentation: initial?.use_question_augmentation ?? true,
    use_small_to_big:          initial?.use_small_to_big          ?? true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggle(k) { setForm(f => ({ ...f, [k]: !f[k] })) }

  async function save() {
    setSaving(true); setError('')
    try { await saveSettings(form); onSaved() }
    catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  const FLAGS = [
    { key: 'use_cache',                label: '语义缓存',     hint: 'Redis hash 缓存，相同语义查询直接返回，跳过检索' },
    { key: 'use_sparse',               label: '稀疏检索',     hint: '稀疏向量召回路径，仅 EMBEDDING_PROVIDER=local 时生效' },
    { key: 'use_question_augmentation', label: '问题增强',    hint: 'question_embeddings 第三召回路径，提升长尾问法命中率' },
    { key: 'use_small_to_big',         label: 'Small-to-Big', hint: '召回子块后扩展到父级 chunk，提供更完整上下文' },
  ]

  return (
    <EditModal title="编辑检索优化开关" onClose={onClose} onSave={save} saving={saving} error={error}>
      <p className="text-xs text-slate-400 -mt-1 mb-3">关闭某项技术后可与开启状态进行 A/B 对比观察。</p>
      <div className="space-y-4">
        {FLAGS.map(({ key, label, hint }) => (
          <div key={key} className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-700">{label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
            </div>
            <Toggle checked={form[key]} onChange={() => toggle(key)} />
          </div>
        ))}
      </div>
    </EditModal>
  )
}

const PROMPT_TYPE_OPTIONS = [
  { key: 'chat',    label: '对话 Prompt' },
  { key: 'rewrite', label: '问题改写' },
  { key: 'summary', label: '摘要总结' },
]
const PT_BADGE = {
  chat:    'bg-indigo-50 text-indigo-600',
  rewrite: 'bg-teal-50 text-teal-600',
  summary: 'bg-violet-50 text-violet-600',
}

function PromptVersions() {
  const [typeFilter, setTypeFilter] = useState('chat')
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [cache, setCache] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ version: '', note: '', content: '', prompt_type: 'chat' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const res = await apiFetch('/api/ops/prompts')
      setPrompts((await res.json()).prompts || [])
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  const filtered = prompts.filter(p => (p.prompt_type || 'chat') === typeFilter)

  async function openView(version) {
    let content = cache[version]
    if (content === undefined) {
      try {
        const res = await apiFetch(`/api/ops/prompts/${encodeURIComponent(version)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        content = (await res.json()).content ?? ''
        setCache(c => ({ ...c, [version]: content }))
      } catch (e) { setError(e.message); return }
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
      setShowNew(false); setNewForm({ version: '', note: '', content: '', prompt_type: typeFilter }); await load()
    } catch { setError('网络错误') } finally { setSaving(false) }
  }

  function openNew() {
    const active = filtered.find(p => p.is_active)
    const prefill = active && cache[active.version] ? cache[active.version] : ''
    setError(''); setShowNew(true)
    setNewForm({ version: '', note: '', content: prefill, prompt_type: typeFilter })
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold text-slate-800">Prompt 版本</span>
            <div className="flex gap-0.5">
              {PROMPT_TYPE_OPTIONS.map(t => (
                <button key={t.key} onClick={() => setTypeFilter(t.key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    typeFilter === t.key
                      ? 'bg-slate-100 text-slate-700'
                      : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                  }`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button onClick={openNew}
            className="h-7 px-3 text-xs font-medium rounded-md border border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors">
            + 新建
          </button>
        </div>
        {loading ? (
          <div className="px-5 py-4 text-sm text-slate-400">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-4 text-sm text-slate-400">该类型暂无版本</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {[...filtered].reverse().map(p => (
              <div key={p.version}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${p.is_active ? 'bg-indigo-50/40' : 'hover:bg-slate-50/60'}`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${p.is_active ? 'bg-indigo-500' : 'bg-slate-200'}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${p.is_active ? 'text-indigo-700' : 'text-slate-700'}`}>{p.version}</span>
                    {p.is_active && <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded uppercase tracking-wide">生产</span>}
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${PT_BADGE[p.prompt_type || 'chat'] || 'bg-slate-50 text-slate-500'}`}>
                      {PROMPT_TYPE_OPTIONS.find(t => t.key === (p.prompt_type || 'chat'))?.label || p.prompt_type}
                    </span>
                    {p.note && <span className="text-xs text-slate-400">{p.note}</span>}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">{p.created_at?.replace('T', ' ').slice(0, 16)}</p>
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
          <div className="grid grid-cols-3 gap-3 mb-3">
            <FormRow label="版本号 *"><Input placeholder="v4.0.0" value={newForm.version} onChange={v => setNewForm(f => ({ ...f, version: v }))} /></FormRow>
            <FormRow label="说明"><Input placeholder="简短描述" value={newForm.note} onChange={v => setNewForm(f => ({ ...f, note: v }))} /></FormRow>
            <FormRow label="类型">
              <select value={newForm.prompt_type} onChange={e => setNewForm(f => ({ ...f, prompt_type: e.target.value }))}
                className="w-full h-8 border border-slate-200 rounded-lg px-2.5 text-sm text-slate-700 focus:outline-none focus:border-indigo-400 bg-white">
                {PROMPT_TYPE_OPTIONS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
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
            <button disabled={!newForm.version.trim() || !newForm.content.trim() || saving} onClick={create}
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

// ══════════════════════════════════════════════════════════════════════════════
// 基础配置
// ══════════════════════════════════════════════════════════════════════════════

function BasicTab() {
  const config = useBasicConfig()

  return (
    <div className="space-y-4">
      <BasicSection
        title="文档类型" tag="doc_type" desc="用于文档分类，影响检索过滤与统计维度"
        items={config.doc_types}
        onSave={list => updateBasicConfig('doc_types', list)}
      />
      <BasicSection
        title="分类" tag="category" desc="文档内容分类，用于精细化检索过滤"
        items={config.categories}
        onSave={list => updateBasicConfig('categories', list)}
      />
      <TagSection
        items={config.tag_presets}
        onSave={list => updateBasicConfig('tag_presets', list)}
      />
      <BasicSection
        title="项目组" tag="group_id" desc="文档归属的项目组，用于权限隔离与检索范围控制"
        items={config.groups}
        onSave={list => updateBasicConfig('groups', list)}
        canDelete={false}
      />
    </div>
  )
}

function BasicSection({ title, tag, desc, items, onSave, canDelete = true }) {
  const [list, setList] = useState(items || [])
  const [editIdx, setEditIdx] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { setList(items || []); setDirty(false); setEditIdx(null) }, [items])

  function startEdit(idx) {
    setEditIdx(idx); setEditLabel(list[idx].label); setErr('')
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select() }, 0)
  }

  function commitEdit() {
    if (editIdx === null) return
    const l = editLabel.trim()
    if (l && l !== list[editIdx].label) {
      const next = [...list]; next[editIdx] = { ...next[editIdx], label: l }
      setList(next); setDirty(true)
    }
    setEditIdx(null); setErr('')
  }

  function remove(idx) {
    setList(prev => prev.filter((_, i) => i !== idx)); setDirty(true)
  }

  function add() {
    const v = newValue.trim(); const l = newLabel.trim()
    if (!v || !l) return
    if (list.some(i => i.value === v)) { setErr(`"${v}" 已存在`); return }
    setList(prev => [...prev, { value: v, label: l }])
    setNewValue(''); setNewLabel(''); setDirty(true); setErr('')
  }

  async function save() {
    setSaving(true); setErr('')
    try { await onSave(list); setDirty(false) }
    catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{tag}</span>
        </div>
        {dirty && (
          <button onClick={save} disabled={saving}
            className="h-6 px-3 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            {saving ? '保存…' : '保存'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-3">{desc}</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {list.map((item, idx) => (
          editIdx === idx ? (
            <div key={item.value}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-300 bg-indigo-50">
              <span className="text-[11px] font-mono text-slate-400">{item.value}</span>
              <span className="text-slate-300 mx-0.5">·</span>
              <input ref={inputRef} value={editLabel} onChange={e => setEditLabel(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditIdx(null) }}
                className="h-5 w-20 text-xs font-medium bg-transparent border-b border-indigo-400 focus:outline-none text-indigo-700" />
            </div>
          ) : (
            <div key={item.value}
              className="group flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-100 bg-slate-50">
              <span className="text-[11px] font-mono text-slate-400">{item.value}</span>
              <span className="text-slate-200 mx-0.5">·</span>
              <button onClick={() => startEdit(idx)} title="点击编辑名称"
                className="text-xs text-slate-700 font-medium hover:text-indigo-600 transition-colors">
                {item.label}
              </button>
              {canDelete && (
                <button onClick={() => remove(idx)}
                  className="ml-0.5 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm leading-none">
                  ×
                </button>
              )}
            </div>
          )
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input value={newValue} onChange={e => setNewValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} placeholder="标识 key"
          className="h-7 w-28 border border-slate-200 rounded-lg px-2 text-xs font-mono focus:outline-none focus:border-indigo-400" />
        <input value={newLabel} onChange={e => setNewLabel(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} placeholder="显示名称"
          className="h-7 w-24 border border-slate-200 rounded-lg px-2 text-xs focus:outline-none focus:border-indigo-400" />
        <button onClick={add} disabled={!newValue.trim() || !newLabel.trim()}
          className="h-7 px-2.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
          + 添加
        </button>
      </div>
      {err && <p className="text-xs text-red-500 mt-1.5">{err}</p>}
    </div>
  )
}

function TagSection({ items, onSave }) {
  const [list, setList] = useState(items || [])
  const [editIdx, setEditIdx] = useState(null)
  const [editVal, setEditVal] = useState('')
  const [newTag, setNewTag] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef(null)

  useEffect(() => { setList(items || []); setDirty(false); setEditIdx(null) }, [items])

  function startEdit(idx) {
    setEditIdx(idx); setEditVal(list[idx]); setErr('')
    setTimeout(() => inputRef.current?.select(), 0)
  }

  function commitEdit() {
    if (editIdx === null) return
    const v = editVal.trim()
    if (v && v !== list[editIdx] && list.includes(v)) { setErr(`"${v}" 已存在`); return }
    if (v && v !== list[editIdx]) {
      const next = [...list]; next[editIdx] = v
      setList(next); setDirty(true)
    }
    setEditIdx(null); setErr('')
  }

  function remove(idx) {
    setList(prev => prev.filter((_, i) => i !== idx)); setDirty(true); setEditIdx(null)
  }

  function add() {
    const t = newTag.trim()
    if (!t) return
    if (list.includes(t)) { setErr(`"${t}" 已存在`); return }
    setList(prev => [...prev, t]); setNewTag(''); setDirty(true); setErr('')
  }

  async function save() {
    setSaving(true); setErr('')
    try { await onSave(list); setDirty(false) }
    catch (e) { setErr(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800">预设标签</p>
          <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">tags</span>
        </div>
        {dirty && (
          <button onClick={save} disabled={saving}
            className="h-6 px-3 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40 transition-colors">
            {saving ? '保存…' : '保存'}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400 mb-3">点击标签可编辑名称，上传/编辑时可多选</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {list.map((tag, idx) => (
          editIdx === idx ? (
            <input
              key={idx} ref={inputRef} value={editVal}
              onChange={e => setEditVal(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditIdx(null) }}
              className="h-7 px-2.5 rounded-full text-xs border border-indigo-300 bg-indigo-50 text-indigo-700 font-medium focus:outline-none min-w-[4rem] w-24"
            />
          ) : (
            <div key={tag} className="group flex items-center rounded-full bg-slate-100 text-slate-600">
              <button onClick={() => startEdit(idx)} title="点击编辑"
                className="pl-2.5 pr-1.5 py-1 text-xs font-medium hover:bg-slate-200 rounded-l-full transition-colors">
                {tag}
              </button>
              <button onClick={() => remove(idx)}
                className="pr-2 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity text-sm leading-none">
                ×
              </button>
            </div>
          )
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input value={newTag} onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} placeholder="新标签名"
          className="h-7 w-32 border border-slate-200 rounded-lg px-2 text-xs focus:outline-none focus:border-indigo-400" />
        <button onClick={add} disabled={!newTag.trim()}
          className="h-7 px-2.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
          + 添加
        </button>
      </div>
      {err && <p className="text-xs text-red-500 mt-1.5">{err}</p>}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 工单配置
// ══════════════════════════════════════════════════════════════════════════════

function TicketTab() {
  const [configs, setConfigs] = useState([])
  const [editing, setEditing] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successKey, setSuccessKey] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ticket-links')
      setConfigs(await res.json())
    } catch {
      setError('加载配置失败，请刷新重试')
    }
  }, [])

  useEffect(() => { load() }, [load])

  function startEdit(cfg) { setEditing({ ...cfg }); setError('') }
  function cancelEdit() { setEditing(null); setError('') }

  async function save() {
    if (!editing.label.trim()) { setError('显示名称不能为空'); return }
    if (!editing.form_url.trim()) { setError('表单 URL 不能为空'); return }
    if (!/^https?:\/\//.test(editing.form_url)) { setError('表单 URL 必须以 http:// 或 https:// 开头'); return }
    setSaving(true); setError('')
    try {
      const res = await apiFetch(`/api/ticket-links/${editing.ticket_type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: editing.label, form_url: editing.form_url, enabled: editing.enabled }),
      })
      if (!res.ok) { setError((await res.json().catch(() => ({}))).detail || '保存失败，请重试'); return }
      setSuccessKey(editing.ticket_type)
      setTimeout(() => setSuccessKey(''), 2000)
      setEditing(null)
      await load()
    } catch { setError('网络错误，请重试') } finally { setSaving(false) }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <div className="px-5 py-4 border-b border-slate-100">
        <p className="text-sm font-semibold text-slate-800">工单链接配置</p>
        <p className="text-xs text-slate-400 mt-1">
          配置各工单类型的表单链接。AI 工具节点（自动创建）和转派节点（兜底链接）均读取此配置，修改后立即生效。
        </p>
      </div>

      <div className="divide-y divide-slate-100 px-5">
        {configs.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">暂无配置，请检查数据库是否已完成初始化</p>
        )}
        {configs.map(cfg => (
          <div key={cfg.ticket_type} className="py-4 flex items-center gap-4">
            <div className="w-36 shrink-0">
              <p className="text-sm font-medium text-slate-800">{cfg.label}</p>
              <p className="text-xs font-mono text-slate-400 mt-0.5">{cfg.ticket_type}</p>
            </div>
            <div className="flex-1 min-w-0">
              <a href={cfg.form_url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-indigo-500 hover:underline break-all">
                {cfg.form_url}
              </a>
            </div>
            <div className="w-14 shrink-0 text-center">
              <Badge tone={cfg.enabled ? 'green' : 'slate'}>{cfg.enabled ? '启用' : '停用'}</Badge>
            </div>
            {successKey === cfg.ticket_type && <span className="text-xs text-green-500 shrink-0">已保存 ✓</span>}
            <Button variant="ghost" onClick={() => startEdit(cfg)}>编辑</Button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">编辑工单链接</h2>
              <p className="text-xs text-slate-400 mt-0.5 font-mono">{editing.ticket_type}</p>
            </div>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-600">显示名称</span>
                <input className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={editing.label} onChange={e => setEditing({ ...editing, label: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">表单 URL</span>
                <input className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={editing.form_url} onChange={e => setEditing({ ...editing, form_url: e.target.value })}
                  placeholder="https://example.com/tickets/new" />
                <p className="text-[11px] text-slate-400 mt-1">系统将自动追加 ?type=&session=&prefill= 参数，此处填写基础地址即可</p>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                <input type="checkbox" className="w-4 h-4 rounded accent-indigo-600"
                  checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} />
                <span className="text-sm text-slate-700">启用此工单类型</span>
                {!editing.enabled && <span className="text-xs text-amber-500">停用后 AI 将回退"请联系人工客服"提示</span>}
              </label>
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="ghost" onClick={cancelEdit} disabled={saving}>取消</Button>
              <Button variant="primary" onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// 公用原语
// ══════════════════════════════════════════════════════════════════════════════

function EditModal({ title, children, onClose, onSave, saving, error }) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="space-y-3">{children}</div>
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
        {hint && <span className="text-xs text-slate-400 truncate min-w-0 cursor-default" title={hint}>{hint}</span>}
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

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${checked ? 'bg-indigo-500' : 'bg-slate-200'}`}
    >
      <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}
