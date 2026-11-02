import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Vincula um MediaStream a um elemento <video>/<audio> e tenta iniciar a reprodução. */
export function useMediaStream<T extends HTMLMediaElement>(stream: MediaStream | null): RefObject<T | null> {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (!stream) {
      return () => {
        if (el.srcObject === stream) el.srcObject = null
      }
    }

    const tryPlay = () => {
      if (el.srcObject !== stream) {
        el.srcObject = stream
      }
      el.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.debug('[discordia] play() bloqueado:', err)
      })
    }

    tryPlay()

    const tracks = stream.getTracks()
    stream.addEventListener('addtrack', tryPlay)
    for (const track of tracks) {
      track.addEventListener('unmute', tryPlay)
    }

    const onGesture = () => tryPlay()
    window.addEventListener('pointerdown', onGesture, { once: true })

    return () => {
      stream.removeEventListener('addtrack', tryPlay)
      for (const track of tracks) {
        track.removeEventListener('unmute', tryPlay)
      }
      window.removeEventListener('pointerdown', onGesture)
      if (el.srcObject === stream) el.srcObject = null
    }
  }, [stream])

  return ref
}
