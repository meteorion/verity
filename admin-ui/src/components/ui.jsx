import { useState, useRef, useEffect } from 'react'

export function Select({ value, onChange, options = [], className = '', size = 'sm' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const toVal  = (o) => typeof o === 'string' ? o : o.value
  const toLbl  = (o) => typeof o === 'string' ? o : o.label
  const selected = options.find((o) => toVal(o) === value)
  const label = selected ? toLbl(selected) : value

  const triggerCls = size === 'sm'
    ? 'text-xs px-2.5 py-1.5'
    : 'text-sm px-3 py-2'

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center justify-between gap-1.5 border border-slate-100 bg-slate-50 rounded-xl text-slate-500 cursor-pointer hover:border-slate-200 hover:bg-white transition-colors ${triggerCls}`}
      >
        <span>{label}</span>
        <svg
          className={`shrink-0 text-slate-300 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          width="11" height="11" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 min-w-full bg-white border border-slate-100 rounded-xl shadow-lg shadow-slate-200/60 overflow-hidden py-1">
          {options.map((o) => {
            const val = toVal(o)
            const lbl = toLbl(o)
            const active = val === value
            return (
              <button
                key={val}
                type="button"
                onClick={() => { onChange(val); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors whitespace-nowrap
                  ${active
                    ? 'bg-indigo-50 text-indigo-600 font-medium'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  }`}
              >
                {lbl}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function Card({ title, action, children, className = '' }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          {title && <h3 className="text-sm font-medium text-slate-700">{title}</h3>}
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  )
}

const badgeStyles = {
  slate: 'bg-slate-100 text-slate-600',
  green: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  blue: 'bg-blue-50 text-blue-700',
  purple: 'bg-violet-50 text-violet-700'
}

export function Badge({ tone = 'slate', children }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${badgeStyles[tone] || badgeStyles.slate}`}>
      {children}
    </span>
  )
}

const statusToneMap = {
  active: 'green',
  pending: 'amber',
  rejected: 'red',
  expired: 'slate',
  online: 'green',
  offline: 'slate',
  transferred: 'purple'
}

export function StatusBadge({ status, labelMap = {} }) {
  const tone = statusToneMap[status] || 'slate'
  return <Badge tone={tone}>{labelMap[status] || status}</Badge>
}

export function MetricCard({ label, value, unit, hint, tone = 'slate' }) {
  const toneText = {
    slate: 'text-slate-900',
    green: 'text-emerald-600',
    red: 'text-red-600',
    amber: 'text-amber-600'
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500 mb-1.5">{label}</p>
      <p className={`text-2xl font-semibold ${toneText[tone] || toneText.slate}`}>
        {value}
        {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
      </p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

export function Button({ children, variant = 'default', size = 'md', className = '', ...props }) {
  const variants = {
    default: 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50',
    primary: 'bg-indigo-600 border border-indigo-600 text-white hover:bg-indigo-700',
    danger: 'bg-white border border-red-200 text-red-600 hover:bg-red-50',
    'danger-solid': 'bg-red-600 border border-red-600 text-white hover:bg-red-700',
    warning: 'bg-white border border-amber-300 text-amber-600 hover:bg-amber-50',
    ghost: 'border border-transparent text-slate-500 hover:bg-slate-100'
  }
  const sizes = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-1.5 text-sm'
  }
  return (
    <button
      className={`rounded-lg font-medium transition-colors inline-flex items-center gap-1.5 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}

export function Table({ columns, rows, rowKey, onRowClick }) {
  return (
    <div className="overflow-x-auto -mx-5">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
            {columns.map((c) => (
              <th key={c.key} className="px-5 py-2 font-medium whitespace-nowrap">
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-5 py-8 text-center text-slate-400 text-sm">
                暂无数据
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr
              key={row[rowKey]}
              onClick={() => onRowClick && onRowClick(row)}
              className={`border-b border-slate-50 last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}
            >
              {columns.map((c) => (
                <td key={c.key} className="px-5 py-2.5 whitespace-nowrap text-slate-700">
                  {c.render ? c.render(row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ProgressBar({ value, max = 100, tone = 'indigo' }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  const toneMap = {
    indigo: 'bg-indigo-500',
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500'
  }
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full ${toneMap[tone] || toneMap.indigo}`} style={{ width: `${pct}%` }} />
    </div>
  )
}
