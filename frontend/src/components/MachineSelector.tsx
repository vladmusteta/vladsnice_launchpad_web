import { useState, useEffect } from 'react'
import type { AnsibleInventory } from '../types'
import { bulkImportMachinesWithJump } from '../api'

type ScriptType = 'ansible' | 'shell'

interface Props {
  inventories: AnsibleInventory[]
  onSelect: (id: string) => void
  onChanged: () => void
  onHostsChange?: (hosts: string[]) => void
  disabled?: boolean
}

const inputCls =
  'bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full'

export default function MachineSelector({
  inventories, onSelect, onChanged, onHostsChange, disabled,
}: Props) {
  const [pasteText, setPasteText] = useState('')
  const [pasteUser, setPasteUser] = useState('root')
  const [pastePort, setPastePort] = useState(22)
  const [pasteAuth, setPasteAuth] = useState<'key' | 'password' | 'kerberos' | 'winrm'>('key')
  const [pasteKey, setPasteKey] = useState('')
  const [pastePassword, setPastePassword] = useState('')
  const [pastePrefix, setPastePrefix] = useState('')
  const [pasteInventory, setPasteInventory] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')
  const [scriptType, setScriptType] = useState<ScriptType>('ansible')

  const [useBastion, setUseBastion] = useState(false)
  const [bastionHost, setBastionHost] = useState('')
  const [bastionPort, setBastionPort] = useState(22)
  const [bastionUser, setBastionUser] = useState('')
  const [bastionAuth, setBastionAuth] = useState<'key' | 'password'>('key')
  const [bastionKey, setBastionKey] = useState('')
  const [bastionPassword, setBastionPassword] = useState('')

  const pasteHosts = pasteText.split(/[\n,;]/).map((h) => h.trim()).filter(Boolean)

  // Reset incompatible auth when switching to shell
  useEffect(() => {
    if (scriptType === 'shell' && (pasteAuth === 'kerberos' || pasteAuth === 'winrm')) {
      setPasteAuth('key')
    }
  }, [scriptType]) // eslint-disable-line react-hooks/exhaustive-deps

  // Propagate hosts list to parent whenever textarea changes
  useEffect(() => {
    onHostsChange?.(pasteHosts)
  }, [pasteText]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBulkImport() {
    if (!pasteHosts.length) return
    setImporting(true); setImportError(''); setImportSuccess('')
    try {
      const jumpHost = useBastion && bastionHost ? {
        host: bastionHost, port: bastionPort, username: bastionUser,
        auth_method: bastionAuth,
        key_path: bastionKey || undefined, password: bastionPassword || undefined,
      } : null
      const created = await bulkImportMachinesWithJump({
        hosts: pasteHosts, username: pasteUser, port: pastePort,
        auth_method: pasteAuth, key_path: pasteKey || undefined,
        password: pastePassword || undefined, name_prefix: pastePrefix || undefined,
        use_ansible: scriptType === 'ansible',
        ansible_inventory: scriptType === 'ansible' ? (pasteInventory || undefined) : undefined,
        jump_host: jumpHost,
      })
      onChanged()
      if (created.length > 0) onSelect(created[0].id)
      setImportSuccess(created.length + ' machine' + (created.length !== 1 ? 's' : '') + ' imported.')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import error')
    } finally { setImporting(false) }
  }

  const connectionOpts: Array<{ value: 'key' | 'password' | 'kerberos' | 'winrm'; label: string; note?: string }> = [
    { value: 'key',      label: 'SSH Key' },
    { value: 'password', label: 'SSH Password' },
    ...(scriptType === 'ansible' ? [
      { value: 'kerberos' as const, label: 'Kerberos / WinRM', note: 'No credentials — uses kinit ticket' },
      { value: 'winrm'    as const, label: 'WinRM (NTLM)',     note: 'Username + password' },
    ] : []),
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-slate-800">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Target Machines</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <div className="flex flex-col gap-3">

          {/* Script type */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-slate-400">Script type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { value: 'ansible' as ScriptType, label: '⚡ Ansible' },
                { value: 'shell'   as ScriptType, label: '🖥️ Bash / PowerShell' },
              ]).map((opt) => (
                <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer p-2 rounded border border-slate-700 hover:border-slate-500 transition-colors">
                  <input type="radio" checked={scriptType === opt.value} onChange={() => setScriptType(opt.value)} className="accent-blue-500 shrink-0" />
                  <span className="text-xs text-slate-300">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Hosts */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Hosts — one per line or comma/semicolon separated</label>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
              disabled={disabled} rows={6}
              placeholder={"192.168.1.10\n192.168.1.11\nserver-prod-3"}
              className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder-slate-600 disabled:opacity-50" />
            {pasteHosts.length > 0 && <span className="text-xs text-slate-500">{pasteHosts.length} hosts detected</span>}
          </div>

          {/* Username + Port */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">
                Username{pasteAuth === 'kerberos' ? ' (optional — user@REALM)' : ''}
              </label>
              <input value={pasteUser} onChange={(e) => setPasteUser(e.target.value)} className={inputCls}
                placeholder={pasteAuth === 'kerberos' ? 'user@REALM' : pasteAuth === 'winrm' ? 'DOMAIN\\user' : 'root'} />
            </div>
            {(pasteAuth === 'key' || pasteAuth === 'password') && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">Port</label>
                <input type="number" value={pastePort} onChange={(e) => setPastePort(Number(e.target.value))} className={inputCls} />
              </div>
            )}
          </div>

          {/* Name prefix */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-slate-400">Name prefix (optional)</label>
            <input value={pastePrefix} onChange={(e) => setPastePrefix(e.target.value)} className={inputCls} placeholder="prod-" />
          </div>

          {/* Connection method */}
          <div className="flex flex-col gap-2">
            <label className="text-xs text-slate-400">Connection method</label>
            <div className="grid grid-cols-2 gap-1.5">
              {connectionOpts.map((opt) => (
                <label key={opt.value} className="flex items-start gap-1.5 cursor-pointer p-2 rounded border border-slate-700 hover:border-slate-500 transition-colors">
                  <input type="radio" checked={pasteAuth === opt.value} onChange={() => setPasteAuth(opt.value)} className="accent-blue-500 mt-0.5 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-300">{opt.label}</span>
                    {opt.note && <span className="text-[10px] text-slate-500">{opt.note}</span>}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {pasteAuth === 'key' && (
            <input value={pasteKey} onChange={(e) => setPasteKey(e.target.value)} className={inputCls} placeholder="~/.ssh/id_rsa" />
          )}
          {pasteAuth === 'password' && (
            <input type="password" value={pastePassword} onChange={(e) => setPastePassword(e.target.value)} className={inputCls} autoComplete="new-password" />
          )}
          {pasteAuth === 'winrm' && (
            <input type="password" value={pastePassword} onChange={(e) => setPastePassword(e.target.value)} className={inputCls} placeholder="WinRM password (optional)" autoComplete="new-password" />
          )}
          {pasteAuth === 'kerberos' && (
            <div className="px-3 py-2 bg-blue-900/20 border border-blue-700/30 rounded-lg text-xs text-blue-300">
              Ansible will use the active Kerberos ticket. Run <code>kinit user@REALM</code> on the control node before executing.
            </div>
          )}

          {/* Ansible inventory — only for ansible script type */}
          {scriptType === 'ansible' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Ansible inventory (optional)</label>
              <select value={pasteInventory} onChange={(e) => setPasteInventory(e.target.value)} className={inputCls + ' text-sm'}>
                <option value="">— none / set per-machine —</option>
                {inventories.map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.is_ephemeral ? '[E] ' : ''}{inv.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Bastion / Jump Host — always available */}
          <div className="border border-slate-700 rounded-lg p-3 flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input type="checkbox" checked={useBastion} onChange={(e) => setUseBastion(e.target.checked)} className="accent-purple-500" />
              🔗 Via Jump Host (Bastion)
            </label>
            {useBastion && (
              <div className="flex flex-col gap-2 pt-1">
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Bastion host</label>
                    <input value={bastionHost} onChange={(e) => setBastionHost(e.target.value)} className={inputCls} placeholder="bastion.example.com" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Port</label>
                    <input type="number" value={bastionPort} onChange={(e) => setBastionPort(Number(e.target.value))} className={inputCls} />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Bastion username</label>
                  <input value={bastionUser} onChange={(e) => setBastionUser(e.target.value)} className={inputCls} placeholder="ec2-user" />
                </div>
                <div className="flex gap-3">
                  {(['key', 'password'] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                      <input type="radio" checked={bastionAuth === m} onChange={() => setBastionAuth(m)} className="accent-purple-500" />
                      {m === 'key' ? 'SSH Key' : 'Password'}
                    </label>
                  ))}
                </div>
                {bastionAuth === 'key' ? (
                  <input value={bastionKey} onChange={(e) => setBastionKey(e.target.value)} className={inputCls} placeholder="~/.ssh/bastion_key" />
                ) : (
                  <input type="password" value={bastionPassword} onChange={(e) => setBastionPassword(e.target.value)} className={inputCls} autoComplete="new-password" />
                )}
              </div>
            )}
          </div>

          {importError && <p className="text-red-400 text-xs">{importError}</p>}
          {importSuccess && <p className="text-emerald-400 text-xs">{importSuccess}</p>}
          <button onClick={() => void handleBulkImport()}
            disabled={!pasteHosts.length || importing || disabled}
            className="py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium">
            {importing ? 'Importing...' : `Import ${pasteHosts.length} host${pasteHosts.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
