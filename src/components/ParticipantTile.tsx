import { useState } from 'react'
import { Eye, MicOff, MonitorUp, Swords, Volume2 } from 'lucide-react'
import { Avatar } from './Avatar'
import { VolumeSlider } from './VolumeSlider'
import type { PeerConnectionState } from '../types'

interface ParticipantTileProps {
  peerId?: string
  name: string
  speaking: boolean
  muted: boolean
  sharing: boolean
  isLocal?: boolean
  micAvailable?: boolean
  connectionState?: PeerConnectionState
  compact?: boolean
  voiceVolume?: number
  onVoiceVolumeChange?: (value: number) => void
  onWatchScreen?: () => void
  isWatchingScreen?: boolean
  onChallengeRps?: (peerId: string) => void
}

/**
 * Cartão de participante no palco ou na faixa horizontal inferior.
 * Borda verde pulsante quando há fala detectada, etiqueta "🔴 AO VIVO / Transmitindo",
 * botão "Assistir Transmissão" (opt-in) e controle de volume integrado.
 */
export function ParticipantTile({
  peerId,
  name,
  speaking,
  muted,
  sharing,
  isLocal = false,
  micAvailable = true,
  connectionState = 'connected',
  compact = false,
  voiceVolume = 1,
  onVoiceVolumeChange,
  onWatchScreen,
  isWatchingScreen = false,
  onChallengeRps,
}: ParticipantTileProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const canChallenge = !isLocal && !!peerId && !!onChallengeRps
  const canWatch = sharing && !!onWatchScreen

  if (compact) {
    return (
      <div
        className={`flex shrink-0 items-center gap-2.5 rounded-xl bg-dc-darker px-3 py-2 ring-2 transition-all ${
          speaking
            ? 'ring-dc-green shadow-[0_0_18px_rgba(35,165,90,0.35)]'
            : 'ring-white/[0.06] hover:ring-white/15'
        }`}
      >
        <Avatar name={name} size={32} speaking={speaking} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="max-w-28 truncate text-xs font-semibold text-dc-text">
              {name}
              {isLocal && <span className="text-dc-muted"> (você)</span>}
            </span>
            {!isLocal && connectionState !== 'connected' && (
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  connectionState === 'error' ? 'bg-dc-red animate-pulse' : 'bg-amber-400 animate-pulse'
                }`}
                title={connectionState === 'error' ? 'Reconectando rota...' : 'Conectando rota...'}
              />
            )}
            {muted && <MicOff size={13} className="shrink-0 text-dc-red" />}
          </div>
          {sharing && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-rose-400">
              🔴 AO VIVO · Transmitindo
            </span>
          )}
        </div>

        {canWatch && !isWatchingScreen && (
          <button
            type="button"
            onClick={onWatchScreen}
            className="inline-flex items-center gap-1 rounded-lg bg-dc-red px-2.5 py-1 text-[11px] font-bold text-white shadow transition hover:bg-dc-red/90"
            title={`Assistir transmissão de ${name}`}
          >
            <Eye size={12} />
            <span>Assistir Transmissão</span>
          </button>
        )}

        {!isLocal && onVoiceVolumeChange && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShowVolume((v) => !v)}
              className={`rounded-lg p-1.5 text-xs transition ${
                showVolume ? 'bg-dc-brand text-white' : 'bg-white/5 text-dc-muted hover:bg-white/10 hover:text-white'
              }`}
              title={`Ajustar volume de ${name}`}
            >
              <Volume2 size={13} />
            </button>
            {showVolume && (
              <div className="w-28 pr-1">
                <VolumeSlider
                  id={`compact-vol-${peerId ?? name}`}
                  value={voiceVolume}
                  onChange={onVoiceVolumeChange}
                  label={`Volume de ${name}`}
                />
              </div>
            )}
          </div>
        )}

        {canChallenge && (
          <button
            type="button"
            onClick={() => onChallengeRps(peerId)}
            className="rounded-lg bg-dc-brand/20 p-1.5 text-dc-brand-soft transition hover:bg-dc-brand hover:text-white"
            title={`Desafiar ${name} para Pedra, Papel e Tesoura`}
          >
            <Swords size={13} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      onClick={() => {
        if (canWatch || canChallenge) setMenuOpen((o) => !o)
      }}
      onContextMenu={(e) => {
        if (!canChallenge && !canWatch) return
        e.preventDefault()
        setMenuOpen(true)
      }}
      className={`group relative flex aspect-video min-h-36 w-full animate-fade-up items-center justify-center overflow-hidden rounded-xl bg-dc-darker ring-2 transition-all duration-200 ${
        speaking ? 'ring-dc-green shadow-[0_0_24px_rgba(35,165,90,0.25)]' : 'ring-white/[0.03]'
      } ${canChallenge || canWatch ? 'cursor-pointer' : ''}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-30 transition-opacity group-hover:opacity-50"
        style={{ background: 'radial-gradient(circle at 50% 40%, rgba(88,101,242,0.25), transparent 65%)' }}
      />
      <Avatar name={name} size={84} speaking={speaking} />

      {/* Botão rápido no hover ou menu ao clicar sobre o participante */}
      {canChallenge && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen(false)
            onChallengeRps(peerId)
          }}
          className={`absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-lg border border-dc-brand/40 bg-dc-darkest/90 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition ${
            menuOpen ? 'opacity-100 scale-100' : 'opacity-0 group-hover:opacity-100 hover:bg-dc-brand'
          }`}
          title="Desafiar para Pedra, Papel e Tesoura (Melhor de 3)"
        >
          <Swords size={14} className="text-dc-brand-soft group-hover:text-white" />
          <span>Desafiar 1v1</span>
        </button>
      )}

      {/* Overlay/Botão Opt-in "Assistir Transmissão" ao passar o mouse ou clicar no cartão de quem transmite */}
      {canWatch && (
        <div
          className={`absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-[2px] transition-opacity duration-200 ${
            menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(false)
              onWatchScreen()
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-dc-red px-4 py-2.5 text-sm font-bold text-white shadow-xl ring-2 ring-white/20 transition hover:scale-105 hover:bg-dc-red/90"
          >
            <Eye size={16} />
            <span>Assistir Transmissão</span>
          </button>
        </div>
      )}

      <div className="absolute bottom-2.5 left-2.5 flex max-w-[calc(100%-1.25rem)] items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 backdrop-blur">
        {muted && <MicOff size={14} className="shrink-0 text-dc-red" aria-label="Microfone desativado" />}
        <div className="min-w-0 leading-tight">
          <span className="block truncate text-sm font-medium text-white">
            {name}
            {isLocal && <span className="text-white/60"> (você)</span>}
          </span>
          {isLocal && !micAvailable ? (
            <span className="block truncate text-[10px] font-medium text-amber-300">
              Microfone desativado ou não detectado
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 text-[10px] font-medium ${
                connectionState === 'connected'
                  ? 'text-emerald-400'
                  : connectionState === 'error'
                    ? 'text-rose-400'
                    : 'text-amber-300'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  connectionState === 'connected'
                    ? 'bg-emerald-400'
                    : connectionState === 'error'
                      ? 'bg-rose-400 animate-pulse'
                      : 'bg-amber-300 animate-pulse'
                }`}
              />
              {connectionState === 'connected'
                ? 'Conectado'
                : connectionState === 'error'
                  ? 'Reconectando rota...'
                  : 'Conectando rota...'}
            </span>
          )}
        </div>
      </div>

      {sharing && (
        <span className="absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-md bg-dc-red px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
          <MonitorUp size={12} /> 🔴 AO VIVO · Transmitindo
        </span>
      )}
    </div>
  )
}
