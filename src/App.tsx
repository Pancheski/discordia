import { useCallback, useState } from 'react'
import { Lobby } from './components/Lobby'
import { RoomView } from './components/RoomView'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { useRoom } from './hooks/useRoom'
import { useRoomSignaling } from './hooks/useRoomSignaling'

export default function App() {
  const controller = useRoom()
  const { snapshot, toasts, dismissToast, pushToast, join } = controller
  const [joining, setJoining] = useState(false)
  const [roomDisplayName, setRoomDisplayName] = useState<string | undefined>(undefined)

  useRoomSignaling(snapshot, roomDisplayName)

  const handleJoin = useCallback(
    async (name: string, room: string, displayName?: string) => {
      setJoining(true)
      setRoomDisplayName(displayName ?? room)
      const ok = await join(name, room)
      setJoining(false)
      if (ok) {
        const targetUrl = `?room=${encodeURIComponent(room)}`
        if (window.location.search !== targetUrl) {
          history.replaceState(null, '', targetUrl)
        }
      }
    },
    [join],
  )

  const inRoom = snapshot?.status === 'connected'

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-dc-darkest">
      <TitleBar />
      <div className="relative min-h-0 flex-1 overflow-y-auto">
        {inRoom && snapshot ? (
          <RoomView snapshot={snapshot} controller={controller} />
        ) : (
          <Lobby joining={joining} onJoin={handleJoin} onToast={pushToast} />
        )}
      </div>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

