import { useState } from 'react'
import type { Machine, Environment, AnsibleInventory } from '../types'
import { deleteMachine, bulkImportMachinesWithJump } from '../api'
import MachineModal from './MachineModal'

type Tab = 'saved' | 'paste'

interface Props {
  machines: Machine[]
  environments: Environment[]
  inventories: AnsibleInventory[]
  selected: string
  envFilter: string
  onSelect: (id: string) => void
  onChanged: () => void
  disabled?: boolean
}

const inputCls =
  'bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full'

export default function MachineSelector({
  machines, environments, inventories, selected, envFilter, onSelect, onChanged, disabled,
}: Props) {
  const [tab, setTab] = useState<Tab>('saved')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Machine | undefined>()
  const [deleting, setDeleting] = useState('')

  const [pasteText, setPasteText] = useState('')
  const [pasteUser, setPasteUser] = useState('root')
  const [pastePort, setPastePort] = useState(22)
  const [pasteAuth, setPasteAuth] = useState<'key' | 'password' | 'kerberos' | 'winrm'>('key')
  const [pasteKey, setPasteKey] = useState('')
  const [pastePassword, setPastePassword] = useState('')
  const [pastePrefix, setPastePrefix] = useState('')
  const [pasteUseAnsible, setPasteUseAnsible] = useState(false)
  const [pasteInventory, setPasteInventory] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const [importSuccess, setImportSuccess] = useState('')

  const [useBastion, setUseBastion] = useState(false)
  const [bastionHost, setBastionHost] = useState('')
  const [bastionPort, setBastionPort] = useState(22)
  const [bastionUser, setBastionUser] = useState('')
  const [bastionAuth, setBastionAuth] = useState<'key' | 'password'>('key')
  const [bastionKey, setBastionKey] = useState('')
  const [bastionPassword, setBastionPassword] = useState('')

  function openAdd() { setEditing(undefined); setShowModal(true) }
  function openEdit(m: Machine) { setEditing(m); setShowModal(true) }

  async function handleDelete(m: Machine) {
    if (!confirm('Delete "' + m.name + '"?')) return
    setDeleting(m.id)
    try { await deleteMachine(m.id); onChanged() }
    finally { setDeleting('') }
  }

  const pasteHosts = pasteText.split(/[\n,;]/).map((h) => h.trim()).filter(Boolean)

  const filteredMachines = envFilter
    ? machines.filter((m) => (m as Machine & { environment_id?: string }).environment_id === envFilter)
    : machines

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
        use_ansible: pasteUseAnsible, ansible_inventory: pasteInventory || undefined,
        jump_host: jumpHost,
      })
      onChanged(); setPasteText('')
      setImportSuccess(created.length + ' machine' + (created.length !== 1 ? 's' : '') + ' imported.')
      setTab('saved')
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import error')
    } finally { setImporting(false) }
  }

  const envColor: Record<string, string> = {}
  environments.forEach((e) => { envColor[e.id] = e.color })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-3 pt-3 pb-2 border-b border-slate-800 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Target Machines</span>
        <button onClick={openAdd} disabled={disabled}
          className="w-6 h-6 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors disabled:opacity-40"
          title="Add machine">+</button>
      </div>
      <div className="shrink-0 flex border-b border-slate-800">
        {(['saved', 'paste'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={'flex-1 py-1.5 text-xs font-medium transition-colors ' +
              (tab === t ? 'text-slate-200 border-b-2 border-emerald-500' : 'text-slate-500 hover:text-slate-300')}>
            {t === 'saved' ? '📋 Saved' : '📥 Import'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {tab === 'saved' && (
          <div className="flex flex-col gap-2">
            {importSuccess && <p className="text-emerald-400 text-xs">{importSuccess}</p>}
            {filteredMachines.length === 0 ? (
              <p className="text-sm text-slate-500 italic mt-2">No machines yet.</p>
            ) : filteredMachines.map((m) => {
              const mExt = m as Machine & { environment_id?: string }
              const dot = mExt.environment_id ? envColor[mExt.environment_id] : null
              return (
                <div key={m.id} onClick={() => !disabled && onSelect(m.id)}
                  className={'flex items-center justify-between px-3 py-2 rounded-lg border cursor-pointer transition-colors text-sm ' +
                    (selected === m.id ? 'border-blue-500 bg-blue-500/10 text-blue-300' : 'border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500') +
                    (disabled ? ' pointer-events-none opacity-60' : '')}>
                  <div className="flex items-center gap-2 min-w-0">
                    {dot && <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dot }} />}
                    <div className="flex flex-col min-w-0">
                      <span className="font-medium truncate">{m.name}</span>
                      <span className="text-xs text-slate-500 truncate">
                        {m.username}@{m.host}:{m.port}
                        {m.use_ansible && ' · ansible'}
                        {m.jump_host?.host && ' · via ' + m.jump_host.host}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <button onClick={(e) => { e.stopPropagation(); openEdit(m) }}
                      className="p-1 text-slate-500 hover:text-slate-200 transition-colors" title="Edit">✏️</button>
                    <button onClick={(e) => { e.stopPropagation(); void handleDelete(m) }}
                      disabled={deleting === m.id}
                      className="p-1 text-slate-500 hover:text-red-400 transition-colors disabled:opacity-50" title="Delete">🗑️</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {tab === 'paste' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Hosts — one per line or comma/semicolon separated</label>
              <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                disabled={disabled} rows={6}
                placeholder={"192.168.1.10\n192.168.1.11\nserver-prod-3"}
                className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y placeholder-slate-600 disabled:opacity-50" />
              {pasteHosts.length > 0 && <span className="text-xs text-slate-500">{pasteHosts.length} hosts detected</span>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-400">
                  Username{(pasteAuth === 'kerberos') ? ' (optional — user@REALM)' : ''}
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
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-400">Name prefix (optional)</label>
              <input value={pastePrefix} onChange={(e) => setPastePrefix(e.target.value)} className={inputCls} placeholder="prod-" />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs text-slate-400">Connection method</label>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { value: 'key',      label: 'SSH Key' },
                  { value: 'password', label: 'SSH Password' },
                  { value: 'kerberos', label: 'Kerberos / WinRM', note: 'No credentials — uses kinit ticket' },
                  { value: 'winrm',    label: 'WinRM (NTLM)',     note: 'Username + password' },
                ] as const).map((opt) => (
                  <label key={opt.value} className="flex items-start gap-1.5 cursor-pointer p-2 rounded border border-slate-700 hover:border-slate-500 transition-colors">
                    <input type="radio" checked={pasteAuth === opt.value} onChange={() => setPasteAuth(opt.value)} className="accent-blue-500 mt-0.5 shrink-0" />
                    <div className="flex flex-col">
                      <span className="text-xs text-slate-300">{opt.label}</span>
                      {'note' in opt && <span className="text-[10px] text-slate-500">{opt.note}</span>}
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
            <div className="border border-slate-700 rounded-lg p-3 flex flex-col gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input type="checkbox" checked={pasteUseAnsible} onChange={(e) => setPasteUseAnsible(e.target.checked)} className="accent-orange-500" />
                Use Ansible for these hosts
              </label>
              {pasteUseAnsible && (
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
            </div>
            {(pasteAuth === 'key' || pasteAuth === 'password') && (
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
            )}
            {importError && <p className="text-red-400 text-xs">{importError}</p>}
            <button onClick={() => void handleBulkImport()}
              disabled={!pasteHosts.length || importing || disabled}
              className="py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium">
              {importing ? 'Importing...' : 'Import ' + pasteHosts.length + ' host' + (pasteHosts.length !== 1 ? 's' : '')}
            </button>
          </div>
        )}
      </div>
      {showModal && (
        <MachineModal machine={editing} environments={environments} onSaved={() => { setShowModal(false); onChanged() }} onClose={() => setShowModal(false)} />
      )}
    </div>
  )
}
