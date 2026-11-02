import { useCallback, useEffect, useRef, useState } from 'react'
import { PRESENCE_POLL_MS, getPresence } from '../lib/presence'
import type { ActiveRoom, PresenceKind } from '../lib/presence'
import { useRoomSignaling } from './useRoomSignaling'

export { useRoomSignaling, useRoomSignaling as useRoomPresence }

export interface ActiveRoomsState {
  rooms: ActiveRoom[]
  loading: boolean
  error: string | null
  kind: PresenceKind
  refresh: () => void
}

/** Lista as salas abertas (polling a cada 5 s enquanto o lobby está visível). */
export function useActiveRooms(enabled = true): ActiveRoomsState {
  const presence = getPresence()
  const [rooms, setRooms] = useState<ActiveRoom[]>([])
  const [loading, setLoading] = useState(presence.kind !== 'off')
  const [error, setError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const refresh = useCallback(() => {
    if (inFlight.current || presence.kind === 'off') return
    inFlight.current = true
    presence
      .list()
      .then((list) => {
        setRooms(list)
        setError(null)
      })
      .catch((err: unknown) => {
        console.warn('[discordia] falha ao listar salas', err)
        setError('Não foi possível carregar as salas abertas.')
      })
      .finally(() => {
        inFlight.current = false
        setLoading(false)
      })
  }, [presence])

  useEffect(() => {
    if (!enabled || presence.kind === 'off') return
    refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, PRESENCE_POLL_MS)
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', onVisible)
    const unsubscribe = presence.subscribe?.(refresh)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      unsubscribe?.()
    }
  }, [enabled, presence, refresh])

  return { rooms, loading, error, kind: presence.kind, refresh }
}
