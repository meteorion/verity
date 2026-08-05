import Icon from './Icon.jsx'

const NAV_ITEMS = [
  { key: 'knowledge', label: '知识库', icon: 'book' },
  { key: 'chunks', label: 'Chunks', icon: 'layers' },
  { key: 'playground', label: '对话调试', icon: 'chat' },
  { key: 'evaluation', label: '评估', icon: 'target' },
  { key: 'sessions', label: '会话', icon: 'activity' },
  { key: 'analytics', label: '统计', icon: 'chart' },
  { key: 'tickets', label: '工单', icon: 'inbox' },
  { key: 'config', label: '配置', icon: 'sliders' },
  { key: 'users', label: '用户权限', icon: 'users' }
]

const roleTone = {
  admin: 'bg-violet-500/20 text-violet-300',
  ops: 'bg-blue-500/20 text-blue-300',
  agent: 'bg-emerald-500/20 text-emerald-300',
  customer: 'bg-slate-500/20 text-slate-300',
}

export default function Sidebar({ active, onChange, user, onLogout, onTaskCenter, activeJobCount = 0 }) {
  return (
    <aside className="w-48 shrink-0 bg-slate-900 text-slate-300 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-slate-800">
        <p className="text-white font-semibold text-sm tracking-wide">Verity RAG</p>
        <p className="text-[10px] text-slate-500 mt-0.5">智能客服管理后台</p>
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

      {/* Task Center */}
      <div className="px-2 pb-1 border-t border-slate-800 pt-2">
        <button
          onClick={onTaskCenter}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <Icon name="activity" size={16} />
            任务中心
          </div>
          {activeJobCount > 0 && (
            <span className="bg-indigo-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none">
              {activeJobCount}
            </span>
          )}
        </button>
      </div>

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
            <button onClick={onLogout} title="退出登录"
              className="text-slate-600 group-hover:text-slate-400 hover:!text-red-400 transition-colors p-0.5">
              <Icon name="log-out" size={13} />
            </button>
          </div>
        </div>
      )}

    </aside>
  )
}
