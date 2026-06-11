export interface JumpHost {
  host: string
  port: number
  username: string
  auth_method: 'key' | 'password'
  key_path?: string
  password?: string
}

// ansible: 'ssh' | 'kerberos' | 'inventory'
// shell:   'ssh' | 'none'
export type AnsibleAuthMode = 'ssh' | 'kerberos' | 'inventory'
export type ShellAuthMode   = 'ssh' | 'none'

export interface Machine {
  id: string
  name: string
  host: string
  port: number
  username: string
  // legacy field kept for compat; new field is ansible_auth / shell_auth
  auth_method: 'key' | 'password' | 'kerberos' | 'winrm' | 'none'
  key_path?: string
  password?: string
  use_ansible: boolean
  ansible_inventory?: string
  /** Ordered list of bastion hops (first = nearest to us, last connects to target) */
  jump_hosts?: JumpHost[]
  /** legacy single hop kept for backward compat */
  jump_host?: JumpHost | null
  environment_id?: string | null
  /** SSH connection timeout in seconds (default 10) */
  timeout_s?: number
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
