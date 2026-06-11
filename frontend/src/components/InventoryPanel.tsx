import { useState, useEffect } from 'react'
import type { AnsibleInventory } from '../types'
import { fetchInventories, createInventory, updateInventory, deleteInventory } from '../api'

const KERBEROS_BASE = `[all:vars]
ansible_connection = ssh
# Kerberos authentication — edit as needed:
# ansible_kerberos_keytab = /path/to/service.keytab
# ansible_user = user@REALM
# ansible_become = true
`

interface Props {
  onClose: () => void
  envId?: string
}

const inputCls =
  'bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-full'

export default function InventoryPanel({ onClose, envId = '' }: Props) {
  const [inventories, setInventories] = useState<AnsibleInventory[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<Omit<AnsibleInventory, 'id'>>({
    name: '', content: '', is_ephemeral: false, base_content: KERBEROS_BASE, description: '',
  })
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { void load() }, [])

  async function load() {
    setInventories(await fetchInventories(envId))
  }

  function selectInv(inv: AnsibleInventory) {
    setSelectedId(inv.id)
    setForm({ name: inv.name, content: inv.content, is_ephemeral: inv.is_ephemeral,
              base_content: inv.base_content || KERBEROS_BASE, description: inv.description })
    setDirty(false)
    setError('')
  }

  function newInv() {
    setSelectedId(null)
    setForm({ name: '', content: '', is_ephemeral: false, base_content: KERBEROS_BASE, description: '' })
    setDirty(true)
    setError('')
  }

  const set = (k: keyof typeof form, v: string | boolean) => {
    setForm((p) => ({ ...p, [k]: v }))
    setDirty(true)
  }

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      if (selectedId) {
        const updated = await updateInventory({ ...form, id: selectedId })
        setInventories((p) => p.map((i) => i.id === selectedId ? updated : i))
      } else {
        const created = await createInventory({ ...form, environment_id: envId || undefined })
        setInventories((p) => [...p, created])
        setSelectedId(created.id)
      }
      setDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!selectedId) return
    const inv = inventories.find((i) => i.id === selectedId)
    if (!confirm(`Delete "${inv?.name}"?`)) return
    await deleteInventory(selectedId)
    setInventories((p) => p.filter((i) => i.id !== selectedId))
    setSelectedId(null)
    setForm({ name: '', content: '', is_ephemeral: false, base_content: KERBEROS_BASE, description: '' })
    setDirty(false)
  }

  const hasContent = selectedId !== null || dirty

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-4xl h-[82vh]
                      flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800 shrink-0">
          <h2 className="font-semibold text-slate-100 flex items-center gap-2">
            Ansible Inventories
          </h2>
          <button onClick={onClose}
            className="text-slate-400 hover:text-slate-200 transition-colors text-xl leading-none w-8 h-8 flex items-center justify-center">
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0">
          {/* Left: list */}
          <div className="w-52 shrink-0 border-r border-slate-800 flex flex-col">
            <div className="p-2 border-b border-slate-800">
              <button onClick={newInv}
                className="w-full text-xs py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300
                           rounded-lg border border-slate-700 transition-colors">
                + New Inventory
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {inventories.map((inv) => (
                <button key={inv.id} onClick={() => selectInv(inv)}
                  className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-start gap-2
                              ${selectedId === inv.id
                      ? 'bg-slate-800 text-slate-100'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
                >
                  <span className="shrink-0 mt-0.5 text-xs text-slate-500">{inv.is_ephemeral ? '[E]' : ''}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{inv.name}</div>
                    {inv.description && (
                      <div className="truncate text-[10px] text-slate-600">{inv.description}</div>
                    )}
                  </div>
                </button>
              ))}
              {inventories.length === 0 && (
                <p className="text-xs text-slate-600 px-3 py-2 italic">No inventories yet</p>
              )}
            </div>
          </div>

          {/* Right: editor */}
          <div className="flex-1 flex flex-col min-h-0 p-4 gap-3 overflow-y-auto">
            {hasContent ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Name *</label>
                    <input value={form.name} onChange={(e) => set('name', e.target.value)}
                      className={inputCls} placeholder="Production servers" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-slate-400">Description</label>
                    <input value={form.description} onChange={(e) => set('description', e.target.value)}
                      className={inputCls} placeholder="optional" />
                  </div>
                </div>

                {/* Type toggle */}
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                  <input type="checkbox" checked={form.is_ephemeral}
                    onChange={(e) => set('is_ephemeral', e.target.checked)}
                    className="accent-orange-500 w-4 h-4" />
                  <span>Ephemeral inventory</span>
                  <span className="text-xs text-slate-500">
                    — always empty; hosts are injected per run, then cleared
                  </span>
                </label>

                {/* Content editor */}
                {form.is_ephemeral ? (
                  <div className="flex flex-col gap-1 flex-1 min-h-0">
                    <label className="text-xs text-slate-400">
                      Base content
                      <span className="ml-2 text-slate-600 font-normal">
                        (Kerberos vars, group_vars, connection settings — persisted; hosts are added per-run only)
                      </span>
                    </label>
                    <textarea
                      value={form.base_content}
                      onChange={(e) => set('base_content', e.target.value)}
                      className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2
                                 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500
                                 resize-none flex-1 min-h-[220px]"
                      spellCheck={false}
                    />
                    <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2 text-xs
                                    text-slate-500 font-mono">
                      <span className="text-slate-600"># Added automatically at run time:</span>
                      {'\n'}[targets]{'\n'}{'<host1>'}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1 flex-1 min-h-0">
                    <label className="text-xs text-slate-400">Inventory content (INI format)</label>
                    <textarea
                      value={form.content}
                      onChange={(e) => set('content', e.target.value)}
                      className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2
                                 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500
                                 resize-none flex-1 min-h-[240px]"
                      placeholder={`[all]\nserver1 ansible_host=192.168.1.10\nserver2 ansible_host=192.168.1.11\n\n[all:vars]\nansible_user=ubuntu`}
                      spellCheck={false}
                    />
                  </div>
                )}

                {error && <p className="text-red-400 text-sm">{error}</p>}

                <div className="flex justify-between items-center pt-1 border-t border-slate-800 shrink-0">
                  {selectedId ? (
                    <button onClick={() => void handleDelete()}
                      className="text-sm text-slate-600 hover:text-red-400 transition-colors px-2">
                      Delete
                    </button>
                  ) : <div />}
                  <button
                    onClick={() => void handleSave()}
                    disabled={saving || !dirty}
                    className="px-4 py-1.5 text-sm bg-emerald-600 hover:bg-emerald-500 text-white
                               rounded-lg disabled:opacity-50 transition-colors"
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-slate-600 text-sm italic">Select an inventory or create a new one</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
