import { useEffect, useRef, useState } from 'react'
import type { RunStatus } from '../types'

interface Props {
  lines: string[]
  status: RunStatus
  onClear: () => void
  onSave?: () => Promise<void>
  onStop?: () => Promise<void>
}

function classifyLine(line: string): string {
  if (line.startsWith('[ERROR]')) return 'text-red-400'
  if (line.startsWith('[INFO]')) return 'text-blue-400'
  if (line.startsWith('[DONE]')) return 'text-emerald-400'
  if (line.startsWith('[STDERR]')) return 'text-orange-400'
  if (line.startsWith('---') || line.startsWith('===')) return 'text-slate-600'
  return 'text-slate-300'
}

const STATUS_LABELS: Record<RunStatus, string> = {
  idle: '', running: 'RUNNING', done: 'DONE', error: 'ERROR',
}
const STATUS_COLORS: Record<RunStatus, string> = {
  idle: '', running: 'text-yellow-400 animate-pulse', done: 'text-emerald-400', error: 'text-red-400',
}

export default function LogViewer({ lines, status, onClear, onSave, onStop }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [stopping, setStopping] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [filter, setFilter] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines, autoScroll])

  const visibleLines = filter
    ? lines.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : lines

  async function handleSave() {
    if (!onSave || saveState === 'saving') return
    setSaveState('saving')
    try {
      await onSave()
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 3000)
    } catch {
      setSaveState('error')
      setTimeout(() => setSaveState('idle'), 3500)
    }
  }

  async function handleStop() {
    if (!onStop || stopping) return
    setStopping(true)
    try { await onStop() } catch { /* ignore */ } finally { setStopping(false) }
  }

  return (
    <div className="flex flex-col gap-2 flex-1 min-h-0">
      <div className="flex items-center justify-between shrink-0 gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-300 flex items-center gap-2">
            <span className="text-purple-400">▤</span> Logs
          </span>
          {status !== 'idle' && (
            <span className={`text-xs font-mono font-bold ${STATUS_COLORS[status]}`}>
              {STATUS_LABELS[status]}
            </span>
          )}
          {lines.length > 0 && (
            <span className="text-[10px] text-slate-600">
              {filter ? `${visibleLines.length}/${lines.length}` : lines.length} lines
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Live filter */}
          <input
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setFilter('') }}
            placeholder="filter lines..."
            className="w-32 bg-slate-800/60 border border-slate-700 text-slate-300 rounded px-2 py-0.5 text-xs
                       focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-slate-600"
          />
          {/* Wrap toggle */}
          <button
            onClick={() => setWrap(w => !w)}
            title={wrap ? 'Switch to no-wrap' : 'Switch to wrap'}
            className={`text-xs px-2 py-0.5 rounded border transition-colors
              ${wrap ? 'border-slate-600 text-slate-400 hover:text-slate-200' : 'border-emerald-600/50 text-emerald-400 bg-emerald-900/20'}`}
          >{wrap ? '↔ Wrap' : '↔ NoWrap'}</button>
          {/* Auto-scroll toggle */}
          <button
            onClick={() => setAutoScroll(a => !a)}
            title={autoScroll ? 'Disable auto-scroll' : 'Enable auto-scroll'}
            className={`text-xs px-2 py-0.5 rounded border transition-colors
              ${autoScroll ? 'border-blue-600/50 text-blue-400 bg-blue-900/20' : 'border-slate-600 text-slate-500 hover:text-slate-300'}`}
          >↓ Auto</button>
          {/* Stop button — only while running */}
          {status === 'running' && onStop && (
            <button
              onClick={() => void handleStop()}
              disabled={stopping}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium
                         bg-red-900/40 text-red-300 border border-red-700/50
                         hover:bg-red-800/60 hover:text-red-200 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {stopping ? 'Stopping...' : 'Stop'}
            </button>
          )}
          {/* Save button */}
          {onSave && lines.length > 0 && status !== 'running' && (
            <button
              onClick={() => void handleSave()}
              disabled={saveState === 'saving'}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors
                ${saveState === 'saved' ? 'text-emerald-400 bg-emerald-900/20 border border-emerald-700/30' :
                  saveState === 'error' ? 'text-red-400 bg-red-900/20 border border-red-700/30' :
                  'text-slate-400 border border-slate-700 hover:text-slate-200 hover:border-slate-500'}`}
            >
              {saveState === 'saving' ? '...' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Error' : 'Save'}
            </button>
          )}
          {lines.length > 0 && (
            <button onClick={onClear}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 bg-slate-950 border border-slate-700 rounded-xl p-4 overflow-auto">
        {visibleLines.length === 0 ? (
          <span className="text-slate-600 italic text-xs">
            {lines.length === 0
              ? (status === 'running' ? 'Waiting for output...' : 'Waiting for a script to run...')
              : 'No lines match the filter.'}
          </span>
        ) : (
          visibleLines.map((line, i) => (
            <div key={i} className={(wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre') + ' ' + classifyLine(line)}>
              {line.endsWith('\n') ? line.slice(0, -1) : line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
