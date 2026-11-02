import { ArrowRight, CircleAlert, Hash, LoaderCircle, Plus, Radio, RefreshCw, Users } from 'lucide-react'
import { MAX_PEERS } from '../lib/utils'
import type { ActiveRoomsState } from '../hooks/usePresence'

interface LobbyRoomsProps {
  state: ActiveRoomsState
  joining: boolean
  canEnter: boolean
  onSelectRoom: (roomId: string, roomName: string) => void
  onSwitchToCreate: () => void
}

/**
 * Lista de salas abertas em tempo real (Firebase RTDB ou Mock Local via .env).
 * Exibe cartões com nome da sala, quantidade de pessoas online e botão "Entrar".
 */
export function LobbyRooms({ state, joining, canEnter, onSelectRoom, onSwitchToCreate }: LobbyRoomsProps) {
  const { rooms, loading, error, kind, refresh } = state

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-dc-muted">
        <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide">
          <Radio size={13} className="text-dc-green" />
          Salas ativas ({rooms.length})
          <span className="rounded bg-dc-darkest px-1.5 py-0.5 font-mono text-[10px] font-normal lowercase text-dc-faint">
            {kind === 'firebase' ? 'firebase rtdb' : kind === 'local' ? 'local sync' : 'off'}
          </span>
        </span>

        <button
          type="button"
          onClick={refresh}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-dc-muted transition hover:bg-dc-hover hover:text-dc-text"
          title="Atualizar lista de salas"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Atualizar
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-dc-red/30 bg-dc-red/10 p-2.5 text-xs text-dc-red">
          <CircleAlert size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && rooms.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-white/5 bg-dc-darkest/60 py-10 text-sm text-dc-muted">
          <LoaderCircle size={18} className="animate-spin text-dc-brand-soft" />
          Procurando salas abertas…
        </div>
      ) : rooms.length === 0 ? (
        <div className="rounded-xl border border-dashed border-dc-border bg-dc-darkest/40 p-6 text-center">
          <Users size={26} className="mx-auto mb-2 text-dc-faint" />
          <p className="text-sm font-semibold text-dc-header">Nenhuma sala aberta no momento</p>
          <p className="mt-1 text-xs text-dc-muted">
            Crie uma nova sala e ela aparecerá aqui automaticamente para seus amigos entrarem.
          </p>
          <button type="button" onClick={onSwitchToCreate} className="dc-btn-primary mt-4 py-2 text-xs">
            <Plus size={15} /> Criar Nova Sala
          </button>
        </div>
      ) : (
        <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
          {rooms.map((room) => {
            const full = room.online >= MAX_PEERS
            return (
              <li
                key={room.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-dc-darkest/80 px-3.5 py-3 transition hover:border-dc-brand/40 hover:bg-dc-darkest"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Hash size={15} className="shrink-0 text-dc-brand-soft" />
                    <span className="truncate font-semibold text-dc-header">{room.name}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-dc-muted">
                    <span className="inline-flex items-center gap-1.5 font-medium text-dc-green">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-dc-green" />
                      {room.online} {room.online === 1 ? 'pessoa online' : 'pessoas online'}
                    </span>
                    <span className="text-dc-faint">·</span>
                    <span className="font-mono text-[11px] text-dc-faint">
                      {room.online}/{MAX_PEERS}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={!canEnter || joining || full}
                  onClick={() => onSelectRoom(room.id, room.name)}
                  className="dc-btn-primary shrink-0 px-3.5 py-2 text-xs"
                  title={!canEnter ? 'Digite seu apelido acima para entrar' : full ? 'Sala cheia' : `Entrar em #${room.name}`}
                >
                  {full ? (
                    'Cheia'
                  ) : (
                    <>
                      Entrar <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

