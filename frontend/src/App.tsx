import { useState, useEffect, useRef, useCallback } from 'react'
import type { Machine, TreeNode, Environment, AnsibleInventory, RunTab } from './types'
import { fetchScriptsTree, fetchMachines, fetchEnvironments, fetchInventories, startRun, saveLogs, fetchScriptContent, stopRun, saveScriptContent } from './api'
import { createEnvironment, deleteEnvironment } from './api'
import { useDragResize } from './hooks/useDragResize'
import FileTree from './components/FileTree'
import MachineSelector from './components/MachineSelector'
import LogViewer from './components/LogViewer'
import InventoryPanel from './components/InventoryPanel'
import LogsBrowser from './components/LogsBrowser'
import HistoryView from './components/HistoryView'
import AnsibleHostsPicker from './components/AnsibleHostsPicker'
import WireGuardPanel from './components/WireGuardPanel'

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

type MainTab = 'run' | 'logs' | 'history' | 'hosts' | 'vpn'

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
  const [machines, setMachines] = useState<Machine[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [inventories, setInventories] = useState<AnsibleInventory[]>([])

  const [theme, setTheme] = useState<ThemeId>(() => (localStorage.getItem('theme') as ThemeId) ?? 'dark-slate')

  const [selectedScript, setSelectedScript] = useState('')
  const [selectedMachine, setSelectedMachine] = useState('')
  const [selectedEnv, setSelectedEnv] = useState('')
  const [selectedInventory, setSelectedInventory] = useState('')
  const [ephemeralHosts, setEphemeralHosts] = useState('')
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
  const [showInventories, setShowInventories] = useState(false)
  const [activeTab, setActiveTab] = useState<MainTab>('run')

  const wsRefs = useRef<Map<string, WebSocket>>(new Map())

  const [sidebarWidth, onSidebarDrag]    = useDragResize(() => 125, 'x', 110)
  const [machinesWidth, onMachinesDrag]  = useDragResize(() => Math.max(300, Math.floor((window.innerWidth - 130) * 0.72)), 'x', 200)
  const [controlsHeight, onControlsDrag] = useDragResize(() => Math.max(200, Math.floor(window.innerHeight * 0.60)), 'y', 120)

  const load = useCallback(async (env = selectedEnv) => {
    try {
      const [t, m, e, i] = await Promise.all([
        fetchScriptsTree(env), fetchMachines(), fetchEnvironments(), fetchInventories(env),
      ])
      setTree(t); setMachines(m); setEnvironments(e); setInventories(i)
    } catch { /* backend not up yet */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { void load() }, [load])

  // Reload env-specific data when env changes
  useEffect(() => {
    void load(selectedEnv)
    setSelectedScript('')
    setSelectedInventory('')
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

  const selectedMachineObj = machines.find((m) => m.id === selectedMachine)
  const selectedInventoryObj = inventories.find((i) => i.id === selectedInventory)
  const needsInventory = selectedMachineObj?.use_ansible ?? false
  const ephemeralHostList = ephemeralHosts.split(/[\n,;]/).map((h) => h.trim()).filter(Boolean)

  const activeTab_ = runTabs.find(t => t.id === activeRunTab)

  function handleRun() {
    if (!selectedScript || !selectedMachine) return
    const runningTabs = runTabs.filter(t => t.status === 'running')
    if (runningTabs.length > 0) return

    const paramArgs = scriptParams.map(p => {
      const v = (paramValues[p.varName] ?? '').trim()
      return v.includes(' ') ? `"${v}"` : v
    }).join(' ')
    const effectiveArgs = paramArgs ? (args ? `${paramArgs} ${args}` : paramArgs) : args
    const ephHosts = needsInventory && selectedInventoryObj?.is_ephemeral ? ephemeralHostList : []
    const machineName = selectedMachineObj?.name ?? '?'
    const tabId = Date.now().toString()
    const newTab: RunTab = {
      id: tabId, runId: '', script: selectedScript, machineName,
      lines: [], status: 'running',
      startedAt: new Date().toLocaleTimeString(),
    }
    setRunTabs(prev => {
      // keep last 8 tabs
      const next = [...prev.slice(-7), newTab]
      return next
    })
    setActiveRunTab(tabId)

    void startRun(selectedScript, selectedMachine, effectiveArgs, selectedInventory, ephHosts, selectedEnv)
      .then((runId) => {
        // store the real runId on the tab for cancellation
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

  const isRunning = runTabs.some(t => t.status === 'running')
  const canRun = selectedScript !== '' && selectedMachine !== '' && !isRunning

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
          <button className={mainTabCls('logs')} onClick={() => setActiveTab('logs')}>📁 Logs</button>
          <button className={mainTabCls('history')} onClick={() => setActiveTab('history')}>📜 History</button>
          <button className={mainTabCls('hosts')} onClick={() => setActiveTab('hosts')}>🖥️ Hosts</button>
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
      </header>

      {/* ── Logs tab ── */}
      {activeTab === 'logs' && (
        <div className="flex-1 overflow-hidden">
          <LogsBrowser scriptFilter={selectedScript} envId={selectedEnv} />
        </div>
      )}

      {/* ── History tab ── */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-hidden">
          <HistoryView scriptFilter={selectedScript} envId={selectedEnv} />
        </div>
      )}

      {/* ── Hosts tab ── */}
      {activeTab === 'hosts' && (
        <div className="flex-1 overflow-hidden">
          <AnsibleHostsPicker
            inventories={inventories}
            envId={selectedEnv}
            onUseHosts={(hosts) => {
              setEphemeralHosts(hosts.join('\n'))
              setActiveTab('run')
            }}
          />
        </div>
      )}

      {/* ── VPN tab ── */}
      {activeTab === 'vpn' && (
        <div className="flex-1 overflow-hidden">
          <WireGuardPanel />
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
                onRefresh={() => void fetchScriptsTree().then(setTree).catch(() => {})}
              />
            </aside>

            <div className={dragHandleV} onMouseDown={onSidebarDrag} />

            <div className="flex-1 flex flex-col overflow-hidden min-w-0">
              {/* Controls row — height = controlsHeight */}
              <div style={{ height: controlsHeight }} className="flex shrink-0 overflow-hidden border-b border-slate-800">

                {/* Machines panel */}
                <div style={{ width: machinesWidth }} className="shrink-0 border-r border-slate-800 overflow-hidden flex flex-col">
                  <MachineSelector
                    inventories={inventories}
                    onSelect={setSelectedMachine}
                    onChanged={() => void load()}
                    onHostsChange={(hosts) => setEphemeralHosts(hosts.join('\n'))}
                    disabled={isRunning}
                  />
                </div>

                <div className={dragHandleV} onMouseDown={onMachinesDrag} />

                {/* Run config — same height */}
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  {/* Compact top controls — shrink-only, scrollable */}
                  <div className="shrink-0 overflow-y-auto p-4 pb-2 flex flex-col gap-3 select-text" style={{ maxHeight: '60%' }}>

                    {/* Status badges */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className={`px-2 py-1 rounded font-mono border transition-colors
                        ${selectedScript ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' : 'bg-slate-800/50 text-slate-600 border-slate-700/30'}`}>
                        {selectedScript || 'no script selected'}
                      </span>
                      <span className={`px-2 py-1 rounded font-mono border transition-colors
                        ${selectedMachineObj ? 'bg-blue-900/30 text-blue-300 border-blue-700/40' : 'bg-slate-800/50 text-slate-600 border-slate-700/30'}`}>
                        {selectedMachineObj
                          ? `${selectedMachineObj.name}${selectedMachineObj.jump_host?.host ? ` → ${selectedMachineObj.jump_host.host}` : ''}`
                          : 'no machine selected'}
                      </span>
                    </div>

                    {/* Inventory selector */}
                    {needsInventory && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-400 flex items-center gap-1">
                          <span className="text-orange-400">📦</span> Ansible Inventory
                        </label>
                        <div className="flex gap-2">
                          <select
                            value={selectedInventory}
                            onChange={(e) => { setSelectedInventory(e.target.value) }}
                            disabled={isRunning}
                            className="flex-1 bg-slate-800 border border-slate-600 text-slate-200 rounded-lg
                                       px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-500
                                       disabled:opacity-50"
                          >
                            <option value="">— use machine default —</option>
                            {inventories.map((inv) => (
                              <option key={inv.id} value={inv.id}>
                                {inv.is_ephemeral ? '🔄 ' : '📄 '}{inv.name}
                              </option>
                            ))}
                          </select>
                          <button onClick={() => setShowInventories(true)}
                            className="text-xs text-slate-500 hover:text-slate-300 border border-slate-700
                                       hover:border-slate-500 rounded-lg px-2 transition-colors" title="Manage">✏️
                          </button>
                        </div>
                        {selectedInventoryObj?.is_ephemeral && (
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-slate-400">Hosts for this run (from import)</label>
                            {ephemeralHostList.length > 0 ? (
                              <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-slate-400 max-h-20 overflow-y-auto">
                                {ephemeralHostList.join('\n')}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-500 italic">No hosts — enter hosts in the Import panel.</p>
                            )}
                            {ephemeralHostList.length > 0 && (
                              <span className="text-[10px] text-slate-500">
                                {ephemeralHostList.length} host{ephemeralHostList.length !== 1 ? 's' : ''} queued
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Detected script parameters */}
                    {scriptParams.length > 0 && (
                      <div className="flex flex-col gap-2">
                        <label className="text-xs text-slate-400">Script parameters</label>
                        {scriptParams.map(p => (
                          <div key={p.varName} className="flex flex-col gap-0.5">
                            <label className="text-[11px] text-slate-500">{p.prompt}</label>
                            <input
                              value={paramValues[p.varName] ?? ''}
                              onChange={(e) => setParamValues(prev => ({ ...prev, [p.varName]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === 'Enter' && canRun) handleRun() }}
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
                        onKeyDown={(e) => { if (e.key === 'Enter' && canRun) handleRun() }}
                        disabled={isRunning}
                        placeholder="--env prod --verbose"
                        className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2
                                   text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500
                                   disabled:opacity-50 placeholder-slate-600"
                      />
                    </div>
                  </div>

                  {/* Script preview — flex-1, fills remaining space */}
                  <div className="flex-1 min-h-0 flex flex-col border-t border-slate-800">
                    <div className="shrink-0 flex items-center justify-between px-4 py-1.5 border-b border-slate-800/60 bg-slate-900/30">
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
                                onClick={async () => {
                                  setEditSaving(true); setEditError('')
                                  try {
                                    await saveScriptContent(selectedScript, editContent, selectedEnv)
                                    setScriptPreview(editContent)
                                    const detected = detectScriptParams(editContent)
                                    setScriptParams(detected)
                                    setParamValues(Object.fromEntries(detected.map(p => [p.varName, ''])))
                                    setEditingScript(false)
                                  } catch (e) { setEditError(e instanceof Error ? e.message : 'Save failed') }
                                  finally { setEditSaving(false) }
                                }}
                                disabled={editSaving}
                                className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-700/50 px-2 py-0.5 rounded disabled:opacity-50"
                              >{editSaving ? 'Saving...' : 'Save'}</button>
                              <button onClick={() => setEditingScript(false)}
                                className="text-xs text-slate-500 hover:text-slate-300 px-1">Cancel</button>
                            </>
                          ) : (
                            <button
                              onClick={() => { setEditContent(scriptPreview); setEditingScript(true); setEditError('') }}
                              className="text-xs text-slate-500 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-colors"
                            >Edit</button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-auto">
                      {editingScript ? (
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

                  {/* Run button */}
                  <div className="shrink-0 px-4 py-2 border-t border-slate-800">
                    <button
                      onClick={handleRun}
                      disabled={!canRun}
                      className={`w-full py-2 rounded-lg font-semibold text-sm tracking-wide transition-all
                                  ${canRun
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 active:scale-[0.98]'
                        : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'}`}
                    >
                      {isRunning ? 'Running...' : 'Run Script'}
                    </button>
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
                            const useAnsible = selectedMachineObj?.use_ansible ?? false
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
    </div>
  )
}
