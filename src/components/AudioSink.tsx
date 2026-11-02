import { useEffect, useRef } from 'react'
import { clamp } from '../lib/utils'

interface AudioSinkProps {
  stream: MediaStream
  volume: number
  unlockSignal?: number
  onAutoplayBlocked?: () => void
  onAutoplayResolved?: () => void
}

/**
 * Reproduz o áudio remoto (voz ou tela) com controle de volume individual.
 * Não usa display:none nem o atributo hidden para evitar que o navegador aplique
 * economia de energia ou despriorize a thread de áudio em segundo plano.
 */
export function AudioSink({
  stream,
  volume,
  unlockSignal = 0,
  onAutoplayBlocked,
  onAutoplayResolved,
}: AudioSinkProps) {
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return

    if (el.srcObject !== stream) {
      el.srcObject = stream
    }

    const clamped = clamp(volume)
    el.volume = clamped
    el.muted = clamped === 0

    const playAudio = () => {
      if (el.srcObject !== stream) {
        el.srcObject = stream
      }
      el.play()
        .then(() => {
          onAutoplayResolved?.()
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          console.debug('[discordia] áudio aguardando interação:', err)
          onAutoplayBlocked?.()
        })
    }

    playAudio()

    const tracks = stream.getAudioTracks()
    stream.addEventListener('addtrack', playAudio)
    for (const track of tracks) {
      track.addEventListener('unmute', playAudio)
    }

    const onUserGesture = () => playAudio()
    window.addEventListener('pointerdown', onUserGesture, { once: true })
    window.addEventListener('keydown', onUserGesture, { once: true })

    return () => {
      stream.removeEventListener('addtrack', playAudio)
      for (const track of tracks) {
        track.removeEventListener('unmute', playAudio)
      }
      window.removeEventListener('pointerdown', onUserGesture)
      window.removeEventListener('keydown', onUserGesture)
      if (el.srcObject === stream) {
        el.srcObject = null
      }
    }
  }, [stream, volume, unlockSignal, onAutoplayBlocked, onAutoplayResolved])

  return (
    <audio
      ref={audioRef}
      autoPlay
      playsInline
      style={{
        position: 'fixed',
        top: -9999,
        left: -9999,
        width: 1,
        height: 1,
        opacity: 0.001,
        pointerEvents: 'none',
      }}
    />
  )
}
