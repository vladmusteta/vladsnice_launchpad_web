import type { Machine, Environment, AnsibleInventory, TreeNode, HistoryEntry, LogFile, ParsedInventory, WireGuardConfig, WireGuardStatus } from './types'

const BASE = '/api'

export async function fetchScriptsTree(envId = ''): Promise<TreeNode> {
  const qs = envId ? `?env_id=${encodeURIComponent(envId)}` : ''
  const res = await fetch(`${BASE}/scripts/tree${qs}`)
  if (!res.ok) throw new Error('Failed to fetch scripts tree')
  return res.json() as Promise<TreeNode>
}

export async function fetchEnvironments(): Promise<Environment[]> {
  const res = await fetch(`${BASE}/environments`)
  if (!res.ok) throw new Error('Failed to fetch environments')
  const data = await res.json() as { environments: Environment[] }
  return data.environments
}

export async function createEnvironment(env: Omit<Environment, 'id'>): Promise<Environment> {
  const res = await fetch(`${BASE}/environments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(env),
  })
  if (!res.ok) throw new Error('Failed to create environment')
  return res.json() as Promise<Environment>
}

export async function deleteEnvironment(id: string): Promise<void> {
  await fetch(`${BASE}/environments/${id}`, { method: 'DELETE' })
}

export async function fetchInventories(envId = ''): Promise<AnsibleInventory[]> {
  const qs = envId ? `?env_id=${encodeURIComponent(envId)}` : ''
  const res = await fetch(`${BASE}/inventories${qs}`)
  if (!res.ok) throw new Error('Failed to fetch inventories')
  const data = await res.json() as { inventories: AnsibleInventory[] }
  return data.inventories
}

export async function createInventory(inv: Omit<AnsibleInventory, 'id'>): Promise<AnsibleInventory> {
  const res = await fetch(`${BASE}/inventories`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv),
  })
  if (!res.ok) throw new Error('Failed to create inventory')
  return res.json() as Promise<AnsibleInventory>
}

export async function updateInventory(inv: AnsibleInventory): Promise<AnsibleInventory> {
  const res = await fetch(`${BASE}/inventories/${inv.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inv),
  })
  if (!res.ok) throw new Error('Failed to update inventory')
  return res.json() as Promise<AnsibleInventory>
}

export async function deleteInventory(id: string): Promise<void> {
  await fetch(`${BASE}/inventories/${id}`, { method: 'DELETE' })
}

export async function fetchMachines(): Promise<Machine[]> {
  const res = await fetch(`${BASE}/machines`)
  if (!res.ok) throw new Error('Failed to fetch machines')
  const data = await res.json() as { machines: Machine[] }
  return data.machines
}

export async function createMachine(m: Omit<Machine, 'id'>): Promise<Machine> {
  const res = await fetch(`${BASE}/machines`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m),
  })
  if (!res.ok) throw new Error('Failed to create machine')
  return res.json() as Promise<Machine>
}

export async function updateMachine(m: Machine): Promise<Machine> {
  const res = await fetch(`${BASE}/machines/${m.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(m),
  })
  if (!res.ok) throw new Error('Failed to update machine')
  return res.json() as Promise<Machine>
}

export async function deleteMachine(id: string): Promise<void> {
  await fetch(`${BASE}/machines/${id}`, { method: 'DELETE' })
}

export async function bulkImportMachines(payload: {
  hosts: string[]
  username: string
  port?: number
  auth_method?: string
  key_path?: string
  password?: string
  name_prefix?: string
  environment_id?: string
}): Promise<Machine[]> {
  return bulkImportMachinesWithJump(payload)
}

interface JumpHopPayload { host: string; port: number; username: string; auth_method: string; key_path?: string; password?: string }

export async function bulkImportMachinesWithJump(payload: {
  hosts: string[]
  username: string
  port?: number
  auth_method?: string
  key_path?: string
  password?: string
  name_prefix?: string
  environment_id?: string
  use_ansible?: boolean
  ansible_inventory?: string
  /** Ordered chain of jump hosts (first = nearest, last connects to target) */
  jump_hosts?: JumpHopPayload[]
  /** legacy single hop, kept for compat */
  jump_host?: JumpHopPayload | null
}): Promise<Machine[]> {
  const res = await fetch(`${BASE}/machines/bulk`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Failed to bulk import')
  }
  const data = await res.json() as { created: Machine[] }
  return data.created
}

export async function saveLogs(
  lines: string[],
  script: string,
  use_ansible: boolean,
  envId = '',
): Promise<{ path: string; filename: string }> {
  const res = await fetch(`${BASE}/logs/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lines, script, use_ansible, env_id: envId }),
  })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Failed to save logs')
  }
  return res.json() as Promise<{ path: string; filename: string }>
}

export interface RunParams {
  script: string
  machine_id?: string
  args?: string
  inventory_id?: string
  ephemeral_hosts?: string[]
  envId?: string
  // Inline connection (used when machine_id is omitted)
  host?: string
  port?: number
  username?: string
  auth_method?: string
  key_path?: string
  password?: string
}

export async function startRun(p: RunParams): Promise<string> {
  const res = await fetch(`${BASE}/run`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script: p.script,
      machine_id: p.machine_id ?? '',
      args: p.args ?? '',
      inventory_id: p.inventory_id ?? '',
      ephemeral_hosts: p.ephemeral_hosts ?? [],
      environment_id: p.envId ?? '',
      host: p.host ?? '',
      port: p.port ?? 22,
      username: p.username ?? '',
      auth_method: p.auth_method ?? 'key',
      key_path: p.key_path ?? null,
      password: p.password ?? null,
    }),
  })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Failed to start run')
  }
  const data = await res.json() as { run_id: string }
  return data.run_id
}

export async function fetchHistory(envId = ''): Promise<HistoryEntry[]> {
  const qs = envId ? `?env_id=${encodeURIComponent(envId)}` : ''
  const res = await fetch(`${BASE}/history${qs}`)
  if (!res.ok) throw new Error('Failed to fetch history')
  const data = await res.json() as { history: HistoryEntry[] }
  return data.history
}

export async function clearHistory(envId = ''): Promise<void> {
  const qs = envId ? `?env_id=${encodeURIComponent(envId)}` : ''
  await fetch(`${BASE}/history${qs}`, { method: 'DELETE' })
}

export async function fetchLogFiles(envId = ''): Promise<LogFile[]> {
  const qs = envId ? `?env_id=${encodeURIComponent(envId)}` : ''
  const res = await fetch(`${BASE}/logs/list${qs}`)
  if (!res.ok) throw new Error('Failed to fetch log files')
  const data = await res.json() as { files: LogFile[] }
  return data.files
}

export async function readLogFile(path: string): Promise<string> {
  const res = await fetch(`${BASE}/logs/content?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error('Failed to read log file')
  const data = await res.json() as { content: string }
  return data.content
}

export async function deleteLogFile(path: string): Promise<void> {
  await fetch(`${BASE}/logs/file?path=${encodeURIComponent(path)}`, { method: 'DELETE' })
}

export async function stopRun(runId: string): Promise<void> {
  await fetch(`${BASE}/runs/${runId}/cancel`, { method: 'POST' })
}

export async function fetchScriptContent(path: string, envId = ''): Promise<{ content: string; name: string; path: string }> {
  const envQs = envId ? `&env_id=${encodeURIComponent(envId)}` : ''
  const res = await fetch(`${BASE}/scripts/content?path=${encodeURIComponent(path)}${envQs}`)
  if (!res.ok) throw new Error('Failed to fetch script content')
  return res.json() as Promise<{ content: string; name: string; path: string }>
}

export async function parseInventoryContent(content: string): Promise<ParsedInventory> {
  const res = await fetch(`${BASE}/inventories/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) throw new Error('Failed to parse inventory')
  return res.json() as Promise<ParsedInventory>
}

export async function saveScriptContent(path: string, content: string, envId = ''): Promise<void> {
  const res = await fetch(`${BASE}/scripts/content`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, content, env_id: envId }),
  })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Failed to save script')
  }
}

// ── WireGuard ─────────────────────────────────────────────────────────────────
export async function fetchWireGuardConfigs(): Promise<WireGuardConfig[]> {
  const res = await fetch(`${BASE}/wireguard`)
  if (!res.ok) throw new Error('Failed to fetch WireGuard configs')
  const data = await res.json() as { configs: WireGuardConfig[] }
  return data.configs
}

export async function createWireGuardConfig(cfg: Omit<WireGuardConfig, 'id'>): Promise<WireGuardConfig> {
  const res = await fetch(`${BASE}/wireguard`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error('Failed to create config')
  return res.json() as Promise<WireGuardConfig>
}

export async function updateWireGuardConfig(cfg: WireGuardConfig): Promise<WireGuardConfig> {
  const res = await fetch(`${BASE}/wireguard/${cfg.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error('Failed to update config')
  return res.json() as Promise<WireGuardConfig>
}

export async function deleteWireGuardConfig(id: string): Promise<void> {
  await fetch(`${BASE}/wireguard/${id}`, { method: 'DELETE' })
}

export async function getWireGuardStatus(id: string): Promise<WireGuardStatus> {
  const res = await fetch(`${BASE}/wireguard/${id}/status`)
  if (!res.ok) throw new Error('Status check failed')
  return res.json() as Promise<WireGuardStatus>
}

export async function connectWireGuard(id: string): Promise<{ ok: boolean; output?: string; exit_code?: number }> {
  const res = await fetch(`${BASE}/wireguard/${id}/connect`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Connect failed')
  }
  return res.json() as Promise<{ ok: boolean; output?: string; exit_code?: number }>
}

export async function disconnectWireGuard(id: string): Promise<{ ok: boolean; output?: string; exit_code?: number }> {
  const res = await fetch(`${BASE}/wireguard/${id}/disconnect`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Disconnect failed')
  }
  return res.json() as Promise<{ ok: boolean; output?: string; exit_code?: number }>
}

export async function generateWireGuardKeys(): Promise<{ private_key: string; public_key: string }> {
  const res = await fetch(`${BASE}/wireguard/genkeys`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Key generation failed')
  }
  return res.json() as Promise<{ private_key: string; public_key: string }>
}

// ── Machine SSH test ──────────────────────────────────────────────────────────
export async function testMachineConnection(
  id: string,
): Promise<{ ok: boolean | null; latency_ms?: number; error?: string; message?: string }> {
  const res = await fetch(`${BASE}/machines/${id}/test`, { method: 'POST' })
  if (!res.ok) throw new Error('Request failed')
  return res.json() as Promise<{ ok: boolean | null; latency_ms?: number; error?: string; message?: string }>
}

// ── Script upload ─────────────────────────────────────────────────────────────
export async function uploadScript(
  file: File,
  folder: string,
  envId = '',
): Promise<{ ok: boolean; path: string; name: string }> {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('folder', folder)
  fd.append('env_id', envId)
  const res = await fetch(`${BASE}/scripts/upload`, { method: 'POST', body: fd })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Upload failed')
  }
  return res.json() as Promise<{ ok: boolean; path: string; name: string }>
}

// ── Multi-machine run ─────────────────────────────────────────────────────────
export async function startMultiRun(payload: {
  script: string
  machine_ids: string[]
  args?: string
  environment_id?: string
}): Promise<{ runs: { run_id: string; machine_id: string; machine_name: string }[] }> {
  const res = await fetch(`${BASE}/run/multi`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      script: payload.script,
      machine_ids: payload.machine_ids,
      args: payload.args ?? '',
      environment_id: payload.environment_id ?? '',
    }),
  })
  if (!res.ok) {
    const body = await res.json() as { detail?: string }
    throw new Error(body.detail ?? 'Multi-run failed')
  }
  return res.json() as Promise<{ runs: { run_id: string; machine_id: string; machine_name: string }[] }>
}

// ── Schedules ─────────────────────────────────────────────────────────────────
export interface ScheduleEntry {
  id: string
  name: string
  script: string
  machine_id: string
  args: string
  environment_id: string
  cron_hour: number
  cron_minute: number
  enabled: boolean
  last_run: string
}

export async function fetchSchedules(): Promise<ScheduleEntry[]> {
  const res = await fetch(`${BASE}/schedules`)
  if (!res.ok) throw new Error('Failed to fetch schedules')
  const data = await res.json() as { schedules: ScheduleEntry[] }
  return data.schedules
}

export async function createSchedule(s: Omit<ScheduleEntry, 'id'>): Promise<ScheduleEntry> {
  const res = await fetch(`${BASE}/schedules`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
  })
  if (!res.ok) throw new Error('Failed to create schedule')
  return res.json() as Promise<ScheduleEntry>
}

export async function updateSchedule(s: ScheduleEntry): Promise<ScheduleEntry> {
  const res = await fetch(`${BASE}/schedules/${s.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s),
  })
  if (!res.ok) throw new Error('Failed to update schedule')
  return res.json() as Promise<ScheduleEntry>
}

export async function deleteSchedule(id: string): Promise<void> {
  await fetch(`${BASE}/schedules/${id}`, { method: 'DELETE' })
}
