import { useState } from 'react'
import { isLoggedIn, getUser, clearAuth } from './auth.js'
import { loadConvs, saveConvs, loadActiveId, saveActiveId, deriveTitle } from './store.js'
import Sidebar from './Sidebar.jsx'
import ChatArea from './ChatArea.jsx'
import LoginModal from './LoginModal.jsx'

export default function App() {
  const [convs,       setConvs]       = useState(loadConvs)
  const [activeId,    setActiveId]    = useState(loadActiveId)
  const [user,        setUser]        = useState(() => isLoggedIn() ? getUser() : null)
  const [showLogin,   setShowLogin]   = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeConv = convs.find(c => c.id === activeId) ?? null

  // ── Conversation management ──────────────────────────────────────────
  function newConv() {
    setActiveId(null)
    saveActiveId(null)
    setSidebarOpen(false)
  }

  function selectConv(id) {
    setActiveId(id)
    saveActiveId(id)
    setSidebarOpen(false)
  }

  function deleteConv(id) {
    const updated = convs.filter(c => c.id !== id)
    setConvs(updated)
    saveConvs(updated)
    if (activeId === id) { setActiveId(null); saveActiveId(null) }
  }

  // Called by ChatArea whenever messages change (including once per streamed
  // token, for the conversation currently being sent). Only activate the
  // conversation when it's brand new — otherwise, since this fires
  // continuously while streaming, switching to a different history
  // conversation mid-stream would get yanked right back by the next token.
  function handleMessage(sessionId, messages, firstQuery) {
    let isNew = false
    setConvs(prev => {
      const existing = prev.find(c => c.id === sessionId)
      let updated
      if (existing) {
        updated = prev.map(c =>
          c.id === sessionId ? { ...c, messages, updatedAt: Date.now() } : c
        )
      } else {
        isNew = true
        const title = deriveTitle(firstQuery || messages.find(m => m.role === 'user')?.text || '新对话')
        updated = [
          { id: sessionId, title, messages, createdAt: Date.now(), updatedAt: Date.now() },
          ...prev,
        ]
      }
      saveConvs(updated)
      return updated
    })
    if (isNew) {
      setActiveId(sessionId)
      saveActiveId(sessionId)
    }
  }

  // ── Auth ─────────────────────────────────────────────────────────────
  function handleLogin(token, userData) {
    setUser(userData)
    setShowLogin(false)
  }

  function handleLogout() {
    clearAuth()
    setUser(null)
  }

  return (
    <div className="flex h-full overflow-hidden bg-white">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:relative inset-y-0 left-0 z-30
        transform transition-transform duration-200 ease-in-out
        lg:transform-none lg:translate-x-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        shrink-0
      `}>
        <Sidebar
          convs={convs}
          activeId={activeId}
          user={user}
          onNew={newConv}
          onSelect={selectConv}
          onDelete={deleteConv}
          onLogin={() => setShowLogin(true)}
          onLogout={handleLogout}
          onClose={() => setSidebarOpen(false)}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 min-w-0 flex flex-col">
        <ChatArea
          conv={activeConv}
          onMessage={handleMessage}
          onToggleSidebar={() => setSidebarOpen(v => !v)}
        />
      </div>

      {showLogin && (
        <LoginModal
          onClose={() => setShowLogin(false)}
          onLogin={handleLogin}
        />
      )}
    </div>
  )
}
