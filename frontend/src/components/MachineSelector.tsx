import { useState, useEffect } from 'react'
import type { AnsibleInventory } from '../types'
import { bulkImportMachinesWithJump } from '../api'

type ScriptType = 'ansible' | 'shell'
type AnsibleConn = 'ssh' | 'inventory'
type ShellConn   = 'ssh' | 'none'

interface Props {
  inventories: AnsibleInventory[]
  onSelect: (id: string) => void
  onChanged: () => void
  onHostsChange?: (hosts: string[]) => void
  disabled?: boolean
}

const inputCls =
  'bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent w-full'

const cardCls =
  'flex items-start gap-1.5 cursor-pointer p-2 rounded border border-[var(--border)] ' +
  'hover:border-[var(--border-hover)] transition-colors'


export default function MachineSelector({ inventories, onSelect, onChanged, onHostsChange, disabled }: Props) {
  const [pasteText,     setPasteText]     = useState('')
  const [pasteUser,     setPasteUser]     = useState('root')
  const [pastePort,     setPastePort]     = useState(22)
  const [pasteKey,      setPasteKey]      = useState('')
  const [pastePassword, setPastePassword] = useState('')
  const [pastePrefix,   setPastePrefix]   = useState('')
  const [pasteInventory, setPasteInventory] = useState('')
  const [importing,     setImporting]     = useState(false)
  const [importError,   setImportError]   = useState('')
  const [importSuccess, setImportSuccess] = useState('')

  const [scriptType,  setScriptType]  = useState<ScriptType>('ansible')
  const [ansibleConn, setAnsibleConn] = useState<AnsibleConn>('ssh')
  const [shellConn,   setShellConn]   = useState<ShellConn>('ssh')
  const [sshAuth,     setSshAuth]     = useState<'key' | 'password'>('key')

  const pasteHosts = pasteText.split(/[\n,;]/).map(h => h.trim()).filter(Boolean)

  useEffect(() => { onHostsChange?.(pasteHosts) }, [pasteText]) // eslint-disable-line

  function effectiveAuthMethod(): string {
    if (scriptType === 'shell') return shellConn === 'none' ? 'none' : sshAuth
    if (ansibleConn === 'inventory') return 'inventory'
    return sshAuth
  }

  async function handleBulkImport() {
    if (!pasteHosts.length) return
    setImporting(true); setImportError(''); setImportSuccess('')
    try {
      const auth = effectiveAuthMethod()
      const created = await bulkImportMachinesWithJump({
        hosts: pasteHosts, username: pasteUser, port: pastePort,
        auth_method: auth,
        key_path:  auth === 'key'      ? (pasteKey      || undefined) : undefined,
        password:  auth === 'password' ? (pastePassword || undefined) : undefined,
        name_prefix: pastePrefix || undefined,
        use_ansible: scriptType === 'ansible',
        ansible_inventory: scriptType === 'ansible' && ansibleConn === 'inventory' ? (pasteInventory || undefined) : undefined,
      })
      onChanged()
      if (created.length > 0) onSelect(created[0].id)
      setImportSuccess(`${created.length} machine${created.length !== 1 ? 's' : ''} imported.`)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import error')
    } finally { setImporting(false) }
  }

  const showSshCreds = (scriptType === 'ansible' && ansibleConn === 'ssh') || (scriptType === 'shell' && shellConn === 'ssh')
  const showUserPort = !(scriptType === 'ansible' && ansibleConn === 'inventory') && !(scriptType === 'shell' && shellConn === 'none')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">Target Machines</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">

          {/* Script type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-muted)]">Script type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([{ v: 'ansible' as ScriptType, label: '⚡ Ansible' }, { v: 'shell' as ScriptType, label: '🖥️ Bash / PS' }]).map(opt => (
                <label key={opt.v} className={cardCls}>
                  <input type="radio" checked={scriptType === opt.v} onChange={() => setScriptType(opt.v)} className="accent-blue-500 shrink-0 mt-0.5" />
                  <span className="text-xs text-[var(--text-secondary)]">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Connection method */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-muted)]">Connection</label>
            {scriptType === 'ansible' ? (
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { v: 'ssh'       as AnsibleConn, label: '🔑 SSH',       note: 'key or password' },
                  { v: 'inventory' as AnsibleConn, label: '📄 Inventory', note: 'creds in file' },
                ]).map(opt => (
                  <label key={opt.v} className={cardCls}>
                    <input type="radio" checked={ansibleConn === opt.v} onChange={() => setAnsibleConn(opt.v)} className="accent-blue-500 shrink-0 mt-0.5" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs text-[var(--text-secondary)]">{opt.label}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{opt.note}</span>
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { v: 'ssh'  as ShellConn, label: '🔑 SSH',  note: 'key or password' },
                  { v: 'none' as ShellConn, label: '⚡ None', note: 'local / no creds' },
                ]).map(opt => (
                  <label key={opt.v} className={cardCls}>
                    <input type="radio" checked={shellConn === opt.v} onChange={() => setShellConn(opt.v)} className="accent-blue-500 shrink-0 mt-0.5" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs text-[var(--text-secondary)]">{opt.label}</span>
                      <span className="text-[10px] text-[var(--text-muted)]">{opt.note}</span>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Inventory selector for ansible+inventory */}
          {scriptType === 'ansible' && ansibleConn === 'inventory' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-muted)]">Inventory file</label>
              <select value={pasteInventory} onChange={e => setPasteInventory(e.target.value)} className={inputCls + ' text-sm'}>
                <option value="">— select inventory —</option>
                {inventories.map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.is_ephemeral ? '[E] ' : ''}{inv.name}</option>
                ))}
              </select>
              <p className="text-[10px] text-[var(--text-muted)]">Connection params (user, kerberos vars, etc.) come from the inventory file.</p>
            </div>
          )}

          {/* Hosts textarea */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">Hosts — one per line or comma/semicolon separated</label>
            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)}
              disabled={disabled} rows={5}
              placeholder={"192.168.1.10\n192.168.1.11\nserver-prod-3"}
              className="bg-[var(--input-bg)] border border-[var(--border)] text-[var(--text-primary)] rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y placeholder-slate-600 disabled:opacity-50" />
            {pasteHosts.length > 0 && <span className="text-xs text-[var(--text-muted)]">{pasteHosts.length} host{pasteHosts.length !== 1 ? 's' : ''} detected</span>}
          </div>

          {/* Username + Port */}
          {showUserPort && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-muted)]">Username</label>
                <input value={pasteUser} onChange={e => setPasteUser(e.target.value)} className={inputCls} placeholder="root" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-[var(--text-muted)]">Port</label>
                <input type="number" value={pastePort} onChange={e => setPastePort(Number(e.target.value))} className={inputCls} />
              </div>
            </div>
          )}

          {/* SSH auth */}
          {showSshCreds && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-[var(--text-muted)]">SSH authentication</label>
              <div className="grid grid-cols-2 gap-1.5">
                {([{ v: 'key' as const, label: 'SSH Key' }, { v: 'password' as const, label: 'Password' }]).map(opt => (
                  <label key={opt.v} className={cardCls}>
                    <input type="radio" checked={sshAuth === opt.v} onChange={() => setSshAuth(opt.v)} className="accent-blue-500 shrink-0" />
                    <span className="text-xs text-[var(--text-secondary)]">{opt.label}</span>
                  </label>
                ))}
              </div>
              {sshAuth === 'key'
                ? <input value={pasteKey} onChange={e => setPasteKey(e.target.value)} className={inputCls} placeholder="~/.ssh/id_rsa" />
                : <input type="password" value={pastePassword} onChange={e => setPastePassword(e.target.value)} className={inputCls} autoComplete="new-password" placeholder="SSH password" />
              }
            </div>
          )}

          {/* Name prefix */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-[var(--text-muted)]">Name prefix (optional)</label>
            <input value={pastePrefix} onChange={e => setPastePrefix(e.target.value)} className={inputCls} placeholder="prod-" />
          </div>

          {/* Ansible inventory override (ssh mode) */}
          {scriptType === 'ansible' && ansibleConn === 'ssh' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-[var(--text-muted)]">Ansible inventory override (optional)</label>
              <select value={pasteInventory} onChange={e => setPasteInventory(e.target.value)} className={inputCls + ' text-sm'}>
                <option value="">— none / per-machine default —</option>
                {inventories.map(inv => (
                  <option key={inv.id} value={inv.id}>{inv.is_ephemeral ? '[E] ' : ''}{inv.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Bastion chain removed — configure jump hosts in the Run panel */}

          {importError   && <p className="text-red-400 text-xs">{importError}</p>}
          {importSuccess && <p className="text-emerald-400 text-xs">{importSuccess}</p>}

          <button onClick={() => void handleBulkImport()}
            disabled={!pasteHosts.length || importing || disabled}
            className="py-2 px-4 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium">
            {importing ? 'Importing...' : `Import ${pasteHosts.length} host${pasteHosts.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
