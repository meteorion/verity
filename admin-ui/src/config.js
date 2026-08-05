/**
 * 全局基础配置 —— 单例 + 广播模式
 * 只发一次 /api/settings/basic-config 请求，所有 useBasicConfig() 调用共享同一份数据。
 * 调用 updateBasicConfig() 可同步更新所有已挂载的组件。
 */
import { useState, useEffect } from 'react'
import { apiFetch } from './auth.js'

// ── 内置默认值 ────────────────────────────────────────────────────────────────

export const DEFAULT_DOC_TYPES = [
  { value: 'faq',          label: 'FAQ' },
  { value: 'manual',       label: '操作手册' },
  { value: 'policy',       label: '政策说明' },
  { value: 'announcement', label: '公告' },
  { value: 'other',        label: '其他' },
]

export const DEFAULT_CATEGORIES = [
  { value: 'product',     label: '产品' },
  { value: 'after_sales', label: '售后' },
  { value: 'complaint',   label: '投诉' },
  { value: 'inquiry',     label: '咨询' },
  { value: 'general',     label: '通用' },
]

export const DEFAULT_TAG_PRESETS = ['高优', '紧急', '外部', '常见问题', 'VIP', '退款', '发货', '会员']

export const DEFAULT_GROUPS = [
  { value: 'global',    label: '全局' },
  { value: 'saas',      label: 'SAAS' },
  { value: 'cashier',   label: '收银通' },
  { value: 'joint_acq', label: '联合收单' },
]

// ── localStorage ──────────────────────────────────────────────────────────────

const _LS_KEY = 'verity:basic_config'

function _lsLoad() {
  try { return JSON.parse(localStorage.getItem(_LS_KEY) || 'null') } catch { return null }
}
function _lsSave(data) {
  try { localStorage.setItem(_LS_KEY, JSON.stringify(data)) } catch {}
}

function _merge(raw) {
  return {
    doc_types:   raw?.doc_types   ?? DEFAULT_DOC_TYPES,
    categories:  raw?.categories  ?? DEFAULT_CATEGORIES,
    tag_presets: raw?.tag_presets ?? DEFAULT_TAG_PRESETS,
    groups:      raw?.groups      ?? DEFAULT_GROUPS,
  }
}

// ── 单例 store ────────────────────────────────────────────────────────────────

let _store = _merge(_lsLoad())
const _subs = new Set()
let _fetchStarted = false

function _broadcast(data) {
  _store = data
  _subs.forEach(fn => fn(data))
}

function _fetchOnce() {
  if (_fetchStarted) return
  _fetchStarted = true
  apiFetch('/api/settings/basic-config')
    .then(r => { if (!r.ok) throw new Error(); return r.json() })
    .then(d => { const m = _merge(d); _lsSave(m); _broadcast(m) })
    .catch(() => {})
}

/** 保存一个 section 的更新，广播到所有订阅组件，并异步同步到后端 */
export function updateBasicConfig(key, value) {
  const next = { ..._store, [key]: value }
  _broadcast(next)
  _lsSave(next)
  apiFetch('/api/settings/basic-config', {
    method: 'PUT',
    body: JSON.stringify({ [key]: value }),
  }).catch(() => {})
}

// ── hook ──────────────────────────────────────────────────────────────────────

export function useBasicConfig() {
  const [config, setConfig] = useState(() => _store)
  useEffect(() => {
    _subs.add(setConfig)
    _fetchOnce()
    return () => { _subs.delete(setConfig) }
  }, [])
  return config
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

/** [{value, label}] → {value: label} */
export function toLabel(items) {
  return Object.fromEntries((items || []).map(i => [i.value, i.label]))
}
