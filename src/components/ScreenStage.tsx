import { useCallback, useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, MonitorUp, VolumeX } from 'lucide-react'
import { useMediaStream } from '../hooks/useMediaStream'
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
  onVolumeChange: (value: number) => void
}

/** Área de destaque da transmissão de tela, com tela cheia e controle de volume. */
export function ScreenStage({ screen, onVolumeChange }: ScreenStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // O vídeo é sempre mudo: o áudio da tela toca via <AudioSink>, independente do foco.
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
        // iOS Safari: só permite tela cheia no próprio <video>
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
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent p-3 opacity-100 transition-opacity duration-300 sm:opacity-0 sm:group-hover:opacity-100">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex items-center gap-1.5 rounded bg-dc-red px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            <span className="h-1.5 w-1.5 animate-live rounded-full bg-white" /> Ao vivo
          </span>
          <span className="truncate text-sm font-semibold text-white drop-shadow">
            {screen.isLocal ? 'Sua transmissão' : screen.name}
          </span>
          {resolution && <span className="hidden text-xs text-white/60 sm:inline">{resolution}</span>}
        </div>
        <button
          id="fullscreen-button"
          type="button"
          onClick={toggleFullscreen}
          className="pointer-events-auto rounded-md bg-black/50 p-2 text-white backdrop-blur transition hover:bg-black/80"
          title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
      </div>

      {/* Barra inferior */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-100 transition-opacity duration-300 sm:opacity-0 sm:group-hover:opacity-100">
        {screen.isLocal ? (
          <span className="flex items-center gap-1.5 text-xs text-white/75">
            <MonitorUp size={14} />
            Pré-visualização (sem áudio local){!screen.hasAudio && ' · transmitindo sem som'}
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
            <VolumeX size={14} /> Transmissão sem áudio
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
