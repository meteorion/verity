import { useState } from 'react'

export default function TechnicalIssueForm({ sessionId, prefill = {} }) {
  const [form, setForm] = useState({
    description: prefill.detail || prefill.summary || '',
    contact:     prefill.contact || '',
    error_code:  '',
  })
  const [done, setDone] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket_type: 'technical_issue', session_id: sessionId, fields: form }),
      })
      if (!res.ok) throw new Error(await res.text())
      const data = await res.json()
      setDone(data.ticket_id)
    } catch {
      setError('提交失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  if (done) return (
    <div className="text-center py-8">
      <div className="text-green-600 text-lg font-medium mb-2">工单已提交</div>
      <p className="text-slate-500 text-sm">工单号：<span className="font-mono font-medium text-slate-800">{done}</span></p>
      <p className="text-slate-400 text-xs mt-2">技术团队将尽快跟进处理</p>
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">问题描述 <span className="text-red-500">*</span></label>
        <textarea
          required rows={4} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="请描述遇到的技术问题，包括操作步骤"
          value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">联系方式 <span className="text-red-500">*</span></label>
        <input
          required className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="手机号或邮箱"
          value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">错误码（选填）</label>
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="如：ERR_500 / 40301"
          value={form.error_code} onChange={e => setForm({ ...form, error_code: e.target.value })}
        />
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
      <button
        type="submit" disabled={loading}
        className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? '提交中…' : '提交工单'}
      </button>
    </form>
  )
}
