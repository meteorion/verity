import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from '../auth.js'
import Icon from './Icon.jsx'

const JOB_TYPE_LABEL = {
  ingest: '文档解析',
  chunk_export: 'Chunk 导出',
  eval_batch: '评估批次',
}

const JOB_TYPE_ICON = {
  ingest: '📄',
  chunk_export: '🧩',
  eval_batch: '📊',
}

const STATUS_LABEL = {
  pending: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

function elapsed(iso) {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso)) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

function ProgressBar({ job }) {
  const pct =
    job.status === 'completed' ? 100
    : job.progress_total > 0 ? Math.round((job.progress_current / job.progress_total) * 100)
    : job.status === 'running' ? null  // indeterminate
    : 0

  const colorCls =
    job.status === 'completed' ? 'bg-emerald-400'
    : job.status === 'failed' ? 'bg-red-400'
    : job.status === 'cancelled' ? 'bg-slate-500'
    : job.job_type === 'eval_batch' ? 'bg-violet-400'
    : job.job_type === 'chunk_export' ? 'bg-teal-400'
    : 'bg-blue-400'

  return (
    <div className="h-1 bg-slate-700 rounded-full overflow-hidden mb-2">
      {pct === null ? (
        // indeterminate stripe animation
        <div className={`h-full w-1/3 rounded-full ${colorCls} animate-pulse`} />
      ) : (
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorCls}`}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  )
}

function JobCard({ job, onCancel, onDownload }) {
  const isActive = job.status === 'pending' || job.status === 'running'
  const canDownload = job.status === 'completed' && job.job_type === 'chunk_export'

  return (
    <div className="px-4 py-3.5 border-b border-slate-800 last:border-0 hover:bg-slate-800/40 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          <span className="text-base mt-0.5 shrink-0">{JOB_TYPE_ICON[job.job_type] ?? '⚙️'}</span>
          <div className="min-w-0">
            <p
              className="text-[12.5px] font-semibold text-slate-200 truncate"
              style={{ maxWidth: '155px' }}
              title={job.display_name}
            >
              {job.display_name}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">{JOB_TYPE_LABEL[job.job_type]}</p>
          </div>
        </div>
        <span className="text-[10px] text-slate-600 shrink-0 tabular-nums mt-0.5">
          {elapsed(job.created_at)}
        </span>
      </div>

      <ProgressBar job={job} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500 truncate flex-1">
          {job.status === 'running' && job.progress_phase ? (
            <>
              {job.progress_phase}
              {job.progress_total > 0 && (
                <span className="ml-1 tabular-nums text-slate-600">
                  {job.progress_current}/{job.progress_total}
                </span>
              )}
            </>
          ) : job.status === 'completed' && job.job_type === 'ingest' && job.result_data ? (
            <span className="text-emerald-500">
              {job.result_data.chunk_count} chunks · 准入分 {job.result_data.admission_score}
            </span>
          ) : job.status === 'completed' && job.job_type === 'chunk_export' && job.result_data ? (
            <span className="text-emerald-500">
              {job.result_data.chunk_count} chunks
            </span>
          ) : job.status === 'completed' && job.job_type === 'eval_batch' && job.result_data ? (
            <span className="text-emerald-500">
              {job.result_data.completed_items}/{job.result_data.total_items} 条已评估
            </span>
          ) : job.status === 'cancelled' ? (
            <span className="text-slate-500">
              已中断（{job.progress_current ?? 0}/{job.progress_total ?? 0} 条）
            </span>
          ) : job.status === 'failed' ? (
            <span className="text-red-400" title={job.error_message}>
              {job.error_message?.slice(0, 50) || '执行失败'}
            </span>
          ) : (
            <span className={
              job.status === 'completed' ? 'text-emerald-500'
              : job.status === 'cancelled' ? 'text-slate-600'
              : 'text-slate-500'
            }>{STATUS_LABEL[job.status]}</span>
          )}
        </p>

        <div className="flex items-center gap-1.5 shrink-0">
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
          )}
          {job.status === 'running' && job.job_type === 'eval_batch' && (
            <button
              onClick={() => onCancel(job.job_id)}
              className="text-[11px] px-2 py-0.5 rounded bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors font-medium"
            >
              中断
            </button>
          )}
          {canDownload && (
            <button
              onClick={() => onDownload(job)}
              className="text-[11px] px-2 py-0.5 rounded bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 transition-colors font-medium"
            >
              下载
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default function TaskCenter({ onClose, onActiveCountChange }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const streamsRef = useRef({})  // job_id → AbortController

  const fetchJobs = useCallback(async () => {
    try {
      const res = await apiFetch('/api/jobs?limit=30')
      if (!res.ok) return
      const data = await res.json()
      setJobs(data.jobs ?? [])
    } catch {
      // network error — keep stale jobs
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  // Report active count upward so Sidebar badge stays current
  useEffect(() => {
    const n = jobs.filter(j => j.status === 'pending' || j.status === 'running').length
    onActiveCountChange?.(n)
  }, [jobs, onActiveCountChange])

  // Subscribe to SSE for each active job, clean up terminated ones
  useEffect(() => {
    const active = jobs.filter(j => j.status === 'pending' || j.status === 'running')
    const activeIds = new Set(active.map(j => j.job_id))

    // Abort subscriptions for jobs no longer active
    Object.keys(streamsRef.current).forEach(id => {
      if (!activeIds.has(id)) {
        streamsRef.current[id].abort()
        delete streamsRef.current[id]
      }
    })

    // Start new subscriptions
    active.forEach(job => {
      if (streamsRef.current[job.job_id]) return

      const ctrl = new AbortController()
      streamsRef.current[job.job_id] = ctrl

      ;(async () => {
        try {
          const res = await apiFetch(`/api/jobs/${job.job_id}/stream`, { signal: ctrl.signal })
          if (!res.ok || !res.body) return

          const reader = res.body.getReader()
          const dec = new TextDecoder()
          let buf = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += dec.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() ?? ''

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const raw = line.slice(6).trim()
              if (raw === '[DONE]') return
              try {
                const update = JSON.parse(raw)
                setJobs(prev =>
                  prev.map(j =>
                    j.job_id === update.job_id
                      ? {
                          ...j,
                          status: update.status,
                          progress_current: update.current ?? j.progress_current,
                          progress_total: update.total ?? j.progress_total,
                          progress_phase: update.phase ?? j.progress_phase,
                          result_data: update.result ?? j.result_data,
                          error_message: update.error ?? j.error_message,
                        }
                      : j
                  )
                )
              } catch {
                // malformed SSE line — ignore
              }
            }
          }
        } catch {
          // AbortError or network failure — normal cleanup path
        } finally {
          delete streamsRef.current[job.job_id]
        }
      })()
    })
  }, [jobs])

  // Cleanup all streams on unmount
  useEffect(() => {
    return () => {
      Object.values(streamsRef.current).forEach(c => c.abort())
    }
  }, [])

  async function handleCancel(jobId) {
    try {
      const res = await apiFetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
      if (res.ok) {
        setJobs(prev =>
          prev.map(j => j.job_id === jobId ? { ...j, status: 'cancelled' } : j)
        )
      }
    } catch {
      // ignore
    }
  }

  async function handleDownload(job) {
    try {
      const res = await apiFetch(`/api/jobs/${job.job_id}/download`)
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        alert(d?.detail || '下载失败')
        return
      }
      const blob = await res.blob()
      const result = job.result_data || {}
      const filename = result.filename || `chunks.${result.format || 'jsonl'}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(`下载失败：${e.message}`)
    }
  }

  const activeCount = jobs.filter(j => j.status === 'pending' || j.status === 'running').length

  return (
    <div className="fixed inset-y-0 right-0 w-72 bg-slate-900 border-l border-slate-700 flex flex-col z-40 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">任务中心</span>
          {activeCount > 0 && (
            <span className="bg-indigo-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {activeCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchJobs}
            title="刷新"
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <Icon name="refresh-cw" size={13} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="text-xs text-slate-600 text-center py-10">加载中…</p>
        )}
        {!loading && jobs.length === 0 && (
          <div className="text-center py-14">
            <p className="text-2xl mb-2">📭</p>
            <p className="text-xs text-slate-600">暂无任务记录</p>
          </div>
        )}
        {!loading && jobs.map(job => (
          <JobCard key={job.job_id} job={job} onCancel={handleCancel} onDownload={handleDownload} />
        ))}
      </div>
    </div>
  )
}
