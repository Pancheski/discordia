import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Eye, Gamepad2, Hash, Maximize2, MessageSquare, MicOff, MonitorUp, Power, Rocket, Users, Volume2, VolumeX } from 'lucide-react'
import { AppLauncherModal } from './AppLauncherModal'
import { AudioSink } from './AudioSink'
import { ChatSidebar } from './ChatSidebar'
import { ControlBar } from './ControlBar'
import { DesktopScreenPickerModal } from './DesktopScreenPickerModal'
import { KeybindSettingsModal } from './KeybindSettingsModal'
import { MiniGolfGame } from './MiniGolfGame'
import { ParticipantTile } from './ParticipantTile'
import { RemotePlayControl } from './RemotePlayControl'
import { Roulette3D } from './Roulette3D'
import { RpsDuelModal } from './RpsDuelModal'
import { ScreenStage, ScreenThumb } from './ScreenStage'
import type { ScreenSource } from './ScreenStage'
import { Sidebar } from './Sidebar'
import { SoundboardPopover } from './SoundboardPopover'
import { TrioGame3D } from './TrioGame3D'
import { playUiSfx } from '../hooks/useAudioSystem'
import type { RoomController } from '../hooks/useRoom'
import { loadSavedKeybinds, type KeybindShortcuts } from '../lib/keybinds'
import { buildRoomLink, copyToClipboard, detectCapabilities } from '../lib/utils'
import type { AppActivityId, RoomSnapshot, ScreenSharePreset } from '../types'

interface RoomViewProps {
  snapshot: RoomSnapshot
  controller: RoomController
}

export function RoomView({ snapshot, controller }: RoomViewProps) {
  const { local, participants, room, voiceStreams, screenStreams } = snapshot
  const {
    toggleMute,
    toggleDeafen,
    startScreenShare,
    stopScreenShare,
    setScreenPreset,
    leave,
    setVolume,
    pushToast,
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
    installVigemDriver,
  } = controller

  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth >= 1024 : true))
  const [soundboardOpen, setSoundboardOpen] = useState(false)
  const [appsModalOpen, setAppsModalOpen] = useState(false)
  const [keybindsModalOpen, setKeybindsModalOpen] = useState(false)
  const [remotePlayModalOpen, setRemotePlayModalOpen] = useState(false)
  const [minimizedApp, setMinimizedApp] = useState<AppActivityId>(null)
  const [watchedScreenId, setWatchedScreenId] = useState<string | null>(null)
  const [stagePriority, setStagePriority] = useState<'app' | 'screen'>('app')
  const [autoplayBlocked, setAutoplayBlocked] = useState(false)
  const [audioUnlockSignal, setAudioUnlockSignal] = useState(0)
  const [readUpTo, setReadUpTo] = useState(0)
  const [desktopPickerOpen, setDesktopPickerOpen] = useState(false)
  const [selectedPresetForPicker, setSelectedPresetForPicker] = useState<ScreenSharePreset>('game')
  const prevMsgCountRef = useRef(chat.messages.length)
  const screenSupported = useMemo(() => detectCapabilities().screenShare, [])
  const isElectron = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)

  const memberNames = useMemo(
    () => [local.name, ...participants.map((p) => p.name)].filter(Boolean),
    [local.name, participants],
  )

  const golfParticipants = useMemo(
    () => [
      { peerId: local.peerId, name: local.name, isLocal: true },
      ...participants.map((p) => ({ peerId: p.peerId, name: p.name, isLocal: false })),
    ],
    [local.peerId, local.name, participants],
  )

  const handleLaunchApp = useCallback(
    (appId: AppActivityId) => {
      setMinimizedApp(null)
      setAppsModalOpen(false)
      if (appId) setStagePriority('app')
      launchApp(appId)
    },
    [launchApp],
  )

  const handleWatchScreen = useCallback((screenId: string) => {
    setWatchedScreenId(screenId)
    setStagePriority('screen')
  }, [])

  const handleStopWatchingScreen = useCallback(() => {
    setWatchedScreenId(null)
    setStagePriority('app')
  }, [])

  const handleUnlockAudio = useCallback(() => {
    setAutoplayBlocked(false)
    setAudioUnlockSignal((n) => n + 1)
  }, [])

  const handleAutoplayBlocked = useCallback(() => {
    setAutoplayBlocked(true)
  }, [])

  const handleAutoplayResolved = useCallback(() => {
    setAutoplayBlocked(false)
  }, [])

  const unreadCount = useMemo(() => {
    if (chatOpen) return 0
    return chat.messages.slice(readUpTo).filter((m) => !m.isLocal && m.kind !== 'system').length
  }, [chat.messages, chatOpen, readUpTo])

  useEffect(() => {
    const total = chat.messages.length
    if (total > prevMsgCountRef.current) {
      const latest = chat.messages[total - 1]
      if (latest && !latest.isLocal && latest.kind !== 'system') {
        if (!chatOpen || document.hidden) {
          playUiSfx('message')
        }
      }
    }
    prevMsgCountRef.current = total
  }, [chat.messages, chatOpen])

  const toggleChat = useCallback(() => {
    setReadUpTo(chat.messages.length)
    setChatOpen((o) => !o)
  }, [chat.messages.length])

  const closeChat = useCallback(() => {
    setReadUpTo(chat.messages.length)
    setChatOpen(false)
  }, [chat.messages.length])

  const screens = useMemo<ScreenSource[]>(() => {
    const list: ScreenSource[] = []
    for (const p of participants) {
      const stream = screenStreams[p.peerId] ?? p.screenStream
      if (stream) {
        list.push({
          id: p.peerId,
          name: p.name,
          stream,
          isLocal: false,
          volume: p.screenVolume,
          hasAudio: stream.getAudioTracks().length > 0,
        })
      }
    }
    if (local.screenStream) {
      list.push({
        id: 'local',
        name: local.name,
        stream: local.screenStream,
        isLocal: true,
        volume: 0,
        hasAudio: local.screenHasAudio,
      })
    }
    return list
  }, [participants, screenStreams, local.screenStream, local.name, local.screenHasAudio])

  const watchedScreen = useMemo(
    () => (watchedScreenId ? (screens.find((s) => s.id === watchedScreenId) ?? null) : null),
    [screens, watchedScreenId],
  )

  const activeStageApp: AppActivityId = activeApp && minimizedApp !== activeApp ? activeApp : null
  const isAppMinimized = Boolean(activeApp && minimizedApp === activeApp)
  const hasStageContent = Boolean(activeStageApp || watchedScreen)

  const showingScreenOnStage = Boolean(
    watchedScreen && (!activeStageApp || stagePriority === 'screen'),
  )
  const showingAppOnStage = Boolean(activeStageApp && !showingScreenOnStage)

  const copyLink = useCallback(async () => {
    const ok = await copyToClipboard(buildRoomLink(room))
    pushToast(ok ? 'success' : 'error', ok ? 'Link de convite copiado!' : 'Não foi possível copiar o link.')
    return ok
  }, [room, pushToast])

  const handleRequestScreenShare = useCallback(
    (preset?: ScreenSharePreset) => {
      const targetPreset = preset ?? local.screenPreset ?? 'game'
      if (isElectron) {
        setSelectedPresetForPicker(targetPreset)
        setDesktopPickerOpen(true)
      } else {
        void startScreenShare(targetPreset)
      }
    },
    [isElectron, local.screenPreset, startScreenShare],
  )

  const handleConfirmDesktopPicker = useCallback(
    async (sourceId: string, chosenPreset: ScreenSharePreset) => {
      setDesktopPickerOpen(false)
      if (window.electron?.selectDesktopSource) {
        await window.electron.selectDesktopSource(sourceId)
      }
      await startScreenShare(chosenPreset)
    },
    [startScreenShare],
  )

  const toggleScreen = useCallback(() => {
    if (local.screenStream) {
      stopScreenShare()
      if (watchedScreenId === 'local') setWatchedScreenId(null)
      return
    }
    handleRequestScreenShare()
  }, [handleRequestScreenShare, local.screenStream, stopScreenShare, watchedScreenId])

  // ─── Atalhos Globais e Navegador (Mute / Deafen) ─────────────────────────
  const [activeKeybinds, setActiveKeybinds] = useState<KeybindShortcuts>(loadSavedKeybinds)

  // Registra no Electron via IPC ao iniciar ou alterar
  useEffect(() => {
    if (isElectron && window.electron?.registerGlobalShortcuts) {
      window.electron.registerGlobalShortcuts(activeKeybinds)
    }
  }, [isElectron, activeKeybinds])

  // Escuta atalhos globais disparados pelo processo principal do Electron
  useEffect(() => {
    if (!isElectron || !window.electron?.onShortcutTriggered) return

    const unsub = window.electron.onShortcutTriggered((action) => {
      if (action === 'toggle-mute') {
        toggleMute()
      } else if (action === 'toggle-deafen') {
        toggleDeafen()
      }
    })

    return () => unsub()
  }, [isElectron, toggleMute, toggleDeafen])

  // Escuta de atalhos no navegador (dentro da janela)
  useEffect(() => {
    const parseShortcut = (accel: string) => {
      const parts = accel.split('+').map((p) => p.trim())
      const key = parts[parts.length - 1]
      const needsCtrl = parts.includes('CommandOrControl') || parts.includes('Control') || parts.includes('Command')
      const needsShift = parts.includes('Shift')
      const needsAlt = parts.includes('Alt')
      return { key, needsCtrl, needsShift, needsAlt }
    }

    const muteDef = parseShortcut(activeKeybinds.toggleMute)
    const deafenDef = parseShortcut(activeKeybinds.toggleDeafen)

    const matches = (e: KeyboardEvent, def: ReturnType<typeof parseShortcut>) => {
      const hasCtrl = e.ctrlKey || e.metaKey
      if (def.needsCtrl !== hasCtrl) return false
      if (def.needsShift !== e.shiftKey) return false
      if (def.needsAlt !== e.altKey) return false

      const checkKey = def.key.toUpperCase()
      if (checkKey.startsWith('F') && /^F\d{1,2}$/.test(checkKey)) {
        return e.code.toUpperCase() === checkKey
      }
      return e.key.toUpperCase() === checkKey || e.code.toUpperCase() === `KEY${checkKey}`
    }

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

      // Atalho customizado de Mute
      if (matches(e, muteDef)) {
        e.preventDefault()
        toggleMute()
        return
      }

      // Atalho customizado de Deafen
      if (matches(e, deafenDef)) {
        e.preventDefault()
        toggleDeafen()
        return
      }

      // Atalho rápido clássico de M (se não colidir com combinação)
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        toggleMute()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeKeybinds, toggleMute, toggleDeafen])

  const tiles = [
    {
      key: 'local',
      peerId: local.peerId,
      name: local.name,
      speaking: local.speaking,
      muted: local.muted,
      sharing: !!local.screenStream,
      isLocal: true,
      micAvailable: local.micAvailable,
      connectionState: 'connected' as const,
      voiceVolume: 1,
      screenId: local.screenStream ? 'local' : null,
    },
    ...participants.map((p) => {
      const hasScreen = Boolean(screenStreams[p.peerId] ?? p.screenStream) || p.sharing
      return {
        key: p.peerId,
        peerId: p.peerId,
        name: p.name,
        speaking: p.speaking,
        muted: p.muted,
        sharing: hasScreen,
        isLocal: false,
        micAvailable: true,
        connectionState: p.connectionState,
        voiceVolume: p.voiceVolume,
        screenId: hasScreen ? p.peerId : null,
      }
    }),
  ]

  const meshState = useMemo(() => {
    if (participants.some((p) => p.connectionState === 'error')) return 'error' as const
    if (participants.some((p) => p.connectionState === 'connecting' || p.connectionState === 'reconnecting')) {
      return 'connecting' as const
    }
    return 'connected' as const
  }, [participants])

  const appLabel =
    activeApp === 'trio'
      ? 'TRIO'
      : activeApp === 'wheel'
        ? 'Roleta'
        : activeApp === 'golf'
          ? 'Mini Golf'
          : ''

  return (
    <div className="flex h-full overflow-hidden bg-dc-dark text-dc-text">
      <Sidebar
        room={room}
        local={local}
        participants={participants}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCopyLink={copyLink}
        onVolume={setVolume}
        onToggleMute={toggleMute}
        onChallengeRps={challengeRps}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-black/30 px-4 shadow-sm">
          <button
            id="open-sidebar-button"
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="-ml-1 rounded p-1.5 text-dc-muted transition hover:bg-dc-hover hover:text-dc-text md:hidden"
            aria-label="Abrir lista de participantes"
          >
            <Users size={18} />
          </button>
          <Hash size={20} className="shrink-0 text-dc-muted" />
          <h1 className="truncate font-semibold text-dc-header">{room}</h1>

          <div className="ml-auto flex items-center gap-2">
            {activeApp && (
              <button
                type="button"
                onClick={() => {
                  setMinimizedApp(null)
                  setStagePriority('app')
                }}
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-semibold text-amber-300 ring-1 ring-amber-400/30 transition hover:bg-amber-500/30"
              >
                <Rocket size={13} />
                <span>{appLabel}</span>
              </button>
            )}

            {screens.length > 0 && !watchedScreen && (
              <button
                type="button"
                onClick={() => handleWatchScreen(screens[0].id)}
                className="inline-flex items-center gap-1.5 rounded-full bg-dc-red/20 px-2.5 py-1 text-xs font-bold text-rose-300 ring-1 ring-dc-red/40 transition hover:bg-dc-red hover:text-white"
              >
                <MonitorUp size={13} />
                <span>
                  {screens.length === 1 ? `${screens[0].name} ao vivo` : `${screens.length} transmissões`} · Assistir
                </span>
              </button>
            )}

            {!isElectron && (
              <a
                href="https://github.com/Pancheski/discordia/releases/latest/download/Discordia-Setup.exe"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-dc-brand/40 bg-dc-brand/15 px-2.5 py-1.5 text-xs font-bold text-dc-brand-soft shadow-sm transition hover:bg-dc-brand hover:text-white"
                title="Baixar instalador oficial para Windows (.exe)"
              >
                <Download size={14} />
                <span className="hidden sm:inline">Baixar App</span>
              </a>
            )}

            <button
              type="button"
              onClick={() => {
                connectCompanionBridge()
                setRemotePlayModalOpen(true)
              }}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition ${
                remotePlay.grant?.hostId === local.peerId &&
                Object.keys(remotePlay.grant.controllers || {}).length > 0
                  ? 'bg-emerald-600 text-white shadow ring-1 ring-emerald-400/50'
                  : 'bg-dc-darker text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/20'
              }`}
              title="Remote Play"
            >
              <Gamepad2 size={15} />
              <span>Remote Play</span>
            </button>

            <span className="flex items-center gap-1.5 rounded-full bg-dc-darker px-2.5 py-1 text-xs text-dc-muted">
              <span className="h-2 w-2 rounded-full bg-dc-green" />
              {participants.length + 1}
            </span>

            <button
              id="header-chat-toggle"
              type="button"
              onClick={toggleChat}
              className={`relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                chatOpen ? 'bg-dc-brand text-white' : 'bg-dc-darker text-dc-muted hover:bg-dc-hover hover:text-dc-text'
              }`}
              title={chatOpen ? 'Recolher chat' : 'Abrir chat'}
            >
              <MessageSquare size={15} />
              <span className="hidden sm:inline">Chat</span>
              {unreadCount > 0 && !chatOpen && (
                <span className="rounded-full bg-dc-yellow px-1.5 text-[10px] font-black text-black">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        <RemotePlayControl
          localPeerId={local.peerId}
          participants={participants}
          grant={remotePlay.grant}
          companionConnected={remotePlay.companionConnected}
          driverReady={remotePlay.driverReady}
          installingDriver={remotePlay.installingDriver}
          modalOpen={remotePlayModalOpen}
          onCloseModal={() => setRemotePlayModalOpen(false)}
          onGrantGuest={grantRemotePlay}
          onRevokeGuest={revokeRemotePlay}
          onSendGamepadState={sendGamepadState}
          onRetryCompanion={connectCompanionBridge}
          onInstallDriver={installVigemDriver}
        />

        {local.deafened && (
          <div className="z-30 flex shrink-0 items-center justify-between gap-2 border-b border-dc-red/40 bg-dc-red/20 px-4 py-1.5 text-xs text-rose-200">
            <span className="inline-flex items-center gap-2 font-semibold">
              <VolumeX size={15} className="shrink-0 text-dc-red" />
              <span>Você está ensurdecido (áudio de entrada e microfone desativados).</span>
            </span>
            <button
              type="button"
              onClick={toggleDeafen}
              className="shrink-0 rounded bg-dc-red/30 px-2.5 py-0.5 text-[11px] font-bold text-white transition hover:bg-dc-red/40"
            >
              Desativar
            </button>
          </div>
        )}

        {autoplayBlocked && (
          <div className="z-40 flex shrink-0 items-center justify-between gap-3 border-b border-dc-brand/40 bg-dc-brand/25 px-4 py-2 text-xs text-white shadow-lg backdrop-blur">
            <span className="inline-flex items-center gap-2 font-semibold">
              <Volume2 size={16} className="shrink-0 animate-bounce text-amber-300" />
              <span>Áudio da chamada bloqueado pelo navegador.</span>
            </span>
            <button
              type="button"
              onClick={handleUnlockAudio}
              className="shrink-0 rounded-lg bg-dc-green px-3.5 py-1.5 text-xs font-extrabold text-white shadow transition hover:brightness-110"
            >
              Ativar Áudio
            </button>
          </div>
        )}

        {!local.micAvailable && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/25 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
            <span className="inline-flex items-center gap-2 font-medium">
              <MicOff size={14} className="shrink-0 text-amber-400" />
              <span>Microfone desativado ou não detectado</span>
            </span>
            <button
              type="button"
              onClick={toggleMute}
              className="shrink-0 rounded bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold text-amber-100 ring-1 ring-amber-400/30 transition hover:bg-amber-500/30"
            >
              Ativar microfone
            </button>
          </div>
        )}

        {/* Palco Central (MainStage) */}
        <section className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          {hasStageContent ? (
            <>
              {activeStageApp && watchedScreen && (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setStagePriority('app')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      showingAppOnStage
                        ? 'bg-dc-brand text-white shadow'
                        : 'bg-dc-darker text-dc-muted hover:text-white'
                    }`}
                  >
                    <Rocket size={13} />
                    <span>{appLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStagePriority('screen')}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                      showingScreenOnStage
                        ? 'bg-dc-red text-white shadow'
                        : 'bg-dc-darker text-dc-muted hover:text-white'
                    }`}
                  >
                    <Eye size={13} />
                    <span>{watchedScreen.name}</span>
                  </button>
                </div>
              )}

              <div className="flex-1 min-h-0 w-full h-full rounded-xl overflow-hidden">
                {showingScreenOnStage && watchedScreen ? (
                  <ScreenStage
                    key={watchedScreen.id}
                    screen={watchedScreen}
                    screenPreset={local.screenPreset}
                    onPresetChange={setScreenPreset}
                    onVolumeChange={(v) => !watchedScreen.isLocal && setVolume(watchedScreen.id, 'screen', v)}
                    onStopWatching={handleStopWatchingScreen}
                  />
                ) : (
                  <>
                    <TrioGame3D
                      open={activeStageApp === 'trio'}
                      onClose={() => setMinimizedApp('trio')}
                      localPeerId={local.peerId}
                      gameState={trioState}
                      onStartGame={startTrioGame}
                      onAction={sendTrioAction}
                      onEndGame={() => handleLaunchApp(null)}
                    />
                    <Roulette3D
                      open={activeStageApp === 'wheel'}
                      onClose={() => setMinimizedApp('wheel')}
                      onEndApp={() => handleLaunchApp(null)}
                      wheelState={wheelState}
                      roomMemberNames={memberNames}
                      onUpdateOptions={updateWheelOptions}
                      onTriggerSpin={spinWheel}
                    />
                    <MiniGolfGame
                      open={activeStageApp === 'golf'}
                      onClose={() => setMinimizedApp('golf')}
                      onEndApp={() => handleLaunchApp(null)}
                      localPeerId={local.peerId}
                      localName={local.name}
                      participants={golfParticipants}
                      lastStroke={lastGolfStroke}
                      lastReset={lastGolfReset}
                      lastHole={lastGolfHole}
                      onSendStroke={sendGolfStroke}
                      onSendReset={sendGolfReset}
                      onSendHole={sendGolfHole}
                    />
                  </>
                )}
              </div>

              <div className="flex shrink-0 flex-row items-center gap-3 overflow-x-auto py-2">
                {screens.length > 1 &&
                  showingScreenOnStage &&
                  screens.map((s) => (
                    <ScreenThumb
                      key={s.id}
                      screen={s}
                      active={s.id === watchedScreen?.id}
                      onSelect={() => handleWatchScreen(s.id)}
                    />
                  ))}
                {tiles.map(({ key, screenId, voiceVolume, ...t }) => (
                  <ParticipantTile
                    key={key}
                    {...t}
                    compact
                    voiceVolume={voiceVolume}
                    onVoiceVolumeChange={!t.isLocal && t.peerId ? (v) => setVolume(t.peerId, 'mic', v) : undefined}
                    onWatchScreen={screenId ? () => handleWatchScreen(screenId) : undefined}
                    isWatchingScreen={Boolean(screenId && watchedScreen?.id === screenId && showingScreenOnStage)}
                    onChallengeRps={challengeRps}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-full w-full min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
              {tiles.length === 1 ? (
                (() => {
                  const { key, screenId, voiceVolume, ...t } = tiles[0]
                  return (
                    <div className="flex w-full max-w-2xl items-center justify-center my-auto">
                      <div className="w-full max-w-2xl aspect-video">
                        <ParticipantTile
                          key={key}
                          {...t}
                          voiceVolume={voiceVolume}
                          onVoiceVolumeChange={
                            !t.isLocal && t.peerId ? (v) => setVolume(t.peerId, 'mic', v) : undefined
                          }
                          onWatchScreen={screenId ? () => handleWatchScreen(screenId) : undefined}
                          isWatchingScreen={false}
                          onChallengeRps={challengeRps}
                        />
                      </div>
                    </div>
                  )
                })()
              ) : (
                <div
                  className={`w-full my-auto ${
                    tiles.length === 2
                      ? 'grid grid-cols-1 md:grid-cols-2 gap-4 max-w-5xl'
                      : tiles.length <= 4
                        ? 'grid grid-cols-2 gap-4 max-w-5xl'
                        : 'grid grid-cols-2 lg:grid-cols-3 gap-4 max-w-6xl'
                  }`}
                >
                  {tiles.map(({ key, screenId, voiceVolume, ...t }) => (
                    <ParticipantTile
                      key={key}
                      {...t}
                      voiceVolume={voiceVolume}
                      onVoiceVolumeChange={!t.isLocal && t.peerId ? (v) => setVolume(t.peerId, 'mic', v) : undefined}
                      onWatchScreen={screenId ? () => handleWatchScreen(screenId) : undefined}
                      isWatchingScreen={false}
                      onChallengeRps={challengeRps}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {isAppMinimized && activeApp && (
          <div className="fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-2xl border border-amber-400/35 bg-dc-darkest/95 px-3.5 py-2.5 shadow-2xl backdrop-blur">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300">
              <Rocket size={16} />
            </span>
            <p className="pr-1 text-xs font-extrabold text-white">{appLabel}</p>
            <button
              type="button"
              onClick={() => {
                setMinimizedApp(null)
                setStagePriority('app')
              }}
              className="inline-flex items-center gap-1 rounded-lg bg-dc-brand px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-dc-brand/90"
            >
              <Maximize2 size={13} />
              <span>Abrir</span>
            </button>
            <button
              type="button"
              onClick={() => handleLaunchApp(null)}
              className="inline-flex items-center gap-1 rounded-lg bg-dc-red/20 px-2.5 py-1.5 text-xs font-bold text-dc-red transition hover:bg-dc-red hover:text-white"
            >
              <Power size={13} />
              <span>Sair</span>
            </button>
          </div>
        )}

        <SoundboardPopover
          open={soundboardOpen}
          onClose={() => setSoundboardOpen(false)}
          onPlaySfx={playSfx}
          onToast={pushToast}
        />

        <ControlBar
          room={room}
          muted={local.muted}
          deafened={local.deafened}
          micAvailable={local.micAvailable}
          sharing={!!local.screenStream}
          screenSupported={screenSupported}
          screenPreset={local.screenPreset}
          isRemotePlayActive={Boolean(
            (remotePlay.grant?.hostId === local.peerId &&
              Object.keys(remotePlay.grant.controllers || {}).length > 0) ||
              Boolean(remotePlay.grant?.controllers?.[local.peerId]),
          )}
          chatOpen={chatOpen}
          unreadCount={unreadCount}
          soundboardOpen={soundboardOpen}
          appsOpen={appsModalOpen || Boolean(activeStageApp)}
          activeApp={activeApp}
          meshState={meshState}
          onToggleMute={toggleMute}
          onToggleDeafen={toggleDeafen}
          onToggleScreen={toggleScreen}
          onStartScreenShare={(preset) => handleRequestScreenShare(preset)}
          onTogglePreset={() => void setScreenPreset(local.screenPreset === 'game' ? 'quality' : 'game')}
          onToggleSoundboard={() => setSoundboardOpen((o) => !o)}
          onToggleApps={() => setAppsModalOpen((o) => !o)}
          onToggleChat={toggleChat}
          onOpenSettings={() => setKeybindsModalOpen(true)}
          onLeave={leave}
          onCopyLink={() => void copyLink()}
        />
      </main>

      <ChatSidebar
        room={room}
        open={chatOpen}
        onClose={closeChat}
        chat={chat}
        onSendText={sendChat}
        onSendFiles={sendFiles}
        onCancelTransfer={cancelTransfer}
        onSaveTransfer={saveTransfer}
      />

      <RpsDuelModal
        localName={local.name}
        duel={rpsDuel}
        onAccept={acceptRps}
        onDecline={declineRps}
        onChoose={chooseRps}
        onRematch={rematchRps}
        onClose={closeRps}
      />

      <AppLauncherModal
        open={appsModalOpen}
        onClose={() => setAppsModalOpen(false)}
        activeApp={activeApp}
        onLaunchApp={handleLaunchApp}
        onStopApp={() => handleLaunchApp(null)}
      />

      <KeybindSettingsModal
        open={keybindsModalOpen}
        onClose={() => setKeybindsModalOpen(false)}
        onSave={(shortcuts) => setActiveKeybinds(shortcuts)}
      />

      <DesktopScreenPickerModal
        open={desktopPickerOpen}
        onClose={() => setDesktopPickerOpen(false)}
        initialPreset={selectedPresetForPicker}
        onSelectSource={handleConfirmDesktopPicker}
      />

      {/* Áudio recebido dos participantes: mudo quando local.deafened for verdadeiro */}
      {participants.map((p) => {
        const voiceStream = voiceStreams[p.peerId] ?? p.micStream
        const screenStream = screenStreams[p.peerId] ?? p.screenStream
        const isWatchingThisScreen = watchedScreen?.id === p.peerId
        const effectiveVoiceVolume = local.deafened ? 0 : p.voiceVolume
        const effectiveScreenVolume = local.deafened ? 0 : p.screenVolume

        return (
          <div key={p.peerId} aria-hidden="true">
            {voiceStream && (
              <AudioSink
                stream={voiceStream}
                volume={effectiveVoiceVolume}
                unlockSignal={audioUnlockSignal}
                onAutoplayBlocked={handleAutoplayBlocked}
                onAutoplayResolved={handleAutoplayResolved}
              />
            )}
            {isWatchingThisScreen && screenStream && screenStream.getAudioTracks().length > 0 && (
              <AudioSink
                stream={screenStream}
                volume={effectiveScreenVolume}
                unlockSignal={audioUnlockSignal}
                onAutoplayBlocked={handleAutoplayBlocked}
                onAutoplayResolved={handleAutoplayResolved}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
