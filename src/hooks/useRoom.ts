import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomManager } from '../lib/RoomManager'
import type { MediaKind, RoomSnapshot, Toast, ToastKind } from '../types'

const TOAST_TTL_MS = 5000

export function useRoom() {
  const managerRef = useRef<RoomManager | null>(null)
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastIdRef = useRef(0)
  const toastTimers = useRef(new Map<number, number>())

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const timer = toastTimers.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      toastTimers.current.delete(id)
    }
  }, [])

  const pushToast = useCallback(
    (kind: ToastKind, message: string) => {
      setToasts((list) => {
        if (list.some((t) => t.message === message)) return list
        const id = ++toastIdRef.current
        const timer = window.setTimeout(() => dismissToast(id), kind === 'error' ? TOAST_TTL_MS * 1.6 : TOAST_TTL_MS)
        toastTimers.current.set(id, timer)
        return [...list.slice(-4), { id, kind, message }]
      })
    },
    [dismissToast],
  )

  const join = useCallback(
    async (name: string, room: string): Promise<boolean> => {
      if (managerRef.current) return true
      const manager = new RoomManager({ onChange: setSnapshot, onToast: pushToast })
      managerRef.current = manager
      const ok = await manager.join(name, room)
      if (!ok) {
        manager.leave()
        if (managerRef.current === manager) managerRef.current = null
        setSnapshot(null)
      }
      return ok
    },
    [pushToast],
  )

  const leave = useCallback(() => {
    managerRef.current?.leave()
    managerRef.current = null
    setSnapshot(null)
  }, [])

  const toggleMute = useCallback(() => managerRef.current?.toggleMute(), [])
  const startScreenShare = useCallback(() => void managerRef.current?.startScreenShare(), [])
  const stopScreenShare = useCallback(() => managerRef.current?.stopScreenShare(), [])
  const setVolume = useCallback(
    (peerId: string, kind: MediaKind, value: number) => managerRef.current?.setParticipantVolume(peerId, kind, value),
    [],
  )

  // Garante limpeza ao desmontar (ex.: HMR / navegação)
  useEffect(() => {
    const timers = toastTimers.current
    return () => {
      managerRef.current?.leave()
      managerRef.current = null
      timers.forEach((t) => window.clearTimeout(t))
      timers.clear()
    }
  }, [])

  return {
    snapshot,
    toasts,
    pushToast,
    dismissToast,
    join,
    leave,
    toggleMute,
    startScreenShare,
    stopScreenShare,
    setVolume,
  }
}

export type RoomController = ReturnType<typeof useRoom>
