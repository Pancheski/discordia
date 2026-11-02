import {
  AudioWaveform,
  Link2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Rocket,
  Signal,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { AppActivityId, PeerConnectionState } from '../types'

interface ControlBarProps {
  room: string
  muted: boolean
  micAvailable: boolean
  sharing: boolean
  screenSupported: boolean
  chatOpen: boolean
  unreadCount: number
  soundboardOpen: boolean
  appsOpen: boolean
  activeApp: AppActivityId
  meshState?: PeerConnectionState
  onToggleMute: () => void
  onToggleScreen: () => void
  onToggleSoundboard: () => void
  onToggleApps: () => void
  onToggleChat: () => void
  onLeave: () => void
  onCopyLink: () => void
}

export function ControlBar({
  room,
  muted,
  micAvailable,
  sharing,
  screenSupported,
  chatOpen,
  unreadCount,
  soundboardOpen,
  appsOpen,
  activeApp,
  meshState = 'connected',
  onToggleMute,
  onToggleScreen,
  onToggleSoundboard,
  onToggleApps,
  onToggleChat,
  onLeave,
  onCopyLink,
}: ControlBarProps) {
  const micLabel = !micAvailable ? 'Ativar microfone' : muted ? 'Ativar microfone' : 'Silenciar microfone'
  const appLabel = activeApp
    ? `Atividades · ${activeApp === 'trio' ? 'TRIO' : activeApp === 'wheel' ? 'Roleta' : 'Mini Golf'}`
    : 'Atividades'

  const statusText =
    meshState === 'error'
      ? 'Erro de conexão'
      : meshState === 'connecting' || meshState === 'reconnecting'
        ? 'Conectando...'
        : 'Voz Conectada'
  const statusColor =
    meshState === 'error'
      ? 'text-dc-red'
      : meshState === 'connecting' || meshState === 'reconnecting'
        ? 'text-amber-400'
        : 'text-dc-green'

  return (
    <footer className="relative flex h-20 shrink-0 items-center justify-between gap-2 border-t border-black/30 bg-dc-darkest/80 px-3 backdrop-blur sm:px-5">
      <div className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
        <Signal size={18} className={`shrink-0 ${statusColor}`} />
        <div className="min-w-0 leading-tight">
          <p className={`text-sm font-semibold ${statusColor}`}>{statusText}</p>
          <p className="truncate text-xs text-dc-muted">#{room}</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center gap-2 sm:gap-2.5 md:flex-none">
        <ControlButton
          id="mic-toggle-button"
          label={micLabel}
          onClick={onToggleMute}
          variant={muted ? 'danger' : 'neutral'}
          badge={!micAvailable ? '!' : undefined}
        >
          {muted ? <MicOff size={21} /> : <Mic size={21} />}
        </ControlButton>

        <ControlButton
          id="screen-toggle-button"
          label={sharing ? 'Parar Transmissão' : 'Compartilhar Tela'}
          onClick={onToggleScreen}
          variant={sharing ? 'active' : 'neutral'}
          dimmed={!screenSupported}
        >
          {sharing ? <MonitorOff size={21} /> : <MonitorUp size={21} />}
        </ControlButton>

        <ControlButton
          id="soundboard-toggle-button"
          label="Soundboard"
          onClick={onToggleSoundboard}
          variant={soundboardOpen ? 'brand' : 'neutral'}
        >
          <AudioWaveform size={20} />
        </ControlButton>

        <ControlButton
          id="apps-hub-button"
          label={appLabel}
          onClick={onToggleApps}
          variant={appsOpen ? 'brand' : activeApp ? 'active' : 'neutral'}
          badge={activeApp && !appsOpen ? 'ON' : undefined}
        >
          <Rocket size={20} />
        </ControlButton>

        <ControlButton
          id="chat-toggle-button"
          label={chatOpen ? 'Ocultar Chat' : 'Chat'}
          onClick={onToggleChat}
          variant={chatOpen ? 'brand' : 'neutral'}
          badge={unreadCount > 0 ? String(unreadCount > 9 ? '9+' : unreadCount) : undefined}
        >
          <MessageSquare size={20} />
        </ControlButton>

        <ControlButton id="leave-button" label="Desconectar" onClick={onLeave} variant="leave">
          <PhoneOff size={21} />
        </ControlButton>
      </div>

      <div className="flex items-center justify-end gap-2 md:flex-1">
        <button id="controlbar-copy-link" type="button" onClick={onCopyLink} className="dc-btn-ghost hidden sm:inline-flex">
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
  variant: 'neutral' | 'danger' | 'active' | 'brand' | 'leave'
  badge?: string
  dimmed?: boolean
  children: ReactNode
}

const VARIANTS: Record<ControlButtonProps['variant'], string> = {
  neutral: 'bg-dc-light text-dc-text hover:bg-dc-hover',
  danger: 'bg-dc-red/15 text-dc-red ring-1 ring-dc-red/40 hover:bg-dc-red/25',
  active: 'bg-dc-green text-white hover:bg-[#1f8b4c] shadow-lg shadow-dc-green/25',
  brand: 'bg-dc-brand text-white hover:bg-dc-brand-hover shadow-lg shadow-dc-brand/25',
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
        className={`relative flex h-11 w-11 items-center justify-center rounded-full transition-all duration-150 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 sm:h-12 sm:w-12 ${
          variant === 'leave' ? 'sm:w-15' : ''
        } ${VARIANTS[variant]} ${dimmed ? 'opacity-50' : ''}`}
      >
        {children}
        {badge && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-dc-yellow px-1 text-[9px] font-black text-black ring-2 ring-dc-darkest">
            {badge}
          </span>
        )}
      </button>
      <span className="pointer-events-none absolute -top-10 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-black px-2.5 py-1.5 text-xs font-semibold text-white opacity-0 shadow-xl transition-opacity group-hover:opacity-100">
        {label}
      </span>
    </div>
  )
}
