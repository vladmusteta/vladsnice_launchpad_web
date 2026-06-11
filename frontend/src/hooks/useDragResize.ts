import { useState, useRef, useCallback } from 'react'

export function useDragResize(initialPx: number | (() => number), direction: 'x' | 'y', minPx = 120) {
  const [size, setSize] = useState(initialPx)
  const sizeRef = useRef(size)
  sizeRef.current = size

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const startPos = direction === 'x' ? e.clientX : e.clientY
      const startSize = sizeRef.current
      const move = (ev: MouseEvent) => {
        const curr = direction === 'x' ? ev.clientX : ev.clientY
        setSize(Math.max(minPx, startSize + (curr - startPos)))
      }
      const up = () => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    },
    [direction, minPx],
  )

  return [size, onMouseDown] as const
}
