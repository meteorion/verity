export const MD_COMPONENTS = {
  p:          ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
  ul:         ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-0.5">{children}</ul>,
  ol:         ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-0.5">{children}</ol>,
  li:         ({ children }) => <li className="leading-relaxed">{children}</li>,
  h1:         ({ children }) => <h1 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h1>,
  h2:         ({ children }) => <h2 className="text-sm font-bold mb-1.5 mt-2.5 first:mt-0">{children}</h2>,
  h3:         ({ children }) => <h3 className="text-sm font-semibold mb-1 mt-2 first:mt-0">{children}</h3>,
  strong:     ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em:         ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 pl-3 my-2 text-slate-500 italic">{children}</blockquote>,
  a:          ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline break-all">{children}</a>,
  hr:         () => <hr className="my-3 border-slate-200" />,
  code:       ({ inline, className, children }) => inline
    ? <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-mono">{children}</code>
    : <pre className="my-2 p-3 rounded-lg bg-slate-800 text-slate-100 text-xs font-mono overflow-x-auto whitespace-pre"><code className={className}>{children}</code></pre>,
  table:      ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
  th:         ({ children }) => <th className="border border-slate-200 px-2 py-1 bg-slate-50 font-semibold text-left">{children}</th>,
  td:         ({ children }) => <td className="border border-slate-200 px-2 py-1">{children}</td>,
}
