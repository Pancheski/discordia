import { Check, Copy, Hash, Mic, MicOff, MonitorUp, Volume2, X } from 'lucide-react'
import { useState } from 'react'
import { Avatar } from './Avatar'
import { VolumeSlider } from './VolumeSlider'
import { MAX_PEERS } from '../lib/utils'
import type { LocalState, MediaKind, RemoteParticipant } from '../types'

interface SidebarProps {
  room: string
  local: LocalState
  participants: RemoteParticipant[]
  open: boolean
  onClose: () => void
  onCopyLink: () => Promise<boolean>
  onVolume: (peerId: string, kind: MediaKind, value: number) => void
  onToggleMute: () => void
}

export function Sidebar({ room, local, participants, open, onClose, onCopyLink, onVolume, onToggleMute }: SidebarProps) {
  const [copied, setCopied] = useState(false)
  const total = participants.length + 1

  const handleCopy = async () => {
    if (await onCopyLink()) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    }
  }

  return (
    <>
      {/* Overlay mobile */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity md:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-dc-darker transition-transform duration-300 md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Participantes"
      >
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

          <ul className="space-y-0.5">
            <li className="rounded-md px-2 py-1.5 transition hover:bg-dc-hover/50">
              <div className="flex items-center gap-2.5">
                <Avatar name={local.name} size={32} speaking={local.speaking} />
                <span className={`flex-1 truncate text-sm font-medium ${local.speaking ? 'text-dc-header' : 'text-dc-text'}`}>
                  {local.name} <span className="text-dc-muted">(você)</span>
                </span>
                {local.screenStream && <LiveBadge />}
                {local.muted && <MicOff size={15} className="text-dc-red" />}
              </div>
            </li>

            {participants.map((p) => (
              <li key={p.peerId} className="rounded-md px-2 py-1.5 transition hover:bg-dc-hover/50">
                <div className="flex items-center gap-2.5">
                  <Avatar name={p.name} size={32} speaking={p.speaking} />
                  <span className={`flex-1 truncate text-sm font-medium ${p.speaking ? 'text-dc-header' : 'text-dc-text'}`}>
                    {p.name}
                  </span>
                  {p.sharing && <LiveBadge />}
                  {p.muted && <MicOff size={15} className="text-dc-red" />}
                </div>
                <div className="mt-1.5 space-y-1 pl-[2.6rem]">
                  <VolumeSlider
                    id={`voice-volume-${p.peerId}`}
                    value={p.voiceVolume}
                    onChange={(v) => onVolume(p.peerId, 'mic', v)}
                    label={`Voz de ${p.name}`}
                  />
                  {p.screenStream && (
                    <div className="flex items-center gap-1">
                      <MonitorUp size={12} className="shrink-0 text-dc-faint" />
                      <VolumeSlider
                        id={`screen-volume-side-${p.peerId}`}
                        value={p.screenVolume}
                        onChange={(v) => onVolume(p.peerId, 'screen', v)}
                        label={`Áudio da tela de ${p.name}`}
                        className="flex-1"
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
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

        {/* Painel do usuário */}
        <footer className="flex h-[3.25rem] shrink-0 items-center gap-2 bg-[#232428] px-2">
          <Avatar name={local.name} size={32} speaking={local.speaking} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-semibold text-dc-header">{local.name}</p>
            <p className="flex items-center gap-1 text-[11px] font-medium text-dc-green">
              <span className="h-1.5 w-1.5 rounded-full bg-dc-green" /> Voz conectada
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
      </aside>
    </>
  )
}

function LiveBadge() {
  return (
    <span className="rounded bg-dc-red px-1 py-px text-[9px] font-bold uppercase tracking-wider text-white">Ao vivo</span>
  )
}
