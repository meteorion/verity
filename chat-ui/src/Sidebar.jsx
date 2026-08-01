import { useState } from 'react'
import { groupConvsByDate } from './store.js'

export default function Sidebar({ convs, activeId, user, onNew, onSelect, onDelete, onLogin, onLogout, onClose }) {
  const groups = groupConvsByDate(convs)

  return (
    <aside className="flex flex-col h-full bg-slate-950 text-slate-300 w-64 select-none">
      {/* Top */}
      <div className="flex items-center gap-2 px-3 pt-6 pb-4">
        {/* Logo */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center shrink-0">
            <BotIcon />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white leading-none">智能客服</p>
            <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1 leading-none">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
              在线中
            </p>
          </div>
        </div>
        {/* Close on mobile */}
        {onClose && (
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 p-1 rounded lg:hidden">
            <XIcon />
          </button>
        )}
      </div>

      {/* New chat */}
      <div className="px-3 mt-2 pb-4">
        <button
          onClick={onNew}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-700 hover:border-slate-600 transition-colors"
        >
          <PlusIcon />
          新对话
        </button>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 space-y-4 py-1">
        {convs.length === 0 && (
          <p className="text-xs text-slate-600 text-center py-6">暂无对话记录</p>
        )}
        {groups.map(group => (
          <div key={group.label}>
            <p className="text-[10px] font-medium text-slate-600 uppercase tracking-wider px-2 pb-1">{group.label}</p>
            <div className="space-y-0.5">
              {group.items.map(conv => (
                <ConvItem
                  key={conv.id}
                  conv={conv}
                  active={conv.id === activeId}
                  onSelect={() => onSelect(conv.id)}
                  onDelete={() => onDelete(conv.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* User area */}
      <div className="border-t border-slate-800 p-3">
        {user ? (
          <div className="flex items-center gap-2.5 group relative">
            <div className="w-7 h-7 rounded-full bg-indigo-700 text-indigo-200 flex items-center justify-center text-xs font-semibold shrink-0">
              {user.name?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{user.name}</p>
              <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
            </div>
            <button
              onClick={onLogout}
              title="退出登录"
              className="text-slate-600 hover:text-red-400 transition-colors p-1"
            >
              <LogoutIcon />
            </button>
          </div>
        ) : (
          <button
            onClick={onLogin}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <LoginIcon />
            登录账号
          </button>
        )}
      </div>
    </aside>
  )
}

function ConvItem({ conv, active, onSelect, onDelete }) {
  const [hovering, setHovering] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
        active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
      }`}
      onClick={onSelect}
    >
      <p className="flex-1 text-xs truncate">{conv.title}</p>
      {(hovering || active) && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="shrink-0 p-0.5 rounded text-slate-600 hover:text-red-400 hover:bg-slate-700 transition-colors"
        >
          <TrashIcon />
        </button>
      )}
    </div>
  )
}

// Icons
function BotIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"/>
      <circle cx="12" cy="5" r="2"/>
      <path d="M12 7v4"/>
      <circle cx="8" cy="16" r="1" fill="white" stroke="none"/>
      <circle cx="16" cy="16" r="1" fill="white" stroke="none"/>
    </svg>
  )
}
function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14"/>
    </svg>
  )
}
function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  )
}
function XIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18M6 6l12 12"/>
    </svg>
  )
}
function LoginIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
    </svg>
  )
}
function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}
