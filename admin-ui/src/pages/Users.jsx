import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../auth.js'
import { Card, Table, Badge, Button } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'

const ROLES = ['admin', 'ops', 'agent', 'customer']
const roleTone = { admin: 'purple', ops: 'blue', agent: 'green', customer: 'slate' }

const ROLE_ACL = [
  { role: 'customer', desc: '终端用户，仅可检索 acl 含 public 的知识', scope: 'public' },
  { role: 'agent', desc: '人工坐席，可检索 agent + public 知识，可查看会话全文', scope: 'agent, public' },
  { role: 'ops', desc: '知识运营，可管理文档准入、下架、生效期', scope: '知识运营后台全部权限' },
  { role: 'admin', desc: '系统管理员，可配置模型参数、用户与权限', scope: '系统全部权限' },
]

function fmtTime(ts) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { hour12: false })
}

export default function Users({ user: currentUser }) {
  const isAdmin = (currentUser?.roles || []).includes('admin')

  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState(null)   // user object being edited

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/v1/users')
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      const data = await res.json()
      setUsers(data.users || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (isAdmin) fetchUsers() }, [isAdmin, fetchUsers])

  async function handleDisable(uid, disabled) {
    await apiFetch(`/v1/users/${uid}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    })
    fetchUsers()
  }

  async function handleDelete(uid, name) {
    if (!confirm(`确定删除用户「${name}」？此操作不可撤销。`)) return
    await apiFetch(`/v1/users/${uid}`, { method: 'DELETE' })
    fetchUsers()
  }

  const columns = [
    {
      key: 'name',
      header: '用户',
      render: (row) => (
        <div>
          <p className="font-medium text-slate-800">{row.name}</p>
          <p className="text-xs text-slate-400">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'roles',
      header: '角色',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {(row.roles || []).map(r => (
            <Badge key={r} tone={roleTone[r] || 'slate'}>{r}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (row) => (
        <Badge tone={row.disabled ? 'amber' : 'green'}>{row.disabled ? '已禁用' : '正常'}</Badge>
      ),
    },
    {
      key: 'last_login',
      header: '最近登录',
      render: (row) => <span className="text-xs text-slate-500">{fmtTime(row.last_login)}</span>,
    },
    ...(isAdmin ? [{
      key: 'ops',
      header: '操作',
      render: (row) => (
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setEditing(row) }}>
            编辑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={e => { e.stopPropagation(); handleDisable(row.uid, !row.disabled) }}
            disabled={row.uid === currentUser?.uid}
          >
            {row.disabled ? '启用' : '禁用'}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={e => { e.stopPropagation(); handleDelete(row.uid, row.name) }}
            disabled={row.uid === currentUser?.uid}
          >
            <Icon name="trash-2" size={12} />
          </Button>
        </div>
      ),
    }] : []),
  ]

  return (
    <div className="space-y-5">
      <Card
        title="用户列表"
        action={
          isAdmin && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={fetchUsers} disabled={loading}>
                <Icon name="refresh-cw" size={13} className={loading ? 'animate-spin' : ''} />
                刷新
              </Button>
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                <Icon name="user-plus" size={14} />
                添加成员
              </Button>
            </div>
          )
        }
      >
        {error && (
          <div className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 mb-3">加载失败：{error}</div>
        )}
        {!isAdmin && (
          <div className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">
            仅管理员可管理用户，当前为只读视图。
          </div>
        )}
        <Table columns={columns} rows={users} rowKey="uid" />
      </Card>

      <Card title="角色与知识 ACL 对照">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ROLE_ACL.map(r => (
            <div key={r.role} className="border border-slate-100 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Badge tone={roleTone[r.role] || 'slate'}>{r.role}</Badge>
              </div>
              <p className="text-sm text-slate-700">{r.desc}</p>
              <p className="text-xs text-slate-400 mt-1">检索可见范围：{r.scope}</p>
            </div>
          ))}
        </div>
        <div className="bg-slate-50 text-slate-500 text-xs rounded-lg px-3 py-2 mt-4">
          权限校验链路：Admin UI 登录验 JWT → 后端解析 Bearer Token → 请求携带 X-UID / X-Roles Header →
          应用层 WHERE 条件按角色过滤 chunk 级 ACL，检索阶段即拦截越权内容。
        </div>
      </Card>

      {showCreate && (
        <CreateUserModal onClose={() => setShowCreate(false)} onCreated={fetchUsers} />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={fetchUsers}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Create user modal
// ---------------------------------------------------------------------------
function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', roles: ['ops'] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function toggle(role) {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name || !form.email || !form.password) { setError('请填写所有必填项'); return }
    if (form.roles.length === 0) { setError('至少选择一个角色'); return }
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch('/v1/users', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || '创建失败'); return }
      onCreated()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="添加成员" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="姓名 *">
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="张三"
            className={inputCls}
          />
        </Field>
        <Field label="邮箱 *">
          <input
            type="email"
            value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            placeholder="user@company.com"
            className={inputCls}
          />
        </Field>
        <Field label="初始密码 *">
          <input
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="至少 6 位"
            className={inputCls}
          />
        </Field>
        <Field label="角色（可多选）">
          <div className="flex flex-wrap gap-2 mt-1">
            {ROLES.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => toggle(r)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  form.roles.includes(r)
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <ModalFooter onClose={onClose} loading={loading} submitLabel="创建" />
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Edit user modal
// ---------------------------------------------------------------------------
function EditUserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({ name: user.name, roles: [...(user.roles || [])], password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function toggle(role) {
    setForm(f => ({
      ...f,
      roles: f.roles.includes(role) ? f.roles.filter(r => r !== role) : [...f.roles, role],
    }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name) { setError('姓名不能为空'); return }
    if (form.roles.length === 0) { setError('至少选择一个角色'); return }
    setLoading(true)
    setError('')
    const body = { name: form.name, roles: form.roles }
    if (form.password) body.password = form.password
    try {
      const res = await apiFetch(`/v1/users/${user.uid}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || '保存失败'); return }
      onSaved()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title={`编辑用户 · ${user.name}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="姓名 *">
          <input
            value={form.name}
            onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
            className={inputCls}
          />
        </Field>
        <Field label="角色（可多选）">
          <div className="flex flex-wrap gap-2 mt-1">
            {ROLES.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => toggle(r)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  form.roles.includes(r)
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </Field>
        <Field label="新密码（留空不改）">
          <input
            type="password"
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="••••••••"
            className={inputCls}
          />
        </Field>
        {error && <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <ModalFooter onClose={onClose} loading={loading} submitLabel="保存" />
      </form>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent'

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-slate-500 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function ModalFooter({ onClose, loading, submitLabel = '确定' }) {
  return (
    <div className="flex justify-end gap-2 pt-2">
      <Button size="sm" variant="ghost" type="button" onClick={onClose}>取消</Button>
      <Button size="sm" variant="primary" type="submit" disabled={loading}>
        {loading ? '处理中…' : submitLabel}
      </Button>
    </div>
  )
}
