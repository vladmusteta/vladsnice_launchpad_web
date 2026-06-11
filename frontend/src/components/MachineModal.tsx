import { useState } from 'react'
import type { Machine, JumpHost, Environment } from '../types'
import { createMachine, updateMachine, testMachineConnection } from '../api'

interface Props {
  machine?: Machine
  environments: Environment[]
  defaultEnvId?: string
  onSaved: (m: Machine) => void
  onClose: () => void
}

const EMPTY: Omit<Machine, 'id'> = {
  name: '', host: '', port: 22, username: '', auth_method: 'key',
  key_path: '', password: '', use_ansible: false, ansible_inventory: '',
  jump_host: null, environment_id: null, timeout_s: 10,
}

const EMPTY_JUMP: JumpHost = {
  host: '', port: 22, username: '', auth_method: 'key', key_path: '', password: '',
}

const AUTH_OPTIONS: { value: 'key' | 'password' | 'kerberos' | 'winrm'; label: string; note?: string }[] = [
  { value: 'key',      label: 'SSH Key' },
  { value: 'password', label: 'SSH Password' },
  { value: 'kerberos', label: 'Kerberos / WinRM', note: 'Ansible uses kinit ticket — no stored credentials' },
  { value: 'winrm',    label: 'WinRM (NTLM)',     note: 'Username + password, Ansible connects via WinRM' },
]

const inputCls =
  'bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-full'

function Field({ label, children, required }: {
  label: string; children: React.ReactNode; required?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-400">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

export default function MachineModal({ machine, environments, defaultEnvId, onSaved, onClose }: Props) {
  const [form, setForm] = useState<Omit<Machine, 'id'>>(
    machine ? { ...machine } : { ...EMPTY, environment_id: defaultEnvId || null }
  )
  const [showJump, setShowJump] = useState(!!(machine?.jump_host?.host))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [testResult, setTestResult] = useState<{ ok: boolean | null; latency_ms?: number; error?: string; message?: string } | null>(null)
  const [testing, setTesting] = useState(false)

  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }))

  const setJump = (partial: Partial<JumpHost>) =>
    setForm((prev) => ({ ...prev, jump_host: { ...EMPTY_JUMP, ...prev.jump_host, ...partial } }))

  function toggleJump(on: boolean) {
    setShowJump(on)
    if (!on) set('jump_host', null)
    else if (!form.jump_host?.host) set('jump_host', { ...EMPTY_JUMP })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const data = { ...form, jump_host: showJump && form.jump_host?.host ? form.jump_host : null }
      const saved = machine
        ? await updateMachine({ ...data, id: machine.id })
        : await createMachine(data)
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error saving')
    } finally {
      setSaving(false)
    }
  }

  const jump = form.jump_host ?? EMPTY_JUMP

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-md
                      max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-slate-900 border-b border-slate-800 px-6 py-4 rounded-t-xl">
          <h2 className="text-lg font-semibold text-slate-100">
            {machine ? 'Edit Machine' : 'Add Machine'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 flex flex-col gap-4">
          <Field label="Name" required>
            <input value={form.name} onChange={(e) => set('name', e.target.value)}
              className={inputCls} placeholder="production-server-1" required />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <Field label="Host / IP" required>
                <input value={form.host} onChange={(e) => set('host', e.target.value)}
                  className={inputCls} placeholder="192.168.1.10" required />
              </Field>
            </div>
            <Field label="Port">
              <input type="number" value={form.port}
                onChange={(e) => set('port', Number(e.target.value))} className={inputCls} />
            </Field>
          </div>

          <Field label="Username" required={form.auth_method !== 'kerberos'}>
            <input value={form.username} onChange={(e) => set('username', e.target.value)}
              className={inputCls}
              placeholder={form.auth_method === 'kerberos' ? 'user@REALM (optional)' : form.auth_method === 'winrm' ? 'DOMAIN\\\\user' : 'ubuntu'}
              required={form.auth_method !== 'kerberos'} />
          </Field>

          <Field label="Authentication">
            <div className="flex flex-col gap-1.5">
              {AUTH_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" checked={form.auth_method === opt.value}
                    onChange={() => set('auth_method', opt.value)}
                    className="accent-emerald-500 mt-0.5 shrink-0" />
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-300">{opt.label}</span>
                    {opt.note && <span className="text-[11px] text-slate-500">{opt.note}</span>}
                  </div>
                </label>
              ))}
            </div>
          </Field>

          {form.auth_method === 'key' && (
            <Field label="Private key path">
              <input value={form.key_path ?? ''} onChange={(e) => set('key_path', e.target.value)}
                className={inputCls} placeholder="~/.ssh/id_rsa" />
            </Field>
          )}
          {form.auth_method === 'password' && (
            <Field label="Password">
              <input type="password" value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                className={inputCls} autoComplete="new-password" />
            </Field>
          )}
          {form.auth_method === 'winrm' && (
            <Field label="WinRM password">
              <input type="password" value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                className={inputCls} autoComplete="new-password"
                placeholder="Leave empty to use Kerberos ticket" />
            </Field>
          )}
          {form.auth_method === 'kerberos' && (
            <div className="px-3 py-2 bg-blue-900/20 border border-blue-700/30 rounded-lg text-xs text-blue-300">
              Ansible will use the active Kerberos ticket from the control node (<code>kinit user@REALM</code>).
            </div>
          )}

          {environments.length > 0 && (
            <Field label="Environment">
              <select value={form.environment_id ?? ''}
                onChange={(e) => set('environment_id', e.target.value || null)}
                className={inputCls}>
                <option value="">— none —</option>
                {environments.map((env) => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            </Field>
          )}

          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" checked={form.use_ansible}
              onChange={(e) => set('use_ansible', e.target.checked)} className="accent-emerald-500" />
            Use Ansible
          </label>

          {form.use_ansible && (
            <Field label="Ansible Inventory (fallback path)">
              <input value={form.ansible_inventory ?? ''}
                onChange={(e) => set('ansible_inventory', e.target.value)}
                className={inputCls} placeholder="/etc/ansible/hosts" />
            </Field>
          )}

          {/* Jump Host */}
          <div className="border-t border-slate-700/50 pt-3">
            <Field label="SSH Timeout (seconds)">
              <input
                type="number" min={1} max={120}
                value={form.timeout_s ?? 10}
                onChange={e => set('timeout_s', Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>

          <div className="border-t border-slate-700/50 pt-3">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input type="checkbox" checked={showJump}
                onChange={(e) => toggleJump(e.target.checked)} className="accent-purple-500 w-4 h-4" />
              <span>🔗 SSH via Jump Host</span>
              <span className="text-xs text-slate-500">(bastion / proxy)</span>
            </label>

            {showJump && (
              <div className="mt-3 border border-slate-700/50 rounded-lg p-3 flex flex-col gap-3 bg-slate-800/20">
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Field label="Jump Host">
                      <input value={jump.host} onChange={(e) => setJump({ host: e.target.value })}
                        className={inputCls} placeholder="bastion.example.com" />
                    </Field>
                  </div>
                  <Field label="Port">
                    <input type="number" value={jump.port}
                      onChange={(e) => setJump({ port: Number(e.target.value) })} className={inputCls} />
                  </Field>
                </div>
                <Field label="Username">
                  <input value={jump.username} onChange={(e) => setJump({ username: e.target.value })}
                    className={inputCls} placeholder="bastion-user" />
                </Field>
                <Field label="Authentication">
                  <div className="flex gap-3">
                    {(['key', 'password'] as const).map((m) => (
                      <label key={m} className="flex items-center gap-1.5 text-sm text-slate-300 cursor-pointer">
                        <input type="radio" checked={jump.auth_method === m}
                          onChange={() => setJump({ auth_method: m })} className="accent-purple-500" />
                        {m === 'key' ? 'SSH Key' : 'Password'}
                      </label>
                    ))}
                  </div>
                </Field>
                {jump.auth_method === 'key' ? (
                  <Field label="Private Key Path">
                    <input value={jump.key_path ?? ''} onChange={(e) => setJump({ key_path: e.target.value })}
                      className={inputCls} placeholder="~/.ssh/id_rsa" />
                  </Field>
                ) : (
                  <Field label="Jump Host Password">
                    <input type="password" value={jump.password ?? ''}
                      onChange={(e) => setJump({ password: e.target.value })}
                      className={inputCls} autoComplete="new-password" />
                  </Field>
                )}
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {testResult && (
            <div className={`px-3 py-2 rounded-lg text-xs border ${
              testResult.ok === true ? 'bg-emerald-900/20 border-emerald-700/30 text-emerald-300' :
              testResult.ok === false ? 'bg-red-900/20 border-red-700/30 text-red-300' :
              'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              {testResult.ok === true && `✓ Connected — ${testResult.latency_ms}ms`}
              {testResult.ok === false && `✕ ${testResult.error}`}
              {testResult.ok === null && testResult.message}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1 border-t border-slate-800">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Cancel
            </button>
            {machine && (
              <button
                type="button"
                disabled={testing}
                onClick={async () => {
                  setTesting(true); setTestResult(null)
                  try { setTestResult(await testMachineConnection(machine.id)) }
                  catch { setTestResult({ ok: false, error: 'Request failed' }) }
                  finally { setTesting(false) }
                }}
                className="px-4 py-2 text-sm border border-slate-600 text-slate-300 hover:border-slate-400 rounded-lg disabled:opacity-50 transition-colors"
              >
                {testing ? 'Testing…' : '⚡ Test SSH'}
              </button>
            )}
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg
                         disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
