import { useState } from 'react'
import type { AnsibleInventory, AnsibleHost, ParsedInventory } from '../types'
import { parseInventoryContent } from '../api'

interface Props {
  inventories: AnsibleInventory[]
  envId?: string
  onUseHosts: (hosts: string[]) => void
}

export default function AnsibleHostsPicker({ inventories, onUseHosts }: Props) {
  const [selectedInvId, setSelectedInvId] = useState('')
  const [parsed, setParsed] = useState<ParsedInventory | null>(null)
  const [loading, setLoading] = useState(false)
  const [parseError, setParseError] = useState('')
  const [checkedHosts, setCheckedHosts] = useState<Set<string>>(new Set())
  const [regexFilter, setRegexFilter] = useState('')
  const [regexError, setRegexError] = useState('')
  const [mode, setMode] = useState<'picker' | 'paste'>('picker')
  const [pasteText, setPasteText] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'groups' | 'flat'>('groups')

  async function handleLoadInventory(invId: string) {
    setSelectedInvId(invId)
    setParseError('')
    setParsed(null)
    setCheckedHosts(new Set())
    const inv = inventories.find(i => i.id === invId)
    if (!inv) return
    const src = inv.is_ephemeral ? inv.base_content : inv.content
    if (!src.trim()) { setParseError('Inventory is empty'); return }
    setLoading(true)
    try {
      const result = await parseInventoryContent(src)
      setParsed(result)
      setExpandedGroups(new Set(Object.keys(result.groups)))
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Parse error')
    } finally {
      setLoading(false)
    }
  }

  function getFilteredHosts(hosts: AnsibleHost[]): AnsibleHost[] {
    if (!regexFilter) return hosts
    try {
      const rx = new RegExp(regexFilter, 'i')
      setRegexError('')
      return hosts.filter(h => rx.test(h.name))
    } catch {
      setRegexError('Invalid regex')
      return hosts
    }
  }

  function toggleHost(name: string) {
    setCheckedHosts(prev => {
      const n = new Set(prev)
      if (n.has(name)) n.delete(name); else n.add(name)
      return n
    })
  }

  function selectAllFiltered() {
    if (!parsed) return
    const filtered = getFilteredHosts(parsed.all_hosts)
    setCheckedHosts(prev => {
      const n = new Set(prev)
      filtered.forEach(h => n.add(h.name))
      return n
    })
  }

  function deselectAll() { setCheckedHosts(new Set()) }

  function selectGroup(groupHosts: string[]) {
    setCheckedHosts(prev => {
      const n = new Set(prev)
      groupHosts.forEach(h => n.add(h))
      return n
    })
  }

  function toggleGroup(g: string) {
    setExpandedGroups(prev => {
      const n = new Set(prev)
      if (n.has(g)) n.delete(g); else n.add(g)
      return n
    })
  }

  function handleUse() {
    if (mode === 'paste') {
      const hosts = pasteText.split(/[\n,;]/).map(h => h.trim()).filter(Boolean)
      if (hosts.length) onUseHosts(hosts)
      return
    }
    const selected = Array.from(checkedHosts)
    if (selected.length) onUseHosts(selected)
  }

  const filteredAll = parsed ? getFilteredHosts(parsed.all_hosts) : []
  const activeHostCount = mode === 'paste'
    ? pasteText.split(/[\n,;]/).map(h => h.trim()).filter(Boolean).length
    : checkedHosts.size

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-slate-800 flex items-center gap-4">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Ansible Hosts Database</span>
        <div className="flex gap-1">
          {(['picker', 'paste'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={'px-3 py-1 rounded text-xs font-medium transition-colors ' +
                (mode === m ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}>
              {m === 'picker' ? 'From Inventory' : 'Paste List'}
            </button>
          ))}
        </div>
        {activeHostCount > 0 && (
          <button
            onClick={handleUse}
            className="ml-auto px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors">
            Use {activeHostCount} host{activeHostCount !== 1 ? 's' : ''} for run
          </button>
        )}
      </div>

      {mode === 'paste' ? (
        /* ── Paste mode ── */
        <div className="flex-1 p-4 flex flex-col gap-3">
          <label className="text-xs text-slate-400">Paste a list of hosts (one per line, or comma/semicolon separated):</label>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            rows={12}
            placeholder={"web1.example.com\nweb2.example.com\n192.168.1.10"}
            className="flex-1 bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2
                       text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500
                       resize-none placeholder-slate-600"
          />
          {pasteText.trim() && (
            <p className="text-xs text-slate-500">
              {pasteText.split(/[\n,;]/).map(h => h.trim()).filter(Boolean).length} hosts detected
            </p>
          )}
        </div>
      ) : (
        /* ── Inventory picker mode ── */
        <div className="flex-1 flex overflow-hidden min-h-0">
          {/* Left: inventory list */}
          <div className="w-56 shrink-0 border-r border-slate-800 flex flex-col">
            <div className="shrink-0 px-3 py-2 border-b border-slate-800">
              <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Inventory Files</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
              {inventories.length === 0 && (
                <p className="text-xs text-slate-600 italic px-2 py-3">No inventories. Add one via Inventories.</p>
              )}
              {inventories.map(inv => (
                <button key={inv.id} onClick={() => void handleLoadInventory(inv.id)}
                  className={'w-full text-left px-3 py-2 rounded-lg text-xs transition-colors border ' +
                    (selectedInvId === inv.id
                      ? 'border-emerald-600 bg-emerald-900/30 text-emerald-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-800/50')}>
                  <div className="font-medium truncate">{inv.is_ephemeral ? '[E] ' : ''}{inv.name}</div>
                  {inv.description && <div className="text-[10px] text-slate-500 truncate mt-0.5">{inv.description}</div>}
                </button>
              ))}
            </div>
          </div>

          {/* Right: host browser */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedInvId ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-slate-600 text-sm">Select an inventory file to browse its hosts</p>
              </div>
            ) : loading ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-slate-500 text-sm">Parsing inventory...</p>
              </div>
            ) : parseError ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-red-400 text-sm">{parseError}</p>
              </div>
            ) : parsed ? (
              <>
                {/* Toolbar */}
                <div className="shrink-0 px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
                  <input
                    value={regexFilter}
                    onChange={e => { setRegexFilter(e.target.value); setRegexError('') }}
                    placeholder="regex filter (e.g. web.*prod)"
                    className={'flex-1 min-w-32 bg-slate-800 border text-slate-200 rounded-md px-2 py-1 text-xs ' +
                      'focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-slate-600 ' +
                      (regexError ? 'border-red-500' : 'border-slate-600')}
                  />
                  {regexError && <span className="text-red-400 text-[10px]">{regexError}</span>}
                  <button onClick={selectAllFiltered}
                    className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2 py-1 rounded transition-colors">
                    Select all{regexFilter ? ' matching' : ''}
                  </button>
                  <button onClick={deselectAll}
                    className="text-xs text-slate-400 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2 py-1 rounded transition-colors">
                    None
                  </button>
                  <div className="flex gap-1">
                    {(['groups', 'flat'] as const).map(v => (
                      <button key={v} onClick={() => setViewMode(v)}
                        className={'px-2 py-0.5 rounded text-xs ' +
                          (viewMode === v ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}>
                        {v === 'groups' ? 'By Group' : 'Flat'}
                      </button>
                    ))}
                  </div>
                  <span className="text-xs text-slate-500">
                    {checkedHosts.size}/{parsed.host_count} selected
                  </span>
                </div>

                {/* Host list */}
                <div className="flex-1 overflow-y-auto p-3">
                  {viewMode === 'flat' ? (
                    <div className="flex flex-col gap-0.5">
                      {filteredAll.map(h => (
                        <HostRow key={h.name} host={h} checked={checkedHosts.has(h.name)} onToggle={toggleHost} />
                      ))}
                      {filteredAll.length === 0 && (
                        <p className="text-slate-600 text-xs italic px-2 py-4">No hosts match the filter.</p>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {Object.entries(parsed.groups).map(([group, hosts]) => {
                        const filteredGroupHosts = getFilteredHosts(
                          hosts.map(name => parsed.all_hosts.find(h => h.name === name) ?? { name, groups: [group], variables: {} })
                        )
                        if (filteredGroupHosts.length === 0) return null
                        const expanded = expandedGroups.has(group)
                        const allChecked = filteredGroupHosts.every(h => checkedHosts.has(h.name))
                        return (
                          <div key={group} className="border border-slate-800 rounded-lg overflow-hidden">
                            <div className="flex items-center gap-2 px-3 py-2 bg-slate-800/40 cursor-pointer select-none"
                              onClick={() => toggleGroup(group)}>
                              <span className="text-[10px] text-slate-500">{expanded ? '-' : '+'}</span>
                              <span className="text-xs font-semibold text-slate-300">{group}</span>
                              <span className="text-[10px] text-slate-600">({filteredGroupHosts.length} host{filteredGroupHosts.length !== 1 ? 's' : ''})</span>
                              <button
                                onClick={e => { e.stopPropagation(); selectGroup(filteredGroupHosts.map(h => h.name)) }}
                                className="ml-auto text-[10px] text-slate-500 hover:text-emerald-400 transition-colors">
                                {allChecked ? 'deselect all' : 'select all'}
                              </button>
                            </div>
                            {expanded && (
                              <div className="p-1">
                                {filteredGroupHosts.map(h => (
                                  <HostRow key={h.name} host={h} checked={checkedHosts.has(h.name)} onToggle={toggleHost} />
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function HostRow({ host, checked, onToggle }: { host: AnsibleHost; checked: boolean; onToggle: (name: string) => void }) {
  const vars = Object.entries(host.variables)
  return (
    <label className={'flex items-start gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors select-none ' +
      (checked ? 'bg-emerald-900/20 text-emerald-300' : 'text-slate-300 hover:bg-slate-800/50')}>
      <input type="checkbox" checked={checked} onChange={() => onToggle(host.name)}
        className="mt-0.5 shrink-0 accent-emerald-500" />
      <div className="min-w-0">
        <span className="text-xs font-mono">{host.name}</span>
        {vars.length > 0 && (
          <span className="ml-2 text-[10px] text-slate-600">
            {vars.slice(0, 3).map(([k, v]) => `${k}=${v}`).join(' ')}
          </span>
        )}
      </div>
    </label>
  )
}
