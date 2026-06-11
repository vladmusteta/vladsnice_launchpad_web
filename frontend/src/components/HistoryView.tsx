import { useState, useEffect, useCallback, useRef } from 'react'
import type { HistoryEntry } from '../types'
import { fetchHistory, clearHistory } from '../api'

interface Props {
  scriptFilter?: string
  envId?: string
  onReRun?: (entry: HistoryEntry) => void
}

export default function HistoryView({ scriptFilter, envId = '', onReRun }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [filterStatus, setFilterStatus] = useState<'all' | 'done' | 'error' | 'running'>('all')
  const [search, setSearch] = useState('')
  const [confirmEntry, setConfirmEntry] = useState<HistoryEntry | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { setHistory(await fetchHistory(envId)) } catch { /* ignore */ } finally { setLoading(false) }
  }, [envId])

  useEffect(() => { void load() }, [load])

  // Auto-refresh every 5s so running jobs update
  useEffect(() => {
    intervalRef.current = setInterval(() => { void fetchHistory(envId).then(setHistory).catch(() => {}) }, 5000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [envId])

  async function handleClear() {
    if (!confirm('Clear all run history?')) return
    await clearHistory(envId)
    setHistory([])
  }

  function exportCSV() {
    const rows = [
      ['Status', 'Script', 'Machine', 'Args', 'Time', 'Environment'],
      ...filtered.map(h => [h.status, h.script, h.machine_name, h.args, h.timestamp, h.environment_id ?? '']),
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'history.csv'; a.click()
    URL.revokeObjectURL(url)
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

  function StatusBadge({ s }: { s: HistoryEntry['status'] }) {
    if (s === 'done') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono bg-emerald-900/40 text-emerald-300 border border-emerald-700/30">
        <span className="text-emerald-400">✓</span> done
      </span>
    )
    if (s === 'error') return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono bg-red-900/40 text-red-300 border border-red-700/30">
        <span className="text-red-400">✕</span> error
      </span>
    )
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-mono bg-blue-900/40 text-blue-300 border border-blue-700/30">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        running
      </span>
    )
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
        {filtered.length > 0 && (
          <button onClick={exportCSV}
            className="text-xs text-slate-500 hover:text-slate-200 transition-colors border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded">
            ↓ CSV
          </button>
        )}
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
                {onReRun && <th className="px-4 py-2 text-xs font-medium text-slate-500" />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((h) => (
                <tr key={h.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors group">
                  <td className="px-4 py-2.5">
                    <StatusBadge s={h.status} />
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
                  {onReRun && (
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => setConfirmEntry(h)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-slate-500 hover:text-emerald-400 transition-all px-2 py-0.5 rounded border border-transparent hover:border-emerald-700/50"
                        title="Re-run"
                      >↩ re-run</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Re-run confirmation modal ── */}
      {confirmEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setConfirmEntry(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-md mx-4 p-5"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-200 mb-3">Re-run confirmation</h3>
            <div className="flex flex-col gap-2 mb-4">
              <Row label="Script"  value={confirmEntry.script} mono />
              <Row label="Machine" value={confirmEntry.machine_name} />
              {confirmEntry.args && <Row label="Args" value={confirmEntry.args} mono />}
              {confirmEntry.environment_id && <Row label="Env" value={confirmEntry.environment_id} />}
              <Row label="Last run" value={fmtDate(confirmEntry.timestamp)} />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmEntry(null)}
                className="px-4 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500 transition-colors"
              >Cancel</button>
              <button
                onClick={() => { onReRun!(confirmEntry); setConfirmEntry(null) }}
                className="px-4 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
              >▶ Run</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-[10px] uppercase tracking-wider text-slate-500 w-16 shrink-0 pt-0.5">{label}</span>
      <span className={`text-xs text-slate-200 break-all ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}
