import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/**
 * Drag-and-drop de arquivos em uma área. Usa contador de dragenter/dragleave para
 * não "piscar" o overlay ao passar sobre elementos filhos.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const onDragEnter = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setDragging(true)
    },
    [enabled],
  )

  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [enabled],
  )

  const onDragLeave = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setDragging(false)
    },
    [enabled],
  )

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!enabled || !hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer.files ?? [])
      if (files.length > 0) onFiles(files)
    },
    [enabled, onFiles],
  )

  return { dragging, bind: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

