import { useCallback, useEffect, useMemo, useState } from 'react'
import { Hash, Users } from 'lucide-react'
import { AudioSink } from './AudioSink'
import { ControlBar } from './ControlBar'
import { ParticipantTile } from './ParticipantTile'
import { ScreenStage, ScreenThumb } from './ScreenStage'
import type { ScreenSource } from './ScreenStage'
import { Sidebar } from './Sidebar'
import type { RoomController } from '../hooks/useRoom'
import { buildRoomLink, copyToClipboard, detectCapabilities } from '../lib/utils'
import type { RoomSnapshot } from '../types'

interface RoomViewProps {
  snapshot: RoomSnapshot
  controller: RoomController
}

export function RoomView({ snapshot, controller }: RoomViewProps) {
  const { local, participants, room } = snapshot
  const { toggleMute, startScreenShare, stopScreenShare, leave, setVolume, pushToast } = controller
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const screenSupported = useMemo(() => detectCapabilities().screenShare, [])

  const screens = useMemo<ScreenSource[]>(() => {
    const list: ScreenSource[] = []
    for (const p of participants) {
      if (p.screenStream) {
        list.push({
          id: p.peerId,
          name: p.name,
          stream: p.screenStream,
          isLocal: false,
          volume: p.screenVolume,
          hasAudio: p.screenStream.getAudioTracks().length > 0,
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
  }, [participants, local.screenStream, local.name, local.screenHasAudio])

  const focused = screens.find((s) => s.id === focusedId) ?? screens[0] ?? null

  const copyLink = useCallback(async () => {
    const ok = await copyToClipboard(buildRoomLink(room))
    pushToast(ok ? 'success' : 'error', ok ? 'Link de convite copiado!' : 'Não foi possível copiar o link.')
    return ok
  }, [room, pushToast])

  const toggleScreen = useCallback(() => {
    if (local.screenStream) stopScreenShare()
    else startScreenShare()
  }, [local.screenStream, startScreenShare, stopScreenShare])

  // Atalho: tecla "M" alterna o microfone (fora de campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        toggleMute()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleMute])

  const tiles = [
    {
      key: 'local',
      name: local.name,
      speaking: local.speaking,
      muted: local.muted,
      sharing: !!local.screenStream,
      isLocal: true,
    },
    ...participants.map((p) => ({
      key: p.peerId,
      name: p.name,
      speaking: p.speaking,
      muted: p.muted,
      sharing: p.sharing,
      isLocal: false,
    })),
  ]

  const gridCols =
    tiles.length <= 1
      ? 'grid-cols-1 max-w-2xl'
      : tiles.length <= 2
        ? 'grid-cols-1 sm:grid-cols-2 max-w-5xl'
        : tiles.length <= 4
          ? 'grid-cols-2 max-w-5xl'
          : 'grid-cols-2 lg:grid-cols-3 max-w-6xl'

  return (
    <div className="flex h-dvh overflow-hidden bg-dc-dark text-dc-text">
      <Sidebar
        room={room}
        local={local}
        participants={participants}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onCopyLink={copyLink}
        onVolume={setVolume}
        onToggleMute={toggleMute}
      />

      <main className="flex min-w-0 flex-1 flex-col">
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
          <span className="ml-auto flex items-center gap-1.5 rounded-full bg-dc-darker px-2.5 py-1 text-xs text-dc-muted">
            <span className="h-2 w-2 rounded-full bg-dc-green" />
            {participants.length + 1} na call
          </span>
        </header>

        <section className="flex min-h-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          {focused ? (
            <>
              <div className="min-h-0 flex-1">
                <ScreenStage
                  key={focused.id}
                  screen={focused}
                  onVolumeChange={(v) => !focused.isLocal && setVolume(focused.id, 'screen', v)}
                />
              </div>
              <div className="flex shrink-0 items-center gap-3 overflow-x-auto pb-1">
                {screens.length > 1 &&
                  screens.map((s) => (
                    <ScreenThumb key={s.id} screen={s} active={s.id === focused.id} onSelect={() => setFocusedId(s.id)} />
                  ))}
                <div className="flex items-center gap-2">
                  {tiles.map(({ key, ...t }) => (
                    <ParticipantTile key={key} {...t} compact />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
              <div className={`mx-auto grid w-full gap-3 sm:gap-4 ${gridCols}`}>
                {tiles.map(({ key, ...t }) => (
                  <ParticipantTile key={key} {...t} />
                ))}
              </div>
            </div>
          )}
        </section>

        <ControlBar
          room={room}
          muted={local.muted}
          micAvailable={local.micAvailable}
          sharing={!!local.screenStream}
          screenSupported={screenSupported}
          onToggleMute={toggleMute}
          onToggleScreen={toggleScreen}
          onLeave={leave}
          onCopyLink={() => void copyLink()}
        />
      </main>

      {/* Saídas de áudio remotas: voz e tela são elementos independentes, com volumes próprios */}
      {participants.map((p) => (
        <div key={p.peerId} aria-hidden="true">
          {p.micStream && <AudioSink stream={p.micStream} volume={p.voiceVolume} />}
          {p.screenStream && p.screenStream.getAudioTracks().length > 0 && (
            <AudioSink stream={p.screenStream} volume={p.screenVolume} />
          )}
        </div>
      ))}
    </div>
  )
}
