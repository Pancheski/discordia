import { useEffect, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MonitorUp, Volume2 } from 'lucide-react'
import { VolumeSlider } from './VolumeSlider'

export interface ParticipantMenuAnchor {
  x: number
  y: number
}

interface ParticipantMenuProps {
  open: boolean
  anchor: ParticipantMenuAnchor | null
  peerId: string
  name: string
  voiceVolume: number
  onVoiceVolumeChange: (value: number) => void
  isSharingScreen: boolean
  screenVolume?: number
  onScreenVolumeChange?: (value: number) => void
  canKick: boolean
  onKick?: () => void
  onClose: () => void
}

/**
 * Menu suspenso / de contexto estilo Discord para controles de participante remoto:
 * - Volume de voz
 * - Volume da transmissão (apenas quando o participante está transmitindo)
 * - Divisor visual + ação de expulsão (visível apenas para o dono da sala)
 */
export function ParticipantMenu({
  open,
  anchor,
  peerId,
  name,
  voiceVolume,
  onVoiceVolumeChange,
  isSharingScreen,
  screenVolume = 1,
  onScreenVolumeChange,
  canKick,
  onKick,
  onClose,
}: ParticipantMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = menuRef.current
    if (!open || !anchor || !el) return
    const width = el.offsetWidth || 240
    const height = el.offsetHeight || 160
    const pad = 8
    const left = Math.max(pad, Math.min(anchor.x, window.innerWidth - width - pad))
    const top = Math.max(pad, Math.min(anchor.y, window.innerHeight - height - pad))
    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [open, anchor, isSharingScreen, canKick])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const onResize = () => onClose()
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onResize)
    }
  }, [open, onClose])

  if (!open || !anchor) return null

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Opções de ${name}`}
      style={{ left: anchor.x, top: anchor.y }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[70] w-60 rounded-xl border border-white/10 bg-[#111214] p-2.5 shadow-2xl shadow-black/80"
    >
      <div className="mb-2 border-b border-white/5 px-1 pb-1.5">
        <p className="truncate text-xs font-bold text-dc-header">{name}</p>
      </div>

      <div className="space-y-2.5 px-1">
        <div>
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-dc-muted">
            <Volume2 size={12} className="text-dc-brand-soft" />
            Volume de Voz
          </span>
          <VolumeSlider
            id={`menu-voice-volume-${peerId}`}
            value={voiceVolume}
            onChange={onVoiceVolumeChange}
            label={`Voz de ${name}`}
          />
        </div>

        {isSharingScreen && onScreenVolumeChange && (
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-dc-muted">
              <MonitorUp size={12} className="text-rose-400" />
              Volume da Transmissão
            </span>
            <VolumeSlider
              id={`menu-screen-volume-${peerId}`}
              value={screenVolume}
              onChange={onScreenVolumeChange}
              label={`Áudio da tela de ${name}`}
            />
          </div>
        )}
      </div>

      {canKick && onKick && (
        <>
          <div className="my-2.5 h-px bg-white/10" role="separator" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClose()
              onKick()
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-bold text-dc-red transition hover:bg-dc-red hover:text-white"
          >
            <span>🚪 Expulsar da sala</span>
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
