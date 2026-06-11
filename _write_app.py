
content = r"""import { useState, useEffect, useRef, useCallback } from 'react'
import type { Machine, RunStatus, TreeNode, Environment, AnsibleInventory, RunTab } from './types'
import { fetchScriptsTree, fetchMachines, fetchEnvironments, fetchInventories, startRun, saveLogs, fetchScriptContent } from './api'
import { useDragResize } from './hooks/useDragResize'
import FileTree from './components/FileTree'
import MachineSelector from './components/MachineSelector'
import LogViewer from './components/LogViewer'
import EnvironmentBar from './components/EnvironmentBar'
import InventoryPanel from './components/InventoryPanel'
import LogsBrowser from './components/LogsBrowser'
import HistoryView from './components/HistoryView'
import AnsibleHostsPicker from './components/AnsibleHostsPicker'

type MainTab = 'run' | 'logs' | 'history' | 'hosts'

export default function App() {
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [machines, setMachines] = useState<Machine[]>([])
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [inventories, setInventories] = useState<AnsibleInventory[]>([])

  const [selectedScript, setSelectedScript] = useState('')
  const [selectedMachine, setSelectedMachine] = useState('')
  const [selectedEnv, setSelectedEnv] = useState('')
  const [selectedInventory, setSelectedInventory] = useState('')
  const [ephemeralHosts, setEphemeralHosts] = useState('')
  const [args, setArgs] = useState('')

  // per-run log tabs
  const [runTabs, setRunTabs] = useState<RunTab[]>([])
  const [activeRunTab, setActiveRunTab] = useState<string>('')

  // script preview
  const [scriptPreview, setScriptPreview] = useState<string>('')
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)

  const [showInventories, setShowInventories] = useState(false)
  const [activeTab, setActiveTab] = useState<MainTab>('run')

  const wsRefs = useRef<Map<string, WebSocket>>(new Map())

  const [sidebarWidth, onSidebarDrag]    = useDragResize(220, 'x', 140)
  const [machinesWidth, onMachinesDrag]  = useDragResize(260, 'x', 180)
  const [controlsHeight, onControlsDrag] = useDragResize(220, 'y', 140)

  const load = useCallback(async () => {
    try {
      const [t, m, e, i] = await Promise.all([
        fetchScriptsTree(), fetchMachines(), fetchEnvironments(), fetchInventories(),
      ])
      setTree(t); setMachines(m); setEnvironments(e); setInventories(i)
    } catch { /* backend not up yet */ }
  }, [])

  useEffect(() => { void load() }, [load])

  // Load script preview when a script is selected
  useEffect(() => {
    if (!selectedScript) { setScriptPreview(''); return }
    setPreviewLoading(true)
    fetchScriptContent(selectedScript)
      .then(r => setScriptPreview(r.content))
      .catch(() => setScriptPreview(''))
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

    const ephHosts = needsInventory && selectedInventoryObj?.is_ephemeral ? ephemeralHostList : []
    const machineName = selectedMachineObj?.name ?? '?'
    const tabId = Date.now().toString()
    const newTab: RunTab = {
      id: tabId, script: selectedScript, machineName,
      lines: [], status: 'running',
      startedAt: new Date().toLocaleTimeString(),
    }
    setRunTabs(prev => {
      // keep last 8 tabs
      const next = [...prev.slice(-7), newTab]
      return next
    })
    setActiveRunTab(tabId)

    void startRun(selectedScript, selectedMachine, args, selectedInventory, ephHosts)
      .then((runId) => {
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

  function lineStatus(lines: string[]): RunStatus {
    const last = lines[lines.length - 1] ?? ''
    if (last.includes('[ERROR]')) return 'error'
    return 'done'
  }

  return (
    <div className="h-screen flex flex-col bg-slate-950 text-slate-200 overflow-hidden select-none">
      {/* Header */}
      <header className="shrink-0 h-10 px-4 border-b border-slate-800 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 text-lg">⬡</span>
          <h1 className="font-bold text-white tracking-tight text-sm">Monitoring App</h1>
        </div>
        <div className="flex items-center gap-0">
          <button className={mainTabCls('run')} onClick={() => setActiveTab('run')}>▶ Run</button>
          <button className={mainTabCls('logs')} onClick={() => setActiveTab('logs')}>📁 Logs</button>
          <button className={mainTabCls('history')} onClick={() => setActiveTab('history')}>📜 History</button>
          <button className={mainTabCls('hosts')} onClick={() => setActiveTab('hosts')}>🖥️ Hosts</button>
        </div>
        <button
          onClick={() => setShowInventories(true)}
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-slate-400 hover:text-slate-200
                     border border-slate-700 hover:border-slate-500 rounded-lg transition-colors"
        >
          📦 Inventories
        </button>
      </header>

      {/* ── Logs tab ── */}
      {activeTab === 'logs' && (
        <div className="flex-1 overflow-hidden">
          <LogsBrowser scriptFilter={selectedScript} />
        </div>
      )}

      {/* ── History tab ── */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-hidden">
          <HistoryView scriptFilter={selectedScript} />
        </div>
      )}

      {/* ── Hosts tab ── */}
      {activeTab === 'hosts' && (
        <div className="flex-1 overflow-hidden">
          <AnsibleHostsPicker
            inventories={inventories}
            onUseHosts={(hosts) => {
              setEphemeralHosts(hosts.join('\n'))
              setActiveTab('run')
            }}
          />
        </div>
      )}

      {/* ── Run tab ── */}
      {activeTab === 'run' && (
        <>
          <EnvironmentBar
            environments={environments}
            selected={selectedEnv}
            onSelect={setSelectedEnv}
            onChange={() => void load()}
          />

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
                    machines={machines}
                    environments={environments}
                    inventories={inventories}
                    selected={selectedMachine}
                    envFilter={selectedEnv}
                    onSelect={setSelectedMachine}
                    onChanged={() => void load()}
                    disabled={isRunning}
                  />
                </div>

                <div className={dragHandleV} onMouseDown={onMachinesDrag} />

                {/* Run config — same height, scrollable */}
                <div className="flex-1 flex flex-col overflow-hidden min-w-0">
                  <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 select-text">

                    {/* Status badges */}
                    <div className="flex flex-wrap gap-2 text-xs">
                      <span className={`px-2 py-1 rounded font-mono border transition-colors
                        ${selectedScript ? 'bg-emerald-900/30 text-emerald-300 border-emerald-700/40' : 'bg-slate-800/50 text-slate-600 border-slate-700/30'}`}>
                        ▶ {selectedScript || 'no script selected'}
                      </span>
                      <span className={`px-2 py-1 rounded font-mono border transition-colors
                        ${selectedMachineObj ? 'bg-blue-900/30 text-blue-300 border-blue-700/40' : 'bg-slate-800/50 text-slate-600 border-slate-700/30'}`}>
                        ⬡ {selectedMachineObj
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
                            onChange={(e) => { setSelectedInventory(e.target.value); setEphemeralHosts('') }}
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
                            <label className="text-xs text-slate-400 flex items-center justify-between">
                              <span>Hosts for this run</span>
                              {ephemeralHosts && (
                                <button onClick={() => setEphemeralHosts('')}
                                  className="text-[10px] text-slate-600 hover:text-slate-400">clear</button>
                              )}
                            </label>
                            <textarea
                              value={ephemeralHosts}
                              onChange={(e) => setEphemeralHosts(e.target.value)}
                              disabled={isRunning}
                              rows={3}
                              placeholder={"server1.example.com\n192.168.1.10"}
                              className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2
                                         text-xs font-mono focus:outline-none focus:ring-2 focus:ring-orange-500
                                         resize-none placeholder-slate-600 disabled:opacity-50"
                            />
                            {ephemeralHostList.length > 0 && (
                              <span className="text-[10px] text-slate-500">
                                {ephemeralHostList.length} host{ephemeralHostList.length !== 1 ? 's' : ''} queued
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Args */}
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-slate-400 flex items-center gap-1">
                        <span className="text-orange-400">⚙</span> Arguments (optional)
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

                    {/* Script preview */}
                    {selectedScript && (
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => setPreviewOpen(o => !o)}
                          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          <span>{previewOpen ? '▾' : '▸'}</span>
                          <span>📄 Script preview</span>
                          {previewLoading && <span className="animate-spin">◌</span>}
                        </button>
                        {previewOpen && scriptPreview && (
                          <pre className="max-h-48 overflow-auto bg-slate-900 border border-slate-700 rounded-lg
                                          p-3 text-[11px] font-mono text-slate-300 leading-relaxed">
                            {scriptPreview.split('\n').slice(0, 100).join('\n')}
                            {scriptPreview.split('\n').length > 100 && '\n... (truncated)'}
                          </pre>
                        )}
                      </div>
                    )}

                    {/* Run button */}
                    <button
                      onClick={handleRun}
                      disabled={!canRun}
                      className={`w-full py-2.5 rounded-xl font-semibold text-sm tracking-wide transition-all mt-auto
                                  ${canRun
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/30 active:scale-[0.98]'
                        : 'bg-slate-700/50 text-slate-500 cursor-not-allowed'}`}
                    >
                      {isRunning
                        ? <span className="flex items-center justify-center gap-2"><span className="animate-spin inline-block">◌</span> Running...</span>
                        : '▶  Run Script'}
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
                            await saveLogs(activeTab_.lines, activeTab_.script, useAnsible)
                          }}
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
"""
open('frontend/src/App.tsx', 'w').write(content)
print("Done: App.tsx rewritten with per-run tabs, script preview, Hosts tab")
