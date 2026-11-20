import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface MosaicItem {
  key: string
  node: ReactNode
}

interface VideoMosaicProps {
  items: MosaicItem[]
}

const MIN_ASPECT = 4 / 3
const MAX_ASPECT = 16 / 9
const MIN_TILE_WIDTH = 180
const MIN_TILE_HEIGHT = 110
const GAP = 12

interface GridLayout {
  tileWidth: number
  tileHeight: number
  needsScroll: boolean
}

function computeOptimalGrid(width: number, height: number, count: number): GridLayout | null {
  if (count <= 0 || width <= 0 || height <= 0) return null

  let best: { tileW: number; tileH: number; area: number } | null = null

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const cellW = (width - GAP * (cols - 1)) / cols
    const cellH = (height - GAP * (rows - 1)) / rows
    if (cellW <= 0 || cellH <= 0) continue

    let tileW = cellW
    let tileH = cellH
    const cellAspect = cellW / cellH

    if (cellAspect > MAX_ASPECT) {
      tileW = cellH * MAX_ASPECT
    } else if (cellAspect < MIN_ASPECT) {
      tileH = cellW / MIN_ASPECT
    }

    const area = tileW * tileH
    if (!best || area > best.area + 1) {
      best = { tileW, tileH, area }
    }
  }

  if (!best) return null

  if (best.tileW < MIN_TILE_WIDTH || best.tileH < MIN_TILE_HEIGHT) {
    const fallbackCols = Math.max(1, Math.floor((width + GAP) / (MIN_TILE_WIDTH + GAP)))
    const fallbackW = Math.max(MIN_TILE_WIDTH, (width - GAP * (fallbackCols - 1)) / fallbackCols)
    const fallbackH = Math.max(MIN_TILE_HEIGHT, Math.round(fallbackW / MAX_ASPECT))
    return {
      tileWidth: Math.floor(fallbackW),
      tileHeight: Math.floor(fallbackH),
      needsScroll: true,
    }
  }

  return {
    tileWidth: Math.floor(best.tileW),
    tileHeight: Math.floor(best.tileH),
    needsScroll: false,
  }
}

/**
 * Mosaico adaptativo inteligente: mede o espaço disponível em tempo real (ResizeObserver)
 * e calcula automaticamente o tamanho ideal de cada tela/câmera para preencher toda a área
 * com ótima legibilidade e sem desperdício de margem.
 */
export function VideoMosaic({ items }: VideoMosaicProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const updateSize = (w: number, h: number) => {
      const nextW = Math.floor(w)
      const nextH = Math.floor(h)
      setSize((prev) => (prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }))
    }

    const rect = el.getBoundingClientRect()
    updateSize(rect.width, rect.height)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      updateSize(entry.contentRect.width, entry.contentRect.height)
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(
    () => computeOptimalGrid(size.width, size.height, items.length),
    [size.width, size.height, items.length],
  )

  return (
    <div
      ref={containerRef}
      className={`flex h-full min-h-0 w-full flex-1 ${
        layout?.needsScroll
          ? 'items-start justify-center overflow-y-auto'
          : 'items-center justify-center overflow-hidden'
      }`}
    >
      {layout ? (
        <div
          className="flex flex-wrap content-center items-center justify-center"
          style={{ gap: `${GAP}px`, maxWidth: '100%' }}
        >
          {items.map((item) => (
            <div
              key={item.key}
              className="shrink-0 transition-[width,height] duration-300 ease-out"
              style={{ width: `${layout.tileWidth}px`, height: `${layout.tileHeight}px` }}
            >
              {item.node}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid h-full w-full grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.key} className="min-h-0 w-full">
              {item.node}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
