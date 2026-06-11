import { useState, useEffect, useCallback } from 'react'
import type { LogFile } from '../types'
import { fetchLogFiles, readLogFile, deleteLogFile } from '../api'

interface Props {
  scriptFilter?: string
  envId?: string
}

export default function LogsBrowser({ scriptFilter, envId = '' }: Props) {
  const [files, setFiles] = useState<LogFile[]>([])
  const [selected, setSelected] = useState<LogFile | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(false)
  const [contentLoading, setContentLoading] = useState(false)
  const [catFilter, setCatFilter] = useState<'all' | 'ansible' | 'bash'>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setFiles(await fetchLogFiles(envId)) } catch { /* ignore */ } finally { setLoading(false) }
  }, [envId])

  useEffect(() => { void load() }, [load])

  async function openFile(f: LogFile) {
    setSelected(f); setContentLoading(true)
    try { setContent(await readLogFile(f.path)) } catch { setContent('[Error reading file]') }
    finally { setContentLoading(false) }
  }

  async function handleDelete(f: LogFile, e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm('Delete "' + f.name + '"?')) return
    await deleteLogFile(f.path)
    if (selected?.path === f.path) { setSelected(null); setContent('') }
    void load()
  }

  function fuzzy(text: string, q: string): boolean {
    if (!q) return true
    const lt = text.toLowerCase(), lq = q.toLowerCase()
    let qi = 0
    for (let i = 0; i < lt.length && qi < lq.length; i++) { if (lt[i] === lq[qi]) qi++ }
    return qi === lq.length
  }

  let visible = catFilter === 'all' ? files : files.filter(f => f.category === catFilter)
  if (search) visible = visible.filter(f => fuzzy(f.name, search))
  if (scriptFilter) visible = visible.filter(f => f.name.includes(scriptFilter.replace(/.*\//, '').replace(/\.[^.]+$/, '')))

  const ansible = visible.filter(f => f.category === 'ansible')
  const bash = visible.filter(f => f.category === 'bash')

  function fmtSize(b: number) {
    if (b < 1024) return b + ' B'
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'
    return (b / 1048576).toFixed(1) + ' MB'
  }
  function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  const colorByLine = (line: string) => {
    if (line.startsWith('[ERROR]')) return 'text-red-400'
    if (line.startsWith('[INFO]')) return 'text-blue-400'
    if (line.startsWith('[DONE]')) return 'text-emerald-400'
    if (line.startsWith('[STDERR]')) return 'text-orange-400'
    if (line.startsWith('---')) return 'text-slate-600'
    return 'text-slate-300'
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 shrink-0 border-r border-slate-800 flex flex-col">
        <div className="shrink-0 px-3 py-2 border-b border-slate-800 flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Saved Logs</span>
          <button onClick={() => void load()} disabled={loading}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40">
            {loading ? '↻' : '↺ Refresh'}
          </button>
        </div>
        <div className="shrink-0 px-2 py-1.5 border-b border-slate-800">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
            placeholder="fuzzy search logs..."
            className="w-full bg-slate-800/60 border border-slate-700 text-slate-300 rounded-md px-2 py-1 text-xs
                       focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-600"
          />
        </div>
        {scriptFilter && (
          <div className="shrink-0 px-3 py-1 border-b border-slate-800 flex items-center gap-2">
            <span className="text-[10px] text-slate-500">Filtered:</span>
            <span className="text-[10px] text-emerald-400 font-mono truncate">{scriptFilter.split('/').pop()}</span>
          </div>
        )}
        <div className="shrink-0 px-3 py-1 border-b border-slate-800 flex gap-1">
          {(['all', 'ansible', 'bash'] as const).map(f => (
            <button key={f} onClick={() => setCatFilter(f)}
              className={'px-2 py-0.5 rounded text-xs font-medium transition-colors ' +
                (catFilter === f ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}>
              {f === 'all' ? 'All' : f === 'ansible' ? 'Ansible' : 'Bash'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-0.5">
          {visible.length === 0 && !loading && (
            <p className="text-slate-500 text-xs italic px-2 py-4">No saved logs found.</p>
          )}
          {(catFilter === 'all'
            ? [{ label: 'Ansible', items: ansible }, { label: 'Bash', items: bash }]
            : [{ label: '', items: visible }]
          ).map(({ label, items }) => items.length > 0 && (
            <div key={label}>
              {label && <p className="text-[10px] text-slate-600 px-2 py-1 uppercase tracking-wider">{label}</p>}
              {items.map(f => (
                <div key={f.path} onClick={() => void openFile(f)}
                  className={'group flex items-start justify-between px-2 py-1.5 rounded cursor-pointer transition-colors ' +
                    (selected?.path === f.path ? 'bg-emerald-900/30 text-emerald-300' : 'hover:bg-slate-800 text-slate-300')}>
                  <div className="flex flex-col min-w-0 mr-1">
                    <span className="text-xs font-mono truncate">{f.name}</span>
                    <span className="text-[10px] text-slate-600">{fmtDate(f.modified)} · {fmtSize(f.size)}</span>
                  </div>
                  <button onClick={e => void handleDelete(f, e)}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all text-xs">🗑️</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-950">
        {selected ? (
          <>
            <div className="shrink-0 px-4 py-2 border-b border-slate-800 flex items-center gap-3">
              <span className="text-xs font-mono text-slate-300 truncate">{selected.path}</span>
              <span className="text-xs text-slate-600 shrink-0">{fmtSize(selected.size)}</span>
              <span className="text-xs text-slate-600 shrink-0">{fmtDate(selected.modified)}</span>
            </div>
            <div className="flex-1 overflow-auto p-4">
              {contentLoading ? (
                <p className="text-slate-500 text-sm">Loading...</p>
              ) : (
                <pre className="text-xs font-mono leading-relaxed">
                  {content.split('\n').map((line, i) => (
                    <span key={i} className={'block ' + colorByLine(line)}>{line}</span>
                  ))}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-slate-600 text-sm">Select a log file to view its content</p>
          </div>
        )}
      </div>
    </div>
  )
}
