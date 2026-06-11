import { useState, useEffect, useCallback } from 'react'
import type { HistoryEntry } from '../types'
import { fetchHistory, clearHistory } from '../api'

interface Props {
  scriptFilter?: string
  envId?: string
}

export default function HistoryView({ scriptFilter, envId = '' }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | 'done' | 'error' | 'running'>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try { setHistory(await fetchHistory(envId)) } catch { /* ignore */ } finally { setLoading(false) }
  }, [envId])

  useEffect(() => { void load() }, [load])

  async function handleClear() {
    if (!confirm('Clear all run history?')) return
    await clearHistory(envId)
    setHistory([])
  }

  function fuzzy(text: string, q: string): boolean {
    if (!q) return true
    const lt = text.toLowerCase(), lq = q.toLowerCase()
    let qi = 0
    for (let i = 0; i < lt.length && qi < lq.length; i++) { if (lt[i] === lq[qi]) qi++ }
    return qi === lq.length
  }

  function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  function scriptBase(path: string) {
    return path.split('/').pop() ?? path
  }

  let filtered = filterStatus === 'all' ? history : history.filter(h => h.status === filterStatus)
  if (scriptFilter) filtered = filtered.filter(h => h.script === scriptFilter || h.script.endsWith('/' + scriptFilter.split('/').pop()))
  if (search) filtered = filtered.filter(h => fuzzy(h.script, search) || fuzzy(h.machine_name, search) || fuzzy(h.args, search))

  const counts = {
    all: history.length,
    done: history.filter(h => h.status === 'done').length,
    error: history.filter(h => h.status === 'error').length,
    running: history.filter(h => h.status === 'running').length,
  }

  const statusBadge = (s: HistoryEntry['status']) => {
    if (s === 'done') return 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/30'
    if (s === 'error') return 'bg-red-900/40 text-red-300 border border-red-700/30'
    return 'bg-blue-900/40 text-blue-300 border border-blue-700/30'
  }
  const statusIcon = (s: HistoryEntry['status']) => {
    if (s === 'done') return 'ok'
    if (s === 'error') return 'err'
    return '...'
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-4 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Run History</span>
          {scriptFilter && (
            <span className="text-xs text-emerald-400 font-mono bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-700/30">
              {scriptFilter.split('/').pop()}
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {(['all', 'done', 'error', 'running'] as const).map(f => (
            <button key={f} onClick={() => setFilterStatus(f)}
              className={'px-2 py-0.5 rounded text-xs font-medium transition-colors ' +
                (filterStatus === f ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}>
              {f === 'all' ? 'All' : f === 'done' ? 'Done' : f === 'error' ? 'Error' : 'Running'}
              <span className="ml-1 text-slate-600">({counts[f]})</span>
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
          placeholder="fuzzy search..."
          className="ml-auto w-40 bg-slate-800/60 border border-slate-700 text-slate-300 rounded-md px-2 py-0.5 text-xs
                     focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-slate-600"
        />
        <button onClick={() => void load()} disabled={loading}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40">
          {loading ? '↻' : '↺'}
        </button>
        {history.length > 0 && (
          <button onClick={() => void handleClear()}
            className="text-xs text-slate-600 hover:text-red-400 transition-colors">
            🗑️ Clear
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-slate-600 text-sm italic">
              {history.length === 0 ? 'No runs yet.' : 'No runs match the filter.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left sticky top-0 bg-slate-950">
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Status</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Script</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Machine</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Args</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => (
                <tr key={h.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                  <td className="px-4 py-2.5">
                    <span className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono ' + statusBadge(h.status)}>
                      <span className={h.status === 'running' ? 'animate-spin inline-block' : ''}>{statusIcon(h.status)}</span>
                      {h.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col">
                      <span className="font-mono text-xs text-slate-200">{scriptBase(h.script)}</span>
                      {h.script.includes('/') && (
                        <span className="text-[10px] text-slate-600 font-mono">{h.script}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-300 text-xs">{h.machine_name}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-mono">{h.args || '—'}</td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{fmtDate(h.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
