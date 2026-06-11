import { useState, useEffect, useCallback } from 'react'
import type { Machine, Environment } from '../types'
import { fetchMachines, deleteMachine, testMachineConnection } from '../api'
import MachineModal from './MachineModal'

interface Props {
  environments: Environment[]
  envId?: string
}

export default function MachinesPanel({ environments, envId = '' }: Props) {
  const [machines, setMachines] = useState<Machine[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Machine | undefined>(undefined)
  const [showModal, setShowModal] = useState(false)
  const [testStates, setTestStates] = useState<Record<string, { ok: boolean | null; latency_ms?: number; error?: string; loading: boolean }>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try { setMachines(await fetchMachines()) } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const visible = machines
    .filter(m => !envId || m.environment_id === envId || !m.environment_id)
    .filter(m => !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.host.toLowerCase().includes(search.toLowerCase()))

  async function handleDelete(m: Machine) {
    if (!confirm(`Delete machine "${m.name}"?`)) return
    await deleteMachine(m.id)
    setMachines(p => p.filter(x => x.id !== m.id))
  }

  async function handleTest(m: Machine) {
    setTestStates(p => ({ ...p, [m.id]: { ok: null, loading: true } }))
    try {
      const res = await testMachineConnection(m.id)
      setTestStates(p => ({ ...p, [m.id]: { ...res, loading: false } }))
    } catch {
      setTestStates(p => ({ ...p, [m.id]: { ok: false, error: 'Request failed', loading: false } }))
    }
  }

  function authBadge(auth: string) {
    const map: Record<string, string> = {
      key: 'bg-emerald-900/30 text-emerald-400 border-emerald-700/30',
      password: 'bg-amber-900/30 text-amber-400 border-amber-700/30',
      kerberos: 'bg-blue-900/30 text-blue-400 border-blue-700/30',
      winrm: 'bg-purple-900/30 text-purple-400 border-purple-700/30',
    }
    return (map[auth] ?? 'bg-slate-800 text-slate-400 border-slate-700') + ' text-[10px] font-mono px-1.5 py-0.5 rounded border'
  }

  function envName(id: string | null | undefined) {
    if (!id) return ''
    return environments.find(e => e.id === id)?.name ?? ''
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-4 py-2 border-b border-slate-800 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Machines</span>
        <span className="text-xs text-slate-600">({visible.length})</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') setSearch('') }}
          placeholder="search..."
          className="ml-2 w-40 bg-slate-800/60 border border-slate-700 text-slate-300 rounded px-2 py-0.5 text-xs
                     focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-600"
        />
        <button onClick={() => void load()} disabled={loading}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          {loading ? '↻' : '↺'}
        </button>
        <button
          onClick={() => { setEditing(undefined); setShowModal(true) }}
          className="ml-auto px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition-colors"
        >+ Add Machine</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-slate-600 text-sm italic">No machines found.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left sticky top-0 bg-slate-950">
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Name</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Host</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Auth</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Env</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Jump</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">SSH Test</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500" />
              </tr>
            </thead>
            <tbody>
              {visible.map(m => {
                const t = testStates[m.id]
                return (
                  <tr key={m.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors group">
                    <td className="px-4 py-2.5 font-medium text-slate-200 text-xs">{m.name}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{m.host}:{m.port}</td>
                    <td className="px-4 py-2.5">
                      <span className={authBadge(m.auth_method)}>{m.auth_method}</span>
                    </td>
                    <td className="px-4 py-2.5 text-slate-500 text-xs">{envName(m.environment_id)}</td>
                    <td className="px-4 py-2.5 text-slate-600 text-xs">
                      {m.jump_host?.host ? (
                        <span title={`${m.jump_host.host}:${m.jump_host.port}`} className="text-slate-400">🔗 {m.jump_host.host}</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {t?.loading ? (
                        <span className="text-[10px] text-slate-500 animate-pulse">testing…</span>
                      ) : t?.ok === true ? (
                        <span className="text-[10px] text-emerald-400">✓ {t.latency_ms}ms</span>
                      ) : t?.ok === false ? (
                        <span className="text-[10px] text-red-400 truncate max-w-[120px] block" title={t.error}>✕ {t.error}</span>
                      ) : t?.ok === null ? (
                        <span className="text-[10px] text-slate-500">{t.error}</span>
                      ) : (
                        <button
                          onClick={() => void handleTest(m)}
                          className="text-[10px] text-slate-500 hover:text-emerald-400 transition-colors border border-slate-700 hover:border-emerald-700/50 px-1.5 py-0.5 rounded"
                        >⚡ Test</button>
                      )}
                    </td>
                    <td className="px-3 py-2.5 flex gap-2 justify-end">
                      <button
                        onClick={() => { setEditing(m); setShowModal(true) }}
                        className="opacity-0 group-hover:opacity-100 text-xs text-slate-500 hover:text-slate-200 transition-all"
                      >✏️</button>
                      <button
                        onClick={() => void handleDelete(m)}
                        className="opacity-0 group-hover:opacity-100 text-xs text-slate-500 hover:text-red-400 transition-all"
                      >🗑️</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <MachineModal
          machine={editing}
          environments={environments}
          defaultEnvId={envId || undefined}
          onSaved={(saved) => {
            setMachines(p => editing ? p.map(m => m.id === saved.id ? saved : m) : [...p, saved])
            setShowModal(false)
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
