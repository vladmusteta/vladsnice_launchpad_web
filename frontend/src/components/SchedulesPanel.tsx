import { useState, useEffect, useCallback } from 'react'
import type { Machine } from '../types'
import {
  fetchSchedules, createSchedule, updateSchedule, deleteSchedule,
  fetchScriptsTree,
} from '../api'
import type { ScheduleEntry } from '../api'
import type { TreeNode } from '../types'

interface Props {
  machines: Machine[]
  envId?: string
}

const EMPTY: Omit<ScheduleEntry, 'id'> = {
  name: '', script: '', machine_id: '', args: '',
  environment_id: '', cron_hour: 9, cron_minute: 0,
  enabled: true, last_run: '',
}

function collectFiles(node: TreeNode | null, acc: string[] = []): string[] {
  if (!node) return acc
  if (node.type === 'file') { acc.push(node.path); return acc }
  node.children.forEach(c => collectFiles(c, acc))
  return acc
}

function padTwo(n: number) { return String(n).padStart(2, '0') }

export default function SchedulesPanel({ machines, envId = '' }: Props) {
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [editing, setEditing] = useState<ScheduleEntry | null>(null)
  const [form, setForm] = useState<Omit<ScheduleEntry, 'id'>>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [scripts, setScripts] = useState<string[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try { setSchedules(await fetchSchedules()) } catch { /* ignore */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    fetchScriptsTree(envId).then(t => setScripts(collectFiles(t))).catch(() => {})
  }, [envId])

  function openNew() {
    setEditing({ id: '', ...EMPTY, environment_id: envId })
    setForm({ ...EMPTY, environment_id: envId })
  }

  function openEdit(s: ScheduleEntry) {
    setEditing(s)
    setForm({ name: s.name, script: s.script, machine_id: s.machine_id, args: s.args,
      environment_id: s.environment_id, cron_hour: s.cron_hour, cron_minute: s.cron_minute,
      enabled: s.enabled, last_run: s.last_run })
  }

  async function handleSave() {
    if (!form.name || !form.script || !form.machine_id) return
    setSaving(true)
    try {
      if (editing?.id) {
        await updateSchedule({ ...form, id: editing.id })
      } else {
        await createSchedule(form)
      }
      await load()
      setEditing(null)
    } catch { /* ignore */ } finally { setSaving(false) }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this schedule?')) return
    await deleteSchedule(id)
    await load()
  }

  async function toggleEnabled(s: ScheduleEntry) {
    await updateSchedule({ ...s, enabled: !s.enabled })
    await load()
  }

  function fmtLast(iso: string) {
    if (!iso) return '—'
    try { return new Date(iso).toLocaleString() } catch { return iso }
  }

  const machineName = (id: string) => machines.find(m => m.id === id)?.name ?? id

  const inp = 'bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm w-full ' +
    'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-4 py-2 border-b border-slate-800 flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Schedules</span>
        <button onClick={() => void load()} disabled={loading}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
          {loading ? '↻' : '↺'}
        </button>
        <button onClick={openNew}
          className="ml-auto px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded-lg transition-colors">
          + New Schedule
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {schedules.length === 0 && !loading ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-slate-600 text-sm italic">No schedules yet.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left sticky top-0 bg-slate-950">
                <th className="px-4 py-2 text-xs font-medium text-slate-500 w-10">On</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Name</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Script</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Machine</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Time</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Last Run</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500" />
              </tr>
            </thead>
            <tbody>
              {schedules.map(s => (
                <tr key={s.id} className="border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <button
                      onClick={() => void toggleEnabled(s)}
                      className={`w-8 h-4 rounded-full transition-colors ${s.enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                      title={s.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                    >
                      <span className={`block w-3 h-3 rounded-full bg-white transition-transform mx-0.5
                        ${s.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-2.5 text-slate-200 text-xs font-medium">{s.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{s.script.split('/').pop()}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs">{machineName(s.machine_id)}</td>
                  <td className="px-4 py-2.5 text-slate-300 text-xs font-mono">
                    {padTwo(s.cron_hour)}:{padTwo(s.cron_minute)}
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{fmtLast(s.last_run)}</td>
                  <td className="px-4 py-2.5 flex gap-2 justify-end">
                    <button onClick={() => openEdit(s)}
                      className="text-xs text-slate-500 hover:text-slate-200 transition-colors px-1">✏️</button>
                    <button onClick={() => void handleDelete(s.id)}
                      className="text-xs text-slate-500 hover:text-red-400 transition-colors px-1">🗑️</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Edit/New modal ── */}
      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setEditing(null)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5"
            onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-slate-200 mb-4">
              {editing.id ? 'Edit Schedule' : 'New Schedule'}
            </h3>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">Name</span>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className={inp} placeholder="Daily backup" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">Script</span>
                <select value={form.script} onChange={e => setForm(p => ({ ...p, script: e.target.value }))} className={inp}>
                  <option value="">— select script —</option>
                  {scripts.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">Machine</span>
                <select value={form.machine_id} onChange={e => setForm(p => ({ ...p, machine_id: e.target.value }))} className={inp}>
                  <option value="">— select machine —</option>
                  {machines.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-400">Args (optional)</span>
                <input value={form.args} onChange={e => setForm(p => ({ ...p, args: e.target.value }))}
                  className={inp} placeholder="--extra-vars ..." />
              </label>
              <div className="flex gap-3">
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-slate-400">Hour (0-23)</span>
                  <input type="number" min={0} max={23} value={form.cron_hour}
                    onChange={e => setForm(p => ({ ...p, cron_hour: Number(e.target.value) }))}
                    className={inp} />
                </label>
                <label className="flex flex-col gap-1 flex-1">
                  <span className="text-xs text-slate-400">Minute (0-59)</span>
                  <input type="number" min={0} max={59} value={form.cron_minute}
                    onChange={e => setForm(p => ({ ...p, cron_minute: Number(e.target.value) }))}
                    className={inp} />
                </label>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" checked={form.enabled}
                  onChange={e => setForm(p => ({ ...p, enabled: e.target.checked }))}
                  className="accent-emerald-500" />
                Enabled
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setEditing(null)}
                className="px-4 py-1.5 text-xs rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={saving || !form.name || !form.script || !form.machine_id}
                className="px-4 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
