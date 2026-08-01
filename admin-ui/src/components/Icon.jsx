// 轻量内联 SVG 图标集，避免引入额外图标库依赖
const paths = {
  book: 'M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22.5v-18Z M4 19.5A2.5 2.5 0 0 1 6.5 17H20',
  chat: 'M21 12a8 8 0 1 1-3.3-6.5L21 4v8Z M8 10h8 M8 13h5',
  activity: 'M3 12h4l3 8 4-16 3 8h4',
  chart: 'M4 20V10 M10 20V4 M16 20v-7 M22 20H2',
  sliders: 'M4 6h9 M4 12h5 M4 18h12 M17 6h3 M13 12h7 M20 18h0',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  upload: 'M12 16V4 M6 10l6-6 6 6 M4 20h16',
  refresh: 'M4 4v6h6 M20 20v-6h-6 M5.5 9A7 7 0 0 1 19 8.5 M18.5 15a7 7 0 0 1-13.5.5',
  check: 'M20 6 9 17l-5-5',
  x: 'M18 6 6 18 M6 6l12 12',
  alert: 'M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z M21 21l-4.3-4.3',
  play: 'M6 4l14 8-14 8V4Z',
  link: 'M9 15 15 9 M11 5 13 3a4 4 0 0 1 6 6l-2 2 M13 19l-2 2a4 4 0 0 1-6-6l2-2',
  plus: 'M12 5v14 M5 12h14',
  'log-out': 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  'user-plus': 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0 M19 8v6 M22 11h-6',
  'trash-2': 'M3 6h18 M8 6V4h8v2 M19 6l-1 14H6L5 6 M10 11v6 M14 11v6',
  'refresh-cw': 'M21 2v6h-6 M3 12a9 9 0 0 1 15-6.7L21 8 M3 22v-6h6 M21 12a9 9 0 0 1-15 6.7L3 16',
  'chevron-up': 'M18 15l-6-6-6 6',
  'chevron-down': 'M6 9l6 6 6-6'
}

export default function Icon({ name, size = 18, className = '' }) {
  const d = paths[name] || paths.activity
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={d} />
    </svg>
  )
}
