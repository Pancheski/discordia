import { Link2, Mic, MicOff, MonitorOff, MonitorUp, PhoneOff, Signal } from 'lucide-react'
import type { ReactNode } from 'react'

interface ControlBarProps {
  room: string
  muted: boolean
  micAvailable: boolean
  sharing: boolean
  screenSupported: boolean
  onToggleMute: () => void
  onToggleScreen: () => void
  onLeave: () => void
  onCopyLink: () => void
}

export function ControlBar({
  room,
  muted,
  micAvailable,
  sharing,
  screenSupported,
  onToggleMute,
  onToggleScreen,
  onLeave,
  onCopyLink,
}: ControlBarProps) {
  const micLabel = !micAvailable ? 'Ativar microfone' : muted ? 'Ativar microfone (M)' : 'Silenciar microfone (M)'

  return (
    <footer className="relative flex h-20 shrink-0 items-center justify-between gap-3 border-t border-black/30 bg-dc-darkest/80 px-3 backdrop-blur sm:px-5">
      <div className="hidden min-w-0 flex-1 items-center gap-2 sm:flex">
        <Signal size={18} className="shrink-0 text-dc-green" />
        <div className="min-w-0 leading-tight">
          <p className="text-sm font-semibold text-dc-green">Voz conectada</p>
          <p className="truncate text-xs text-dc-muted">#{room} · P2P</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center gap-3 sm:flex-none">
        <ControlButton
          id="mic-toggle-button"
          label={micLabel}
          onClick={onToggleMute}
          variant={muted ? 'danger' : 'neutral'}
          badge={!micAvailable}
        >
          {muted ? <MicOff size={22} /> : <Mic size={22} />}
        </ControlButton>

        <ControlButton
          id="screen-toggle-button"
          label={!screenSupported ? 'Compartilhar tela (indisponível)' : sharing ? 'Parar transmissão' : 'Compartilhar tela'}
          onClick={onToggleScreen}
          variant={sharing ? 'active' : 'neutral'}
          dimmed={!screenSupported}
        >
          {sharing ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
        </ControlButton>

        <ControlButton id="leave-button" label="Sair da sala" onClick={onLeave} variant="leave">
          <PhoneOff size={22} />
        </ControlButton>
      </div>

      <div className="hidden flex-1 justify-end sm:flex">
        <button id="controlbar-copy-link" type="button" onClick={onCopyLink} className="dc-btn-ghost">
          <Link2 size={16} /> Convidar
        </button>
      </div>
    </footer>
  )
}

interface ControlButtonProps {
  id: string
  label: string
  onClick: () => void
  variant: 'neutral' | 'danger' | 'active' | 'leave'
  badge?: boolean
  dimmed?: boolean
  children: ReactNode
}

const VARIANTS: Record<ControlButtonProps['variant'], string> = {
  neutral: 'bg-dc-light text-dc-text hover:bg-dc-hover',
  danger: 'bg-dc-red/15 text-dc-red ring-1 ring-dc-red/40 hover:bg-dc-red/25',
  active: 'bg-dc-green text-white hover:bg-[#1f8b4c] shadow-lg shadow-dc-green/25',
  leave: 'bg-dc-red text-white hover:bg-dc-red-hover shadow-lg shadow-dc-red/25',
}

function ControlButton({ id, label, onClick, variant, badge, dimmed, children }: ControlButtonProps) {
  return (
    <div className="group relative">
      <button
        id={id}
        type="button"
        onClick={onClick}
        aria-label={label}
        className={`relative flex h-12 w-12 items-center justify-center rounded-full transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 sm:h-[52px] sm:w-[52px] ${
          variant === 'leave' ? 'sm:w-16' : ''
        } ${VARIANTS[variant]} ${dimmed ? 'opacity-50' : ''}`}
      >
        {children}
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-dc-yellow text-[10px] font-black text-black ring-2 ring-dc-darkest">
            !
          </span>
        )}
      </button>
      <span className="pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  )
}
