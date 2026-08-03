import { useState, useEffect } from 'react'
import { isLoggedIn, getUser, clearAuth, apiFetch } from './auth.js'
import Login from './pages/Login.jsx'
import Sidebar from './components/Sidebar.jsx'
import Icon from './components/Icon.jsx'
import KnowledgeBase from './pages/KnowledgeBase.jsx'
import Chunks from './pages/Chunks.jsx'
import Playground from './pages/Playground.jsx'
import Evaluation from './pages/Evaluation.jsx'
import Sessions from './pages/Sessions.jsx'
import Analytics from './pages/Analytics.jsx'
import ModelConfig from './pages/ModelConfig.jsx'
import Users from './pages/Users.jsx'
import Tickets from './pages/Tickets.jsx'
import TicketLinks from './pages/TicketLinks.jsx'
import TicketNew from './pages/TicketNew.jsx'

const PAGES = {
  knowledge: { title: '知识库管理', desc: '文档准入、生效期与冲突治理', Comp: KnowledgeBase },
  chunks: { title: 'Chunks 管理', desc: '知识块查看、编辑、导入与导出', Comp: Chunks },
  playground: { title: '对话测试/调试', desc: '模拟真实问答，查看检索与生成全链路', Comp: Playground },
  evaluation: { title: '评估体系', desc: '数据集管理、召回率测试与记录统计', Comp: Evaluation },
  sessions: { title: '会话监控', desc: '实时会话审计与异常追踪', Comp: Sessions },
  analytics: { title: '数据统计', desc: '检索/生成/端到端指标看板', Comp: Analytics },
  tickets: { title: '工单管理', desc: '客服工单查看、状态更新与转派', Comp: Tickets },
  ticket_links: { title: '工单链接配置', desc: '各工单类型的表单链接与启用状态管理', Comp: TicketLinks },
  config: { title: '模型/参数配置', desc: 'Provider 切换、阈值与 Prompt 版本管理', Comp: ModelConfig },
  users: { title: '用户与权限', desc: '角色与知识 ACL 管理', Comp: Users }
}

export default function App() {
  const isTicketForm = new URLSearchParams(window.location.search).has('type')

  const [loggedIn, setLoggedIn] = useState(isLoggedIn)
  const [user, setUser] = useState(getUser)
  const [active, setActive] = useState('knowledge')
  const [activePrompt, setActivePrompt] = useState(null)

  async function fetchActivePrompt() {
    try {
      const res = await apiFetch('/api/ops/prompts')
      const data = await res.json()
      const found = (data.prompts || []).find((p) => p.is_active)
      setActivePrompt(found?.version || null)
    } catch {
      // non-critical — sidebar falls back to static text
    }
  }

  useEffect(() => {
    if (loggedIn) fetchActivePrompt()
  }, [loggedIn])

  function handleLogin(userData) {
    setUser(userData)
    setLoggedIn(true)
  }

  function handleLogout() {
    clearAuth()
    setLoggedIn(false)
    setUser(null)
    setActivePrompt(null)
  }

  if (isTicketForm) {
    return <TicketNew />
  }

  if (!loggedIn) {
    return <Login onLogin={handleLogin} />
  }

  const page = PAGES[active]
  const Comp = page.Comp

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar
        active={active}
        onChange={setActive}
        user={user}
        onLogout={handleLogout}
        activePrompt={activePrompt}
      />
      <div className="flex-1 min-w-0">
        <header className="h-14 flex items-center justify-between px-6 bg-white border-b border-slate-200 sticky top-0 z-10">
          <div>
            <h1 className="text-sm font-semibold text-slate-800">{page.title}</h1>
            <p className="text-xs text-slate-400">{page.desc}</p>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-semibold select-none">
                  {user.name?.charAt(0) || '?'}
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs font-medium text-slate-700 leading-none">{user.name}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{(user.roles || []).join(', ')}</p>
                </div>
              </div>
            )}
            <button
              onClick={handleLogout}
              title="退出登录"
              className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <Icon name="log-out" size={15} />
            </button>
          </div>
        </header>
        <main className="p-6 w-full min-w-0">
          <Comp user={user} />
        </main>
      </div>
    </div>
  )
}
