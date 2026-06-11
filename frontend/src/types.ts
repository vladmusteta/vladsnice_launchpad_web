export interface JumpHost {
  host: string
  port: number
  username: string
  auth_method: 'key' | 'password'
  key_path?: string
  password?: string
}

export interface Machine {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_method: 'key' | 'password' | 'kerberos' | 'winrm'
  key_path?: string
  password?: string
  use_ansible: boolean
  ansible_inventory?: string
  jump_host?: JumpHost | null
  environment_id?: string | null
}

export interface Environment {
  id: string
  name: string
  color: string
}

export interface AnsibleInventory {
  id: string
  name: string
  content: string
  is_ephemeral: boolean
  base_content: string
  description: string
  environment_id?: string
}

export interface TreeNode {
  name: string
  path: string
  type: 'file' | 'dir'
  children: TreeNode[]
}

export type RunStatus = 'idle' | 'running' | 'done' | 'error'

export interface HistoryEntry {
  id: string
  script: string
  machine_name: string
  machine_id: string
  args: string
  timestamp: string
  status: 'running' | 'done' | 'error'
  environment_id?: string
}

export interface LogFile {
  name: string
  category: 'ansible' | 'bash'
  path: string
  size: number
  modified: string
}

export interface AnsibleHost {
  name: string
  groups: string[]
  variables: Record<string, string>
}

export interface ParsedInventory {
  groups: Record<string, string[]>
  all_hosts: AnsibleHost[]
  host_count: number
}

export interface RunTab {
  id: string
  runId: string
  script: string
  machineName: string
  lines: string[]
  status: 'running' | 'done' | 'error' | 'idle'
  startedAt: string
}

export interface WireGuardPeer {
  public_key: string
  endpoint: string
  allowed_ips: string
  preshared_key: string
  persistent_keepalive: number
}

export interface WireGuardConfig {
  id: string
  name: string
  private_key: string
  address: string
  dns: string
  peer: WireGuardPeer
}

export interface WireGuardStatus {
  connected: boolean
  interface: string
  error?: string
  stderr?: string
  peer?: {
    latest_handshake?: string
    endpoint?: string
    transfer?: string
    allowed_ips?: string
  }
  raw?: string
}
