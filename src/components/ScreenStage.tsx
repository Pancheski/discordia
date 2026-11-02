import { useCallback, useEffect, useRef, useState } from 'react'
import { EyeOff, Film, Gamepad2, Maximize2, Minimize2, MonitorUp, VolumeX, Zap } from 'lucide-react'
import { useMediaStream } from '../hooks/useMediaStream'
import type { ScreenSharePreset } from '../types'
import { VolumeSlider } from './VolumeSlider'

export interface ScreenSource {
  id: string
  name: string
  stream: MediaStream
  isLocal: boolean
  volume: number
  hasAudio: boolean
}

interface ScreenStageProps {
  screen: ScreenSource
  screenPreset?: ScreenSharePreset
  onPresetChange?: (preset: ScreenSharePreset) => void
  onVolumeChange: (value: number) => void
  onStopWatching?: () => void
  onOpenRemotePlay?: () => void
}

export function ScreenStage({
  screen,
  screenPreset = 'quality',
  onPresetChange,
  onVolumeChange,
  onStopWatching,
  onOpenRemotePlay,
}: ScreenStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useMediaStream<HTMLVideoElement>(screen.stream)
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

    const catchUpLive = () => {
      try {
        if (video.buffered && video.buffered.length > 0) {
          const liveEdge = video.buffered.end(video.buffered.length - 1)
          const drift = liveEdge - video.currentTime
          // Pula imediatamente para o frame mais recente caso haja atraso na rede (> 80ms)
          if (drift > 0.08) {
            video.currentTime = liveEdge
          }
        }
      } catch {
        /* ignore */
      }
    }

    video.addEventListener('timeupdate', catchUpLive)
    video.addEventListener('waiting', catchUpLive)
    video.addEventListener('stalled', catchUpLive)
    const interval = setInterval(catchUpLive, 400)

    return () => {
      video.removeEventListener('timeupdate', catchUpLive)
      video.removeEventListener('waiting', catchUpLive)
      video.removeEventListener('stalled', catchUpLive)
      clearInterval(interval)
    }
  }, [videoRef, screen.stream])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const update = () => {
      if (video.videoWidth) setResolution(`${video.videoWidth}×${video.videoHeight}`)
    }
    video.addEventListener('resize', update)
    video.addEventListener('loadedmetadata', update)
    return () => {
      video.removeEventListener('resize', update)
      video.removeEventListener('loadedmetadata', update)
    }
  }, [videoRef, screen.stream])

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
  }, [videoRef])

  return (
    <div
      ref={containerRef}
      className="stage-fullscreen group relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden rounded-xl bg-black ring-1 ring-white/5"
      onDoubleClick={toggleFullscreen}
    >
      <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />

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
            <span className="hidden items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[11px] font-bold text-amber-300 border border-amber-500/30 sm:inline-flex">
              <Zap size={11} className="fill-amber-300" /> Latência Zero
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {onOpenRemotePlay && (
            <button
              type="button"
              onClick={onOpenRemotePlay}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-emerald-400/35 bg-emerald-600/80 px-2.5 py-1.5 text-xs font-bold text-white backdrop-blur transition hover:bg-emerald-500"
              title="Liberar Controle (Remote Play)"
            >
              <Gamepad2 size={14} />
              <span className="hidden md:inline">Liberar Controle</span>
            </button>
          )}
          {onStopWatching && (
            <button
              type="button"
              onClick={onStopWatching}
              className="pointer-events-auto inline-flex items-center gap-1.5 rounded-md border border-white/15 bg-black/65 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur transition hover:bg-dc-red hover:border-dc-red"
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
  const videoRef = useMediaStream<HTMLVideoElement>(screen.stream)
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
