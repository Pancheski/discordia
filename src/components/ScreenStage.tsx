import { useCallback, useEffect, useRef, useState } from 'react'
import { EyeOff, Film, Maximize2, Minimize2, MonitorUp, VolumeX, Zap } from 'lucide-react'
import type { PeerStats, ScreenSharePreset } from '../types'
import { VolumeSlider } from './VolumeSlider'

export interface ScreenSource {
  id: string
  name: string
  stream: MediaStream | null
  isLocal: boolean
  volume: number
  hasAudio: boolean
  stats?: PeerStats
}

interface ScreenStageProps {
  screen: ScreenSource
  screenPreset?: ScreenSharePreset
  onPresetChange?: (preset: ScreenSharePreset) => void
  onVolumeChange: (value: number) => void
  onStopWatching?: () => void
}

export function ScreenStage({
  screen,
  screenPreset = 'quality',
  onPresetChange,
  onVolumeChange,
  onStopWatching,
}: ScreenStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // 1) Atribuição direta e nativa de srcObject = stream
  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    if (!screen.stream) {
      if (videoEl.srcObject) {
        videoEl.srcObject = null
      }
      return
    }

    if (videoEl.srcObject !== screen.stream) {
      videoEl.srcObject = screen.stream
    }

    videoEl.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.debug('[discordia] video play() aguardando interação:', err)
    })
  }, [screen.stream])

  // 2) Ajuste nativo de volume diretamente no elemento <video>
  useEffect(() => {
    const videoEl = videoRef.current
    if (videoEl && !screen.isLocal) {
      videoEl.volume = Math.max(0, Math.min(1, screen.volume))
    }
  }, [screen.volume, screen.isLocal])

  const [isFullscreen, setIsFullscreen] = useState(false)
  const [resolution, setResolution] = useState('')

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = () => {
      if (video.videoWidth) setResolution(`${video.videoWidth}×${video.videoHeight}`)
    }
    update()
    video.addEventListener('resize', update)
    video.addEventListener('loadedmetadata', update)
    return () => {
      video.removeEventListener('resize', update)
      video.removeEventListener('loadedmetadata', update)
    }
  }, [screen.stream])

  const toggleFullscreen = useCallback(async () => {
    const el = containerRef.current
    if (!el) return
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' })
      } else {
        const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
        video?.webkitEnterFullscreen?.()
      }
    } catch (err) {
      console.warn('[discordia] fullscreen', err)
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="stage-fullscreen group relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-xl bg-black ring-1 ring-white/5"
      onDoubleClick={toggleFullscreen}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={screen.isLocal}
        className="h-full w-full object-contain"
      />

      {!screen.stream && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/80 text-center text-xs text-dc-muted">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-dc-brand border-t-transparent" />
          <span>Conectando à transmissão de {screen.isLocal ? 'sua tela' : screen.name}…</span>
        </div>
      )}

      {/* Barra superior */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/75 to-transparent p-3 opacity-100 transition-opacity duration-300">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1.5 rounded bg-dc-red px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-live rounded-full bg-white" /> AO VIVO
          </span>
          <span className="truncate text-sm font-semibold text-white drop-shadow">
            {screen.isLocal ? 'Sua transmissão' : screen.name}
          </span>
          {resolution && <span className="hidden text-xs text-white/60 sm:inline">{resolution}</span>}

          {/* Telemetria de Latência Real (Ping ms + Tipo de Conexão P2P vs TURN) */}
          {screen.stats && !screen.isLocal && (
            <span className="hidden items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-2 py-0.5 font-mono text-[11px] text-white/90 backdrop-blur sm:inline-flex">
              <span className="font-bold text-emerald-400">
                ⚡ {screen.stats.rttMs !== null ? `${screen.stats.rttMs} ms` : '0 ms'}
              </span>
              <span className="text-white/30">·</span>
              <span className={screen.stats.isRelay ? 'font-medium text-amber-300' : 'font-medium text-emerald-300'}>
                {screen.stats.isRelay ? '🟡 Retransmitida (TURN)' : '🟢 Direta (P2P UDP)'}
              </span>
            </span>
          )}
          {screen.isLocal && onPresetChange ? (
            <div className="pointer-events-auto ml-1 inline-flex items-center rounded-md border border-white/10 bg-black/60 p-0.5 text-[11px] backdrop-blur">
              <button
                type="button"
                onClick={() => onPresetChange('game')}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition ${
                  screenPreset === 'game'
                    ? 'bg-amber-400 text-black font-bold shadow'
                    : 'text-white/70 hover:text-white'
                }`}
                title="⚡ Modo Jogo (720p 60 FPS • Latência Zero)"
              >
                <Zap size={11} className={screenPreset === 'game' ? 'fill-black' : ''} />
                <span>Modo Jogo (720p)</span>
              </button>
              <button
                type="button"
                onClick={() => onPresetChange('quality')}
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium transition ${
                  screenPreset === 'quality'
                    ? 'bg-dc-brand text-white font-bold shadow'
                    : 'text-white/70 hover:text-white'
                }`}
                title="🎬 Alta Qualidade (1080p 60 FPS)"
              >
                <Film size={11} />
                <span>1080p</span>
              </button>
            </div>
          ) : screenPreset === 'game' ? (
            <span className="hidden items-center gap-1 rounded border border-amber-500/30 bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300 sm:inline-flex">
              <Zap size={11} className="fill-amber-300" /> Latência Zero
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {onStopWatching && (
            <button
              type="button"
              onClick={onStopWatching}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-black/65 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:border-dc-red hover:bg-dc-red"
              title="Parar de assistir"
            >
              <EyeOff size={14} />
              <span>Parar de Assistir</span>
            </button>
          )}
          <button
            id="fullscreen-button"
            type="button"
            onClick={toggleFullscreen}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md bg-black/65 px-2.5 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-black/85"
            title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            <span className="hidden sm:inline">{isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}</span>
          </button>
        </div>
      </div>

      {/* Barra inferior */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-100 transition-opacity duration-300 sm:opacity-0 sm:group-hover:opacity-100">
        {screen.isLocal ? (
          <span className="flex items-center gap-1.5 text-xs text-white/75">
            <MonitorUp size={14} />
            Sua tela{!screen.hasAudio && ' · sem áudio'}
          </span>
        ) : screen.hasAudio ? (
          <div className="pointer-events-auto w-56 rounded-md bg-black/55 px-2 py-1 backdrop-blur">
            <VolumeSlider
              id={`screen-volume-${screen.id}`}
              value={screen.volume}
              onChange={onVolumeChange}
              label={`Áudio da tela de ${screen.name}`}
            />
          </div>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-white/75">
            <VolumeX size={14} /> Sem áudio
          </span>
        )}
      </div>
    </div>
  )
}

interface ScreenThumbProps {
  screen: ScreenSource
  active: boolean
  onSelect: () => void
}

export function ScreenThumb({ screen, active, onSelect }: ScreenThumbProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    if (!screen.stream) {
      if (videoEl.srcObject) {
        videoEl.srcObject = null
      }
      return
    }

    if (videoEl.srcObject !== screen.stream) {
      videoEl.srcObject = screen.stream
    }

    videoEl.play().catch(() => {
      /* ignore */
    })
  }, [screen.stream])

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg bg-black ring-2 transition ${
        active ? 'ring-dc-brand' : 'ring-transparent hover:ring-white/20'
      }`}
      title={`Ver tela de ${screen.name}`}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-3 text-left text-[11px] font-medium text-white">
        {screen.isLocal ? 'Você' : screen.name}
      </span>
    </button>
  )
}

interface ScreenMosaicTileProps {
  screen: ScreenSource
  onSelect: () => void
}

/**
 * Cartão de transmissão de tela no mosaico automático (quando nenhuma tela está focada).
 * Exibe o stream de tela em tempo real sem cortes (`object-contain`) e permite focar
 * com um clique ou duplo clique para abrir no palco principal com controles completos.
 */
export function ScreenMosaicTile({ screen, onSelect }: ScreenMosaicTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const videoEl = videoRef.current
    if (!videoEl) return

    if (!screen.stream) {
      if (videoEl.srcObject) {
        videoEl.srcObject = null
      }
      return
    }

    if (videoEl.srcObject !== screen.stream) {
      videoEl.srcObject = screen.stream
    }

    videoEl.play().catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return
      console.debug('[discordia] mosaic screen play() aguardando interação:', err)
    })
  }, [screen.stream])

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      title={`Clique para assistir à tela de ${screen.isLocal ? 'você' : screen.name} em tela cheia`}
      className="group relative flex h-full w-full cursor-pointer select-none items-center justify-center overflow-hidden rounded-xl bg-black ring-2 ring-dc-red/45 transition-all duration-200 hover:ring-dc-brand"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
      />

      {!screen.stream && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-4 text-center text-xs text-dc-muted">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-dc-brand border-t-transparent" />
          <span>Conectando à tela de {screen.isLocal ? 'você' : screen.name}…</span>
        </div>
      )}

      {/* Badge superior esquerdo: AO VIVO */}
      <div className="absolute left-2.5 top-2.5 z-10 flex items-center gap-1.5">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-dc-red/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-md">
          <MonitorUp size={11} className="shrink-0" />
          <span className="h-1.5 w-1.5 animate-live rounded-full bg-white" />
          <span>AO VIVO · Tela</span>
        </span>
      </div>

      {/* Botão discreto de foco no canto superior direito */}
      <div className="absolute right-2.5 top-2.5 z-10 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span className="inline-flex items-center gap-1 rounded-md bg-black/75 px-2.5 py-1 text-[11px] font-bold text-white shadow backdrop-blur-sm">
          <Maximize2 size={12} />
          <span>Focar Tela</span>
        </span>
      </div>

      {/* Tarja semitransparente na base */}
      <div className="absolute bottom-0 left-0 right-0 z-10 flex items-center justify-between gap-2 bg-black/60 px-2.5 py-1.5 text-xs backdrop-blur-sm">
        <span className="truncate font-medium text-white">
          {screen.isLocal ? 'Sua transmissão de tela' : `Tela de ${screen.name}`}
        </span>
        <span className="shrink-0 text-[10px] font-semibold text-white/75">Clique para assistir</span>
      </div>
    </div>
  )
}
