import { useState, useEffect, useCallback } from 'react'
import type { WireGuardConfig, WireGuardStatus } from '../types'
import {
  fetchWireGuardConfigs, createWireGuardConfig, updateWireGuardConfig,
  deleteWireGuardConfig, getWireGuardStatus, connectWireGuard,
  disconnectWireGuard, generateWireGuardKeys,
} from '../api'

const EMPTY_PEER = { public_key: '', endpoint: '', allowed_ips: '0.0.0.0/0, ::/0', preshared_key: '', persistent_keepalive: 25 }
const EMPTY_FORM: Omit<WireGuardConfig, 'id'> = { name: '', private_key: '', address: '', dns: '', peer: EMPTY_PEER }

const inputCls = 'bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm ' +
  'focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent w-full'

function buildConf(cfg: Omit<WireGuardConfig, 'id'>): string {
  const p = cfg.peer
  const lines: string[] = ['[Interface]']
  if (cfg.private_key) lines.push(`PrivateKey = ${cfg.private_key}`)
  if (cfg.address) lines.push(`Address = ${cfg.address}`)
  if (cfg.dns) lines.push(`DNS = ${cfg.dns}`)
  lines.push('', '[Peer]')
  if (p.public_key) lines.push(`PublicKey = ${p.public_key}`)
  if (p.preshared_key) lines.push(`PresharedKey = ${p.preshared_key}`)
  if (p.endpoint) lines.push(`Endpoint = ${p.endpoint}`)
  if (p.allowed_ips) lines.push(`AllowedIPs = ${p.allowed_ips}`)
  if (p.persistent_keepalive) lines.push(`PersistentKeepalive = ${p.persistent_keepalive}`)
  return lines.join('\n') + '\n'
}

function sanitizeIface(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 15)
}

function CmdBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-slate-500 font-medium uppercase tracking-wider">{label}</span>
        <button
          onClick={async () => { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          className="text-[10px] text-slate-600 hover:text-slate-300 border border-slate-700/50 px-1.5 py-0.5 rounded transition-colors"
        >{copied ? 'copied' : 'copy'}</button>
      </div>
      <pre className="bg-slate-900 border border-slate-700/50 rounded-lg p-3 text-[11px] font-mono text-slate-300 overflow-x-auto whitespace-pre leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

export default function WireGuardPanel() {
  const [configs, setConfigs] = useState<WireGuardConfig[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Omit<WireGuardConfig, 'id'>>(EMPTY_FORM)
  const [status, setStatus] = useState<WireGuardStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [cmdOs, setCmdOs] = useState<'linux' | 'windows'>('linux')
  const [connecting, setConnecting] = useState(false)
  const [connectOutput, setConnectOutput] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confCopied, setConfCopied] = useState(false)

  const load = useCallback(async () => {
    try { setConfigs(await fetchWireGuardConfigs()) } catch { /* ignore */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const selected = configs.find(c => c.id === selectedId)

  const refreshStatus = useCallback(async (id: string) => {
    setStatusLoading(true)
    try { setStatus(await getWireGuardStatus(id)) } catch { setStatus(null) }
    finally { setStatusLoading(false) }
  }, [])

  useEffect(() => {
    if (!selectedId || editing) { setStatus(null); return }
    void refreshStatus(selectedId)
    const t = setInterval(() => void refreshStatus(selectedId), 6000)
    return () => clearInterval(t)
  }, [selectedId, editing, refreshStatus])

  function startNew() {
    setSelectedId(null); setForm(EMPTY_FORM); setEditing(true); setError(''); setConnectOutput('')
  }
  function startEdit(cfg: WireGuardConfig) {
    setForm({ name: cfg.name, private_key: cfg.private_key, address: cfg.address, dns: cfg.dns, peer: { ...cfg.peer } })
    setEditing(true); setError('')
  }
  function cancelEdit() { setEditing(false); setError('') }

  const set = (k: keyof Omit<WireGuardConfig, 'id' | 'peer'>, v: string) =>
    setForm(p => ({ ...p, [k]: v }))
  const setPeer = (k: keyof WireGuardConfig['peer'], v: string | number) =>
    setForm(p => ({ ...p, peer: { ...p.peer, [k]: v } }))

  async function handleSave() {
    if (!form.name.trim()) { setError('Name is required'); return }
    setSaving(true); setError('')
    try {
      if (selectedId) {
        const updated = await updateWireGuardConfig({ ...form, id: selectedId })
        setConfigs(p => p.map(c => c.id === selectedId ? updated : c))
      } else {
        const created = await createWireGuardConfig(form)
        setConfigs(p => [...p, created])
        setSelectedId(created.id)
      }
      setEditing(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  async function handleDelete() {
    if (!selectedId || !confirm(`Delete "${selected?.name}"?`)) return
    await deleteWireGuardConfig(selectedId)
    setConfigs(p => p.filter(c => c.id !== selectedId))
    setSelectedId(null); setEditing(false)
  }

  async function handleConnect() {
    if (!selectedId) return
    setConnecting(true); setConnectOutput('')
    try {
      const r = await connectWireGuard(selectedId)
      setConnectOutput(r.output ?? (r.ok ? 'Connected.' : 'Failed.'))
      void refreshStatus(selectedId)
    } catch (e) { setConnectOutput(e instanceof Error ? e.message : 'Error') }
    finally { setConnecting(false) }
  }

  async function handleDisconnect() {
    if (!selectedId) return
    setConnecting(true); setConnectOutput('')
    try {
      const r = await disconnectWireGuard(selectedId)
      setConnectOutput(r.output ?? (r.ok ? 'Disconnected.' : 'Failed.'))
      void refreshStatus(selectedId)
    } catch (e) { setConnectOutput(e instanceof Error ? e.message : 'Error') }
    finally { setConnecting(false) }
  }

  async function handleGenKeys() {
    setGenLoading(true)
    try {
      const keys = await generateWireGuardKeys()
      setForm(p => ({ ...p, private_key: keys.private_key }))
    } catch (e) { setError(e instanceof Error ? e.message : 'Key generation failed') }
    finally { setGenLoading(false) }
  }

  async function copyConf() {
    if (!selected) return
    await navigator.clipboard.writeText(buildConf(selected))
    setConfCopied(true); setTimeout(() => setConfCopied(false), 2000)
  }

  const iface = selected ? sanitizeIface(selected.name) : ''
  const confContent = selected ? buildConf(selected) : ''

  const linuxCmds = iface ? {
    connect: `# Save config file\nsudo mkdir -p /etc/wireguard\nsudo tee /etc/wireguard/${iface}.conf << 'EOF'\n${confContent}EOF\nsudo chmod 600 /etc/wireguard/${iface}.conf\n\n# Connect\nsudo wg-quick up ${iface}`,
    status:  `sudo wg show ${iface}`,
    disconnect: `sudo wg-quick down ${iface}`,
    autostart:  `sudo systemctl enable --now wg-quick@${iface}`,
    delete:  `sudo wg-quick down ${iface}\nsudo rm /etc/wireguard/${iface}.conf`,
  } : null

  const winCmds = iface ? {
    install: `# Download WireGuard from wireguard.com/install\n# Then save the config as ${iface}.conf and run:`,
    connect: `wireguard.exe /installtunnel "${iface}.conf"\n# Tunnel activates automatically after import\n# Or use the WireGuard GUI to import and activate`,
    status:  `# Check status in the WireGuard GUI\n# Or via PowerShell (requires wg in PATH):\nwg show ${iface}`,
    disconnect: `wireguard.exe /uninstalltunnel ${iface}`,
    delete:  `wireguard.exe /uninstalltunnel ${iface}\nRemove-Item "${iface}.conf"`,
  } : null

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: config list */}
      <div className="w-52 shrink-0 border-r border-slate-800 flex flex-col">
        <div className="shrink-0 px-3 pt-3 pb-2 border-b border-slate-800 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">VPN / WireGuard</span>
          <button onClick={startNew} className="w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-200 hover:bg-slate-700 transition-colors text-lg leading-none" title="New config">+</button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
          {configs.length === 0 && (
            <p className="text-xs text-slate-600 italic p-2">No configs yet. Click + to add one.</p>
          )}
          {configs.map(cfg => (
            <button key={cfg.id}
              onClick={() => { setSelectedId(cfg.id); setEditing(false); setConnectOutput('') }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                ${selectedId === cfg.id && !editing
                  ? 'bg-emerald-900/30 text-emerald-300 border border-emerald-700/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'}`}
            >
              <div className="font-medium truncate">{cfg.name}</div>
              <div className="text-[10px] text-slate-600 truncate">{cfg.peer.endpoint || 'no endpoint set'}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Right: detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {editing ? (
          /* ── Edit / Create form ── */
          <div className="p-5 flex flex-col gap-4 max-w-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-300">{selectedId ? `Edit — ${selected?.name}` : 'New WireGuard config'}</h2>
              {error && <span className="text-xs text-red-400">{error}</span>}
            </div>

            {/* Interface */}
            <div className="border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">[Interface]</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Name <span className="text-slate-600">(interface name, max 15 chars)</span></label>
                  <input value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} placeholder="vpn-home" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Client IP / CIDR</label>
                  <input value={form.address} onChange={e => set('address', e.target.value)} className={inputCls} placeholder="10.0.0.2/24" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs text-slate-400">Private Key</label>
                    <button onClick={() => void handleGenKeys()} disabled={genLoading}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 border border-emerald-700/40 px-1.5 py-0.5 rounded disabled:opacity-50 transition-colors">
                      {genLoading ? 'Generating...' : 'Generate on server'}
                    </button>
                  </div>
                  <input value={form.private_key} onChange={e => set('private_key', e.target.value)} className={inputCls} placeholder="base64 private key" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">DNS <span className="text-slate-600">(optional)</span></label>
                  <input value={form.dns} onChange={e => set('dns', e.target.value)} className={inputCls} placeholder="1.1.1.1" />
                </div>
              </div>
            </div>

            {/* Peer */}
            <div className="border border-slate-700/60 rounded-xl p-4 flex flex-col gap-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">[Peer] — Server</span>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Server Public Key</label>
                  <input value={form.peer.public_key} onChange={e => setPeer('public_key', e.target.value)} className={inputCls} placeholder="base64 server public key" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Endpoint <span className="text-slate-600">(host:port)</span></label>
                  <input value={form.peer.endpoint} onChange={e => setPeer('endpoint', e.target.value)} className={inputCls} placeholder="vpn.example.com:51820" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Allowed IPs</label>
                  <input value={form.peer.allowed_ips} onChange={e => setPeer('allowed_ips', e.target.value)} className={inputCls} placeholder="0.0.0.0/0, ::/0" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-400">Preshared Key <span className="text-slate-600">(optional)</span></label>
                  <input type="password" value={form.peer.preshared_key} onChange={e => setPeer('preshared_key', e.target.value)} className={inputCls} placeholder="optional" autoComplete="new-password" />
                </div>
              </div>
              <div className="flex flex-col gap-1" style={{ maxWidth: '180px' }}>
                <label className="text-xs text-slate-400">Persistent Keepalive (sec)</label>
                <input type="number" value={form.peer.persistent_keepalive} onChange={e => setPeer('persistent_keepalive', Number(e.target.value))} className={inputCls} />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => void handleSave()} disabled={saving}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm rounded-lg disabled:opacity-50 font-medium transition-colors">
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button onClick={cancelEdit}
                className="px-4 py-2 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-slate-200 text-sm rounded-lg transition-colors">
                Cancel
              </button>
              {selectedId && (
                <button onClick={() => void handleDelete()}
                  className="ml-auto px-4 py-2 border border-red-800/50 hover:border-red-600 text-red-400 hover:text-red-300 text-sm rounded-lg transition-colors">
                  Delete config
                </button>
              )}
            </div>
          </div>

        ) : selected ? (
          /* ── View mode ── */
          <div className="p-5 flex flex-col gap-5">
            {/* Header */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-slate-200">{selected.name}</h2>
                <span className={`text-xs px-2 py-0.5 rounded border font-medium
                  ${statusLoading
                    ? 'text-slate-500 border-slate-700/40 bg-slate-800/30'
                    : status?.connected
                    ? 'text-emerald-300 border-emerald-700/40 bg-emerald-900/30'
                    : 'text-slate-500 border-slate-700/40 bg-slate-800/30'}`}
                >
                  {statusLoading ? 'checking...' : status?.connected ? 'connected' : 'not connected'}
                </span>
                {(status?.error || status?.stderr) && (
                  <span className="text-[11px] text-red-400">{status.error ?? status.stderr}</span>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(selected)}
                  className="text-xs text-slate-500 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2 py-1 rounded transition-colors">
                  Edit
                </button>
                {status?.connected ? (
                  <button onClick={() => void handleDisconnect()} disabled={connecting}
                    className="text-xs text-red-400 hover:text-red-300 border border-red-800/50 hover:border-red-700 px-3 py-1 rounded transition-colors disabled:opacity-50">
                    {connecting ? 'Disconnecting...' : 'Disconnect'}
                  </button>
                ) : (
                  <button onClick={() => void handleConnect()} disabled={connecting}
                    className="text-xs text-emerald-400 hover:text-emerald-300 border border-emerald-700/50 hover:border-emerald-600 px-3 py-1 rounded transition-colors disabled:opacity-50">
                    {connecting ? 'Connecting...' : 'Connect on server'}
                  </button>
                )}
              </div>
            </div>

            {/* Live status cards */}
            {status?.connected && status.peer && Object.keys(status.peer).length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                {status.peer.endpoint && (
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-4 py-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Peer external IP</div>
                    <div className="text-sm text-slate-200 font-mono">{status.peer.endpoint}</div>
                  </div>
                )}
                {status.peer.allowed_ips && (
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-4 py-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Peer WireGuard IP</div>
                    <div className="text-sm text-slate-200 font-mono">{status.peer.allowed_ips}</div>
                  </div>
                )}
                {status.peer.latest_handshake && (
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-4 py-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Last handshake</div>
                    <div className="text-sm text-slate-200">{status.peer.latest_handshake}</div>
                  </div>
                )}
                {status.peer.transfer && (
                  <div className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-4 py-3">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Transfer</div>
                    <div className="text-sm text-slate-200">{status.peer.transfer}</div>
                  </div>
                )}
              </div>
            )}

            {/* Connect/disconnect output */}
            {connectOutput && (
              <pre className="text-[11px] font-mono bg-slate-900 border border-slate-700 rounded-xl p-3 text-slate-300 max-h-36 overflow-auto whitespace-pre-wrap">
                {connectOutput}
              </pre>
            )}

            {/* .conf file */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">{iface}.conf</span>
                <button onClick={() => void copyConf()}
                  className="text-xs text-slate-500 hover:text-slate-200 border border-slate-700 hover:border-slate-500 px-2 py-0.5 rounded transition-colors">
                  {confCopied ? 'Copied!' : 'Copy config'}
                </button>
              </div>
              <pre className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-[11px] font-mono text-slate-300 leading-relaxed whitespace-pre">
                {confContent}
              </pre>
            </div>

            {/* Commands */}
            <div className="flex flex-col gap-3">
              <div className="flex gap-1 border-b border-slate-800 pb-2">
                <button onClick={() => setCmdOs('linux')}
                  className={'text-xs px-3 py-1.5 rounded transition-colors ' +
                    (cmdOs === 'linux' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}>
                  Linux
                </button>
                <button onClick={() => setCmdOs('windows')}
                  className={'text-xs px-3 py-1.5 rounded transition-colors ' +
                    (cmdOs === 'windows' ? 'bg-slate-700 text-slate-200' : 'text-slate-500 hover:text-slate-300')}>
                  Windows
                </button>
              </div>

              {cmdOs === 'linux' && linuxCmds && (
                <div className="flex flex-col gap-4">
                  <CmdBlock label="Install WireGuard (if needed)" code="# Debian/Ubuntu\nsudo apt install wireguard\n\n# RHEL/Fedora\nsudo dnf install wireguard-tools\n\n# Arch\nsudo pacman -S wireguard-tools" />
                  <CmdBlock label="Save config and connect" code={linuxCmds.connect} />
                  <CmdBlock label="Check connection status" code={linuxCmds.status} />
                  <CmdBlock label="Disconnect" code={linuxCmds.disconnect} />
                  <CmdBlock label="Auto-connect on boot (systemd)" code={linuxCmds.autostart} />
                  <CmdBlock label="Disconnect and delete config" code={linuxCmds.delete} />
                </div>
              )}
              {cmdOs === 'windows' && winCmds && (
                <div className="flex flex-col gap-4">
                  <div className="text-xs text-slate-400 bg-slate-800/30 border border-slate-700/40 rounded-xl p-3">
                    Download WireGuard for Windows from{' '}
                    <span className="text-blue-400 font-mono">wireguard.com/install</span>.
                    {' '}Save the config (from the .conf box above) as{' '}
                    <code className="text-slate-300 bg-slate-800 px-1 rounded">{iface}.conf</code>.
                  </div>
                  <CmdBlock label="Import and connect (CMD / PowerShell)" code={winCmds.connect} />
                  <CmdBlock label="Check status" code={winCmds.status} />
                  <CmdBlock label="Disconnect" code={winCmds.disconnect} />
                  <CmdBlock label="Disconnect and delete" code={winCmds.delete} />
                </div>
              )}
            </div>
          </div>

        ) : (
          <div className="h-full flex items-center justify-center text-slate-600">
            <div className="text-center">
              <div className="text-3xl font-light mb-2">VPN</div>
              <div className="text-sm">Select a config or create a new one</div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
