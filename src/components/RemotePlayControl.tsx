import { useEffect, useState } from 'react'
import { AlertTriangle, Check, Download, Gamepad2, Power, ShieldCheck, UserCheck } from 'lucide-react'
import { Modal } from './Modal'
import { useGamepadCapture } from '../hooks/useGamepadCapture'
import type { GamepadStatePayload, RemoteParticipant, RemotePlayGrant } from '../types'

interface RemotePlayControlProps {
  localPeerId: string
  participants: RemoteParticipant[]
  grant: RemotePlayGrant | null
  companionConnected: boolean
  modalOpen: boolean
  onCloseModal: () => void
  onGrantGuest: (guestId: string | null) => void
  onRevokeGuest?: (guestId: string) => void
  onSendGamepadState: (payload: GamepadStatePayload) => void
  onRetryCompanion: () => void
}

const BUTTON_BADGES: { index: number; label: string; color: string }[] = [
  { index: 0, label: 'A', color: 'bg-emerald-500 text-black' },
  { index: 1, label: 'B', color: 'bg-rose-500 text-white' },
  { index: 2, label: 'X', color: 'bg-sky-400 text-black' },
  { index: 3, label: 'Y', color: 'bg-amber-400 text-black' },
  { index: 4, label: 'LB', color: 'bg-indigo-500 text-white' },
  { index: 5, label: 'RB', color: 'bg-indigo-500 text-white' },
  { index: 6, label: 'LT', color: 'bg-purple-500 text-white' },
  { index: 7, label: 'RT', color: 'bg-purple-500 text-white' },
  { index: 8, label: 'BACK', color: 'bg-zinc-600 text-white' },
  { index: 9, label: 'START', color: 'bg-zinc-600 text-white' },
  { index: 10, label: 'L3', color: 'bg-teal-500 text-black' },
  { index: 11, label: 'R3', color: 'bg-teal-500 text-black' },
  { index: 12, label: '↑', color: 'bg-slate-500 text-white' },
  { index: 13, label: '↓', color: 'bg-slate-500 text-white' },
  { index: 14, label: '←', color: 'bg-slate-500 text-white' },
  { index: 15, label: '→', color: 'bg-slate-500 text-white' },
]

const HOST_EXE_URL =
  (import.meta.env.VITE_HOST_EXE_URL as string | undefined)?.trim() ||
  'https://github.com/Pancheski/discordia/releases/latest/download/Discordia-Setup.exe'

export function RemotePlayControl({
  localPeerId,
  participants,
  grant,
  companionConnected,
  modalOpen,
  onCloseModal,
  onGrantGuest,
  onRevokeGuest,
  onSendGamepadState,
  onRetryCompanion,
}: RemotePlayControlProps) {
  const [hudExpanded, setHudExpanded] = useState(true)
  const isNativeDesktop = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)
  const hostReady = isNativeDesktop || companionConnected

  const controllers = grant?.controllers || {}
  const activeCount = Object.keys(controllers).length
  const mySlot = localPeerId ? controllers[localPeerId] : undefined
  const isAuthorizedGuest = Boolean(mySlot)
  const isHost = Boolean(grant && grant.hostId === localPeerId && activeCount > 0)

  useEffect(() => {
    if (hostReady) return
    if (!modalOpen && !isHost) return

    onRetryCompanion()
    const timer = window.setInterval(() => {
      onRetryCompanion()
    }, 1500)

    return () => {
      window.clearInterval(timer)
    }
  }, [hostReady, modalOpen, isHost, onRetryCompanion])

  const livePad = useGamepadCapture(isAuthorizedGuest, onSendGamepadState)

  const slotBadgeColor =
    mySlot === 1
      ? 'bg-emerald-500/20 text-emerald-300 ring-emerald-400/30'
      : mySlot === 2
        ? 'bg-sky-500/20 text-sky-300 ring-sky-400/30'
        : mySlot === 3
          ? 'bg-amber-500/20 text-amber-300 ring-amber-400/30'
          : 'bg-rose-500/20 text-rose-300 ring-rose-400/30'

  return (
    <>
      {/* No aplicativo desktop nativo (Electron), nunca exibe banners de instalação */}
      {isHost && !hostReady && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-200">
          <span className="inline-flex items-center gap-2 font-medium">
            <AlertTriangle size={14} className="shrink-0 text-amber-400" />
            <span>Discordia Host não detectado.</span>
          </span>
          <a
            href={HOST_EXE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/25 px-3 py-1 text-[11px] font-bold text-white ring-1 ring-amber-400/40 transition hover:bg-amber-500/40"
          >
            <Download size={12} /> Baixar Discordia (.exe)
          </a>
        </div>
      )}

      {/* HUD visual do Jogador Convidado */}
      {isAuthorizedGuest && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-emerald-500/30 bg-emerald-950/35 px-4 py-2 text-xs text-emerald-100">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/25 text-emerald-300">
                <Gamepad2 size={15} />
              </span>
              <span className="font-bold text-white">Controle ativado</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${slotBadgeColor}`}
              >
                Jogador {mySlot} · {grant?.hostName}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                  livePad.connected
                    ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30'
                    : 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    livePad.connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'
                  }`}
                />
                {livePad.connected ? 'Controle conectado' : 'Pressione qualquer botão no controle'}
              </span>
              <button
                type="button"
                onClick={() => setHudExpanded((v) => !v)}
                className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-white/80 hover:bg-white/15"
              >
                {hudExpanded ? 'Ocultar HUD' : 'Mostrar HUD'}
              </button>
            </div>
          </div>

          {hudExpanded && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/40 px-3 py-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {BUTTON_BADGES.map((btn) => {
                  const val = livePad.buttons[btn.index] ?? 0
                  const active = val > 0.08
                  return (
                    <span
                      key={btn.index}
                      className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 font-mono text-[10px] font-extrabold transition-all ${
                        active
                          ? `${btn.color} scale-110 shadow-[0_0_10px_rgba(52,211,153,0.5)]`
                          : 'bg-white/5 text-dc-muted opacity-55'
                      }`}
                    >
                      {btn.label}
                      {(btn.index === 6 || btn.index === 7) && active ? ` ${Math.round(val * 100)}%` : ''}
                    </span>
                  )
                })}
              </div>

              <div className="flex items-center gap-4 text-[10px] font-mono text-dc-muted">
                <div className="flex items-center gap-1.5">
                  <div className="relative h-7 w-7 rounded-full border border-white/20 bg-black/60">
                    <span
                      style={{
                        transform: `translate(${livePad.axes[0] * 9}px, ${livePad.axes[1] * 9}px)`,
                      }}
                      className="absolute left-1/2 top-1/2 -ml-1 -mt-1 h-2 w-2 rounded-full bg-emerald-400"
                    />
                  </div>
                  <span>
                    L: {livePad.axes[0].toFixed(2)}, {livePad.axes[1].toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="relative h-7 w-7 rounded-full border border-white/20 bg-black/60">
                    <span
                      style={{
                        transform: `translate(${livePad.axes[2] * 9}px, ${livePad.axes[3] * 9}px)`,
                      }}
                      className="absolute left-1/2 top-1/2 -ml-1 -mt-1 h-2 w-2 rounded-full bg-sky-400"
                    />
                  </div>
                  <span>
                    R: {livePad.axes[2].toFixed(2)}, {livePad.axes[3].toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Remote Play */}
      <Modal
        open={modalOpen}
        onClose={onCloseModal}
        labelledBy="remote-play-modal-title"
        widthClass="max-w-md"
        icon={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
            <Gamepad2 size={20} />
          </span>
        }
        title="Remote Play"
        footer={
          <div className="flex w-full items-center justify-between gap-2">
            {isHost ? (
              <button
                type="button"
                onClick={() => onGrantGuest(null)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-dc-red/20 px-3 py-2 text-xs font-bold text-dc-red transition hover:bg-dc-red hover:text-white"
              >
                <Power size={14} /> Revogar Todos ({activeCount})
              </button>
            ) : (
              <span />
            )}
            <button type="button" onClick={onCloseModal} className="dc-btn-ghost text-xs">
              Fechar
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {!isNativeDesktop && (
            <div
              className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs transition-colors ${
                hostReady
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-100'
                  : 'border-amber-500/40 bg-amber-500/10 text-amber-100'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <ShieldCheck
                  size={18}
                  className={hostReady ? 'shrink-0 text-emerald-400' : 'shrink-0 text-amber-400'}
                />
                <span className="font-bold text-white">
                  {hostReady ? '🟢 Pronto para jogar' : 'Desconectado'}
                </span>
              </div>
              {!hostReady && (
                <a
                  href={HOST_EXE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-extrabold text-black transition hover:brightness-110"
                >
                  <Download size={13} /> Baixar App (.exe)
                </a>
              )}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <h3 className="font-bold uppercase tracking-wider text-dc-muted">Participantes</h3>
              <span className="font-semibold text-emerald-400">
                {activeCount} / 4 Controles Ativos
              </span>
            </div>

            {participants.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-dc-darkest p-4 text-center text-xs text-dc-muted">
                Nenhum participante conectado no momento.
              </div>
            ) : (
              <ul className="space-y-2">
                {participants.map((p) => {
                  const assignedSlot = controllers[p.peerId]
                  const isAssigned = typeof assignedSlot === 'number'

                  return (
                    <li
                      key={p.peerId}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 transition ${
                        isAssigned
                          ? 'border-emerald-400/60 bg-emerald-500/15'
                          : 'border-white/10 bg-dc-darkest hover:border-white/20'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2.5">
                        <UserCheck size={16} className={isAssigned ? 'text-emerald-400' : 'text-dc-muted'} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{p.name}</p>
                          {isAssigned && (
                            <span className="text-[11px] font-bold text-emerald-400">
                              🎮 Jogador {assignedSlot} (Slot {assignedSlot})
                            </span>
                          )}
                        </div>
                      </div>

                      {isAssigned ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (onRevokeGuest) {
                              onRevokeGuest(p.peerId)
                            } else {
                              onGrantGuest(p.peerId)
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-extrabold text-black shadow transition hover:bg-rose-500 hover:text-white"
                          title="Clique para revogar o controle deste jogador"
                        >
                          <Check size={14} /> Ativo (P{assignedSlot})
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={activeCount >= 4}
                          onClick={() => {
                            onRetryCompanion()
                            onGrantGuest(p.peerId)
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                            activeCount >= 4
                              ? 'cursor-not-allowed bg-white/5 text-dc-muted'
                              : 'bg-dc-brand text-white hover:bg-dc-brand/90'
                          }`}
                        >
                          <Gamepad2 size={14} />
                          {activeCount >= 4 ? 'Limite (4/4)' : 'Liberar Controle'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
