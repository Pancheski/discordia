import { useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import { Eye, MicOff, MonitorUp, MoreVertical, Swords, Video } from 'lucide-react'
import { Avatar } from './Avatar'
import { ParticipantMenu } from './ParticipantMenu'
import type { ParticipantMenuAnchor } from './ParticipantMenu'
import type { PeerConnectionState } from '../types'

interface ParticipantTileProps {
  peerId?: string
  name: string
  speaking: boolean
  muted: boolean
  sharing: boolean
  cameraStream?: MediaStream | null
  isLocal?: boolean
  micAvailable?: boolean
  connectionState?: PeerConnectionState
  compact?: boolean
  spotlight?: boolean
  voiceVolume?: number
  screenVolume?: number
  onVoiceVolumeChange?: (value: number) => void
  onScreenVolumeChange?: (value: number) => void
  canKick?: boolean
  onKick?: () => void
  onWatchScreen?: () => void
  isWatchingScreen?: boolean
  onChallengeRps?: (peerId: string) => void
  onDoubleClick?: () => void
}

/**
 * Cartão de participante no palco ou na faixa horizontal inferior.
 * - Modo `compact` (barra inferior): tamanho fixo padronizado (`w-56 h-14`),
 *   truncamento de nomes, indicador `LIVE` minimalista e alinhamento rígido dos ícones à direita.
 * - Suporta menu suspenso / botão direito para volume e moderação (Expulsar).
 */
export function ParticipantTile({
  peerId,
  name,
  speaking,
  muted,
  sharing,
  cameraStream = null,
  isLocal = false,
  micAvailable = true,
  connectionState = 'connected',
  compact = false,
  spotlight = false,
  voiceVolume = 1,
  screenVolume = 1,
  onVoiceVolumeChange,
  onScreenVolumeChange,
  canKick = false,
  onKick,
  onWatchScreen,
  isWatchingScreen = false,
  onChallengeRps,
  onDoubleClick,
}: ParticipantTileProps) {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [contextAnchor, setContextAnchor] = useState<ParticipantMenuAnchor | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canChallenge = !isLocal && !!peerId && !!onChallengeRps
  const canWatch = sharing && !!onWatchScreen
  const hasActiveCamera = Boolean(
    cameraStream && cameraStream.getVideoTracks().some((track) => track.readyState === 'live'),
  )
  const hasOptionsMenu = !isLocal && Boolean(peerId && onVoiceVolumeChange)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return
    if (!hasActiveCamera || !cameraStream) {
      if (videoEl.srcObject) {
        videoEl.srcObject = null
      }
      return
    }
    if (videoEl.srcObject !== cameraStream) {
      videoEl.srcObject = cameraStream
    }
    videoEl.play().catch((err) => {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.warn('[Webcam] Erro ao dar play no vídeo do participante:', err)
    })
  }, [cameraStream, hasActiveCamera, compact, spotlight])

  const openOptionsFromButton = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!hasOptionsMenu) return
    if (contextAnchor) {
      setContextAnchor(null)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    setContextAnchor({ x: rect.right, y: rect.top - 8 })
  }

  const openOptionsFromContext = (e: MouseEvent<HTMLDivElement>) => {
    if (!hasOptionsMenu) return
    e.preventDefault()
    setContextAnchor({ x: e.clientX, y: e.clientY })
  }

  const optionsMenu = hasOptionsMenu && peerId && onVoiceVolumeChange ? (
    <ParticipantMenu
      open={contextAnchor !== null}
      anchor={contextAnchor}
      peerId={peerId}
      name={name}
      voiceVolume={voiceVolume}
      onVoiceVolumeChange={onVoiceVolumeChange}
      isSharingScreen={sharing}
      screenVolume={screenVolume}
      onScreenVolumeChange={onScreenVolumeChange}
      canKick={canKick}
      onKick={onKick}
      onClose={() => setContextAnchor(null)}
    />
  ) : null

  if (compact) {
    if (hasActiveCamera) {
      return (
        <>
          <div
            onDoubleClick={onDoubleClick}
            onContextMenu={openOptionsFromContext}
            title="Clique duas vezes para focar a câmera"
            className={`group relative h-28 w-48 min-w-[192px] max-w-[192px] shrink-0 cursor-pointer select-none overflow-hidden rounded-md bg-dc-darker ring-2 transition-all ${
              speaking
                ? 'ring-dc-green shadow-[0_0_16px_rgba(35,165,90,0.45)]'
                : 'ring-white/[0.08] hover:ring-white/25'
            }`}
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`pointer-events-none absolute inset-0 h-full w-full rounded-md object-cover ${
                isLocal ? 'scale-x-[-1]' : ''
              }`}
            />

            {/* Topo: badge de transmissão de tela (exclusivo para screenStream) e menu de opções no hover */}
            {(sharing || hasOptionsMenu) && (
              <div className="absolute left-1.5 right-1.5 top-1.5 z-10 flex items-center justify-between gap-1">
                {sharing ? (
                  canWatch && !isWatchingScreen ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onWatchScreen()
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded bg-dc-red px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md transition hover:brightness-110"
                      title={`Assistir transmissão de tela de ${name}`}
                    >
                      <MonitorUp size={10} className="shrink-0" />
                      <span>Assistir Tela</span>
                    </button>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded bg-dc-red/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white shadow-md"
                      title="Transmitindo tela"
                    >
                      <MonitorUp size={9} className="shrink-0" />
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                      <span>AO VIVO</span>
                    </span>
                  )
                ) : (
                  <span />
                )}

                {hasOptionsMenu && (
                  <button
                    type="button"
                    onClick={openOptionsFromButton}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className={`rounded bg-black/60 p-1 text-white/90 backdrop-blur-sm transition hover:bg-dc-brand hover:text-white ${
                      contextAnchor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                    title={`Opções de ${name}`}
                    aria-label={`Opções de ${name}`}
                    aria-haspopup="menu"
                    aria-expanded={contextAnchor !== null}
                  >
                    <MoreVertical size={13} />
                  </button>
                )}
              </div>
            )}

            {/* Tarja semitransparente colada na base do card (rosto 100% livre) */}
            <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-1 bg-black/60 p-1 px-1.5 text-xs backdrop-blur-sm">
              <span className="truncate font-medium text-white">
                {name}
                {isLocal && <span className="font-normal text-white/70"> (você)</span>}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                {muted && <MicOff size={12} className="shrink-0 text-dc-red" aria-label="Microfone desativado" />}
              </div>
            </div>
          </div>
          {optionsMenu}
        </>
      )
    }

    return (
      <>
        <div
          onDoubleClick={onDoubleClick}
          onContextMenu={openOptionsFromContext}
          title="Clique duas vezes para expandir"
          className={`group relative flex h-14 w-56 min-w-[224px] max-w-[224px] shrink-0 cursor-pointer select-none items-center gap-2.5 overflow-hidden rounded-xl bg-dc-darker px-2.5 ring-2 transition-all ${
            speaking
              ? 'ring-dc-green shadow-[0_0_16px_rgba(35,165,90,0.4)]'
              : 'ring-white/[0.07] hover:ring-white/20'
          }`}
        >
          {/* Esquerda: Avatar */}
          <div className="relative z-10 shrink-0">
            <Avatar name={name} size={32} speaking={speaking} />
          </div>

          {/* Centro-esquerda: Nome truncado + status minimalista */}
          <div className="relative z-10 min-w-0 flex-1 leading-tight">
            <p className="truncate text-xs font-semibold text-dc-header">
              {name}
              {isLocal && <span className="font-normal text-dc-muted"> (você)</span>}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5">
              {sharing ? (
                canWatch && !isWatchingScreen ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onWatchScreen()
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 rounded bg-dc-red/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-dc-red/40 transition hover:bg-dc-red hover:text-white"
                    title={`Assistir transmissão de tela de ${name}`}
                  >
                    <MonitorUp size={9} className="shrink-0" />
                    <span className="h-1.5 w-1.5 rounded-full bg-dc-red animate-pulse" />
                    <span>AO VIVO · Tela</span>
                  </button>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 rounded bg-dc-red/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-rose-300 ring-1 ring-dc-red/35"
                    title="Transmitindo tela"
                  >
                    <MonitorUp size={9} className="shrink-0" />
                    <span className="h-1.5 w-1.5 rounded-full bg-dc-red animate-pulse" />
                    <span>AO VIVO</span>
                  </span>
                )
              ) : !isLocal && connectionState !== 'connected' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full animate-pulse ${
                      connectionState === 'error' ? 'bg-dc-red' : 'bg-amber-400'
                    }`}
                  />
                  <span className="truncate">
                    {connectionState === 'error' ? 'Reconectando' : 'Conectando'}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] text-dc-muted">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-dc-green" />
                  <span className="truncate">Na chamada</span>
                </span>
              )}
            </div>
          </div>

          {/* Direita: ícones de mudo / controles rigidamente alinhados */}
          <div className="relative z-10 ml-auto flex shrink-0 items-center gap-1">
            {muted && <MicOff size={13} className="shrink-0 text-dc-red" aria-label="Microfone desativado" />}
            {hasOptionsMenu && (
              <button
                type="button"
                onClick={openOptionsFromButton}
                onDoubleClick={(e) => e.stopPropagation()}
                className={`rounded p-1 transition ${
                  contextAnchor
                    ? 'bg-dc-brand text-white'
                    : 'text-dc-muted hover:bg-white/10 hover:text-white'
                }`}
                title={`Opções de ${name}`}
                aria-label={`Opções de ${name}`}
                aria-haspopup="menu"
                aria-expanded={contextAnchor !== null}
              >
                <MoreVertical size={14} />
              </button>
            )}
          </div>
        </div>
        {optionsMenu}
      </>
    )
  }

  return (
    <>
      <div
        onDoubleClick={onDoubleClick}
        onClick={() => {
          if (!hasActiveCamera && (canWatch || canChallenge)) setOverlayOpen((o) => !o)
        }}
        onContextMenu={openOptionsFromContext}
        title={hasActiveCamera ? 'Clique duas vezes para focar a câmera' : 'Clique duas vezes para expandir'}
        className={`group relative flex ${
          spotlight ? 'h-full w-full' : 'aspect-video min-h-36 w-full'
        } animate-fade-up cursor-pointer select-none items-center justify-center overflow-hidden rounded-xl bg-dc-darker ring-2 transition-all duration-200 ${
          speaking ? 'ring-dc-green shadow-[0_0_24px_rgba(35,165,90,0.35)]' : 'ring-white/[0.03]'
        }`}
      >
        {hasActiveCamera ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`pointer-events-none absolute inset-0 h-full w-full rounded-md object-cover ${
              isLocal ? 'scale-x-[-1]' : ''
            }`}
          />
        ) : (
          <>
            <div
              className="pointer-events-none absolute inset-0 opacity-30 transition-opacity group-hover:opacity-50"
              style={{ background: 'radial-gradient(circle at 50% 40%, rgba(88,101,242,0.25), transparent 65%)' }}
            />
            <Avatar name={name} size={spotlight ? 112 : 84} speaking={speaking} />
          </>
        )}

        {/* Ações do canto superior esquerdo: Desafiar 1v1 e (no modo spotlight) botão Assistir Tela */}
        <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
          {spotlight && canWatch && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOverlayOpen(false)
                onWatchScreen()
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-dc-red px-3 py-1.5 text-xs font-bold text-white shadow-lg ring-1 ring-white/20 transition hover:brightness-110"
              title={`Assistir transmissão de tela de ${name}`}
            >
              <MonitorUp size={13} />
              <span>AO VIVO · Assistir Tela</span>
            </button>
          )}
          {canChallenge && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOverlayOpen(false)
                onChallengeRps(peerId)
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className={`inline-flex items-center gap-1.5 rounded-lg border border-dc-brand/40 bg-dc-darkest/90 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur transition ${
                overlayOpen ? 'scale-100 opacity-100' : 'opacity-0 hover:bg-dc-brand group-hover:opacity-100'
              }`}
              title="Desafiar para Pedra, Papel e Tesoura (Melhor de 3)"
            >
              <Swords size={14} className="text-dc-brand-soft group-hover:text-white" />
              <span>Desafiar 1v1</span>
            </button>
          )}
        </div>

        {/* Overlay central opt-in apenas quando NÃO há câmera ativa (nunca cobre o rosto da webcam) */}
        {canWatch && !hasActiveCamera && !spotlight && (
          <div
            className={`absolute inset-0 z-10 flex items-center justify-center bg-black/55 backdrop-blur-[2px] transition-opacity duration-200 ${
              overlayOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setOverlayOpen(false)
                onWatchScreen()
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-2 rounded-xl bg-dc-red px-4 py-2.5 text-sm font-bold text-white shadow-xl ring-2 ring-white/20 transition hover:scale-105 hover:bg-dc-red/90"
            >
              <Eye size={16} />
              <span>Assistir Tela</span>
            </button>
          </div>
        )}

        {/* Tarja semitransparente colada na base do card quando a câmera está ligada, ou badge inferior quando avatar */}
        {hasActiveCamera ? (
          <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-2 bg-black/60 px-2.5 py-1.5 text-xs backdrop-blur-sm">
            <div className="flex min-w-0 items-center gap-1.5">
              <Video size={13} className="shrink-0 text-emerald-400" aria-label="Câmera ativa" />
              <span className="truncate font-medium text-white">
                {name}
                {isLocal && <span className="text-white/60"> (você)</span>}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {muted && <MicOff size={13} className="shrink-0 text-dc-red" aria-label="Microfone desativado" />}
            </div>
          </div>
        ) : (
          <div className="absolute bottom-2.5 left-2.5 z-10 flex max-w-[calc(100%-3.5rem)] items-center gap-2 rounded-md bg-black/60 px-2.5 py-1 backdrop-blur-sm">
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
        )}

        {!spotlight && (
          <div className="absolute right-2.5 top-2.5 z-10 flex items-center gap-1.5">
            {sharing &&
              (canWatch ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setOverlayOpen(false)
                    onWatchScreen()
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-dc-red/95 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md ring-1 ring-white/20 transition hover:scale-105 hover:bg-dc-red"
                  title={`Assistir transmissão de tela de ${name}`}
                >
                  <MonitorUp size={11} />
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  <span>AO VIVO · Assistir Tela</span>
                </button>
              ) : (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-dc-red/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md"
                  title="Transmitindo tela"
                >
                  <MonitorUp size={11} />
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  <span>AO VIVO</span>
                </span>
              ))}
            {hasOptionsMenu && (
              <button
                type="button"
                onClick={openOptionsFromButton}
                onDoubleClick={(e) => e.stopPropagation()}
                className={`rounded-md bg-black/60 p-1 text-white/80 backdrop-blur-sm transition hover:bg-dc-brand hover:text-white ${
                  contextAnchor ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
                title={`Opções de ${name}`}
                aria-label={`Opções de ${name}`}
              >
                <MoreVertical size={15} />
              </button>
            )}
          </div>
        )}
      </div>
      {optionsMenu}
    </>
  )
}
