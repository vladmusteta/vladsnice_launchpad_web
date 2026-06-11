import { useState, useEffect, useRef, useCallback } from 'react'
import type { TreeNode, Environment, AnsibleInventory, RunTab, Machine } from './types'
import { fetchScriptsTree, fetchEnvironments, fetchInventories, startRun, saveLogs, fetchScriptContent, stopRun, saveScriptContent, startMultiRun, fetchMachines } from './api'
import type { RunParams } from './api'
import { createEnvironment, deleteEnvironment } from './api'
import { useDragResize } from './hooks/useDragResize'
import FileTree from './components/FileTree'
import LogViewer from './components/LogViewer'
import InventoryPanel from './components/InventoryPanel'
import LogsBrowser from './components/LogsBrowser'
import HistoryView from './components/HistoryView'
import AnsibleHostsPicker from './components/AnsibleHostsPicker'
import WireGuardPanel from './components/WireGuardPanel'
import MultiRunPanel from './components/MultiRunPanel'
import SchedulesPanel from './components/SchedulesPanel'
import MachinesPanel from './components/MachinesPanel'
import StatsPanel from './components/StatsPanel'

// ── Script param detection ─────────────────────────────────────────────────
function detectScriptParams(content: string): { prompt: string; varName: string }[] {
  const params: { prompt: string; varName: string }[] = []
  // Match: read -p "prompt" VAR or read -rp "prompt" VAR
  const re = /read\s+-[r]*p\s+"([^"]+)"\s+(\w+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    params.push({ prompt: m[1], varName: m[2] })
  }
  return params
}

// ── Simple line-by-line diff view ─────────────────────────────────────────
function DiffView({ original, modified }: { original: string; modified: string }) {
  const origLines = original.split('\n')
  const modLines  = modified.split('\n')
  // Very simple LCS-based diff
  type DiffLine = { type: 'same' | 'add' | 'del'; text: string }
  const result: DiffLine[] = []
  let i = 0, j = 0
  while (i < origLines.length || j < modLines.length) {
    if (i >= origLines.length) { result.push({ type: 'add', text: modLines[j++] }); continue }
    if (j >= modLines.length)  { result.push({ type: 'del', text: origLines[i++] }); continue }
    if (origLines[i] === modLines[j]) { result.push({ type: 'same', text: origLines[i] }); i++; j++; continue }
    // Look ahead up to 3 lines for a match
    let matched = false
    for (let d = 1; d <= 3 && !matched; d++) {
      if (i + d < origLines.length && origLines[i + d] === modLines[j]) {
        for (let k = 0; k < d; k++) result.push({ type: 'del', text: origLines[i++] })
        matched = true
      } else if (j + d < modLines.length && origLines[i] === modLines[j + d]) {
        for (let k = 0; k < d; k++) result.push({ type: 'add', text: modLines[j++] })
        matched = true
      }
    }
    if (!matched) {
      result.push({ type: 'del', text: origLines[i++] })
      result.push({ type: 'add', text: modLines[j++] })
    }
  }
  const hasChanges = result.some(l => l.type !== 'same')
  return (
    <div className="p-3 font-mono text-[11px] leading-relaxed">
      {!hasChanges && (
        <p className="text-slate-500 italic text-xs">No changes.</p>
      )}
      {result.map((line, idx) => {
        if (line.type === 'same') return null
        return (
          <div key={idx} className={`flex gap-2 px-1 rounded-sm ${
            line.type === 'add' ? 'bg-emerald-900/25 text-emerald-300' : 'bg-red-900/25 text-red-300'
          }`}>
            <span className="shrink-0 w-3 text-center select-none opacity-60">
              {line.type === 'add' ? '+' : '−'}
            </span>
            <span className="whitespace-pre-wrap break-all">{line.text}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── Inline env pill bar (lives in the header) ───────────────────────────────
const ENV_PALETTE: Record<string, { dot: string; active: string }> = {
  emerald: { dot: 'bg-emerald-400', active: 'bg-emerald-500/20 border-emerald-500 text-emerald-300' },
  blue:    { dot: 'bg-blue-400',    active: 'bg-blue-500/20 border-blue-500 text-blue-300' },
  amber:   { dot: 'bg-amber-400',   active: 'bg-amber-500/20 border-amber-500 text-amber-300' },
  rose:    { dot: 'bg-rose-400',    active: 'bg-rose-500/20 border-rose-500 text-rose-300' },
  violet:  { dot: 'bg-violet-400',  active: 'bg-violet-500/20 border-violet-500 text-violet-300' },
  cyan:    { dot: 'bg-cyan-400',    active: 'bg-cyan-500/20 border-cyan-500 text-cyan-300' },
  orange:  { dot: 'bg-orange-400',  active: 'bg-orange-500/20 border-orange-500 text-orange-300' },
  pink:    { dot: 'bg-pink-400',    active: 'bg-pink-500/20 border-pink-500 text-pink-300' },
  teal:    { dot: 'bg-teal-400',    active: 'bg-teal-500/20 border-teal-500 text-teal-300' },
  indigo:  { dot: 'bg-indigo-400',  active: 'bg-indigo-500/20 border-indigo-500 text-indigo-300' },
  slate:   { dot: 'bg-slate-400',   active: 'bg-slate-700 border-slate-500 text-slate-300' },
}
const PILL_COLORS = ['emerald', 'blue', 'amber', 'rose', 'violet', 'cyan', 'orange', 'pink', 'teal', 'indigo']

function EnvPills({ environments, selected, onSelect, onChange }: {
  environments: Environment[]
  selected: string
  onSelect: (id: string) => void
  onChange: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await createEnvironment({ name: newName.trim(), color: PILL_COLORS[environments.length % PILL_COLORS.length] })
      onChange(); setNewName(''); setAdding(false)
    } finally { setSaving(false) }
  }

  async function handleDelete(e: React.MouseEvent, env: Environment) {
    e.stopPropagation()
    if (!confirm(`Delete "${env.name}"?`)) return
    await deleteEnvironment(env.id)
    if (selected === env.id) onSelect('')
    onChange()
  }

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <button
        onClick={() => onSelect('')}
        className={`px-2.5 py-0.5 text-xs font-medium rounded border transition-colors whitespace-nowrap
          ${selected === '' ? 'bg-slate-700 border-slate-500 text-slate-200' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
      >All</button>

      {environments.map((env) => {
        const c = ENV_PALETTE[env.color] ?? ENV_PALETTE['slate']
        return (
          <button key={env.id} onClick={() => onSelect(env.id)}
            className={`group flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded border
              transition-colors whitespace-nowrap
              ${selected === env.id ? c.active : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
            {env.name}
            <span onClick={(e) => void handleDelete(e, env)}
              className="opacity-0 group-hover:opacity-100 ml-0.5 text-slate-500 hover:text-red-400 cursor-pointer"
            >×</span>
          </button>
        )
      })}

      {adding ? (
        <div className="flex items-center gap-1">
          <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAdd(); if (e.key === 'Escape') setAdding(false) }}
            className="bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-0.5
                       text-xs w-24 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            placeholder="name" />
          <button onClick={() => void handleAdd()} disabled={saving} className="text-xs text-emerald-400 hover:text-emerald-300 px-1">✓</button>
          <button onClick={() => setAdding(false)} className="text-xs text-slate-500 hover:text-slate-300 px-1">✕</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors px-1 whitespace-nowrap"
        >+ env</button>
      )}
    </div>
  )
}

type MainTab = 'run' | 'logs' | 'history' | 'hosts' | 'vpn' | 'multi' | 'schedules' | 'machines' | 'stats'

// ── Script-type detection from folder path ──────────────────────────────────
type ScriptCategory = 'ansible' | 'bash' | 'powershell' | 'other'
function scriptCategory(path: string): ScriptCategory {
  const top = path.split('/')[0]?.toLowerCase() ?? ''
  if (top === 'ansible')    return 'ansible'
  if (top === 'bash')       return 'bash'
  if (top === 'powershell') return 'powershell'
  return 'other'
}

// ── Compact inline Target Panel ─────────────────────────────────────────────
interface TargetPanelProps {
  category: ScriptCategory
  inventories: AnsibleInventory[]
  onRun: (p: Omit<RunParams, 'script' | 'args' | 'envId'>) => void
  running: boolean
}

function TargetPanel({ category, inventories, onRun, running }: TargetPanelProps) {
  type AnsibleMode = 'ssh' | 'inventory'
  type ShellMode   = 'ssh' | 'none'

  const [ansibleMode, setAnsibleMode] = useState<AnsibleMode>('ssh')
  const [shellMode,   setShellMode]   = useState<ShellMode>('ssh')
  const [sshAuth,     setSshAuth]     = useState<'key' | 'password'>('key')
  const [host,        setHost]        = useState('')
  const [port,        setPort]        = useState(22)
  const [username,    setUsername]    = useState('root')
  const [keyPath,     setKeyPath]     = useState('')
  const [password,    setPassword]    = useState('')
  const [hostsText,   setHostsText]   = useState('')
  const [inventoryId, setInventoryId] = useState('')

  const inv = inventories.find(i => i.id === inventoryId)
  const hostList = hostsText.split(/[\n,;]/).map(h => h.trim()).filter(Boolean)

  const isAnsible = category === 'ansible'
  const mode = isAnsible ? ansibleMode : shellMode
  const showSsh = mode === 'ssh'
  const showNone = !isAnsible && shellMode === 'none'

  const inp = 'bg-slate-800/80 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs ' +
    'focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full placeholder-slate-600'
  const btn = (active: boolean) =>
    'px-3 py-1 text-xs font-medium rounded border transition-colors ' +
    (active ? 'bg-slate-700 border-slate-500 text-slate-100' : 'border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-500')

  function handleRun() {
    if (running) return
    const params: Omit<RunParams, 'script' | 'args' | 'envId'> = {
      inventory_id: inventoryId || undefined,
      ephemeral_hosts: hostList.length ? hostList : undefined,
      host: host || undefined,
      port,
      username: username || undefined,
      auth_method: showNone ? 'none' : (isAnsible && mode === 'inventory') ? 'inventory' : sshAuth,
      key_path: sshAuth === 'key' ? (keyPath || undefined) : undefined,
      password: sshAuth === 'password' ? (password || undefined) : undefined,
    }
    onRun(params)
  }

  const canRun = showNone ||
    (isAnsible && mode === 'inventory' && !!inventoryId) ||
    (showSsh && !!host)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-3 pt-2 pb-1.5 border-b border-slate-800 flex items-center gap-2">
        <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Target</span>
        {/* Mode toggle */}
        <div className="flex gap-1 ml-auto">
          {isAnsible ? (
            <>
              <button className={btn(ansibleMode === 'ssh')}       onClick={() => setAnsibleMode('ssh')}>SSH</button>
              <button className={btn(ansibleMode === 'inventory')} onClick={() => setAnsibleMode('inventory')}>Inventory</button>
            </>
          ) : (
            <>
              <button className={btn(shellMode === 'ssh')}  onClick={() => setShellMode('ssh')}>SSH</button>
              <button className={btn(shellMode === 'none')} onClick={() => setShellMode('none')}>Local</button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">

        {/* Inventory picker (ansible+inventory) */}
        {isAnsible && mode === 'inventory' && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">Inventory</label>
            <select value={inventoryId} onChange={e => setInventoryId(e.target.value)} className={inp}>
              <option value="">— select —</option>
              {inventories.map(i => (
                <option key={i.id} value={i.id}>{i.is_ephemeral ? '[E] ' : ''}{i.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* SSH target host */}
        {showSsh && (
          <>
            <div className="flex gap-1.5">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Host</label>
                <input value={host} onChange={e => setHost(e.target.value)} className={inp} placeholder="192.168.1.10" />
              </div>
              <div className="w-16 flex flex-col gap-1">
                <label className="text-[10px] text-slate-500 uppercase tracking-wider">Port</label>
                <input type="number" value={port} onChange={e => setPort(Number(e.target.value))} className={inp} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-slate-500 uppercase tracking-wider">Username</label>
              <input value={username} onChange={e => setUsername(e.target.value)} className={inp} placeholder="root" />
            </div>
            {/* Auth */}
            <div className="flex gap-3">
              {(['key', 'password'] as const).map(m => (
                <label key={m} className="flex items-center gap-1 text-[10px] text-slate-400 cursor-pointer">
                  <input type="radio" checked={sshAuth === m} onChange={() => setSshAuth(m)} className="accent-emerald-500" />
                  {m === 'key' ? 'SSH Key' : 'Password'}
                </label>
              ))}
            </div>
            {sshAuth === 'key'
              ? <input value={keyPath} onChange={e => setKeyPath(e.target.value)} className={inp} placeholder="~/.ssh/id_rsa" />
              : <input type="password" value={password} onChange={e => setPassword(e.target.value)} className={inp} autoComplete="new-password" placeholder="SSH password" />
            }
          </>
        )}

        {/* Inventory for ansible+SSH or hosts for ansible+inventory ephemeral */}
        {isAnsible && (
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-slate-500 uppercase tracking-wider">
              {mode === 'ssh' ? 'Inventory (optional)' : inv?.is_ephemeral ? 'Hosts' : 'Limit hosts (optional)'}
            </label>
            {mode === 'ssh' && (
              <select value={inventoryId} onChange={e => setInventoryId(e.target.value)} className={inp}>
                <option value="">— none / default —</option>
                {inventories.map(i => (
                  <option key={i.id} value={i.id}>{i.is_ephemeral ? '[E] ' : ''}{i.name}</option>
                ))}
              </select>
            )}
            {(inventoryId) && (
              <textarea
                value={hostsText}
                onChange={e => setHostsText(e.target.value)}
                rows={3}
                placeholder={inv?.is_ephemeral ? 'server1\nserver2' : 'Leave empty = all hosts'}
                className={inp + ' resize-y font-mono'}
              />
            )}
          </div>
        )}

        {/* Local mode info */}
        {showNone && (
          <p className="text-[10px] text-slate-500 italic">Runs locally on this control node (no SSH).</p>
        )}
      </div>

      {/* Run button */}
      <div className="shrink-0 px-3 pb-3">
        <button
          onClick={handleRun}
          disabled={!canRun || running}
          className={`w-full py-2 rounded-lg font-semibold text-sm transition-all
            ${canRun && !running
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow shadow-emerald-900/30 active:scale-[0.98]'
              : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
        >
          {running ? 'Running…' : '▶ Run'}
        </button>
      </div>
    </div>
  )
}



const THEMES = [
  { id: 'dark-slate',  label: '🌑 Dark Slate' },
  { id: 'dark-green',  label: '🌿 Dark Green' },
  { id: 'dark-purple', label: '🟣 Dark Purple' },
  { id: 'dark-red',    label: '🔴 Dark Red' },
  { id: 'light',       label: '☀️ Light' },
  { id: 'nord',        label: '❄️ Nord' },
  { id: 'dracula',     label: '🧛 Dracula' },
] as const
type ThemeId = typeof THEMES[number]['id']

export default function App() {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [inventories, setInventories] = useState<AnsibleInventory[]>([])
  const [machines, setMachines] = useState<Machine[]>([])

  const [theme, setTheme] = useState<ThemeId>(() => (localStorage.getItem('theme') as ThemeId) ?? 'dark-slate')

  const [selectedScript, setSelectedScript] = useState('')
  const [selectedEnv, setSelectedEnv] = useState('')
  const [args, setArgs] = useState('')
  const [scriptParams, setScriptParams] = useState<{ prompt: string; varName: string }[]>([])
  const [paramValues, setParamValues] = useState<Record<string, string>>({})

  // per-run log tabs
  const [runTabs, setRunTabs] = useState<RunTab[]>([])
  const [activeRunTab, setActiveRunTab] = useState<string>('')

  // script preview
  const [scriptPreview, setScriptPreview] = useState<string>('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const [editingScript, setEditingScript] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const [showDiff, setShowDiff] = useState(false)
  const [showInventories, setShowInventories] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [activeTab, setActiveTab] = useState<MainTab>('run')

  const wsRefs = useRef<Map<string, WebSocket>>(new Map())
  const prevTabStatusRef = useRef<Map<string, string>>(new Map())

  // Request desktop notification permission once
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission()
    }
  }, [])

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName
      if (e.key === 'Escape') { setShowHelp(false); setShowInventories(false) }
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '?') { e.preventDefault(); setShowHelp(h => !h) }
      if (e.key === '1') setActiveTab('run')
      if (e.key === '2') setActiveTab('stats')
      if (e.key === '3') setActiveTab('logs')
      if (e.key === '4') setActiveTab('history')
      if (e.key === '5') setActiveTab('machines')
      if (e.key === '6') setActiveTab('multi')
      if (e.key === '7') setActiveTab('schedules')
      if (e.key === '8') setActiveTab('vpn')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Desktop notification when a run finishes
  useEffect(() => {
    const prev = prevTabStatusRef.current
    runTabs.forEach(tab => {
      const prevStatus = prev.get(tab.id)
      if (prevStatus === 'running' && (tab.status === 'done' || tab.status === 'error')) {
        if ('Notification' in window && Notification.permission === 'granted') {
          const name = tab.script.split('/').pop() ?? tab.script
          const isDone = tab.status === 'done'
          new Notification(isDone ? `✓ Done: ${name}` : `✕ Error: ${name}`, {
            body: `Machine: ${tab.machineName}`,
          })
        }
      }
      prev.set(tab.id, tab.status)
    })
  }, [runTabs])

  const [sidebarWidth, onSidebarDrag]    = useDragResize(() => 125, 'x', 110)
  const [machinesWidth, onMachinesDrag]  = useDragResize(() => Math.max(300, Math.floor((window.innerWidth - 130) * 0.72)), 'x', 200)
  const [controlsHeight, onControlsDrag] = useDragResize(() => Math.max(200, Math.floor(window.innerHeight * 0.60)), 'y', 120)

  const load = useCallback(async (env = selectedEnv) => {
    try {
      const [t, e, i, m] = await Promise.all([
        fetchScriptsTree(env), fetchEnvironments(), fetchInventories(env), fetchMachines(),
      ])
      setTree(t); setEnvironments(e); setInventories(i); setMachines(m)
    } catch { /* backend not up yet */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void load() }, [load])

  // Reload env-specific data when env changes
  useEffect(() => {
    void load(selectedEnv)
    setSelectedScript('')
  }, [selectedEnv]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load script preview when a script is selected
  useEffect(() => {
    if (!selectedScript) { setScriptPreview(''); setScriptParams([]); setParamValues({}); return }
    setPreviewLoading(true)
    fetchScriptContent(selectedScript, selectedEnv)
      .then(r => {
        setScriptPreview(r.content)
        const detected = detectScriptParams(r.content)
        setScriptParams(detected)
        setParamValues(Object.fromEntries(detected.map(p => [p.varName, ''])))
      })
      .catch(() => { setScriptPreview(''); setScriptParams([]); setParamValues({}) })
      .finally(() => setPreviewLoading(false))
  }, [selectedScript])

  const activeTab_ = runTabs.find(t => t.id === activeRunTab)
  const isRunning = runTabs.some(t => t.status === 'running')

  // Dynamic browser tab title
  useEffect(() => {
    const runningTab = runTabs.find(t => t.status === 'running')
    if (runningTab) {
      const name = runningTab.script.split('/').pop() ?? runningTab.script
      document.title = `● Running: ${name}`
    } else {
      document.title = 'Monitoring App'
    }
  }, [runTabs])
  const category = scriptCategory(selectedScript)

  function handleRun(connParams: Omit<RunParams, 'script' | 'args' | 'envId'>) {
    if (!selectedScript) return
    if (isRunning) return

    const paramArgs = scriptParams.map(p => {
      const v = (paramValues[p.varName] ?? '').trim()
      return v.includes(' ') ? `"${v}"` : v
    }).join(' ')
    const effectiveArgs = paramArgs ? (args ? `${paramArgs} ${args}` : paramArgs) : args
    const tabId = Date.now().toString()
    const newTab: RunTab = {
      id: tabId, runId: '', script: selectedScript, machineName: connParams.host ?? 'local',
      lines: [], status: 'running',
      startedAt: new Date().toLocaleTimeString(),
    }
    setRunTabs(prev => [...prev.slice(-7), newTab])
    setActiveRunTab(tabId)

    void startRun({ script: selectedScript, args: effectiveArgs, envId: selectedEnv, ...connParams })
      .then((runId) => {
        setRunTabs(prev => prev.map(t => t.id === tabId ? { ...t, runId } : t))
        const proto = location.protocol === 'https:' ? 'wss' : 'ws'
        const ws = new WebSocket(`${proto}://${location.host}/ws/${runId}`)
        wsRefs.current.set(tabId, ws)
        ws.onmessage = (ev) => {
          const text = ev.data as string
          if (text === '[DONE]\n') {
            setRunTabs(prev => prev.map(t => t.id === tabId ? { ...t, status: 'done' } : t))
            ws.close(); wsRefs.current.delete(tabId); return
          }
          setRunTabs(prev => prev.map(t => t.id === tabId ? { ...t, lines: [...t.lines, text] } : t))
        }
        ws.onerror = () => {
          setRunTabs(prev => prev.map(t =>
            t.id === tabId ? { ...t, lines: [...t.lines, '[ERROR] WebSocket connection failed\n'], status: 'error' } : t
          ))
        }
        ws.onclose = () => {
          setRunTabs(prev => prev.map(t =>
            t.id === tabId && t.status === 'running' ? { ...t, status: 'done' } : t
          ))
          wsRefs.current.delete(tabId)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setRunTabs(prev => prev.map(t =>
          t.id === tabId ? { ...t, lines: [`[ERROR] ${msg}\n`], status: 'error' } : t
        ))
      })
  }

  function handleMultiRun(machineIds: string[]) {
    if (!selectedScript || !machineIds.length) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    void startMultiRun({ script: selectedScript, machine_ids: machineIds, args, environment_id: selectedEnv })
      .then(({ runs }) => {
        const newTabs: RunTab[] = runs.map(r => ({
          id: r.run_id,
          runId: r.run_id,
          script: selectedScript,
          machineName: r.machine_name,
          lines: [],
          status: 'running' as const,
          startedAt: new Date().toLocaleTimeString(),
        }))
        setRunTabs(prev => [...prev.slice(-(8 - newTabs.length)), ...newTabs])
        setActiveRunTab(newTabs[0].id)
        newTabs.forEach(tab => {
          const ws = new WebSocket(`${proto}://${location.host}/ws/${tab.id}`)
          wsRefs.current.set(tab.id, ws)
          ws.onmessage = (ev) => {
            const text = ev.data as string
            if (text === '[DONE]\n') {
              setRunTabs(prev => prev.map(t => t.id === tab.id ? { ...t, status: 'done' } : t))
              ws.close(); wsRefs.current.delete(tab.id); return
            }
            setRunTabs(prev => prev.map(t => t.id === tab.id ? { ...t, lines: [...t.lines, text] } : t))
          }
          ws.onerror = () => {
            setRunTabs(prev => prev.map(t =>
              t.id === tab.id ? { ...t, lines: [...t.lines, '[ERROR] WebSocket failed\n'], status: 'error' } : t
            ))
          }
          ws.onclose = () => {
            setRunTabs(prev => prev.map(t =>
              t.id === tab.id && t.status === 'running' ? { ...t, status: 'done' } : t
            ))
            wsRefs.current.delete(tab.id)
          }
        })
        setActiveTab('run')
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        console.error('Multi-run failed:', msg)
      })
  }

  function closeRunTab(id: string) {
    wsRefs.current.get(id)?.close()
    wsRefs.current.delete(id)
    setRunTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (activeRunTab === id && next.length > 0) setActiveRunTab(next[next.length - 1].id)
      else if (next.length === 0) setActiveRunTab('')
      return next
    })
  }

  const dragHandleV = 'w-1 shrink-0 cursor-col-resize bg-slate-800/80 hover:bg-emerald-500/30 active:bg-emerald-500/50 transition-colors'
  const dragHandleH = 'h-1 shrink-0 cursor-row-resize bg-slate-800/80 hover:bg-purple-500/30 active:bg-purple-500/50 transition-colors'

  const mainTabCls = (t: MainTab) =>
    'px-4 py-2 text-xs font-medium transition-colors ' +
    (activeTab === t ? 'text-slate-100 border-b-2 border-emerald-400' : 'text-slate-500 hover:text-slate-300')

  function applyTheme(t: ThemeId) {
    setTheme(t)
    localStorage.setItem('theme', t)
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none"
         style={{ background: 'var(--bg)', color: 'var(--text-primary)' }}
         data-theme={theme}>
      {/* Header */}
      <header className="shrink-0 h-10 px-3 border-b border-slate-800 flex items-center gap-2">
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-emerald-400 text-lg">⬡</span>
          <h1 className="font-bold text-white tracking-tight text-sm whitespace-nowrap">Monitoring App</h1>
        </div>

        {/* Env selector inline */}
        <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1 px-1">
          <EnvPills
            environments={environments}
            selected={selectedEnv}
            onSelect={setSelectedEnv}
            onChange={() => void load()}
          />
        </div>

        <div className="flex items-center gap-0 shrink-0">
          <button className={mainTabCls('run')} onClick={() => setActiveTab('run')}>▶ Run</button>
          <button className={mainTabCls('stats')} onClick={() => setActiveTab('stats')}>📊 Stats</button>
          <button className={mainTabCls('logs')} onClick={() => setActiveTab('logs')}>📁 Logs</button>
          <button className={mainTabCls('history')} onClick={() => setActiveTab('history')}>📜 History</button>
          <button className={mainTabCls('hosts')} onClick={() => setActiveTab('hosts')}>🖥️ Hosts</button>
          <button className={mainTabCls('machines')} onClick={() => setActiveTab('machines')}>🗄️ Machines</button>
          <button className={mainTabCls('multi')} onClick={() => setActiveTab('multi')}>🚀 Multi-Run</button>
          <button className={mainTabCls('schedules')} onClick={() => setActiveTab('schedules')}>🕐 Schedules</button>
          <button className={mainTabCls('vpn')} onClick={() => setActiveTab('vpn')}>VPN</button>
        </div>
        <button
          onClick={() => setShowInventories(true)}
          className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200
                     border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
        >
          📦 Inventories
        </button>
        {/* Theme picker */}
        <select
          value={theme}
          onChange={e => applyTheme(e.target.value as ThemeId)}
          className="shrink-0 bg-transparent border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none transition-colors cursor-pointer"
          title="Theme"
        >
          {THEMES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <button
          onClick={() => setShowHelp(h => !h)}
          className="shrink-0 text-xs text-slate-500 hover:text-slate-200 border border-slate-700 hover:border-slate-500 rounded-lg px-2 py-1 transition-colors"
          title="Keyboard shortcuts (?)"
        >?</button>
      </header>

      {/* ── Stats tab ── */}
      {activeTab === 'stats' && (
        <div className="flex-1 overflow-hidden">
          <StatsPanel envId={selectedEnv} />
        </div>
      )}

      {/* ── Logs tab ── */}
      {activeTab === 'logs' && (
        <div className="flex-1 overflow-hidden">
          <LogsBrowser scriptFilter={selectedScript} envId={selectedEnv} />
        </div>
      )}

      {/* ── History tab ── */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-hidden">
          <HistoryView
            scriptFilter={selectedScript}
            envId={selectedEnv}
            onReRun={(entry) => {
              setSelectedScript(entry.script)
              setArgs(entry.args ?? '')
              setActiveTab('run')
            }}
          />
        </div>
      )}

      {/* ── Hosts tab ── */}
      {activeTab === 'hosts' && (
        <div className="flex-1 overflow-hidden">
          <AnsibleHostsPicker
            inventories={inventories}
            envId={selectedEnv}
            onUseHosts={(_hosts) => {
              setActiveTab('run')
            }}
          />
        </div>
      )}

      {/* ── Machines tab ── */}
      {activeTab === 'machines' && (
        <div className="flex-1 overflow-hidden">
          <MachinesPanel environments={environments} envId={selectedEnv} />
        </div>
      )}

      {/* ── VPN tab ── */}
      {activeTab === 'vpn' && (
        <div className="flex-1 overflow-hidden">
          <WireGuardPanel />
        </div>
      )}

      {/* ── Multi-Run tab ── */}
      {activeTab === 'multi' && (
        <div className="flex-1 overflow-hidden">
          <MultiRunPanel
            machines={machines.filter(m => !selectedEnv || m.environment_id === selectedEnv || !m.environment_id)}
            selectedScript={selectedScript}
            args={args}
            onRun={handleMultiRun}
          />
        </div>
      )}

      {/* ── Schedules tab ── */}
      {activeTab === 'schedules' && (
        <div className="flex-1 overflow-hidden">
          <SchedulesPanel
            machines={machines}
            envId={selectedEnv}
          />
        </div>
      )}

      {/* ── Run tab ── */}
      {activeTab === 'run' && (
        <>
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* File tree sidebar */}
            <aside
              style={{ width: sidebarWidth }}
              className="shrink-0 border-r border-slate-800 bg-slate-900/20 flex flex-col overflow-hidden"
            >
              <FileTree
                tree={tree}
                selected={selectedScript}
                onSelect={setSelectedScript}
                onRefresh={() => void fetchScriptsTree(selectedEnv).then(setTree).catch(() => {})}
                envId={selectedEnv}
              />
            </aside>

            <div className={dragHandleV} onMouseDown={onSidebarDrag} />

            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Controls row — height = controlsHeight */}
              <div style={{ height: controlsHeight }} className="flex shrink-0 overflow-hidden border-b border-slate-800">

                {/* Target panel */}
                <div style={{ width: machinesWidth }} className="shrink-0 border-r border-slate-800 overflow-hidden flex flex-col">
                  <TargetPanel
                    category={category}
                    inventories={inventories}
                    onRun={handleRun}
                    running={isRunning}
                  />
                </div>

                <div className={dragHandleV} onMouseDown={onMachinesDrag} />

                {/* Script preview + args */}
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  <div className="shrink-0 p-3 pb-2 flex flex-col gap-2 select-text">
                    {/* Status badge */}
                    <span className={`px-2 py-1 rounded font-mono border text-xs transition-colors self-start
                      ${selectedScript ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' : 'bg-slate-800/50 text-slate-600 border-slate-700/30'}`}>
                      {selectedScript || 'no script selected'}
                    </span>

                    {/* Detected script parameters */}
                    {scriptParams.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs text-slate-400">Script parameters</label>
                        {scriptParams.map(p => (
                          <div key={p.varName} className="flex flex-col gap-0.5">
                            <label className="text-[11px] text-slate-500">{p.prompt}</label>
                            <input
                              value={paramValues[p.varName] ?? ''}
                              onChange={(e) => setParamValues(prev => ({ ...prev, [p.varName]: e.target.value }))}
                              disabled={isRunning}
                              placeholder={p.varName}
                              className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2
                                         text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500
                                         disabled:opacity-50 placeholder-slate-600"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Args */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400">
                        {scriptParams.length > 0 ? 'Extra arguments' : 'Arguments (optional)'}
                      </label>
                      <input
                        value={args}
                        onChange={(e) => setArgs(e.target.value)}
                        disabled={isRunning}
                        placeholder="--env prod --verbose"
                        className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2
                                   text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500
                                   disabled:opacity-50 placeholder-slate-600"
                      />
                    </div>
                  </div>

                  {/* Script preview — flex-1, fills remaining space */}
                  <div className="flex-1 min-h-0 flex flex-col border-t border-slate-800">                    <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-slate-800/60 bg-slate-900/30">
                      <span className="text-xs text-slate-500 font-medium">
                        {selectedScript ? selectedScript.split('/').pop() : 'Script preview'}
                        {previewLoading && <span className="ml-2 text-slate-600">...</span>}
                      </span>
                      {selectedScript && (
                        <div className="flex items-center gap-2">
                          {editingScript ? (
                            <>
                              {editError && <span className="text-[10px] text-red-400">{editError}</span>}
                              <button
                                onClick={() => setShowDiff(d => !d)}
                                className={`text-xs px-2 py-0.5 rounded border transition-colors
                                  ${showDiff
                                    ? 'border-purple-500/60 text-purple-300 bg-purple-900/20'
                                    : 'border-slate-700 text-slate-500 hover:text-slate-200 hover:border-slate-500'}`}
                              >Diff</button>
                              <button
                                onClick={async () => {
                                  setEditSaving(true); setEditError('')
                                  try {
                                    await saveScriptContent(selectedScript, editContent, selectedEnv)
                                    setScriptPreview(editContent)
                                    const detected = detectScriptParams(editContent)
                                    setScriptParams(detected)
                                    setParamValues(Object.fromEntries(detected.map(p => [p.varName, ''])))
                                    setEditingScript(false); setShowDiff(false)
                                  } catch (e) { setEditError(e instanceof Error ? e.message : 'Save failed') }
                                  finally { setEditSaving(false) }
                                }}
                                disabled={editSaving}
                                className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded disabled:opacity-50"
                              >{editSaving ? 'Saving...' : 'Save'}</button>
                              <button onClick={() => { setEditingScript(false); setShowDiff(false) }}
                                className="text-xs text-slate-500 hover:text-slate-300 px-1">Cancel</button>
                            </>
                          ) : (
                            <button
                              onClick={() => { setEditContent(scriptPreview); setEditingScript(true); setEditError(''); setShowDiff(false) }}
                              className="text-xs text-slate-500 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-colors"
                            >Edit</button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      {editingScript && showDiff ? (
                        <DiffView original={scriptPreview} modified={editContent} />
                      ) : editingScript ? (
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full h-full bg-slate-950 text-slate-200 font-mono text-[11px] leading-relaxed
                                     p-3 resize-none focus:outline-none focus:ring-1 focus:ring-inset focus:ring-emerald-600"
                          spellCheck={false}
                        />
                      ) : scriptPreview ? (
                        <pre className="p-3 text-[11px] font-mono text-slate-300 leading-relaxed whitespace-pre-wrap">
                          {scriptPreview}
                        </pre>
                      ) : (
                        <div className="p-3 text-xs text-slate-600 italic">
                          {selectedScript ? 'Loading...' : 'Select a script to preview'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className={dragHandleH} onMouseDown={onControlsDrag} />

              {/* Per-run log tabs area */}
              <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                {runTabs.length > 0 ? (
                  <>
                    {/* Run tab bar */}
                    <div className="shrink-0 flex items-center border-b border-slate-800 bg-slate-900/30 overflow-x-auto">
                      {runTabs.map(tab => {
                        const scriptName = tab.script.split('/').pop() ?? tab.script
                        const isActive = tab.id === activeRunTab
                        const statusColor =
                          tab.status === 'running' ? 'text-blue-400' :
                          tab.status === 'error' ? 'text-red-400' : 'text-emerald-400'
                        return (
                          <div key={tab.id}
                            onClick={() => setActiveRunTab(tab.id)}
                            className={'group flex items-center gap-2 px-3 py-2 border-r border-slate-800 cursor-pointer shrink-0 ' +
                              (isActive ? 'bg-slate-800 text-slate-200' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50')}>
                            <span className={'text-[10px] ' + statusColor + (tab.status === 'running' ? ' animate-spin inline-block' : '')}>
                              {tab.status === 'running' ? '◌' : tab.status === 'error' ? '✗' : '✓'}
                            </span>
                            <span className="text-xs font-mono">{scriptName}</span>
                            <span className="text-[10px] text-slate-600">{tab.startedAt}</span>
                            <button
                              onClick={e => { e.stopPropagation(); closeRunTab(tab.id) }}
                              className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300 transition-all text-[10px] ml-1">
                              ✕
                            </button>
                          </div>
                        )
                      })}
                    </div>
                    {/* Active run content */}
                    {activeTab_ && (
                      <div className="flex-1 min-h-0 p-3 flex flex-col select-text">
                        <LogViewer
                          lines={activeTab_.lines}
                          status={activeTab_.status}
                          onClear={() => setRunTabs(prev => prev.map(t => t.id === activeRunTab ? { ...t, lines: [], status: 'idle' as const } : t))}
                          onSave={async () => {
                            if (!activeTab_.script) throw new Error('No script')
                            const useAnsible = scriptCategory(activeTab_.script) === 'ansible'
                            await saveLogs(activeTab_.lines, activeTab_.script, useAnsible, selectedEnv)
                          }}
                          onStop={activeTab_.status === 'running' && activeTab_.runId ? async () => {
                            await stopRun(activeTab_.runId)
                          } : undefined}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex-1 flex flex-col select-text">
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-slate-700 text-sm">Run a script to see logs here</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {showInventories && (
        <InventoryPanel
          onClose={() => {
            setShowInventories(false)
            void fetchInventories().then(setInventories).catch(() => {})
          }}
        />
      )}

      {/* ── Keyboard shortcuts help modal ── */}
      {showHelp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowHelp(false)}>
          <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-200">Keyboard Shortcuts</h3>
              <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-slate-300 text-xs">✕</button>
            </div>
            <div className="flex flex-col gap-1.5 text-xs">
              {[
                ['?', 'Toggle this help'],
                ['Esc', 'Close modals'],
                ['1', 'Go to Run tab'],
                ['2', 'Go to Stats tab'],
                ['3', 'Go to Logs tab'],
                ['4', 'Go to History tab'],
                ['5', 'Go to Machines tab'],
                ['6', 'Go to Multi-Run tab'],
                ['7', 'Go to Schedules tab'],
                ['8', 'Go to VPN tab'],
                ['Ctrl+Enter', 'Run script (in Run tab)'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3">
                  <kbd className="shrink-0 px-2 py-0.5 rounded bg-slate-800 border border-slate-600 font-mono text-slate-300 text-[11px] min-w-[60px] text-center">
                    {key}
                  </kbd>
                  <span className="text-slate-400">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
