const TOKEN_KEY = 'verity_chat_token'
const USER_KEY  = 'verity_chat_user'

export function getToken() { return localStorage.getItem(TOKEN_KEY) }
export function getUser()  {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) } catch { return null }
}
export function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
export function isLoggedIn() {
  const t = getToken()
  if (!t) return false
  try { const p = JSON.parse(atob(t.split('.')[1])); return p.exp * 1000 > Date.now() }
  catch { return false }
}
