import type { CSSProperties } from 'react'
import { Headphones, Minus, Square, X } from 'lucide-react'

const dragStyle: CSSProperties = {
  WebkitAppRegion: 'drag',
} as CSSProperties

const noDragStyle: CSSProperties = {
  WebkitAppRegion: 'no-drag',
} as CSSProperties

export function TitleBar() {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)
  if (!isElectron) return null

  return (
    <div
      style={dragStyle}
      className="flex h-7 shrink-0 select-none items-center justify-between border-b border-black/40 bg-[#111214] pl-3 text-xs text-dc-muted"
    >
      <div className="flex items-center gap-2">
        <Headphones size={13} className="text-dc-brand-soft" />
        <span className="text-[11px] font-bold tracking-wide text-dc-header">Discordia</span>
      </div>

      <div style={noDragStyle} className="flex h-full items-stretch">
        <button
          type="button"
          onClick={() => window.electron?.minimizeWindow()}
          className="flex w-10 items-center justify-center text-dc-muted transition hover:bg-white/10 hover:text-white"
          aria-label="Minimizar"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={() => window.electron?.maximizeWindow()}
          className="flex w-10 items-center justify-center text-dc-muted transition hover:bg-white/10 hover:text-white"
          aria-label="Maximizar"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          onClick={() => window.electron?.closeWindow()}
          className="flex w-10 items-center justify-center text-dc-muted transition hover:bg-dc-red hover:text-white"
          aria-label="Fechar"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}

