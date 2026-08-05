import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Select } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { apiFetch } from '../auth.js'

const VIEWS = { DATASETS: 'datasets', DATASET_DETAIL: 'dataset_detail', RECORDS: 'records' }

const SOURCE_LABEL = { manual: '手动创建', file: '文件导入', kb_sample: '知识库采样' }
const SOURCE_TONE  = { manual: 'slate', file: 'blue', kb_sample: 'purple' }

// 无需 ground_truth 的指标排前，需要 ground_truth 的排后。
// answer_semantic_similarity 已移除：它是 answer_correctness 的内部子步骤（SemanticSimilarity
// 被注入进 AnswerCorrectness），单独运行只会重复 embedding 调用而不提供额外信息。
const ALL_METRICS = [
  {
    key: 'context_relevancy', label: '上下文相关性', sub: 'Context Relevancy', needsGt: false,
    affect: '受 Embedding 模型、分块粒度影响',
    when: '无需标准答案，快速检验检索质量的首选指标',
  },
  {
    key: 'faithfulness', label: '忠实度', sub: 'Faithfulness', needsGt: false,
    affect: '受 LLM 模型、温度影响',
    when: '检测幻觉 — 生成答案是否完全基于检索上下文',
  },
  {
    key: 'answer_relevancy', label: '答案相关性', sub: 'Answer Relevancy', needsGt: false,
    affect: '受 LLM 模型、Prompt 设计影响',
    when: '无需标准答案，评估回答是否切题、是否回避问题',
  },
  {
    key: 'context_recall', label: '上下文召回率', sub: 'Context Recall', needsGt: true,
    affect: '受 Top-K、分块策略影响',
    when: '诊断检索遗漏 — 标准答案所需信息是否被完整检索到',
  },
  {
    key: 'answer_correctness', label: '答案正确性', sub: 'Answer Correctness', needsGt: true,
    affect: '受检索质量、LLM 生成双重影响',
    when: 'RAG 端到端核心指标，综合衡量事实准确性与语义匹配（含语义相似度）',
  },
  {
    key: 'context_precision', label: '上下文精确率', sub: 'Context Precision', needsGt: true,
    affect: '受 Top-K、Embedding 模型影响',
    when: '诊断检索噪音 — 仅在需精确定位"过度检索"问题时启用',
  },
]
const DEFAULT_METRICS = ['context_relevancy', 'faithfulness', 'answer_relevancy', 'context_recall', 'answer_correctness']

const EVAL_PRESETS = [
  {
    key: 'quick',
    label: '快速体检',
    desc: '无需标注，最省调用',
    metrics: ['context_relevancy', 'faithfulness', 'answer_relevancy'],
    topK: 5,
    temperature: 0,
  },
  {
    key: 'full',
    label: '完整评估',
    desc: '有 ground_truth 时的推荐配置',
    metrics: DEFAULT_METRICS,
    topK: 5,
    temperature: 0,
  },
  {
    key: 'retrieval',
    label: '检索诊断',
    desc: '定位检索遗漏与噪音，Top-K 放大',
    metrics: ['context_relevancy', 'context_recall', 'context_precision'],
    topK: 10,
    temperature: 0,
  },
  {
    key: 'hallucination',
    label: '幻觉检测',
    desc: '专注生成层，不依赖标注',
    metrics: ['faithfulness', 'answer_relevancy'],
    topK: 5,
    temperature: 0,
  },
]
const DEFAULT_EVAL_CONFIG = {
  topK: 5,
  temperature: 0,
  metrics: DEFAULT_METRICS,
}

function fmtDate(iso) {
  if (!iso) return '-'
  return String(iso).replace('T', ' ').slice(0, 16)
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function Evaluation() {
  const [view, setView] = useState(VIEWS.DATASETS)
  const [selectedDatasetId, setSelectedDatasetId] = useState(null)
  const [prevView, setPrevView] = useState(VIEWS.DATASETS)

  const goRecords = (from) => { setPrevView(from); setView(VIEWS.RECORDS) }

  if (view === VIEWS.DATASET_DETAIL) {
    return (
      <DatasetDetailView
        datasetId={selectedDatasetId}
        onBack={() => setView(VIEWS.DATASETS)}
        onViewRecords={() => goRecords(VIEWS.DATASET_DETAIL)}
      />
    )
  }
  if (view === VIEWS.RECORDS) {
    return (
      <RecordsView
        onBack={() => setView(prevView)}
        backLabel={prevView === VIEWS.DATASET_DETAIL ? '返回数据集详情' : '返回数据集列表'}
      />
    )
  }
  return (
    <DatasetListView
      onEnterDataset={(id) => { setSelectedDatasetId(id); setView(VIEWS.DATASET_DETAIL) }}
      onViewRecords={() => goRecords(VIEWS.DATASETS)}
    />
  )
}

// ── Dataset List ───────────────────────────────────────────────────────────

function DatasetListView({ onEnterDataset, onViewRecords }) {
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [showGenerate, setShowGenerate] = useState(false)
  const [editingDataset, setEditingDataset] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch('/api/eval/datasets')
      setDatasets((await res.json()).datasets ?? [])
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteDataset(id, e) {
    e.stopPropagation()
    if (!confirm('确认删除数据集？所有关联评估记录将被永久移除。')) return
    try {
      const res = await apiFetch(`/api/eval/datasets/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      load()
    } catch (e) { alert(`删除失败：${e.message}`) }
  }

  if (error) return (
    <div className="flex items-center gap-2 justify-center h-48 text-sm text-red-500">
      加载失败：{error}
      <button className="text-indigo-500 underline" onClick={load}>重试</button>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onViewRecords}>
            <Icon name="chart" size={14} /> 评估记录
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={14} /> 创建数据集
          </Button>
          <Button size="sm" onClick={() => setShowUpload(true)}>
            <Icon name="upload" size={14} /> 文件导入
          </Button>
          <Button size="sm" onClick={() => setShowGenerate(true)}>
            <Icon name="refresh-cw" size={14} /> 知识库生成
          </Button>
        </div>
      </div>

      {loading && <p className="text-xs text-slate-400 text-center py-16">加载中…</p>}
      {!loading && datasets.length === 0 && (
        <div className="text-center py-16 space-y-3">
          <Icon name="book" size={32} className="mx-auto text-slate-300" />
          <p className="text-sm text-slate-400">暂无评估数据集</p>
          <p className="text-xs text-slate-300">创建数据集后即可开始 Ragas 评估</p>
        </div>
      )}
      {!loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {datasets.map((ds) => (
            <div
              key={ds.dataset_id}
              className="bg-white rounded-xl border border-slate-200 p-5 hover:border-indigo-200 hover:shadow-sm transition-all cursor-pointer group"
              onClick={() => onEnterDataset(ds.dataset_id)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-slate-800 truncate">{ds.name}</h3>
                  {ds.description && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{ds.description}</p>
                  )}
                </div>
                <Badge tone={SOURCE_TONE[ds.source_type] || 'slate'}>
                  {SOURCE_LABEL[ds.source_type] || ds.source_type}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400 mb-3">
                <span className="flex items-center gap-1">
                  <Icon name="book" size={12} />{ds.item_count ?? 0} 条数据
                </span>
                <span>{fmtDate(ds.updated_at)}</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-slate-50">
                <span className="text-xs text-indigo-500 group-hover:text-indigo-600 font-medium">
                  进入数据集 →
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingDataset(ds) }}
                    className="text-slate-300 hover:text-indigo-500 transition-colors p-1"
                    title="编辑"
                  >
                    <Icon name="edit" size={13} />
                  </button>
                  <button
                    onClick={(e) => deleteDataset(ds.dataset_id, e)}
                    className="text-slate-300 hover:text-red-500 transition-colors p-1"
                    title="删除"
                  >
                    <Icon name="trash-2" size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <DatasetFormModal
          title="创建数据集"
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); load() }}
        />
      )}
      {showUpload && (
        <UploadDatasetModal
          onClose={() => setShowUpload(false)}
          onSuccess={() => { setShowUpload(false); load() }}
        />
      )}
      {showGenerate && (
        <GenerateDatasetModal
          onClose={() => setShowGenerate(false)}
          onSuccess={() => { setShowGenerate(false); load() }}
        />
      )}
      {editingDataset && (
        <DatasetFormModal
          title="编辑数据集"
          initial={editingDataset}
          onClose={() => setEditingDataset(null)}
          onSuccess={() => { setEditingDataset(null); load() }}
        />
      )}
    </div>
  )
}

// ── Dataset Detail ─────────────────────────────────────────────────────────

function DatasetDetailView({ datasetId, onBack, onViewRecords }) {
  const [dataset, setDataset] = useState(null)
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editingItem, setEditingItem] = useState(null)
  const [running, setRunning] = useState(false)
  const [batchResult, setBatchResult] = useState(null)
  const [singleResult, setSingleResult] = useState(null)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [activeBatch, setActiveBatch] = useState(null)  // {id, total, completed, status}
  const [page, setPage] = useState(0)
  const [evalTarget, setEvalTarget] = useState(null)    // {mode:'single',itemId} | {mode:'batch'}
  const [evalConfig, setEvalConfig] = useState(DEFAULT_EVAL_CONFIG)
  const pageSize = 20

  const loadData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [dsRes, itemsRes] = await Promise.all([
        apiFetch(`/api/eval/datasets/${datasetId}`),
        apiFetch(`/api/eval/datasets/${datasetId}/items?limit=${pageSize}&offset=${page * pageSize}`),
      ])
      setDataset(await dsRes.json())
      const it = await itemsRes.json()
      setItems(it.items ?? [])
      setTotal(it.total ?? 0)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [datasetId, page])

  useEffect(() => { loadData() }, [loadData])

  async function deleteItem(itemId) {
    if (!confirm('确认删除该条目？')) return
    try {
      const res = await apiFetch(`/api/eval/datasets/${datasetId}/items/${itemId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text())
      loadData()
    } catch (e) { alert(`删除失败：${e.message}`) }
  }

  async function runSingle(itemId, config) {
    setRunning(true); setSingleResult(null); setBatchResult(null)
    try {
      const res = await apiFetch(`/api/eval/datasets/${datasetId}/items/${itemId}/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ top_k: config.topK, temperature: config.temperature, metrics: config.metrics }),
      })
      if (!res.ok) throw new Error(await res.text())
      setSingleResult(await res.json())
    } catch (e) { alert(`评估失败：${e.message}`) }
    finally { setRunning(false) }
  }

  async function runBatch(config) {
    setBatchResult(null); setSingleResult(null)
    try {
      const body = { top_k: config.topK, temperature: config.temperature, metrics: config.metrics }
      if (selectedIds.size > 0) body.item_ids = [...selectedIds]
      const res = await apiFetch(`/api/eval/datasets/${datasetId}/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || '存在进行中的批量评估，请稍后再试')
        return
      }
      if (!res.ok) throw new Error(await res.text())
      const { job_id, batch_record_id, total_items } = await res.json()
      setActiveBatch({ id: batch_record_id, jobId: job_id, total: total_items, completed: 0, status: 'running' })
      setSelectedIds(new Set())
    } catch (e) { alert(`批量评估失败：${e.message}`) }
  }

  async function cancelBatch() {
    if (!activeBatch?.jobId) return
    try {
      await apiFetch(`/api/jobs/${activeBatch.jobId}/cancel`, { method: 'POST' })
    } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!activeBatch || activeBatch.status !== 'running') return
    const timer = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/eval/batches/${activeBatch.id}`)
        const data = await res.json()
        if (data.status === 'running') {
          setActiveBatch(prev => ({ ...prev, completed: data.completed_items }))
        } else {
          setActiveBatch(null)
          if (data.status === 'completed') setBatchResult(data)
          else if (data.status === 'cancelled') { /* user cancelled — no alert */ }
          else alert(`批量评估失败：${data.error_msg || '未知错误'}`)
        }
      } catch (e) { /* network hiccup, retry next tick */ }
    }, 2000)
    return () => clearInterval(timer)
  }, [activeBatch])

  function toggleSelect(itemId) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(itemId) ? next.delete(itemId) : next.add(itemId)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === items.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(items.map(i => i.item_id)))
    }
  }

  const totalPages = Math.ceil(total / pageSize)

  if (error) return (
    <div className="space-y-3">
      <BackLink onClick={onBack} />
      <div className="flex items-center gap-2 justify-center h-48 text-sm text-red-500">
        加载失败：{error}
        <button className="text-indigo-500 underline" onClick={loadData}>重试</button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <BackLink onClick={onBack} />
          {dataset && (
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{dataset.name}</h2>
              <p className="text-xs text-slate-400">
                {dataset.item_count} 条数据 · {SOURCE_LABEL[dataset.source_type] || dataset.source_type}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onViewRecords}>
            <Icon name="chart" size={14} /> 评估记录
          </Button>
          <Button size="sm" onClick={() => setEditingItem('new')}>
            <Icon name="plus" size={14} /> 添加条目
          </Button>
          <div className="flex flex-col items-end gap-0.5">
            <Button
              variant="primary" size="sm"
              onClick={() => setEvalTarget({ mode: 'batch' })}
              disabled={running || items.length === 0 || !!batchResult || !!activeBatch}
              title={batchResult ? '已有批次结果，请关闭结果面板后再次发起' : ''}
            >
              <Icon name="play" size={14} />
              {activeBatch
                ? `评估中 ${activeBatch.completed}/${activeBatch.total}`
                : selectedIds.size > 0
                  ? `评估选中（${selectedIds.size}）`
                  : `批量评估全部`}
            </Button>
            {batchResult && (
              <span className="text-[10px] text-amber-500">关闭结果后可重新发起</span>
            )}
          </div>
        </div>
      </div>

      {/* Result panels */}
      {batchResult && <BatchResultPanel result={batchResult} onClose={() => setBatchResult(null)} />}
      {singleResult && <SingleResultPanel result={singleResult} onClose={() => setSingleResult(null)} />}

      {/* Items table */}
      {loading ? (
        <p className="text-xs text-slate-400 text-center py-16">加载中…</p>
      ) : items.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <Icon name="book" size={32} className="mx-auto text-slate-300" />
          <p className="text-sm text-slate-400">暂无数据条目</p>
          <p className="text-xs text-slate-300">添加「问题 + 标准答案」对来构建 Ragas 评估数据集</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="max-h-[540px] overflow-auto">
              <table className="w-full text-sm table-fixed">
                <thead>
                  <tr className="text-left text-xs text-slate-400 border-b border-slate-100 sticky top-0 bg-white z-10">
                    <th className="w-8 px-3 py-2">
                      <input
                        type="checkbox"
                        className="rounded border-slate-300 text-indigo-600 cursor-pointer"
                        checked={items.length > 0 && selectedIds.size === items.length}
                        ref={el => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < items.length }}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th className="w-8 px-2 py-2 font-medium text-slate-400">#</th>
                    <th className="px-2 py-2 font-medium">问题 (Question)</th>
                    <th className="w-64 px-4 py-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <ItemRow
                      key={item.item_id}
                      item={item}
                      idx={page * pageSize + idx}
                      running={running}
                      selected={selectedIds.has(item.item_id)}
                      onToggleSelect={() => toggleSelect(item.item_id)}
                      onEval={() => setEvalTarget({ mode: 'single', itemId: item.item_id })}
                      onEdit={() => setEditingItem(item)}
                      onDelete={() => deleteItem(item.item_id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>共 {total} 条</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
                <span className="px-2 py-1">{page + 1} / {totalPages}</span>
                <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
              </div>
            </div>
          )}
        </>
      )}

      {evalTarget && (
        <EvalConfigModal
          mode={evalTarget.mode}
          initial={evalConfig}
          onClose={() => setEvalTarget(null)}
          onConfirm={(config) => {
            setEvalConfig(config)
            setEvalTarget(null)
            if (evalTarget.mode === 'single') runSingle(evalTarget.itemId, config)
            else runBatch(config)
          }}
        />
      )}

      {editingItem && (
        <ItemEditModal
          datasetId={datasetId}
          item={editingItem === 'new' ? null : editingItem}
          onClose={() => setEditingItem(null)}
          onSuccess={() => { setEditingItem(null); loadData() }}
        />
      )}

      {running && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl px-8 py-6 flex items-center gap-4 shadow-xl">
            <svg className="animate-spin text-indigo-500" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.2-8.6" />
            </svg>
            <div>
              <p className="text-sm font-medium text-slate-800">评估中…</p>
              <p className="text-xs text-slate-400 mt-0.5">正在检索 + 生成答案 + 计算 Ragas 指标</p>
            </div>
          </div>
        </div>
      )}

      {activeBatch && (
        <div className="fixed bottom-6 right-6 z-40 bg-white rounded-xl shadow-lg border border-slate-200 px-5 py-4 flex items-center gap-4 min-w-[280px]">
          <svg className="animate-spin text-indigo-500 shrink-0" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.2-8.6" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-800">批量评估进行中</p>
            <div className="mt-1.5 w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${activeBatch.total ? Math.round(activeBatch.completed / activeBatch.total * 100) : 0}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">{activeBatch.completed} / {activeBatch.total} 条完成</p>
          </div>
          {activeBatch.jobId && (
            <button
              onClick={cancelBatch}
              title="中断评估"
              className="shrink-0 text-[11px] px-2.5 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 transition-colors font-medium border border-red-100"
            >
              中断
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Result panels ──────────────────────────────────────────────────────────

// 包含已废弃的 answer_semantic_similarity，兼容历史评估记录
const RAGAS_DISPLAY_KEYS = [
  ...ALL_METRICS,
  {
    key: 'answer_semantic_similarity', label: '语义相似度', sub: 'Semantic Similarity', needsGt: true,
    when: '答案与标准答案的语义接近程度（已合并入答案正确性）',
  },
]

function RagasGrid({ metrics }) {
  const computed = RAGAS_DISPLAY_KEYS.filter(m => metrics?.[m.key] != null)
  if (computed.length === 0) return <p className="text-xs text-slate-300">暂无 Ragas 指标（检查配置）</p>
  return (
    <div className="flex flex-wrap gap-2">
      {computed.map(({ key, label, when, needsGt }) => (
        <RagasMetricBadge key={key} label={label} value={metrics[key]} hint={when} needsGt={needsGt} />
      ))}
    </div>
  )
}

function BatchResultPanel({ result, onClose }) {
  const ragas = result.aggregate_ragas_metrics || {}
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">批量评估结果</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={16} /></button>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="评估条目" value={result.total_items} />
        <StatCard label="平均总耗时" value={`${result.avg_latency_ms}ms`} />
        <StatCard label="批次 ID" value={result.batch_record_id?.slice(-8)} />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500">聚合 Ragas 指标（均值）</p>
        <RagasGrid metrics={ragas} />
      </div>
      <div className="space-y-1.5 max-h-72 overflow-y-auto">
        <p className="text-xs font-medium text-slate-500 mb-2">逐条结果</p>
        {result.results?.map((r, i) => {
          const m = r.ragas_metrics || {}
          const cr = m.context_relevancy
          const f  = m.faithfulness
          const ar = m.answer_relevancy
          return (
            <div key={r.record_id || i} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-slate-50 text-xs">
              <span className="text-slate-400 shrink-0 w-5 text-right">{i + 1}</span>
              <span className="flex-1 text-slate-700 line-clamp-1">{r.question}</span>
              {cr != null && <span className={`shrink-0 font-medium ${cr >= 0.7 ? 'text-emerald-600' : 'text-amber-600'}`}>CR {(cr * 100).toFixed(0)}%</span>}
              {f  != null && <span className={`shrink-0 font-medium ${f  >= 0.7 ? 'text-emerald-600' : 'text-amber-600'}`}>F {(f  * 100).toFixed(0)}%</span>}
              {ar != null && <span className={`shrink-0 font-medium ${ar >= 0.7 ? 'text-emerald-600' : 'text-amber-600'}`}>AR {(ar * 100).toFixed(0)}%</span>}
              <span className="text-slate-400 shrink-0">{r.latency_ms}ms</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SingleResultPanel({ result, onClose }) {
  const ragas = result.ragas_metrics || {}
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-800">单条评估结果</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={16} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="总耗时" value={`${result.latency_ms}ms`} />
        <StatCard label="检索耗时" value={result.retrieval_ms != null ? `${result.retrieval_ms}ms` : '—'} />
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-500">Ragas 指标</p>
        <RagasGrid metrics={ragas} />
      </div>
      <QABlock question={result.question} answer={result.answer} groundTruth={result.ground_truth} />
      {result.contexts?.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-2">检索上下文（Top {result.contexts.length}）</p>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {result.contexts.map((ctx, i) => (
              <div key={i} className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1.5 leading-relaxed line-clamp-3">
                [{i + 1}] {ctx}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Records View ───────────────────────────────────────────────────────────

function RecordsView({ onBack, backLabel = '返回数据集列表' }) {
  const [stats, setStats] = useState(null)
  const [records, setRecords] = useState([])
  const [totalRecords, setTotalRecords] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [expandedRecord, setExpandedRecord] = useState(null)
  const [page, setPage] = useState(0)
  const pageSize = 20

  const loadData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [statsRes, recordsRes] = await Promise.all([
        apiFetch('/api/eval/records/stats'),
        apiFetch(`/api/eval/records?limit=${pageSize}&offset=${page * pageSize}`),
      ])
      setStats(await statsRes.json())
      const r = await recordsRes.json()
      setRecords(r.records ?? [])
      setTotalRecords(r.total ?? 0)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { loadData() }, [loadData])

  const totalPages = Math.ceil(totalRecords / pageSize)

  if (error) return (
    <div className="space-y-3">
      <BackLink onClick={onBack} label={backLabel} />
      <div className="flex items-center gap-2 justify-center h-48 text-sm text-red-500">
        加载失败：{error}<button className="text-indigo-500 underline ml-2" onClick={loadData}>重试</button>
      </div>
    </div>
  )

  const overallRagas = stats?.overall?.ragas_metrics || {}

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <BackLink onClick={onBack} label={backLabel} />
      </div>

      {/* Overall stats */}
      {stats?.overall && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-slate-800">整体统计</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="总评估次数" value={stats.overall.total_evals} />
            <StatCard label="平均延迟" value={`${stats.overall.avg_latency_ms}ms`} />
            <StatCard label="P50 延迟" value={`${stats.overall.p50_latency_ms}ms`} />
            <StatCard label="P95 延迟" value={`${stats.overall.p95_latency_ms}ms`} />
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
            <p className="text-xs font-medium text-slate-500">Ragas 指标均值</p>
            <RagasGrid metrics={overallRagas} />
          </div>
        </div>
      )}

      {/* Batch runs */}
      {stats?.batch_records?.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">批次记录</h3>
            <Button size="sm" variant="ghost" onClick={async () => {
              if (!confirm('清空所有批次记录？关联的评估明细不会被删除。')) return
              await apiFetch('/api/eval/batches', { method: 'DELETE' })
              loadData()
            }}>
              <Icon name="trash-2" size={13} /> 清空批次
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400 border-b border-slate-50">
                <th className="py-2 px-2 font-medium">批次 ID</th>
                <th className="py-2 px-2 font-medium">数据集</th>
                <th className="py-2 px-2 font-medium text-right">条目数</th>
                <th className="py-2 px-2 font-medium text-right">平均延迟</th>
                <th className="py-2 px-2 font-medium">时间</th>
              </tr>
            </thead>
            <tbody>
              {stats.batch_records.map((br) => (
                <tr key={br.batch_record_id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 px-2 text-xs font-mono text-slate-500">{br.batch_record_id.slice(-12)}</td>
                  <td className="py-2 px-2 text-xs text-slate-500">{br.dataset_id}</td>
                  <td className="py-2 px-2 text-xs text-slate-500 text-right">{br.total_items}</td>
                  <td className="py-2 px-2 text-xs text-slate-500 text-right">{br.avg_latency_ms}ms</td>
                  <td className="py-2 px-2 text-xs text-slate-400">{fmtDate(br.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Record list */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">评估记录明细</h3>
          {totalRecords > 0 && (
            <Button size="sm" variant="ghost" onClick={async () => {
              if (!confirm(`清空全部 ${totalRecords} 条评估记录？此操作不可恢复。`)) return
              await apiFetch('/api/eval/records', { method: 'DELETE' })
              loadData()
            }}>
              <Icon name="trash-2" size={13} /> 清空记录
            </Button>
          )}
        </div>
        {loading ? (
          <p className="text-xs text-slate-400 text-center py-12">加载中…</p>
        ) : records.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-12">暂无记录</p>
        ) : (
          <div className="max-h-[500px] overflow-auto">
            <table className="w-full text-sm table-fixed">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-50 sticky top-0 bg-white">
                  <th className="px-3 py-2 w-[38%] font-medium">问题</th>
                  <th className="px-2 py-2 w-16 font-medium text-center">CR</th>
                  <th className="px-2 py-2 w-16 font-medium text-center">Faith</th>
                  <th className="px-2 py-2 w-16 font-medium text-center">AR</th>
                  <th className="px-2 py-2 w-16 font-medium text-right" title="总耗时（检索+生成+指标）">耗时</th>
                  <th className="px-2 py-2 w-20 font-medium">批次</th>
                  <th className="px-2 py-2 w-28 font-medium">时间</th>
                  <th className="px-2 py-2 w-14 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {records.map((rec) => {
                  const m = (() => {
                    const raw = rec.ragas_metrics
                    if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
                    return raw || {}
                  })()
                  return (
                    <tr key={rec.record_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                      <td className="px-3 py-2.5 text-xs text-slate-700 truncate">{rec.question}</td>
                      <td className="px-2 py-2.5 text-center">
                        <MiniMetric value={m.context_relevancy} />
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <MiniMetric value={m.faithfulness} />
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <MiniMetric value={m.answer_relevancy} />
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-400 text-right">{rec.latency_ms}ms</td>
                      <td className="px-2 py-2.5">
                        {rec.batch_record_id
                          ? <span className="font-mono text-[10px] text-indigo-400 bg-indigo-50 px-1.5 py-0.5 rounded" title={rec.batch_record_id}>
                              {rec.batch_record_id.slice(-8)}
                            </span>
                          : <span className="text-[10px] text-slate-300">—</span>
                        }
                      </td>
                      <td className="px-2 py-2.5 text-xs text-slate-400">{fmtDate(rec.created_at)}</td>
                      <td className="px-2 py-2.5">
                        <Button size="sm" variant="ghost" onClick={() => setExpandedRecord(rec.record_id)}>
                          详情
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {expandedRecord && (
        <RecordDetailPanel recordId={expandedRecord} onClose={() => setExpandedRecord(null)} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-500">
          <span>共 {totalRecords} 条</span>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>上一页</Button>
            <span className="px-2 py-1">{page + 1} / {totalPages}</span>
            <Button size="sm" variant="ghost" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Record Detail Panel ────────────────────────────────────────────────────

function RecordDetailPanel({ recordId, onClose }) {
  const [record, setRecord] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    apiFetch(`/api/eval/records/${recordId}`)
      .then(r => r.json())
      .then(d => { setRecord(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [recordId])

  const ragas = (() => {
    if (!record) return {}
    const raw = record.ragas_metrics
    if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
    return raw || {}
  })()

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h3 className="text-sm font-semibold text-slate-800">评估记录详情</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={18} /></button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {loading ? (
            <p className="text-xs text-slate-400 text-center py-12">加载中…</p>
          ) : !record ? (
            <p className="text-xs text-slate-400 text-center py-12">记录不存在</p>
          ) : (
            <>
              <div className="grid grid-cols-4 gap-3">
                <StatCard label="总耗时" value={`${record.latency_ms}ms`} />
                <StatCard label="检索耗时" value={record.retrieval_ms != null ? `${record.retrieval_ms}ms` : '—'} />
                <StatCard label="Top-K" value={record.top_k} />
                <StatCard label="类型" value={record.run_type === 'batch' ? '批量' : '单条'} />
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-slate-500">Ragas 指标</p>
                <RagasGrid metrics={ragas} />
              </div>

              <QABlock
                question={record.question}
                answer={record.answer}
                groundTruth={record.ground_truth}
              />

              {(record.contexts ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-2">检索上下文</p>
                  <div className="space-y-1.5">
                    {record.contexts.map((ctx, i) => (
                      <div key={i} className="text-xs text-slate-600 bg-slate-50 rounded px-2 py-1.5 leading-relaxed">
                        <span className="text-slate-400 mr-1">[{i + 1}]</span>{ctx}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(record.retrieved_chunk_ids ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">检索 Chunk IDs</p>
                  <div className="flex flex-wrap gap-1">
                    {record.retrieved_chunk_ids.map((cid, i) => (
                      <span key={cid} className="text-[10px] font-mono text-slate-500 bg-slate-100 rounded px-1.5 py-0.5">[{i + 1}] {cid}</span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Item Row (expandable) ──────────────────────────────────────────────────

function ItemRow({ item, idx, running, selected, onToggleSelect, onEval, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <tr
        className={`border-b border-slate-50 hover:bg-slate-50 cursor-pointer ${selected ? 'bg-indigo-50/40' : ''}`}
        onClick={() => setExpanded(v => !v)}
      >
        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            className="rounded border-slate-300 text-indigo-600 cursor-pointer"
            checked={selected}
            onChange={onToggleSelect}
          />
        </td>
        <td className="px-2 py-3 text-xs text-slate-400">{idx + 1}</td>
        <td className="px-2 py-3">
          <div className="flex items-start gap-1.5">
            <Icon
              name="chevron-down"
              size={12}
              className={`shrink-0 mt-0.5 text-slate-300 transition-transform ${expanded ? 'rotate-180' : ''}`}
            />
            <p className="text-xs text-slate-700 leading-relaxed line-clamp-2">{item.question}</p>
          </div>
        </td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex gap-2">
            <Button size="sm" variant="primary" onClick={onEval} disabled={running}>
              <Icon name="play" size={12} /> 评估
            </Button>
            <Button size="sm" onClick={onEdit}>编辑</Button>
            <Button size="sm" variant="danger" onClick={onDelete}>删除</Button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-50 bg-slate-50/60">
          <td /><td />
          <td colSpan={2} className="px-3 pb-3 pt-1">
            {item.ground_truth ? (
              <div>
                <p className="text-[10px] text-slate-400 mb-1 font-medium">标准答案 (Ground Truth)</p>
                <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">{item.ground_truth}</p>
              </div>
            ) : (
              <span className="text-[11px] text-slate-300">标准答案未设置</span>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// ── Shared UI ──────────────────────────────────────────────────────────────

function BackLink({ onClick, label = '返回' }) {
  return (
    <button onClick={onClick} className="text-xs text-indigo-500 hover:text-indigo-600 flex items-center gap-1">
      <Icon name="chevron-up" size={12} className="rotate-[-90deg]" /> {label}
    </button>
  )
}

function QABlock({ question, answer, groundTruth }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-slate-500 mb-1">问题 (Question)</p>
        <p className="text-xs text-slate-700 bg-slate-50 rounded p-2 leading-relaxed">{question}</p>
      </div>
      {answer && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">生成答案 (Answer)</p>
          <p className="text-xs text-slate-700 bg-blue-50/60 rounded p-2 leading-relaxed">{answer}</p>
        </div>
      )}
      {groundTruth && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1">标准答案 (Ground Truth)</p>
          <p className="text-xs text-slate-700 bg-emerald-50/60 rounded p-2 leading-relaxed">{groundTruth}</p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, tone = 'slate' }) {
  const toneText = { slate: 'text-slate-900', amber: 'text-amber-600', red: 'text-red-600', green: 'text-emerald-600' }
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-lg font-semibold truncate ${toneText[tone] || toneText.slate}`}>{value}</p>
    </div>
  )
}

function MetricTooltip({ text, needsGt, children }) {
  if (!text) return children
  const lines = [text, needsGt ? '需要 ground_truth' : ''].filter(Boolean)
  return (
    <div className="relative group/tip">
      {children}
      <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50
                      opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150">
        <div className="bg-slate-800 text-white rounded-lg px-2.5 py-1.5 w-44 text-center shadow-lg">
          {lines.map((l, i) => (
            <p key={i} className={`text-[11px] leading-snug ${i > 0 ? 'text-slate-400 mt-0.5' : ''}`}>{l}</p>
          ))}
        </div>
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
      </div>
    </div>
  )
}

function RagasMetricBadge({ label, value, hint, needsGt }) {
  const pct = value != null ? (value * 100).toFixed(0) : null
  const tone = value == null ? '' : value >= 0.8 ? 'text-emerald-600' : value >= 0.6 ? 'text-amber-600' : 'text-red-500'
  return (
    <MetricTooltip text={hint} needsGt={needsGt}>
      <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center cursor-default min-w-[56px]">
        <p className="text-[10px] text-slate-400 leading-tight">{label}</p>
        <p className={`text-xs font-semibold mt-0.5 ${tone || 'text-slate-300'}`}>{pct != null ? `${pct}%` : '—'}</p>
      </div>
    </MetricTooltip>
  )
}

function MiniMetric({ value }) {
  if (value == null) return <span className="text-[11px] text-slate-300">—</span>
  const pct = (value * 100).toFixed(0)
  const tone = value >= 0.8 ? 'text-emerald-600' : value >= 0.6 ? 'text-amber-600' : 'text-red-500'
  return <span className={`text-xs font-medium ${tone}`}>{pct}%</span>
}

// ── Modals ─────────────────────────────────────────────────────────────────

function DatasetFormModal({ title, initial, onClose, onSuccess }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const isEdit = !!initial

  async function handleSubmit() {
    if (!name.trim()) { setError('请输入数据集名称'); return }
    setSaving(true); setError(null)
    try {
      const url = isEdit ? `/api/eval/datasets/${initial.dataset_id}` : '/api/eval/datasets'
      const method = isEdit ? 'PUT' : 'POST'
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSuccess()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} disabled={saving} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={18} /></button>
        </div>
        <div>
          <label className="text-xs text-slate-500">名称 <span className="text-red-400">*</span></label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            placeholder="例如：售后场景回归测试集" />
        </div>
        <div>
          <label className="text-xs text-slate-500">描述</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)}
            rows={3} className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            placeholder="可选描述" />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中…' : (isEdit ? '保存' : '创建')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function UploadDatasetModal({ onClose, onSuccess }) {
  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit() {
    if (!file) { setError('请选择文件'); return }
    setUploading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (name.trim()) fd.append('name', name.trim())
      if (description.trim()) fd.append('description', description.trim())
      const res = await apiFetch('/api/eval/datasets/upload', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(await res.text())
      onSuccess()
    } catch (e) { setError(e.message); setUploading(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">文件导入数据集</h3>
          <button onClick={onClose} disabled={uploading} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={18} /></button>
        </div>
        <label className="block border-2 border-dashed border-slate-200 rounded-lg py-10 text-center text-slate-400 text-sm cursor-pointer hover:border-indigo-200 hover:bg-slate-50/50 transition-colors">
          <Icon name="upload" size={22} className="mx-auto mb-2" />
          {file ? <span className="text-slate-700">{file.name}</span> : <>点击选择文件</>}
          <p className="text-xs mt-1 text-slate-300">JSONL：每行 {`{"question": "...", "ground_truth": "..."}`}</p>
          <p className="text-xs text-slate-300">CSV：首行为列名，必须含 question 列，可选 ground_truth</p>
          <input type="file" className="hidden" accept=".jsonl,.json,.csv,.txt"
            onChange={e => setFile(e.target.files[0] ?? null)} />
        </label>
        <div>
          <label className="text-xs text-slate-500">数据集名称 <span className="text-slate-300">（可选，默认使用文件名）</span></label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            placeholder="例如：售后回归测试集" />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose} disabled={uploading}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={uploading}>
            {uploading ? '导入中…' : '开始导入'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function GenerateDatasetModal({ onClose, onSuccess }) {
  const [name, setName] = useState('')
  const [sampleCount, setSampleCount] = useState(50)
  const [selectedDocId, setSelectedDocId] = useState('')
  const [documents, setDocuments] = useState([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState(null)

  const selectedDoc = useMemo(() => documents.find(d => d.doc_id === selectedDocId), [selectedDocId, documents])

  useEffect(() => {
    apiFetch('/api/ops/documents?status=all&limit=500')
      .then(r => r.json())
      .then(d => { setDocuments(d.documents ?? []) })
      .catch(() => {})
      .finally(() => setLoadingDocs(false))
  }, [])

  useEffect(() => {
    if (selectedDoc) {
      if (selectedDoc.title) setName(selectedDoc.title)
      setSampleCount(selectedDoc.chunk_count)
    }
  }, [selectedDoc?.doc_id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit() {
    setGenerating(true); setError(null)
    try {
      const params = new URLSearchParams()
      if (name.trim()) params.set('name', name.trim())
      params.set('sample_count', String(sampleCount))
      if (selectedDocId) params.set('doc_ids', selectedDocId)
      const res = await apiFetch(`/api/eval/datasets/generate-from-kb?${params}`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      onSuccess()
    } catch (e) { setError(e.message); setGenerating(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">从知识库生成数据集</h3>
          <button onClick={onClose} disabled={generating} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={18} /></button>
        </div>
        <p className="text-xs text-slate-500">
          从知识库随机采样 Chunk，每条内容作为 Question，ground_truth 留空。
          Ragas 评估时仍可计算 context_relevancy、faithfulness、answer_relevancy。
        </p>
        <div>
          <label className="text-xs text-slate-500">限定文档</label>
          {loadingDocs ? (
            <div className="mt-1 border border-slate-200 rounded-lg px-2 py-2 text-xs text-slate-400">加载中…</div>
          ) : (
            <Select
              value={selectedDocId} onChange={setSelectedDocId}
              className="w-full mt-1" size="md"
              options={[
                { value: '', label: '全部文档' },
                ...documents.map(d => ({ value: d.doc_id, label: `${d.title}（${d.chunk_count} chunks）` })),
              ]}
            />
          )}
          <p className="text-[10px] text-slate-400 mt-0.5">不选则全库随机采样</p>
        </div>
        <div>
          <label className="text-xs text-slate-500">数据集名称</label>
          <input value={name} onChange={e => setName(e.target.value)}
            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            placeholder="默认自动生成" />
        </div>
        <div>
          <label className="text-xs text-slate-500">
            采样数量{selectedDoc && <span className="text-slate-400 ml-1">/ {selectedDoc.chunk_count}</span>}
          </label>
          <input type="number" value={sampleCount}
            onChange={e => setSampleCount(Math.max(1, Math.min(selectedDoc ? selectedDoc.chunk_count : 500, Number(e.target.value))))}
            className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            min={1} max={selectedDoc ? selectedDoc.chunk_count : 500} />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose} disabled={generating}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={generating}>
            {generating ? '生成中…' : '开始生成'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function EvalConfigModal({ mode, initial, onClose, onConfirm }) {
  const [topK, setTopK] = useState(initial?.topK ?? 5)
  const [temperature, setTemperature] = useState(initial?.temperature ?? 0)
  const [metrics, setMetrics] = useState(initial?.metrics ?? DEFAULT_METRICS)
  const [activePreset, setActivePreset] = useState(null)

  function applyPreset(preset) {
    setTopK(preset.topK)
    setTemperature(preset.temperature)
    setMetrics(preset.metrics)
    setActivePreset(preset.key)
  }

  function toggleMetric(key) {
    setActivePreset(null)
    setMetrics(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  function handleConfirm() {
    if (metrics.length === 0) { alert('请至少选择一个指标'); return }
    onConfirm({ topK, temperature, metrics })
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-xl p-6 space-y-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">
            {mode === 'batch' ? '批量评估参数' : '评估参数'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={18} /></button>
        </div>

        {/* Presets */}
        <div>
          <p className="text-xs text-slate-500 mb-2">场景预设</p>
          <div className="grid grid-cols-2 gap-2">
            {EVAL_PRESETS.map(preset => (
              <button
                key={preset.key}
                onClick={() => applyPreset(preset)}
                className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                  activePreset === preset.key
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <p className={`text-xs font-medium ${activePreset === preset.key ? 'text-indigo-700' : 'text-slate-700'}`}>
                  {preset.label}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{preset.desc}</p>
                <p className="text-[10px] text-slate-300 mt-1">
                  Top-K {preset.topK} · T={preset.temperature} · {preset.metrics.length} 指标
                </p>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-500">Top-K（检索数量）</label>
            <input
              type="number" value={topK}
              onChange={e => { setActivePreset(null); setTopK(Math.max(1, Math.min(20, Number(e.target.value)))) }}
              min={1} max={20}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">温度（Temperature）</label>
            <input
              type="number" value={temperature}
              onChange={e => { setActivePreset(null); setTemperature(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0))) }}
              step={0.1} min={0} max={1}
              className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-slate-600">Ragas 指标</p>
            <div className="flex gap-3 text-xs">
              <button onClick={() => { setActivePreset(null); setMetrics(ALL_METRICS.map(m => m.key)) }} className="text-indigo-500 hover:underline">全选</button>
              <button onClick={() => { setActivePreset(null); setMetrics([]) }} className="text-slate-400 hover:underline">清空</button>
            </div>
          </div>
          <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
            {ALL_METRICS.map(({ key, label, sub, needsGt, affect, when }) => (
              <label key={key} className={`flex items-start gap-2.5 cursor-pointer rounded-lg px-2 py-2 transition-colors ${metrics.includes(key) ? 'bg-indigo-50/60' : 'hover:bg-slate-50'}`}>
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-indigo-600 cursor-pointer mt-0.5 shrink-0"
                  checked={metrics.includes(key)}
                  onChange={() => toggleMetric(key)}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-slate-700">{label}</span>
                    <span className="text-[10px] text-slate-400">({sub})</span>
                    {needsGt && (
                      <span className="text-[10px] text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">需 ground_truth</span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    <span className="text-slate-500">{when}</span>
                    {affect && <span className="text-slate-300 mx-1">·</span>}
                    <span className="text-slate-400">{affect}</span>
                  </p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleConfirm}>
            {mode === 'batch' ? '开始批量评估' : '开始评估'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ItemEditModal({ datasetId, item, onClose, onSuccess }) {
  const [question, setQuestion] = useState(item?.question ?? '')
  const [groundTruth, setGroundTruth] = useState(item?.ground_truth ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const isNew = !item

  async function handleSubmit() {
    if (!question.trim()) { setError('问题不能为空'); return }
    setSaving(true); setError(null)
    try {
      const url = isNew
        ? `/api/eval/datasets/${datasetId}/items`
        : `/api/eval/datasets/${datasetId}/items/${item.item_id}`
      const res = await apiFetch(url, {
        method: isNew ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), ground_truth: groundTruth.trim() }),
      })
      if (!res.ok) throw new Error(await res.text())
      onSuccess()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">{isNew ? '添加数据条目' : '编辑数据条目'}</h3>
          <button onClick={onClose} disabled={saving} className="text-slate-400 hover:text-slate-600"><Icon name="x" size={18} /></button>
        </div>
        <div>
          <label className="text-xs text-slate-500">问题 (Question) <span className="text-red-400">*</span></label>
          <textarea value={question} onChange={e => setQuestion(e.target.value)}
            rows={4} className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm resize-y"
            placeholder="输入测试问题" />
        </div>
        <div>
          <label className="text-xs text-slate-500">
            标准答案 (Ground Truth)
            <span className="text-slate-300 ml-1">（可选 — 提供后可计算 context_precision/recall、answer_correctness）</span>
          </label>
          <textarea value={groundTruth} onChange={e => setGroundTruth(e.target.value)}
            rows={4} className="w-full mt-1 border border-slate-200 rounded-lg px-2 py-1.5 text-sm resize-y"
            placeholder="填写预期答案文本" />
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" onClick={onClose} disabled={saving}>取消</Button>
          <Button size="sm" variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
    </div>
  )
}
