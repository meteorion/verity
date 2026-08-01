import { useState, useEffect } from 'react'
import { providerConfig, paramConfig } from '../mock/data.js'
import { Card, Badge, Button, Select } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { apiFetch } from '../auth.js'

// Provider 模式配置面板，对应 arch.md §3.3 环境变量矩阵
// 修改后应写入 .env 并重启 app 容器（生产环境建议走审批流程，而非直接热改）

const PROVIDER_OPTIONS = {
  embedding: ['api', 'local'],
  rerank: ['none', 'local'],
  nli: ['none', 'local'],
  llm: ['anthropic', 'litellm']
}

export default function ModelConfig() {
  const [config, setConfig] = useState(providerConfig)
  const [params, setParams] = useState(paramConfig)
  const [canary, setCanary] = useState(20)

  function updateProvider(key, value) {
    setConfig((c) => ({ ...c, [key]: { ...c[key], provider: value } }))
  }

  return (
    <div className="space-y-5">
      <Card title="推理 Provider 模式" action={<Badge tone="blue">切换需走蓝绿索引重建 + 金标回归</Badge>}>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          {Object.entries(config).map(([key, conf]) => (
            <div key={key} className="border border-slate-100 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase mb-1">{key}</p>
              <Select
                value={conf.provider}
                onChange={(v) => updateProvider(key, v)}
                options={PROVIDER_OPTIONS[key]}
                className="w-full mb-2"
                size="md"
              />
              <p className="text-xs text-slate-500">{conf.model}</p>
              {conf.fallback && <p className="text-xs text-slate-400">fallback: {conf.fallback}</p>}
            </div>
          ))}
        </div>
      </Card>

      <Card title="核心参数">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
          <ParamField label="chunk_size (tokens)" value={params.chunk_size} onChange={(v) => setParams({ ...params, chunk_size: v })} />
          <ParamField label="chunk_overlap (tokens)" value={params.chunk_overlap} onChange={(v) => setParams({ ...params, chunk_overlap: v })} />
          <ParamField label="向量召回 Top-K" value={params.vector_top_k} onChange={(v) => setParams({ ...params, vector_top_k: v })} />
          <ParamField label="Rerank 输出 Top-K" value={params.rerank_top_k} onChange={(v) => setParams({ ...params, rerank_top_k: v })} />
          <ParamField label="RRF k" value={params.rrf_k} onChange={(v) => setParams({ ...params, rrf_k: v })} />
          <ParamField label="相关性阈值" value={params.relevance_threshold} step="0.01" onChange={(v) => setParams({ ...params, relevance_threshold: v })} />
          <ParamField label="temperature" value={params.temperature} step="0.1" onChange={(v) => setParams({ ...params, temperature: v })} />
          <ParamField label="max_tokens" value={params.max_tokens} onChange={(v) => setParams({ ...params, max_tokens: v })} />
          <ParamField
            label="语义缓存阈值"
            value={params.semantic_cache_threshold}
            step="0.01"
            onChange={(v) => setParams({ ...params, semantic_cache_threshold: v })}
          />
          <ParamField label="历史保留轮次" value={params.history_turns} onChange={(v) => setParams({ ...params, history_turns: v })} />
        </div>
        <div className="flex justify-end mt-4">
          <Button variant="primary" size="sm">保存参数（需回归验证）</Button>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <PromptVersions />

        <Card title="灰度发布">
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">当前灰度流量</span>
              <span className="font-semibold text-indigo-600">{canary}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={canary}
              onChange={(e) => setCanary(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex items-center gap-2 text-xs text-slate-400">
              {[5, 20, 50, 100].map((s) => (
                <span key={s} className={canary >= s ? 'text-indigo-500 font-medium' : ''}>{s}%</span>
              ))}
            </div>
            <div className="bg-amber-50 text-amber-700 text-xs rounded-lg px-3 py-2">
              每阶段观察 48 小时，异常时点击下方一键回滚 / 熔断降级为 FAQ + 转人工。
            </div>
            <div className="flex gap-2 pt-1">
              <Button size="sm" variant="danger">一键回滚</Button>
              <Button size="sm" variant="default">熔断降级</Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

function PromptVersions() {
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activating, setActivating] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [contentCache, setContentCache] = useState({})
  const [showNew, setShowNew] = useState(false)
  const [newForm, setNewForm] = useState({ version: '', note: '', content: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function loadPrompts() {
    try {
      const res = await apiFetch('/api/ops/prompts')
      const data = await res.json()
      // show newest first
      setPrompts([...(data.prompts || [])].reverse())
    } catch (e) {
      console.error('Failed to load prompts', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadPrompts() }, [])

  async function toggleContent(version) {
    if (expanded === version) {
      setExpanded(null)
      return
    }
    if (!contentCache[version]) {
      try {
        const res = await apiFetch(`/api/ops/prompts/${encodeURIComponent(version)}`)
        const data = await res.json()
        setContentCache((c) => ({ ...c, [version]: data.content }))
      } catch (e) {
        console.error('Failed to load prompt content', e)
        return
      }
    }
    setExpanded(version)
  }

  async function activateVersion(version) {
    setActivating(version)
    try {
      await apiFetch(`/api/ops/prompts/${encodeURIComponent(version)}/activate`, { method: 'POST' })
      await loadPrompts()
    } catch (e) {
      console.error('Failed to activate prompt', e)
    } finally {
      setActivating(null)
    }
  }

  async function createVersion() {
    if (!newForm.version.trim() || !newForm.content.trim()) return
    setSaving(true)
    setError('')
    try {
      const res = await apiFetch('/api/ops/prompts', {
        method: 'POST',
        body: JSON.stringify(newForm),
      })
      if (res.status === 409) {
        setError(`版本号 "${newForm.version}" 已存在`)
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.detail || '保存失败')
        return
      }
      setShowNew(false)
      setNewForm({ version: '', note: '', content: '' })
      await loadPrompts()
    } catch (e) {
      setError('网络错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  function openNew() {
    // Pre-fill content from the current active prompt for easy editing
    const active = prompts.find((p) => p.active)
    if (active && contentCache[active.version]) {
      setNewForm((f) => ({ ...f, content: contentCache[active.version] }))
    }
    setError('')
    setShowNew(true)
  }

  return (
    <>
      <Card title="Prompt 版本管理" action={
        <Button size="sm" variant="primary" onClick={openNew}>+ 新建版本</Button>
      }>
        {loading ? (
          <p className="text-sm text-slate-400 py-2">加载中…</p>
        ) : prompts.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">暂无版本</p>
        ) : (
          <div className="space-y-2">
            {prompts.map((p) => (
              <div key={p.version}>
                <div className="flex items-center justify-between border border-slate-100 rounded-lg px-3 py-2">
                  <div className="flex-1 min-w-0 mr-2">
                    <p className="text-sm font-medium text-slate-800 flex items-center gap-2 flex-wrap">
                      {p.version}
                      {p.active && <Badge tone="green">当前生产</Badge>}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{p.created_at}{p.note ? ` · ${p.note}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => toggleContent(p.version)}>
                      {expanded === p.version ? '收起' : '查看'}
                    </Button>
                    {!p.active && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={activating === p.version}
                        onClick={() => activateVersion(p.version)}
                      >
                        <Icon name="refresh" size={13} />
                        {activating === p.version ? '激活中…' : '激活'}
                      </Button>
                    )}
                  </div>
                </div>
                {expanded === p.version && contentCache[p.version] && (
                  <div className="mt-1 border border-slate-100 rounded-lg bg-slate-50 p-3 max-h-56 overflow-y-auto">
                    <pre className="text-[11px] text-slate-600 whitespace-pre-wrap font-mono leading-relaxed">
                      {contentCache[p.version]}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {showNew && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
          onClick={(e) => { if (e.target === e.currentTarget) setShowNew(false) }}
        >
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-800">新建 Prompt 版本</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500">版本号 *</label>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="例如 v2.0.0"
                  value={newForm.version}
                  onChange={(e) => setNewForm((f) => ({ ...f, version: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">说明</label>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  placeholder="简短描述变更内容"
                  value={newForm.note}
                  onChange={(e) => setNewForm((f) => ({ ...f, note: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500">Prompt 内容 *</label>
              <textarea
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono h-64 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-300"
                placeholder="在此输入 System Prompt 内容…"
                value={newForm.content}
                onChange={(e) => setNewForm((f) => ({ ...f, content: e.target.value }))}
              />
            </div>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="default" size="sm" onClick={() => { setShowNew(false); setError('') }}>取消</Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!newForm.version.trim() || !newForm.content.trim() || saving}
                onClick={createVersion}
              >
                {saving ? '保存中…' : '保存版本'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ParamField({ label, value, onChange, step = '1' }) {
  return (
    <div>
      <label className="text-xs text-slate-400">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5"
      />
    </div>
  )
}
