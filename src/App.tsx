import { useCallback, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Lobby } from './components/Lobby'
import { Modal } from './components/Modal'
import { RoomPasswordModal } from './components/RoomPasswordModal'
import { RoomView } from './components/RoomView'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { useRoom } from './hooks/useRoom'
import { useRoomSignaling } from './hooks/useRoomSignaling'
import { getPresence } from './lib/presence'
import { slugifyRoom } from './lib/utils'
import { clearStoredRoomHash, getStoredRoomHash, hashRoomPassword, safeEqualHash, storeRoomHash } from './utils/crypto'

interface JoinRequest {
  name: string
  room: string
  displayName: string
}

interface PendingPasswordJoin extends JoinRequest {
  passwordHash: string | null
}

export default function App() {
  const [kickedNoticeOpen, setKickedNoticeOpen] = useState(false)
  const handleKicked = useCallback(() => {
    setKickedNoticeOpen(true)
    if (window.location.search) {
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])
  const controller = useRoom(handleKicked)
  const { snapshot, toasts, dismissToast, pushToast, join } = controller
  const [joining, setJoining] = useState(false)
  const [roomDisplayName, setRoomDisplayName] = useState<string | undefined>(undefined)
  const [pendingJoin, setPendingJoin] = useState<PendingPasswordJoin | null>(null)

  useRoomSignaling(snapshot, roomDisplayName)

  /** Entrada efetiva: só aqui PeerJS, microfone e presença são inicializados. */
  const enterRoom = useCallback(
    async ({ name, room, displayName }: JoinRequest) => {
      setJoining(true)
      setRoomDisplayName(displayName)
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

  /**
   * Portão de segurança: valida a senha da sala ANTES de chamar `join()`.
   * Cobre o Lobby (criar / salas ativas) e links diretos (`/?room=...`), pois todos passam por aqui.
   */
  const handleJoin = useCallback(
    async (name: string, rawRoom: string, displayName?: string, password?: string) => {
      const room = slugifyRoom(rawRoom)
      if (!room) {
        pushToast('error', 'Nome de sala inválido. Use letras e números.')
        return
      }
      const request: JoinRequest = { name, room, displayName: displayName ?? room }
      const newPassword = password?.trim() ?? ''

      setJoining(true)
      try {
        const presence = getPresence()
        const meta = await presence.getRoomSecurity(room)

        // 1) Sala ativa e protegida → exige hash válido (sessão ou senha digitada)
        if (meta.active && meta.hasPassword) {
          const expected = meta.passwordHash
          if (newPassword && expected) {
            const typedHash = await hashRoomPassword(room, newPassword)
            if (safeEqualHash(typedHash, expected)) {
              storeRoomHash(room, typedHash)
              setJoining(false)
              await enterRoom(request)
              return
            }
          }
          const stored = getStoredRoomHash(room)
          if (stored && expected && safeEqualHash(stored, expected)) {
            setJoining(false)
            await enterRoom(request)
            return
          }
          if (stored) clearStoredRoomHash(room) // senha da sala mudou
          setJoining(false)
          setPendingJoin({ ...request, passwordHash: expected })
          return
        }

        // 2) Sala ativa e aberta → não permite "sequestrar" a sala colocando senha
        if (meta.active) {
          if (newPassword) {
            setJoining(false)
            pushToast('error', `Já existe uma sala aberta chamada #${room}. Escolha outro nome para criar uma sala privada.`)
            return
          }
          setJoining(false)
          await enterRoom(request)
          return
        }

        // 3) Sala nova (ou registro abandonado) → registra o hash (ou limpa senha antiga)
        if (newPassword) {
          const hash = await hashRoomPassword(room, newPassword)
          await presence.setRoomPassword(room, request.displayName, hash)
          storeRoomHash(room, hash) // o criador entra direto, inclusive após F5
        } else {
          if (meta.hasPassword) await presence.setRoomPassword(room, request.displayName, null)
          clearStoredRoomHash(room)
        }
        setJoining(false)
        await enterRoom(request)
      } catch (err) {
        console.warn('[discordia] falha ao validar segurança da sala', err)
        setJoining(false)
        pushToast('error', err instanceof Error ? err.message : 'Não foi possível verificar a sala. Tente novamente.')
      }
    },
    [enterRoom, pushToast],
  )

  const handlePasswordSubmit = useCallback(
    async (password: string): Promise<boolean> => {
      if (!pendingJoin) return false
      const { passwordHash, ...request } = pendingJoin
      if (!passwordHash) return false
      const typedHash = await hashRoomPassword(request.room, password)
      if (!safeEqualHash(typedHash, passwordHash)) return false
      storeRoomHash(request.room, typedHash)
      setPendingJoin(null)
      void enterRoom(request)
      return true
    },
    [pendingJoin, enterRoom],
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
      {pendingJoin && (
        <RoomPasswordModal
          key={pendingJoin.room}
          open
          roomName={pendingJoin.displayName}
          onSubmit={handlePasswordSubmit}
          onCancel={() => setPendingJoin(null)}
        />
      )}
      <Modal
        open={kickedNoticeOpen}
        onClose={() => setKickedNoticeOpen(false)}
        labelledBy="kicked-notice-title"
        widthClass="max-w-sm"
        icon={<ShieldAlert size={20} className="text-dc-red" />}
        title="Você foi removido da sala"
        footer={
          <button
            type="button"
            onClick={() => setKickedNoticeOpen(false)}
            className="dc-btn-primary px-4 py-2 text-sm"
          >
            Voltar ao Lobby
          </button>
        }
      >
        <p className="text-sm leading-relaxed text-dc-muted">
          O criador da sala removeu você da chamada e suas conexões de voz e vídeo foram encerradas.
        </p>
      </Modal>
      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
