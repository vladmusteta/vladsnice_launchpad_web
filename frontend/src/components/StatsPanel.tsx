import { useState, useEffect, useCallback } from 'react'
import type { HistoryEntry } from '../types'
import { fetchHistory } from '../api'

interface Props {
  envId?: string
}

// ── tiny helpers ──────────────────────────────────────────────────────────────
function dayKey(iso: string): string {
  return iso ? iso.slice(0, 10) : ''
}

function last30Days(): string[] {
  const days: string[] = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push(d.toISOString().slice(0, 10))
  }
  return days
}

function fmtDay(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── bar helpers ───────────────────────────────────────────────────────────────
function Bar({ total, done: _done, error, max, label }: {
  total: number; done: number; error: number; max: number; label: string
}) {
  const pct = max > 0 ? (total / max) * 100 : 0
  const errPct = total > 0 ? (error / total) * 100 : 0
  const donePct = 100 - errPct
  return (
    <div className="group flex flex-col gap-0.5" title={`${label}: ${total} runs (${error} errors)`}>
      <div className="w-full bg-slate-800 rounded-sm overflow-hidden" style={{ height: '48px' }}>
        <div
          className="w-full h-full flex flex-col-reverse"
          style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
        >
          <div className="w-full" style={{ height: `${donePct}%`, background: 'var(--accent, #10b981)', opacity: 0.85 }} />
          {errPct > 0 && (
            <div className="w-full" style={{ height: `${errPct}%`, background: '#f87171', opacity: 0.85 }} />
          )}
        </div>
      </div>
      <span className="text-[9px] text-slate-600 text-center leading-none truncate group-hover:text-slate-400 transition-colors">
        {fmtDay(label)}
      </span>
    </div>
  )
}

// ── stat card ─────────────────────────────────────────────────────────────────
function Card({ label, value, sub, color = 'text-slate-200' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="flex flex-col gap-1 bg-slate-900 border border-slate-800 rounded-xl px-4 py-3 min-w-[110px]">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">{label}</span>
      <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
      {sub && <span className="text-[10px] text-slate-600">{sub}</span>}
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────
export default function StatsPanel({ envId = '' }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [range, setRange] = useState<7 | 14 | 30>(30)

  const load = useCallback(async () => {
    setLoading(true)
    try { setHistory(await fetchHistory(envId)) } catch { /* ignore */ } finally { setLoading(false) }
  }, [envId])

  useEffect(() => { void load() }, [load])

  // ── compute stats ────────────────────────────────────────────────────────
  const days = last30Days().slice(30 - range)
  const cutoff = days[0]

  const inRange = history.filter(h => dayKey(h.timestamp) >= cutoff)

  // per-day buckets
  const byDay = Object.fromEntries(days.map(d => [d, { total: 0, done: 0, error: 0 }]))
  inRange.forEach(h => {
    const k = dayKey(h.timestamp)
    if (byDay[k]) {
      byDay[k].total++
      if (h.status === 'done') byDay[k].done++
      if (h.status === 'error') byDay[k].error++
    }
  })
  const maxDay = Math.max(1, ...Object.values(byDay).map(d => d.total))

  // totals
  const total = inRange.length
  const totalDone  = inRange.filter(h => h.status === 'done').length
  const totalError = inRange.filter(h => h.status === 'error').length
  const successRate = total > 0 ? Math.round((totalDone / total) * 100) : 100

  // today
  const todayKey = new Date().toISOString().slice(0, 10)
  const todayCount = byDay[todayKey]?.total ?? 0

  // top 5 scripts
  const scriptCounts: Record<string, { total: number; error: number }> = {}
  inRange.forEach(h => {
    const name = h.script.split('/').pop() ?? h.script
    if (!scriptCounts[name]) scriptCounts[name] = { total: 0, error: 0 }
    scriptCounts[name].total++
    if (h.status === 'error') scriptCounts[name].error++
  })
  const top5Scripts = Object.entries(scriptCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 5)

  // error rate per machine
  const machineCounts: Record<string, { name: string; total: number; error: number }> = {}
  inRange.forEach(h => {
    if (!h.machine_name) return
    if (!machineCounts[h.machine_name]) machineCounts[h.machine_name] = { name: h.machine_name, total: 0, error: 0 }
    machineCounts[h.machine_name].total++
    if (h.status === 'error') machineCounts[h.machine_name].error++
  })
  const topMachines = Object.values(machineCounts)
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  const maxMachineTotal = Math.max(1, ...topMachines.map(m => m.total))

  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 py-5 gap-6">
      {/* ── header ── */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-slate-300">📊 Stats</span>
        <div className="flex gap-1 ml-2">
          {([7, 14, 30] as const).map(r => (
            <button key={r} onClick={() => setRange(r)}
              className={`px-2.5 py-0.5 text-xs rounded border transition-colors
                ${range === r ? 'bg-slate-700 border-slate-500 text-slate-200' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}>
              {r}d
            </button>
          ))}
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="text-xs text-slate-600 hover:text-slate-300 transition-colors ml-1">
          {loading ? '↻' : '↺'}
        </button>
        {envId && (
          <span className="text-xs text-slate-500 italic ml-auto">filtered by current environment</span>
        )}
      </div>

      {/* ── KPI cards ── */}
      <div className="flex gap-3 flex-wrap">
        <Card label="Total Runs" value={total} sub={`last ${range} days`} />
        <Card
          label="Success Rate"
          value={`${successRate}%`}
          sub={`${totalDone} done`}
          color={successRate >= 90 ? 'text-emerald-400' : successRate >= 70 ? 'text-amber-400' : 'text-red-400'}
        />
        <Card label="Errors" value={totalError} sub={`${total > 0 ? Math.round((totalError / total) * 100) : 0}% of runs`} color={totalError > 0 ? 'text-red-400' : 'text-emerald-400'} />
        <Card label="Today" value={todayCount} sub="runs today" />
        <Card label="Scripts" value={Object.keys(scriptCounts).length} sub="unique scripts" />
        <Card label="Machines" value={topMachines.length} sub="active machines" />
      </div>

      {/* ── histogram ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Runs per day</span>
          <div className="flex gap-3 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500/80 inline-block" /> Done</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-400/80 inline-block" /> Error</span>
          </div>
        </div>
        {total === 0 ? (
          <div className="flex items-center justify-center h-16 text-slate-600 text-xs italic">No runs in this period.</div>
        ) : (
          <div className="flex items-end gap-[3px] w-full" style={{ height: '64px' }}>
            {days.map(day => (
              <div key={day} className="flex-1 flex flex-col justify-end h-full">
                <Bar
                  total={byDay[day]?.total ?? 0}
                  done={byDay[day]?.done ?? 0}
                  error={byDay[day]?.error ?? 0}
                  max={maxDay}
                  label={day}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── lower two columns ── */}
      <div className="grid grid-cols-2 gap-4 min-h-0">
        {/* Top scripts */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">Top Scripts</span>
          {top5Scripts.length === 0 ? (
            <p className="text-slate-600 text-xs italic">No data.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {top5Scripts.map(([name, s]) => {
                const pct = Math.round((s.total / (top5Scripts[0]?.[1].total ?? 1)) * 100)
                const errPct = s.total > 0 ? Math.round((s.error / s.total) * 100) : 0
                return (
                  <div key={name} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-slate-200 truncate max-w-[200px]" title={name}>{name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {errPct > 0 && (
                          <span className="text-[10px] text-red-400">{errPct}% err</span>
                        )}
                        <span className="text-[10px] text-slate-500 tabular-nums">{s.total}</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${pct}%`,
                          background: errPct > 30 ? '#f87171' : errPct > 0 ? '#fbbf24' : '#10b981',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Error rate per machine */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">Error Rate by Machine</span>
          {topMachines.length === 0 ? (
            <p className="text-slate-600 text-xs italic">No data.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {topMachines.map(m => {
                const errPct = m.total > 0 ? (m.error / m.total) * 100 : 0
                const barColor = errPct === 0 ? '#10b981' : errPct < 20 ? '#fbbf24' : '#f87171'
                return (
                  <div key={m.name} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-200 truncate max-w-[200px]" title={m.name}>{m.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] tabular-nums" style={{ color: barColor }}>
                          {errPct === 0 ? '✓' : `${Math.round(errPct)}% err`}
                        </span>
                        <span className="text-[10px] text-slate-500 tabular-nums">{m.total} runs</span>
                      </div>
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${(m.total / maxMachineTotal) * 100}%`, background: barColor }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── recent activity timeline ── */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-3">Recent Activity</span>
        {inRange.length === 0 ? (
          <p className="text-slate-600 text-xs italic">No runs in this period.</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {[...inRange].reverse().slice(0, 20).map(h => (
              <div key={h.id} className="flex items-center gap-2 text-xs">
                <span className={`shrink-0 text-[10px] font-mono w-10 text-center py-0.5 rounded
                  ${h.status === 'done' ? 'text-emerald-400 bg-emerald-900/20' :
                    h.status === 'error' ? 'text-red-400 bg-red-900/20' :
                    'text-blue-400 bg-blue-900/20'}`}>
                  {h.status === 'done' ? '✓' : h.status === 'error' ? '✕' : '…'}
                </span>
                <span className="text-slate-500 shrink-0 tabular-nums">{h.timestamp.slice(5, 16).replace('T', ' ')}</span>
                <span className="text-slate-300 font-mono truncate">{h.script.split('/').pop()}</span>
                <span className="text-slate-500 truncate">{h.machine_name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
