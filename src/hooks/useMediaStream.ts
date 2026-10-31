import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/** Vincula um MediaStream a um elemento <video>/<audio> e tenta iniciar a reprodução. */
export function useMediaStream<T extends HTMLMediaElement>(stream: MediaStream | null): RefObject<T | null> {
  const ref = useRef<T | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (el.srcObject !== stream) el.srcObject = stream
    if (stream) {
      el.play().catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.debug('[discordia] play() bloqueado:', err)
      })
    }
    return () => {
      if (el.srcObject === stream) el.srcObject = null
    }
  }, [stream])

  return ref
}
