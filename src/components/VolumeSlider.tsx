import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { Volume1, Volume2, VolumeX } from 'lucide-react'

interface VolumeSliderProps {
  id: string
  value: number
  onChange: (value: number) => void
  label: string
  className?: string
}

export function VolumeSlider({ id, value, onChange, label, className = '' }: VolumeSliderProps) {
  const lastNonZero = useRef(value > 0 ? value : 1)
  if (value > 0) lastNonZero.current = value
  const pct = Math.round(value * 100)
  const Icon = value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => onChange(value === 0 ? lastNonZero.current : 0)}
        className={`rounded p-1 transition hover:bg-dc-hover ${value === 0 ? 'text-dc-red' : 'text-dc-muted hover:text-dc-text'}`}
        title={value === 0 ? `Reativar: ${label}` : `Silenciar: ${label}`}
        aria-label={value === 0 ? `Reativar ${label}` : `Silenciar ${label}`}
      >
        <Icon size={15} />
      </button>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={1}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="dc-range min-w-0 flex-1"
        style={{ '--val': `${pct}%` } as CSSProperties}
        aria-label={label}
      />
      <span className="w-9 text-right text-[11px] tabular-nums text-dc-muted">{pct}%</span>
    </div>
  )
}
