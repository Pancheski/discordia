import { MicOff, MonitorUp } from 'lucide-react'
import { Avatar } from './Avatar'

interface ParticipantTileProps {
  name: string
  speaking: boolean
  muted: boolean
  sharing: boolean
  isLocal?: boolean
  compact?: boolean
}

/** Cartão de participante no palco. Borda verde pulsante quando há fala detectada. */
export function ParticipantTile({ name, speaking, muted, sharing, isLocal = false, compact = false }: ParticipantTileProps) {
  if (compact) {
    return (
      <div
        className={`flex shrink-0 items-center gap-2 rounded-full bg-dc-darker py-1 pl-1 pr-3 ring-2 transition ${
          speaking ? 'ring-dc-green' : 'ring-transparent'
        }`}
      >
        <Avatar name={name} size={28} speaking={speaking} />
        <span className="max-w-28 truncate text-xs font-medium text-dc-text">
          {name}
          {isLocal && <span className="text-dc-muted"> (você)</span>}
        </span>
        {muted && <MicOff size={13} className="text-dc-red" />}
        {sharing && <MonitorUp size={13} className="text-dc-brand-soft" />}
      </div>
    )
  }

  return (
    <div
      className={`group relative flex aspect-video min-h-36 w-full animate-fade-up items-center justify-center overflow-hidden rounded-xl bg-dc-darker ring-2 transition-all duration-200 ${
        speaking ? 'ring-dc-green shadow-[0_0_24px_rgba(35,165,90,0.25)]' : 'ring-white/[0.03]'
      }`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30 transition-opacity group-hover:opacity-50"
        style={{ background: 'radial-gradient(circle at 50% 40%, rgba(88,101,242,0.25), transparent 65%)' }}
      />
      <Avatar name={name} size={84} speaking={speaking} />

      <div className="absolute bottom-2.5 left-2.5 flex max-w-[calc(100%-1.25rem)] items-center gap-1.5 rounded-md bg-black/45 px-2 py-1 backdrop-blur">
        {muted && <MicOff size={14} className="shrink-0 text-dc-red" aria-label="Microfone desativado" />}
        <span className="truncate text-sm font-medium text-white">
          {name}
          {isLocal && <span className="text-white/60"> (você)</span>}
        </span>
      </div>

      {sharing && (
        <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded bg-dc-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
          <MonitorUp size={11} /> Ao vivo
        </span>
      )}
    </div>
  )
}
