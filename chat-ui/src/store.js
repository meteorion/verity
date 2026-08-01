const CONVS_KEY  = 'verity_convs'
const ACTIVE_KEY = 'verity_active'

export function loadConvs() {
  try { return JSON.parse(localStorage.getItem(CONVS_KEY)) || [] } catch { return [] }
}
export function saveConvs(convs) {
  localStorage.setItem(CONVS_KEY, JSON.stringify(convs.slice(0, 200)))
}
export function loadActiveId() { return localStorage.getItem(ACTIVE_KEY) || null }
export function saveActiveId(id) {
  id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY)
}

// Derive a short title from the first user message
export function deriveTitle(text) {
  return text.trim().slice(0, 40) || '新对话'
}

// Group conversations by relative date
export function groupConvsByDate(convs) {
  const now = Date.now()
  const DAY = 86_400_000
  const groups = [
    { label: '今天',    items: [] },
    { label: '昨天',    items: [] },
    { label: '过去 7 天', items: [] },
    { label: '更早',    items: [] },
  ]
  for (const c of convs) {
    const age = now - c.updatedAt
    if      (age < DAY)     groups[0].items.push(c)
    else if (age < 2 * DAY) groups[1].items.push(c)
    else if (age < 7 * DAY) groups[2].items.push(c)
    else                    groups[3].items.push(c)
  }
  return groups.filter(g => g.items.length > 0)
}
