import { useState } from 'react'
import type { Machine } from '../types'

interface Props {
  machines: Machine[]
  selectedScript: string
  args: string
  onRun: (machineIds: string[]) => void
}

export default function MultiRunPanel({ machines, selectedScript, args, onRun }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === machines.length) setSelected(new Set())
    else setSelected(new Set(machines.map(m => m.id)))
  }

  const canRun = !!selectedScript && selected.size > 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="shrink-0 px-4 py-2 border-b border-slate-800 flex items-center gap-3">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Multi-Machine Run</span>
        {selectedScript ? (
          <span className="text-xs text-emerald-400 font-mono bg-emerald-900/20 px-2 py-0.5 rounded border border-emerald-700/30 truncate max-w-xs">
            {selectedScript.split('/').pop()}
          </span>
        ) : (
          <span className="text-xs text-slate-500 italic">Select a script in the Run tab first</span>
        )}
        {args && (
          <span className="text-xs text-slate-500 font-mono">args: {args}</span>
        )}
        <button
          onClick={() => onRun([...selected])}
          disabled={!canRun}
          className={`ml-auto px-4 py-1.5 text-xs font-semibold rounded-lg transition-all
            ${canRun
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow shadow-emerald-900/30'
              : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
        >
          ▶ Run on {selected.size} machine{selected.size !== 1 ? 's' : ''}
        </button>
      </div>

      <div className="shrink-0 px-4 py-1.5 border-b border-slate-800 flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={selected.size === machines.length && machines.length > 0}
            onChange={toggleAll}
            className="accent-emerald-500"
          />
          Select all ({machines.length})
        </label>
      </div>

      <div className="flex-1 overflow-y-auto">
        {machines.length === 0 ? (
          <div className="flex items-center justify-center h-32">
            <p className="text-slate-600 text-sm italic">No machines configured for this environment.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left sticky top-0 bg-slate-950">
                <th className="px-4 py-2 w-8" />
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Name</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Host</th>
                <th className="px-4 py-2 text-xs font-medium text-slate-500">Auth</th>
              </tr>
            </thead>
            <tbody>
              {machines.map(m => (
                <tr
                  key={m.id}
                  className="border-b border-slate-800/50 hover:bg-slate-800/30 cursor-pointer transition-colors"
                  onClick={() => toggle(m.id)}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(m.id)}
                      onChange={() => toggle(m.id)}
                      onClick={e => e.stopPropagation()}
                      className="accent-emerald-500"
                    />
                  </td>
                  <td className="px-4 py-2.5 text-slate-200 text-xs font-medium">{m.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs font-mono">{m.host}:{m.port}</td>
                  <td className="px-4 py-2.5">
                    <span className="text-xs text-slate-500 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700">
                      {m.auth_method}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
