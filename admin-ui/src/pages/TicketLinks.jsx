import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../auth.js'
import { Card, Button, Badge } from '../components/ui.jsx'

const TYPE_DISPLAY = {
  after_sales_refund: '售后退款',
  complaint: '投诉建议',
  inquiry: '咨询问题',
  technical_issue: '技术问题',
}

export default function TicketLinks() {
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

  function startEdit(cfg) {
    setEditing({ ...cfg })
    setError('')
  }

  function cancelEdit() {
    setEditing(null)
    setError('')
  }

  async function save() {
    if (!editing.label.trim()) { setError('显示名称不能为空'); return }
    if (!editing.form_url.trim()) { setError('表单 URL 不能为空'); return }
    if (!/^https?:\/\//.test(editing.form_url)) { setError('表单 URL 必须以 http:// 或 https:// 开头'); return }

    setSaving(true)
    setError('')
    try {
      const res = await apiFetch(`/api/ticket-links/${editing.ticket_type}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: editing.label,
          form_url: editing.form_url,
          enabled: editing.enabled,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || '保存失败，请重试')
        return
      }
      setSuccessKey(editing.ticket_type)
      setTimeout(() => setSuccessKey(''), 2000)
      setEditing(null)
      await load()
    } catch {
      setError('网络错误，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card title="工单链接配置">
        <p className="text-xs text-slate-400 mb-5">
          配置各工单类型的表单链接。AI 工具节点（自动创建）和转派节点（兜底链接）均读取此配置，修改后立即生效。
          <br />
          <span className="text-slate-300">form_url 填写表单基础地址，系统会自动追加 <code className="font-mono bg-slate-100 px-1 rounded">?type=&session=&prefill=</code> 参数。</span>
        </p>

        <div className="divide-y divide-slate-100">
          {configs.map(cfg => (
            <div key={cfg.ticket_type} className="py-4 flex items-center gap-4">
              {/* Type + label */}
              <div className="w-36 shrink-0">
                <p className="text-sm font-medium text-slate-800">{cfg.label}</p>
                <p className="text-xs font-mono text-slate-400 mt-0.5">{cfg.ticket_type}</p>
              </div>

              {/* URL */}
              <div className="flex-1 min-w-0">
                <a
                  href={cfg.form_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-500 hover:underline break-all"
                >
                  {cfg.form_url}
                </a>
              </div>

              {/* Status badge */}
              <div className="w-14 shrink-0 text-center">
                <Badge tone={cfg.enabled ? 'green' : 'slate'}>
                  {cfg.enabled ? '启用' : '停用'}
                </Badge>
              </div>

              {/* Success flash */}
              {successKey === cfg.ticket_type && (
                <span className="text-xs text-green-500 shrink-0">已保存 ✓</span>
              )}

              {/* Edit button */}
              <Button variant="ghost" onClick={() => startEdit(cfg)}>编辑</Button>
            </div>
          ))}

          {configs.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">暂无配置，请检查数据库是否已完成初始化</p>
          )}
        </div>
      </Card>

      {/* Edit modal */}
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
                <input
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={editing.label}
                  onChange={e => setEditing({ ...editing, label: e.target.value })}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-600">表单 URL</span>
                <input
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  value={editing.form_url}
                  onChange={e => setEditing({ ...editing, form_url: e.target.value })}
                  placeholder="https://example.com/tickets/new"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  系统将自动追加 ?type=&amp;session=&amp;prefill= 参数，此处填写基础地址即可
                </p>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none pt-1">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded accent-indigo-600"
                  checked={editing.enabled}
                  onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
                />
                <span className="text-sm text-slate-700">启用此工单类型</span>
                {!editing.enabled && (
                  <span className="text-xs text-amber-500">停用后 AI 将回退"请联系人工客服"提示</span>
                )}
              </label>
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="ghost" onClick={cancelEdit} disabled={saving}>取消</Button>
              <Button variant="primary" onClick={save} disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
