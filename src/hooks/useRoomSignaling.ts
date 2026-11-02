import { useCallback, useEffect, useRef } from 'react'
import { PRESENCE_HEARTBEAT_MS, getPresence } from '../lib/presence'
import type { RoomSnapshot } from '../types'

/**
 * Hook de sinalização e presença em tempo real da sala (`discordia_rooms/${roomId}/members`):
 * • Registra o `peerId` local em `members/${myPeerId}` após `peer.on('open')` e configura `onDisconnect().remove()`.
 * • Mantém heartbeat periódico de presença e atualiza `count` com base nos membros ativos.
 * • Remove `discordia_rooms/${roomId}/members/${myPeerId}` via `remove()` + HTTP `DELETE` (`keepalive: true`)
 *   ao clicar em "Sair da Sala" ou fechar a aba (`pagehide` / `beforeunload`).
 */
export function useRoomSignaling(snapshot: RoomSnapshot | null, roomDisplayName: string | undefined): void {
  const connected = snapshot?.status === 'connected'
  const roomId = connected ? snapshot.room : ''
  const memberId = connected ? snapshot.local.peerId : ''
  const memberName = snapshot?.local.name ?? ''
  const count = connected ? snapshot.participants.length + 1 : 0

  const live = useRef({ count, memberName, roomDisplayName })
  const joinedAtRef = useRef<number>(0)

  useEffect(() => {
    live.current = { count, memberName, roomDisplayName }
  }, [count, memberName, roomDisplayName])

  const beat = useCallback(() => {
    if (!roomId || !memberId) return
    if (!joinedAtRef.current) joinedAtRef.current = Date.now()
    const { count: c, memberName: n, roomDisplayName: d } = live.current
    getPresence()
      .heartbeat(roomId, d, { id: memberId, name: n, joinedAt: joinedAtRef.current }, c)
      .catch((err) => console.warn('[Firebase] Heartbeat de presença falhou:', err))
  }, [roomId, memberId])

  useEffect(() => {
    if (!roomId || !memberId) {
      joinedAtRef.current = 0
      return
    }
    joinedAtRef.current = Date.now()
    const presence = getPresence()
    if (presence.kind === 'off') return

    beat()
    const timer = window.setInterval(beat, PRESENCE_HEARTBEAT_MS)
    let left = false
    const handleLeave = () => {
      if (left) return
      left = true
      presence.leave(roomId, memberId, live.current.count <= 1)
    }

    window.addEventListener('pagehide', handleLeave)
    window.addEventListener('beforeunload', handleLeave)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', handleLeave)
      window.removeEventListener('beforeunload', handleLeave)
      handleLeave()
    }
  }, [roomId, memberId, beat])

  useEffect(() => {
    if (count > 0) beat()
  }, [count, beat])
}

