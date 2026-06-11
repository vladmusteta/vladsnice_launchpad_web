import { useState, useCallback } from 'react'
import type { TreeNode } from '../types'
import { uploadScript } from '../api'

function useFavorites() {
  const KEY = 'script_favorites'
  const [favs, setFavs] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]) }
    catch { return new Set() }
  })
  function toggle(path: string) {
    setFavs(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      localStorage.setItem(KEY, JSON.stringify([...next]))
      return next
    })
  }
  return { favs, toggle }
}

function fuzzy(text: string, q: string): boolean {
  if (!q) return true
  const lt = text.toLowerCase(), lq = q.toLowerCase()
  let qi = 0
  for (let i = 0; i < lt.length && qi < lq.length; i++) {
    if (lt[i] === lq[qi]) qi++
  }
  return qi === lq.length
}

function nodeMatchesQuery(node: TreeNode, q: string): boolean {
  if (node.type === 'file') return fuzzy(node.name, q)
  return node.children.some(c => nodeMatchesQuery(c, q))
}

function fileIcon(name: string): string {
  if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh')) return '🐚'
  if (name.endsWith('.py')) return '🐍'
  if (name.endsWith('.yml') || name.endsWith('.yaml')) return '📋'
  if (name.endsWith('.ps1')) return '🔷'
  return '📄'
}

const CATEGORY_META: Record<string, { icon: string; color: string; bg: string }> = {
  ansible:    { icon: '⚡', color: 'text-amber-400',  bg: 'bg-amber-500/10 border-amber-600/30' },
  bash:       { icon: '🐚', color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-600/30' },
  powershell: { icon: '🔷', color: 'text-blue-400',   bg: 'bg-blue-500/10 border-blue-600/30' },
}

interface NodeProps {
  node: TreeNode
  selected: string
  onSelect: (path: string) => void
  level: number
  query: string
  autoOpen?: boolean
  favs: Set<string>
  onToggleFav: (path: string) => void
}

function FTreeNode({ node, selected, onSelect, level, query, autoOpen = false, favs, onToggleFav }: NodeProps) {
  const hasMatch = !query || nodeMatchesQuery(node, query)
  const forceOpen = !!query && node.type === 'dir' && node.children.some(c => nodeMatchesQuery(c, query))
  const [open, setOpen] = useState(autoOpen)
  const indent = level * 14

  if (!hasMatch) return null

  if (node.type === 'file') {
    const active = selected === node.path
    const isFav = favs.has(node.path)
    return (
      <div
        style={{ paddingLeft: `${indent + 8}px` }}
        className={`group w-full flex items-center gap-1 py-[5px] pr-2 rounded-md transition-colors
                    ${active
            ? 'bg-emerald-500/15 text-emerald-300 font-medium'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700/40'
          }`}
      >
        <button
          onClick={() => onSelect(node.path)}
          className="flex items-center gap-2 flex-1 text-left text-sm min-w-0"
        >
          <span className="text-xs leading-none shrink-0">{fileIcon(node.name)}</span>
          {query ? (
            <span className="truncate" dangerouslySetInnerHTML={{ __html: highlight(node.name, query) }} />
          ) : (
            <span className="truncate">{node.name}</span>
          )}
        </button>
        <button
          onClick={e => { e.stopPropagation(); onToggleFav(node.path) }}
          className={`shrink-0 text-xs leading-none transition-colors px-0.5
            ${isFav ? 'text-amber-400' : 'opacity-0 group-hover:opacity-100 text-slate-600 hover:text-amber-400'}`}
          title={isFav ? 'Remove from favorites' : 'Add to favorites'}
        >★</button>
      </div>
    )
  }

  const isOpen = forceOpen || open
  const catMeta = level === 0 ? CATEGORY_META[node.name.toLowerCase()] : undefined

  if (catMeta) {
    // Category-level folder — render as a pill header
    return (
      <div className="mb-1">
        <button
          onClick={() => setOpen((o) => !o)}
          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded border text-left transition-colors
                     ${catMeta.bg} ${catMeta.color} hover:brightness-110`}
        >
          <span className="text-xs">{catMeta.icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider">{node.name}</span>
          <span className="ml-auto text-[10px] opacity-50">{isOpen ? '▾' : '▸'}</span>
        </button>
        {isOpen && (
          <div className="mt-0.5">
            {node.children.map((child) => (
              <FTreeNode key={child.path || child.name} node={child} selected={selected}
                onSelect={onSelect} level={level + 1} query={query}
                favs={favs} onToggleFav={onToggleFav} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: `${indent + 6}px` }}
        className="w-full flex items-center gap-2 py-[5px] pr-3 text-left text-sm
                   text-slate-300 hover:text-slate-100 hover:bg-slate-700/30 rounded-md
                   transition-colors select-none"
      >
        <span className="text-[10px] text-slate-500 w-3 shrink-0 leading-none">
          {isOpen ? '\u25BE' : '\u25B8'}
        </span>
        <span className="text-xs leading-none shrink-0">{isOpen ? '\u{1F4C2}' : '\u{1F4C1}'}</span>
        <span className="font-medium truncate">{node.name}</span>
      </button>
      {isOpen && (
        <div>
          {node.children.map((child) => (
            <FTreeNode
              key={child.path || child.name}
              node={child}
              selected={selected}
              onSelect={onSelect}
              level={level + 1}
              query={query}
              favs={favs}
              onToggleFav={onToggleFav}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function highlight(text: string, query: string): string {
  if (!query) return text
  const lq = query.toLowerCase()
  let result = ''
  let qi = 0
  for (let i = 0; i < text.length; i++) {
    if (qi < lq.length && text[i].toLowerCase() === lq[qi]) {
      result += `<span class="text-emerald-300 font-bold">${text[i]}</span>`
      qi++
    } else {
      result += text[i]
    }
  }
  return result
}

interface Props {
  tree: TreeNode | null
  selected: string
  onSelect: (path: string) => void
  onRefresh: () => void
  envId?: string
}

export default function FileTree({ tree, selected, onSelect, onRefresh, envId = '' }: Props) {
  const [query, setQuery] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const { favs, toggle: toggleFav } = useFavorites()

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setQuery('')
  }, [])

  // Collect all file nodes that match favorites
  function collectFavNodes(node: TreeNode | null): TreeNode[] {
    if (!node) return []
    if (node.type === 'file') return favs.has(node.path) ? [node] : []
    return node.children.flatMap(c => collectFavNodes(c))
  }
  const favNodes = collectFavNodes(tree)

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    setUploading(true); setUploadMsg('')
    const ok: string[] = [], fail: string[] = []
    for (const f of files) {
      try {
        await uploadScript(f, '', envId)
        ok.push(f.name)
      } catch {
        fail.push(f.name)
      }
    }
    setUploading(false)
    if (ok.length) { onRefresh(); setUploadMsg(`Uploaded: ${ok.join(', ')}`) }
    if (fail.length) setUploadMsg(prev => prev + (prev ? ' | ' : '') + `Failed: ${fail.join(', ')}`)
    setTimeout(() => setUploadMsg(''), 4000)
  }

  return (
    <div
      className={`flex flex-col h-full transition-colors ${dragOver ? 'bg-emerald-900/10 ring-1 ring-inset ring-emerald-600/40' : ''}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => void handleDrop(e)}
    >
      <div className="flex items-center justify-between px-3 pt-3 pb-2 shrink-0">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">Scripts</span>
        <button onClick={onRefresh} title="Refresh"
          className="text-xs text-slate-600 hover:text-slate-300 transition-colors px-1">↺</button>
      </div>
      {dragOver && (
        <div className="shrink-0 mx-2 mb-1 px-2 py-1.5 rounded border border-dashed border-emerald-500/60 bg-emerald-900/10 text-xs text-emerald-400 text-center">
          Drop .sh / .py / .yml to upload
        </div>
      )}
      {uploadMsg && (
        <div className="shrink-0 mx-2 mb-1 px-2 py-1 rounded bg-slate-800 text-xs text-slate-400 truncate">
          {uploading ? '⏳ Uploading…' : uploadMsg}
        </div>
      )}
      <div className="shrink-0 px-2 pb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="fuzzy search..."
          className="w-full bg-slate-800/60 border border-slate-700 text-slate-300 rounded-md px-2 py-1 text-xs
                     focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-3">
        {/* Favorites section */}
        {!query && favNodes.length > 0 && (
          <div className="mb-2">
            <div className="px-2 py-0.5 text-[10px] font-semibold text-amber-500/70 uppercase tracking-wider">
              ★ Favorites
            </div>
            {favNodes.map(n => (
              <FTreeNode key={n.path} node={n} selected={selected} onSelect={onSelect}
                level={0} query="" favs={favs} onToggleFav={toggleFav} />
            ))}
            <div className="border-t border-slate-800/60 my-1.5 mx-2" />
          </div>
        )}
        {!tree || tree.children.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-600 italic">
            Add scripts to the <code className="text-slate-500">scripts/</code> folder
          </p>
        ) : (
          tree.children.map((child) => (
            <FTreeNode
              key={child.path || child.name}
              node={child}
              selected={selected}
              onSelect={onSelect}
              level={0}
              query={query}
              autoOpen={child.type === 'dir' && tree.children.length === 1}
              favs={favs}
              onToggleFav={toggleFav}
            />
          ))
        )}
      </div>
    </div>
  )
}
