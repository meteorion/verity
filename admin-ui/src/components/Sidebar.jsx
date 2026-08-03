import Icon from './Icon.jsx'

const NAV_ITEMS = [
  { key: 'knowledge', label: '知识库管理', icon: 'book' },
  { key: 'chunks', label: 'Chunks 管理', icon: 'layers' },
  { key: 'playground', label: '对话测试/调试', icon: 'chat' },
  { key: 'evaluation', label: '评估体系', icon: 'target' },
  { key: 'sessions', label: '会话监控', icon: 'activity' },
  { key: 'analytics', label: '数据统计', icon: 'chart' },
  { key: 'tickets', label: '工单管理', icon: 'inbox' },
  { key: 'ticket_links', label: '工单链接配置', icon: 'link' },
  { key: 'config', label: '模型/参数配置', icon: 'sliders' },
  { key: 'users', label: '用户与权限', icon: 'users' }
]

const roleTone = {
  admin: 'bg-violet-500/20 text-violet-300',
  ops: 'bg-blue-500/20 text-blue-300',
  agent: 'bg-emerald-500/20 text-emerald-300',
  customer: 'bg-slate-500/20 text-slate-300',
}

export default function Sidebar({ active, onChange, user, onLogout, activePrompt }) {
  return (
    <aside className="w-56 shrink-0 bg-slate-900 text-slate-300 flex flex-col h-screen sticky top-0">
      <div className="px-5 py-5 border-b border-slate-800">
        <p className="text-white font-semibold text-sm tracking-wide">Verity RAG</p>
        <p className="text-xs text-slate-500 mt-0.5">智能客服管理后台</p>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
              active === item.key
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            <Icon name={item.icon} size={16} />
            {item.label}
          </button>
        ))}
      </nav>

      {/* Current user */}
      {user && (
        <div className="px-3 py-3 border-t border-slate-800">
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-slate-800 transition-colors group">
            <div className="w-7 h-7 rounded-full bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-xs font-semibold shrink-0 select-none">
              {user.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{user.name}</p>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {(user.roles || []).map(r => (
                  <span key={r} className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${roleTone[r] || roleTone.customer}`}>
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={onLogout}
              title="退出登录"
              className="text-slate-600 group-hover:text-slate-400 hover:!text-red-400 transition-colors p-0.5"
            >
              <Icon name="log-out" size={13} />
            </button>
          </div>
        </div>
      )}

      <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-600">
        <p>环境：P1 · API 模式</p>
        <p className="mt-0.5">
          {activePrompt
            ? <span className="text-indigo-400">prompt-{activePrompt}</span>
            : <span>prompt-…</span>
          }
          {' · claude-sonnet-4-6'}
        </p>
      </div>
    </aside>
  )
}
