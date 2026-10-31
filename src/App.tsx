import { useCallback, useState } from 'react'
import { Lobby } from './components/Lobby'
import { RoomView } from './components/RoomView'
import { Toasts } from './components/Toasts'
import { useRoom } from './hooks/useRoom'

export default function App() {
  const controller = useRoom()
  const { snapshot, toasts, dismissToast, pushToast, join } = controller
  const [joining, setJoining] = useState(false)

  const handleJoin = useCallback(
    async (name: string, room: string) => {
      setJoining(true)
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
    <>
      {inRoom && snapshot ? (
        <RoomView snapshot={snapshot} controller={controller} />
      ) : (
        <Lobby joining={joining} onJoin={handleJoin} onToast={pushToast} />
      )}
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}
