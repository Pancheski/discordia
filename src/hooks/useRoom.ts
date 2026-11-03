import { useCallback, useEffect, useRef, useState } from 'react'
import { RoomManager } from '../lib/RoomManager'
import type {
  AppActivityId,
  ChatSnapshot,
  GamepadStatePayload,
  GolfHoleEvent,
  GolfResetEvent,
  GolfStrokeEvent,
  MediaKind,
  RemotePlayGrant,
  RoomSnapshot,
  RpsChoice,
  RpsDuelState,
  ScreenSharePreset,
  Toast,
  ToastKind,
  TrioAction,
  TrioGameState,
  WheelState,
} from '../types'

const TOAST_TTL_MS = 5000
const EMPTY_CHAT: ChatSnapshot = { messages: [], transfers: {} }
const INITIAL_WHEEL: WheelState = {
  options: ['Pizza 🍕', 'Hambúrguer 🍔', 'Sushi 🍣', 'Tacos 🌮'],
  lastSpin: null,
}
const IS_ELECTRON = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)

const INITIAL_REMOTE_PLAY: { grant: RemotePlayGrant | null; companionConnected: boolean } = {
  grant: null,
  companionConnected: IS_ELECTRON,
}


export function useRoom() {
  const managerRef = useRef<RoomManager | null>(null)
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [chat, setChat] = useState<ChatSnapshot>(EMPTY_CHAT)
  const [rpsDuel, setRpsDuel] = useState<RpsDuelState | null>(null)
  const [trioState, setTrioState] = useState<TrioGameState | null>(null)
  const [activeApp, setActiveApp] = useState<AppActivityId>(null)
  const [wheelState, setWheelState] = useState<WheelState>(INITIAL_WHEEL)
  const [lastGolfStroke, setLastGolfStroke] = useState<GolfStrokeEvent | null>(null)
  const [lastGolfReset, setLastGolfReset] = useState<GolfResetEvent | null>(null)
  const [lastGolfHole, setLastGolfHole] = useState<GolfHoleEvent | null>(null)
  const [remotePlay, setRemotePlay] = useState(INITIAL_REMOTE_PLAY)
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
      setChat(EMPTY_CHAT)
      setRpsDuel(null)
      setTrioState(null)
      setActiveApp(null)
      setWheelState(INITIAL_WHEEL)
      setLastGolfStroke(null)
      setLastGolfReset(null)
      setLastGolfHole(null)
      setRemotePlay(INITIAL_REMOTE_PLAY)
      const manager = new RoomManager({
        onChange: setSnapshot,
        onToast: pushToast,
        onChat: setChat,
        onRpsChange: setRpsDuel,
        onTrioChange: setTrioState,
        onActiveAppChange: setActiveApp,
        onWheelChange: setWheelState,
        onGolfStroke: setLastGolfStroke,
        onGolfReset: setLastGolfReset,
        onGolfHole: setLastGolfHole,
        onRemotePlayChange: setRemotePlay,
      })
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
    setChat(EMPTY_CHAT)
    setRpsDuel(null)
    setTrioState(null)
    setActiveApp(null)
    setWheelState(INITIAL_WHEEL)
    setLastGolfStroke(null)
    setLastGolfReset(null)
    setLastGolfHole(null)
    setRemotePlay(INITIAL_REMOTE_PLAY)
  }, [])

  const toggleMute = useCallback(() => managerRef.current?.toggleMute(), [])
  const toggleDeafen = useCallback(() => managerRef.current?.toggleDeafen(), [])
  const startScreenShare = useCallback(
    (preset?: ScreenSharePreset) => void managerRef.current?.startScreenShare(preset),
    [],
  )
  const stopScreenShare = useCallback(() => managerRef.current?.stopScreenShare(), [])
  const setScreenPreset = useCallback(
    (preset: ScreenSharePreset) => void managerRef.current?.setScreenPreset(preset),
    [],
  )
  const setVolume = useCallback(
    (peerId: string, kind: MediaKind, value: number) => managerRef.current?.setParticipantVolume(peerId, kind, value),
    [],
  )

  // Chat + arquivos P2P (DataChannel)
  const sendChat = useCallback((text: string) => managerRef.current?.sendChat(text) ?? false, [])
  const sendFiles = useCallback((files: Iterable<File>) => managerRef.current?.sendFiles(files), [])
  const cancelTransfer = useCallback((id: string) => managerRef.current?.cancelTransfer(id), [])
  const saveTransfer = useCallback((id: string) => managerRef.current?.saveTransfer(id), [])

  // Soundboard P2P
  const playSfx = useCallback(
    (sfxId: string, custom?: { name: string; dataUrl: string }) => managerRef.current?.playSfx(sfxId, custom),
    [],
  )

  // Duelo 1v1: Pedra, Papel e Tesoura
  const challengeRps = useCallback((peerId: string) => managerRef.current?.challengeRps(peerId), [])
  const acceptRps = useCallback(() => managerRef.current?.acceptRps(), [])
  const declineRps = useCallback(() => managerRef.current?.declineRps(), [])
  const chooseRps = useCallback((choice: RpsChoice) => managerRef.current?.chooseRps(choice), [])
  const rematchRps = useCallback(() => managerRef.current?.rematchRps(), [])
  const closeRps = useCallback(() => managerRef.current?.closeRps(), [])

  // Minigame de Sala: Jogo de Cartas TRIO
  const startTrioGame = useCallback(() => managerRef.current?.startTrioGame(), [])
  const sendTrioAction = useCallback((action: TrioAction) => managerRef.current?.sendTrioAction(action), [])
  const endTrioGame = useCallback(() => managerRef.current?.endTrioGame(), [])

  // Hub de Atividades P2P (Apps / Roleta 3D / Mini Golf 3D)
  const launchApp = useCallback((appId: AppActivityId) => managerRef.current?.launchApp(appId), [])
  const updateWheelOptions = useCallback(
    (options: string[]) => managerRef.current?.updateWheelOptions(options),
    [],
  )
  const spinWheel = useCallback(
    (winnerIndex: number, targetAngle: number, options: string[]) =>
      managerRef.current?.spinWheel(winnerIndex, targetAngle, options),
    [],
  )
  const sendGolfStroke = useCallback(
    (vx: number, vz: number) => managerRef.current?.sendGolfStroke(vx, vz),
    [],
  )
  const sendGolfReset = useCallback(() => managerRef.current?.sendGolfReset(), [])
  const sendGolfHole = useCallback(
    (seed?: number, holeNumber?: number, par?: number) =>
      managerRef.current?.sendGolfHole(seed, holeNumber, par),
    [],
  )

  // Remote Play / Jogar Junto (Gamepad API -> WebRTC -> ViGEmBus)
  const grantRemotePlay = useCallback(
    (guestId: string | null) => managerRef.current?.grantRemotePlay(guestId),
    [],
  )
  const revokeRemotePlay = useCallback(
    (guestId: string) => managerRef.current?.revokeRemotePlay(guestId),
    [],
  )
  const sendGamepadState = useCallback(
    (payload: GamepadStatePayload) => managerRef.current?.sendGamepadState(payload),
    [],
  )
  const connectCompanionBridge = useCallback(
    () => managerRef.current?.connectCompanionBridge(),
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
    toggleDeafen,
    startScreenShare,
    stopScreenShare,
    setScreenPreset,
    setVolume,
    chat,
    sendChat,
    sendFiles,
    cancelTransfer,
    saveTransfer,
    playSfx,
    rpsDuel,
    challengeRps,
    acceptRps,
    declineRps,
    chooseRps,
    rematchRps,
    closeRps,
    trioState,
    startTrioGame,
    sendTrioAction,
    endTrioGame,
    activeApp,
    wheelState,
    lastGolfStroke,
    lastGolfReset,
    lastGolfHole,
    launchApp,
    updateWheelOptions,
    spinWheel,
    sendGolfStroke,
    sendGolfReset,
    sendGolfHole,
    remotePlay,
    grantRemotePlay,
    revokeRemotePlay,
    sendGamepadState,
    connectCompanionBridge,
  }
}

export type RoomController = ReturnType<typeof useRoom>
