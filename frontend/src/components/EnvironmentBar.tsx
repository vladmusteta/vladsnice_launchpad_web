import { useState } from 'react'
import type { Environment } from '../types'
import { createEnvironment, deleteEnvironment } from '../api'

const COLORS = ['emerald', 'blue', 'amber', 'rose', 'violet', 'cyan', 'orange', 'pink', 'teal', 'indigo']

const PALETTE: Record<string, { dot: string; active: string; inactive: string }> = {
  emerald: { dot: 'bg-emerald-400', active: 'bg-emerald-500/20 border-emerald-500 text-emerald-300', inactive: 'hover:border-emerald-700/50' },
  blue:    { dot: 'bg-blue-400',    active: 'bg-blue-500/20 border-blue-500 text-blue-300',          inactive: 'hover:border-blue-700/50' },
  amber:   { dot: 'bg-amber-400',   active: 'bg-amber-500/20 border-amber-500 text-amber-300',       inactive: 'hover:border-amber-700/50' },
  rose:    { dot: 'bg-rose-400',    active: 'bg-rose-500/20 border-rose-500 text-rose-300',          inactive: 'hover:border-rose-700/50' },
  violet:  { dot: 'bg-violet-400',  active: 'bg-violet-500/20 border-violet-500 text-violet-300',    inactive: 'hover:border-violet-700/50' },
  cyan:    { dot: 'bg-cyan-400',    active: 'bg-cyan-500/20 border-cyan-500 text-cyan-300',          inactive: 'hover:border-cyan-700/50' },
  orange:  { dot: 'bg-orange-400',  active: 'bg-orange-500/20 border-orange-500 text-orange-300',    inactive: 'hover:border-orange-700/50' },
  pink:    { dot: 'bg-pink-400',    active: 'bg-pink-500/20 border-pink-500 text-pink-300',          inactive: 'hover:border-pink-700/50' },
  teal:    { dot: 'bg-teal-400',    active: 'bg-teal-500/20 border-teal-500 text-teal-300',          inactive: 'hover:border-teal-700/50' },
  indigo:  { dot: 'bg-indigo-400',  active: 'bg-indigo-500/20 border-indigo-500 text-indigo-300',    inactive: 'hover:border-indigo-700/50' },
  slate:   { dot: 'bg-slate-400',   active: 'bg-slate-700 border-slate-500 text-slate-300',          inactive: 'hover:border-slate-600/50' },
}

function cls(color: string) {
  return PALETTE[color] ?? PALETTE['slate']
}

interface Props {
  environments: Environment[]
  selected: string
  onSelect: (id: string) => void
  onChange: () => void
}

export default function EnvironmentBar({ environments, selected, onSelect, onChange }: Props) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await createEnvironment({ name: newName.trim(), color: COLORS[environments.length % COLORS.length] })
      onChange()
      setNewName('')
      setAdding(false)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(e: React.MouseEvent, env: Environment) {
    e.stopPropagation()
    if (!confirm(`Delete environment "${env.name}"?`)) return
    await deleteEnvironment(env.id)
    if (selected === env.id) onSelect('')
    onChange()
  }

  return (
    <div className="shrink-0 h-9 border-b border-slate-800 bg-slate-900/30 flex items-center px-3 gap-1 overflow-x-auto">
      {/* All */}
      <button
        onClick={() => onSelect('')}
        className={`px-3 py-0.5 text-xs font-medium rounded border transition-colors whitespace-nowrap
                    ${selected === ''
            ? 'bg-slate-700 border-slate-500 text-slate-200'
            : 'border-transparent text-slate-500 hover:text-slate-300'}`}
      >
        All
      </button>

      {/* Env tabs */}
      {environments.map((env) => {
        const c = cls(env.color)
        const isActive = selected === env.id
        return (
          <button
            key={env.id}
            onClick={() => onSelect(env.id)}
            className={`group px-2.5 py-0.5 text-xs font-medium rounded border transition-colors
                        flex items-center gap-1.5 whitespace-nowrap
                        ${isActive
                ? c.active
                : `border-transparent text-slate-500 hover:text-slate-300 ${c.inactive}`}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.dot}`} />
            {env.name}
            <span
              onClick={(e) => void handleDelete(e, env)}
              className="opacity-0 group-hover:opacity-100 ml-0.5 text-slate-500
                         hover:text-red-400 transition-all cursor-pointer leading-none"
            >
              ×
            </span>
          </button>
        )
      })}

      {/* Add */}
      {adding ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleAdd()
              if (e.key === 'Escape') setAdding(false)
            }}
            className="bg-slate-800 border border-slate-600 text-slate-200 rounded px-2 py-0.5
                       text-xs w-28 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            placeholder="env name"
          />
          <button onClick={() => void handleAdd()} disabled={saving}
            className="text-xs text-emerald-400 hover:text-emerald-300 px-1">✓</button>
          <button onClick={() => setAdding(false)}
            className="text-xs text-slate-500 hover:text-slate-300 px-1">✕</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-slate-600 hover:text-slate-400 transition-colors px-1 whitespace-nowrap"
        >
          + env
        </button>
      )}
    </div>
  )
}
