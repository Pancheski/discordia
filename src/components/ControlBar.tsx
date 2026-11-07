import {
  AudioWaveform,
  Film,
  Headphones,
  Link2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Rocket,
  Settings,
  Signal,
  Video,
  VideoOff,
  VolumeX,
  Zap,
} from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppActivityId, PeerConnectionState, ScreenSharePreset } from '../types'

interface ControlBarProps {
  room: string
  muted: boolean
  deafened: boolean
  micAvailable: boolean
  cameraEnabled: boolean
  sharing: boolean
  screenSupported: boolean
  screenPreset?: ScreenSharePreset
  isRemotePlayActive?: boolean
  chatOpen: boolean
  unreadCount: number
  soundboardOpen: boolean
  appsOpen: boolean
  activeApp: AppActivityId
  meshState?: PeerConnectionState
  onToggleMute: () => void
  onToggleDeafen: () => void
  onToggleCamera: () => void
  onToggleScreen: () => void
  onStartScreenShare?: (preset: ScreenSharePreset) => void
  onTogglePreset?: () => void
  onToggleSoundboard: () => void
  onToggleApps: () => void
  onToggleChat: () => void
  onOpenSettings: () => void
  onLeave: () => void
  onCopyLink: () => void
}

export function ControlBar({
  room,
  muted,
  deafened,
  micAvailable,
  cameraEnabled,
  sharing,
  screenSupported,
  screenPreset = 'quality',
  isRemotePlayActive = false,
  chatOpen,
  unreadCount,
  soundboardOpen,
  appsOpen,
  activeApp,
  meshState = 'connected',
  onToggleMute,
  onToggleDeafen,
  onToggleCamera,
  onToggleScreen,
  onStartScreenShare,
  onTogglePreset,
  onToggleSoundboard,
  onToggleApps,
  onToggleChat,
  onOpenSettings,
  onLeave,
  onCopyLink,
}: ControlBarProps) {
  const [screenMenuOpen, setScreenMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!screenMenuOpen) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setScreenMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handleClickOutside)
    return () => document.removeEventListener('pointerdown', handleClickOutside)
  }, [screenMenuOpen])
  const micLabel = !micAvailable ? 'Ativar microfone' : muted ? 'Ativar microfone' : 'Silenciar microfone'
  const deafenLabel = deafened ? 'Desativar ensurdecer' : 'Ensurdecer'
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
          id="deafen-toggle-button"
          label={deafenLabel}
          onClick={onToggleDeafen}
          variant={deafened ? 'danger' : 'neutral'}
        >
          {deafened ? <VolumeX size={21} /> : <Headphones size={21} />}
        </ControlButton>

        <ControlButton
          id="camera-toggle-button"
          label={cameraEnabled ? 'Desligar Câmera' : 'Ligar Câmera'}
          onClick={onToggleCamera}
          variant={cameraEnabled ? 'active' : 'neutral'}
        >
          {cameraEnabled ? <Video size={21} /> : <VideoOff size={21} />}
        </ControlButton>

        <div className="relative inline-flex items-center">
          <ControlButton
            id="screen-toggle-button"
            label={sharing ? 'Parar Transmissão' : 'Compartilhar Tela'}
            onClick={() => {
              if (sharing) {
                onToggleScreen()
              } else {
                setScreenMenuOpen((o) => !o)
              }
            }}
            variant={sharing ? 'active' : 'neutral'}
            dimmed={!screenSupported}
          >
            {sharing ? <MonitorOff size={21} /> : <MonitorUp size={21} />}
          </ControlButton>

          {sharing && onTogglePreset && (
            <button
              type="button"
              onClick={onTogglePreset}
              className={`absolute -top-2.5 -right-2.5 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold shadow-md ring-1 ring-black/40 transition ${
                screenPreset === 'game'
                  ? 'bg-amber-400 text-black hover:bg-amber-300'
                  : 'bg-dc-brand text-white hover:bg-dc-brand/90'
              }`}
              title={`Alternar qualidade (atual: ${screenPreset === 'game' ? '720p 60 FPS • Latência Zero' : '1080p 60 FPS'})`}
            >
              {screenPreset === 'game' ? <Zap size={10} className="fill-black" /> : <Film size={10} />}
              <span>{screenPreset === 'game' ? '720p' : '1080p'}</span>
            </button>
          )}

          {screenMenuOpen && !sharing && (
            <div
              ref={menuRef}
              className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 w-72 rounded-xl border border-white/10 bg-dc-darkest/95 p-2 shadow-2xl backdrop-blur z-50 text-left animate-in fade-in"
            >
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-dc-muted">
                Qualidade da Transmissão
              </div>
              <div className="mt-1 flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setScreenMenuOpen(false)
                    if (onStartScreenShare) {
                      onStartScreenShare('game')
                    } else {
                      onToggleScreen()
                    }
                  }}
                  className={`flex items-start gap-2.5 rounded-lg p-2 transition text-left ${
                    isRemotePlayActive || screenPreset === 'game'
                      ? 'bg-amber-500/15 border border-amber-500/30 text-amber-200'
                      : 'hover:bg-white/5 text-white/90'
                  }`}
                >
                  <div className="mt-0.5 rounded bg-amber-500/20 p-1.5 text-amber-400">
                    <Zap size={16} className="fill-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <span>⚡ Modo Jogo (720p)</span>
                      <span className="rounded bg-amber-400 px-1 py-0.2 text-[9px] font-black text-black">
                        60 FPS
                      </span>
                    </div>
                    <p className="text-[11px] text-white/60 leading-tight mt-0.5">
                      Latência Zero. Padrão para Remote Play e jogos rápidos.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setScreenMenuOpen(false)
                    if (onStartScreenShare) {
                      onStartScreenShare('quality')
                    } else {
                      onToggleScreen()
                    }
                  }}
                  className={`flex items-start gap-2.5 rounded-lg p-2 transition text-left ${
                    !isRemotePlayActive && screenPreset === 'quality'
                      ? 'bg-dc-brand/20 border border-dc-brand/40 text-indigo-200'
                      : 'hover:bg-white/5 text-white/90'
                  }`}
                >
                  <div className="mt-0.5 rounded bg-dc-brand/20 p-1.5 text-dc-brand">
                    <Film size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <span>🎬 Alta Qualidade (1080p)</span>
                      <span className="rounded bg-dc-brand px-1 py-0.2 text-[9px] font-black text-white">
                        60 FPS
                      </span>
                    </div>
                    <p className="text-[11px] text-white/60 leading-tight mt-0.5">
                      Nitidez máxima para vídeos, filmes e tela.
                    </p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

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

        <ControlButton
          id="keybind-settings-button"
          label="Atalhos de Teclado"
          onClick={onOpenSettings}
          variant="neutral"
        >
          <Settings size={20} />
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
