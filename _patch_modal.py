
content = open('frontend/src/components/MachineModal.tsx').read()

# 1. Replace auth_method type in EMPTY
old_empty = '''const EMPTY: Omit<Machine, 'id'> = {
  name: '',
  host: '',
  port: 22,
  username: '',
  auth_method: 'key',
  key_path: '',
  password: '',
  use_ansible: false,
  ansible_inventory: '',
  jump_host: null,
}'''
new_empty = '''const EMPTY: Omit<Machine, 'id'> = {
  name: '',
  host: '',
  port: 22,
  username: '',
  auth_method: 'key',
  key_path: '',
  password: '',
  use_ansible: false,
  ansible_inventory: '',
  jump_host: null,
}

const AUTH_OPTIONS: { value: Machine['auth_method']; label: string; note?: string }[] = [
  { value: 'key',      label: 'SSH Key' },
  { value: 'password', label: 'SSH Password' },
  { value: 'kerberos', label: 'Kerberos / WinRM', note: 'Ansible uses kinit ticket — no stored credentials' },
  { value: 'winrm',    label: 'WinRM (NTLM)',     note: 'Username + password, Ansible connects via WinRM' },
]'''
assert old_empty in content, "EMPTY not found"
content = content.replace(old_empty, new_empty, 1)

# 2. Replace auth_method radio group + key/password fields with the new multi-option version
old_auth = '''          <Field label="Autentificare">
            <div className="flex gap-3">
              {(['key', 'password'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5 text-sm text-slate-300 cursor-pointer">
                  <input type="radio" checked={form.auth_method === m}
                    onChange={() => set('auth_method', m)}
                    className="accent-emerald-500" />
                  {m === 'key' ? 'Cheie SSH' : 'Parolă'}
                </label>
              ))}
            </div>
          </Field>

          {form.auth_method === 'key' ? (
            <Field label="Cale cheie privată">
              <input value={form.key_path ?? ''} onChange={(e) => set('key_path', e.target.value)}
                className={inputCls} placeholder="~/.ssh/id_rsa" />
            </Field>
          ) : (
            <Field label="Parolă">
              <input type="password" value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                className={inputCls} autoComplete="new-password" />
            </Field>
          )}'''
new_auth = '''          <Field label="Authentication">
            <div className="flex flex-col gap-2">
              {AUTH_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-start gap-2 cursor-pointer">
                  <input type="radio" checked={form.auth_method === opt.value}
                    onChange={() => set('auth_method', opt.value)}
                    className="accent-emerald-500 mt-0.5" />
                  <div className="flex flex-col">
                    <span className="text-sm text-slate-300">{opt.label}</span>
                    {opt.note && <span className="text-xs text-slate-500">{opt.note}</span>}
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
            <Field label="WinRM password (optional)">
              <input type="password" value={form.password ?? ''}
                onChange={(e) => set('password', e.target.value)}
                className={inputCls} autoComplete="new-password"
                placeholder="Leave empty to use Kerberos ticket" />
            </Field>
          )}
          {form.auth_method === 'kerberos' && (
            <div className="px-3 py-2 bg-blue-900/20 border border-blue-700/30 rounded-lg text-xs text-blue-300">
              ℹ️ Make sure you have a valid Kerberos ticket (<code className="font-mono">kinit user@REALM</code>) on the machine running this app.
            </div>
          )}'''
assert old_auth in content, "auth section not found"
content = content.replace(old_auth, new_auth, 1)

# 3. Make username not required for kerberos/winrm
old_username = '''          <Field label="Username" required>
            <input value={form.username} onChange={(e) => set('username', e.target.value)}
              className={inputCls} placeholder="ubuntu" required />
          </Field>'''
new_username = '''          <Field label="Username" required={form.auth_method !== 'kerberos'}>
            <input value={form.username} onChange={(e) => set('username', e.target.value)}
              className={inputCls}
              placeholder={form.auth_method === 'kerberos' ? 'user@REALM (optional)' : form.auth_method === 'winrm' ? 'DOMAIN\\\\user' : 'ubuntu'}
              required={form.auth_method !== 'kerberos'} />
          </Field>'''
assert old_username in content, "username field not found"
content = content.replace(old_username, new_username, 1)

# 4. Fix Field label="Autentificare" in jump host section too
old_jump_auth = '''                <Field label="Autentificare">
                  <div className="flex gap-3">
                    {(['key', 'password'] as const).map((m) => (
                      <label key={m} className="flex items-center gap-1.5 text-sm text-slate-300 cursor-pointer">
                        <input type="radio"
                          checked={jump.auth_method === m}
                          onChange={() => setJump({ auth_method: m })}
                          className="accent-purple-500" />
                        {m === 'key' ? 'Cheie SSH' : 'Parolă'}
                      </label>
                    ))}
                  </div>
                </Field>'''
new_jump_auth = '''                <Field label="Auth">
                  <div className="flex gap-3">
                    {(['key', 'password'] as const).map((m) => (
                      <label key={m} className="flex items-center gap-1.5 text-sm text-slate-300 cursor-pointer">
                        <input type="radio"
                          checked={jump.auth_method === m}
                          onChange={() => setJump({ auth_method: m })}
                          className="accent-purple-500" />
                        {m === 'key' ? 'SSH Key' : 'Password'}
                      </label>
                    ))}
                  </div>
                </Field>'''
assert old_jump_auth in content, "jump auth not found"
content = content.replace(old_jump_auth, new_jump_auth, 1)

# 5. Fix other Romanian labels
content = content.replace("'Cheie SSH' : 'Parolă'", "'SSH Key' : 'Password'")
content = content.replace('{machine ? \'Editează mașina\' : \'Adaugă mașină\'}', '{machine ? \'Edit machine\' : \'Add machine\'}')
content = content.replace("'Anulează'", "'Cancel'")
content = content.replace("{saving ? 'Salvez...' : 'Salvează'}", "{saving ? 'Saving...' : 'Save'}")
content = content.replace("'Folosește Ansible'", "'Use Ansible'")
content = content.replace("'Ansible Inventory'", "'Ansible Inventory'")
content = content.replace("\"Editează\"", "\"Edit\"")
content = content.replace("\"Șterge\"", "\"Delete\"")

open('frontend/src/components/MachineModal.tsx', 'w').write(content)
print("Done: MachineModal updated with kerberos/winrm")
