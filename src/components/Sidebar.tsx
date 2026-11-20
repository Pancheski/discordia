import {
  AudioWaveform,
  Check,
  Copy,
  Crown,
  Hash,
  Mic,
  MicOff,
  MonitorUp,
  MoreVertical,
  PanelLeftClose,
  Swords,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useState } from 'react'
import type { MouseEvent } from 'react'
import { Avatar } from './Avatar'
import { ParticipantMenu } from './ParticipantMenu'
import type { ParticipantMenuAnchor } from './ParticipantMenu'
import { useAudioSystem } from '../hooks/useAudioSystem'
import { MAX_PEERS } from '../lib/utils'
import type { LocalState, MediaKind, PeerConnectionState, RemoteParticipant } from '../types'

interface SidebarProps {
  room: string
  ownerId: string | null
  local: LocalState
  participants: RemoteParticipant[]
  open: boolean
  mobileOpen: boolean
  onClose: () => void
  onToggleCollapse?: () => void
  onCopyLink: () => Promise<boolean>
  onVolume: (peerId: string, kind: MediaKind, value: number) => void
  onToggleMute: () => void
  onChallengeRps: (peerId: string) => void
  onKickParticipant: (peerId: string) => void
}

interface ActiveMenuState {
  peerId: string
  anchor: ParticipantMenuAnchor
}

export function Sidebar({
  room,
  ownerId,
  local,
  participants,
  open,
  mobileOpen,
  onClose,
  onToggleCollapse,
  onCopyLink,
  onVolume,
  onToggleMute,
  onChallengeRps,
  onKickParticipant,
}: SidebarProps) {
  const [copied, setCopied] = useState(false)
  const [activeMenu, setActiveMenu] = useState<ActiveMenuState | null>(null)
  const { sfxVolume, sfxMuted, setSfxVolume, toggleSfxMute } = useAudioSystem()
  const total = participants.length + 1
  const isLocalOwner = Boolean(ownerId && local.peerId && ownerId === local.peerId)
  const menuParticipant = activeMenu ? participants.find((p) => p.peerId === activeMenu.peerId) ?? null : null

  const handleCopy = async () => {
    if (await onCopyLink()) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }

  const openMenuFromButton = (e: MouseEvent<HTMLButtonElement>, peerId: string) => {
    e.stopPropagation()
    if (activeMenu?.peerId === peerId) {
      setActiveMenu(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setActiveMenu({ peerId, anchor: { x: rect.right + 6, y: rect.top } })
  }

  const openMenuFromContext = (e: MouseEvent<HTMLLIElement>, peerId: string) => {
    e.preventDefault()
    setActiveMenu({ peerId, anchor: { x: e.clientX, y: e.clientY } })
  }

  return (
    <>
      {/* Overlay mobile */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity md:hidden ${
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col overflow-hidden bg-dc-darker transition-all duration-300 ease-in-out md:static md:translate-x-0 ${
          mobileOpen ? 'w-72 translate-x-0' : 'w-72 -translate-x-full'
        } ${open ? 'md:w-72 md:opacity-100' : 'md:pointer-events-none md:w-0 md:min-w-0 md:opacity-0'}`}
        aria-label="Participantes"
      >
        <div className="flex h-full w-72 shrink-0 flex-col">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-black/30 px-4 shadow-sm">
          <h2 className="flex min-w-0 items-center gap-1.5 font-semibold text-dc-header">
            <Hash size={18} className="shrink-0 text-dc-muted" />
            <span className="truncate">{room}</span>
          </h2>
          <div className="flex items-center gap-1">
            <button
              id="sidebar-copy-link"
              type="button"
              onClick={handleCopy}
              className={`rounded p-1.5 transition ${copied ? 'text-dc-green' : 'text-dc-muted hover:bg-dc-hover hover:text-dc-text'}`}
              title="Copiar link de convite"
              aria-label="Copiar link de convite"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
            {onToggleCollapse && (
              <button
                type="button"
                onClick={onToggleCollapse}
                className="hidden rounded p-1.5 text-dc-muted transition hover:bg-dc-hover hover:text-dc-text md:inline-flex"
                title="Recolher barra lateral"
                aria-label="Recolher barra lateral"
              >
                <PanelLeftClose size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1.5 text-dc-muted transition hover:bg-dc-hover hover:text-dc-text md:hidden"
              aria-label="Fechar painel"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-2 py-4">
          <div className="mb-2 flex items-center justify-between px-2 text-xs font-bold uppercase tracking-wide text-dc-muted">
            <span className="flex items-center gap-1.5">
              <Volume2 size={13} /> Canal de voz
            </span>
            <span className="tabular-nums">
              {total}/{MAX_PEERS}
            </span>
          </div>

          <ul className="space-y-1">
            <li className="rounded-md px-2 py-1.5 transition hover:bg-dc-hover/50">
              <div className="flex items-center gap-2.5">
                <Avatar name={local.name} size={32} speaking={local.speaking} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="flex items-center gap-1">
                    <p className={`truncate text-sm font-medium ${local.speaking ? 'text-dc-header' : 'text-dc-text'}`}>
                      {local.name} <span className="text-dc-muted">(você)</span>
                    </p>
                    {isLocalOwner && (
                      <Crown size={12} className="shrink-0 text-amber-400" aria-label="Dono da sala" />
                    )}
                  </div>
                  {!local.micAvailable && (
                    <p className="truncate text-[10px] font-medium text-amber-400">
                      Microfone desativado ou não detectado
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {local.screenStream && <LiveIndicator />}
                  {local.muted && <MicOff size={15} className="text-dc-red" />}
                </div>
              </div>
            </li>

            {participants.map((p) => {
              const isPeerOwner = Boolean(ownerId && p.peerId === ownerId)
              const isMenuOpen = activeMenu?.peerId === p.peerId
              return (
                <li
                  key={p.peerId}
                  onContextMenu={(e) => openMenuFromContext(e, p.peerId)}
                  className={`group rounded-md px-2 py-1.5 transition ${
                    isMenuOpen ? 'bg-dc-hover/80' : 'hover:bg-dc-hover/50'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Avatar name={p.name} size={32} speaking={p.speaking} />
                    <div className="min-w-0 flex-1 leading-tight">
                      <div className="flex items-center gap-1">
                        <p className={`truncate text-sm font-medium ${p.speaking ? 'text-dc-header' : 'text-dc-text'}`}>
                          {p.name}
                        </p>
                        {isPeerOwner && (
                          <Crown size={12} className="shrink-0 text-amber-400" aria-label="Dono da sala" />
                        )}
                      </div>
                      <PeerStatusLabel state={p.connectionState} />
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      {p.sharing && <LiveIndicator />}
                      {p.muted && <MicOff size={14} className="text-dc-red" />}
                      <button
                        type="button"
                        onClick={() => onChallengeRps(p.peerId)}
                        className="rounded p-1 text-dc-muted opacity-70 transition hover:bg-dc-brand hover:text-white group-hover:opacity-100"
                        title={`Desafiar ${p.name} para Pedra, Papel e Tesoura`}
                        aria-label={`Desafiar ${p.name} para Pedra, Papel e Tesoura`}
                      >
                        <Swords size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => openMenuFromButton(e, p.peerId)}
                        className={`rounded p-1 transition ${
                          isMenuOpen
                            ? 'bg-dc-brand text-white'
                            : 'text-dc-muted hover:bg-white/10 hover:text-dc-header'
                        }`}
                        title={`Opções de ${p.name} (ou clique com o botão direito)`}
                        aria-label={`Opções de ${p.name}`}
                        aria-haspopup="menu"
                        aria-expanded={isMenuOpen}
                      >
                        <MoreVertical size={15} />
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          {participants.length === 0 && (
            <div className="mx-2 mt-4 rounded-lg border border-dashed border-dc-border p-4 text-center">
              <p className="text-sm text-dc-muted">Ninguém por aqui ainda.</p>
              <button type="button" onClick={handleCopy} className="dc-btn-primary mt-3 w-full py-2 text-sm">
                <Copy size={14} /> Convidar amigos
              </button>
            </div>
          )}
        </div>

        {/* Controle de Volume dos Sons do App (UI SFX + Soundboard) */}
        <div className="border-t border-black/30 bg-[#26282d] px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-dc-muted">
            <span className="inline-flex items-center gap-1.5">
              <AudioWaveform size={12} className="text-dc-brand-soft" /> Sons do App
            </span>
            <button
              type="button"
              onClick={toggleSfxMute}
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold transition ${
                sfxMuted ? 'bg-dc-red/20 text-dc-red' : 'bg-dc-light text-dc-text hover:bg-dc-hover'
              }`}
              title={sfxMuted ? 'Ativar efeitos sonoros da interface' : 'Mutar efeitos sonoros da interface'}
            >
              {sfxMuted ? <VolumeX size={11} /> : <Volume2 size={11} />}
              {sfxMuted ? 'Mutado' : `${Math.round(sfxVolume * 100)}%`}
            </button>
          </div>
          <input
            id="app-sfx-volume-slider"
            type="range"
            min={0}
            max={100}
            value={sfxMuted ? 0 : Math.round(sfxVolume * 100)}
            onChange={(e) => {
              const next = Number(e.target.value) / 100
              if (sfxMuted && next > 0) toggleSfxMute()
              setSfxVolume(next)
            }}
            style={{ '--val': `${sfxMuted ? 0 : Math.round(sfxVolume * 100)}%` } as React.CSSProperties}
            className="dc-range w-full"
            aria-label="Volume dos sons do aplicativo"
          />
        </div>

        {/* Painel do usuário */}
        <footer className="flex h-[3.25rem] shrink-0 items-center gap-2 bg-[#232428] px-2">
          <Avatar name={local.name} size={32} speaking={local.speaking} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-dc-header">{local.name}</p>
            <p className="flex items-center gap-1 text-[11px] font-medium text-dc-green">
              <span className="h-1.5 w-1.5 rounded-full bg-dc-green" /> Conectado via P2P
            </p>
          </div>
          <button
            type="button"
            onClick={onToggleMute}
            className={`rounded p-2 transition hover:bg-dc-hover ${local.muted ? 'text-dc-red' : 'text-dc-muted hover:text-dc-text'}`}
            title={local.muted ? 'Ativar microfone' : 'Silenciar microfone'}
            aria-label={local.muted ? 'Ativar microfone' : 'Silenciar microfone'}
          >
            {local.muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        </footer>
        </div>
      </aside>

      {menuParticipant && activeMenu && (
        <ParticipantMenu
          open
          anchor={activeMenu.anchor}
          peerId={menuParticipant.peerId}
          name={menuParticipant.name}
          voiceVolume={menuParticipant.voiceVolume}
          onVoiceVolumeChange={(v) => onVolume(menuParticipant.peerId, 'mic', v)}
          isSharingScreen={Boolean(menuParticipant.sharing || menuParticipant.screenStream)}
          screenVolume={menuParticipant.screenVolume}
          onScreenVolumeChange={(v) => onVolume(menuParticipant.peerId, 'screen', v)}
          canKick={isLocalOwner}
          onKick={() => onKickParticipant(menuParticipant.peerId)}
          onClose={() => setActiveMenu(null)}
        />
      )}
    </>
  )
}

function PeerStatusLabel({ state }: { state: PeerConnectionState }) {
  if (state === 'connected') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-dc-green">
        <span className="h-1.5 w-1.5 rounded-full bg-dc-green" />
        Conectado
      </span>
    )
  }
  if (state === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-dc-red">
        <span className="h-1.5 w-1.5 rounded-full bg-dc-red animate-pulse" />
        Reconectando rota...
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-400">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
      Conectando rota...
    </span>
  )
}

function LiveIndicator() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded bg-dc-red/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-dc-red/40"
      title="Transmitindo tela"
    >
      <MonitorUp size={10} className="shrink-0" />
      <span className="h-1.5 w-1.5 rounded-full bg-dc-red animate-pulse" />
    </span>
  )
}
