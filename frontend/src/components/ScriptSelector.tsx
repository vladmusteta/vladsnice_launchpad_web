interface Props {
  scripts: string[]
  selected: string
  onChange: (s: string) => void
  disabled?: boolean
}

export default function ScriptSelector({ scripts, selected, onChange, disabled }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-slate-300 flex items-center gap-2">
        <span className="text-emerald-400">▶</span> Script
      </label>
      {scripts.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          Niciun script în folderul <code className="text-slate-400">scripts/</code>
        </p>
      ) : (
        <select
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="bg-slate-800 border border-slate-600 text-slate-200 rounded-lg px-3 py-2 text-sm
                     focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <option value="">— alege un script —</option>
          {scripts.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      )}
    </div>
  )
}
