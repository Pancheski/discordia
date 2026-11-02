import { useEffect } from 'react'
import { Crown, Eye, Layers, Play, RotateCcw, Sparkles, Trophy } from 'lucide-react'
import { Modal } from './Modal'
import { playUiSfx } from '../hooks/useAudioSystem'
import type { TrioAction, TrioGameState } from '../types'

interface TrioGameModalProps {
  open: boolean
  onClose: () => void
  localPeerId: string
  gameState: TrioGameState | null
  onStartGame: () => void
  onAction: (action: TrioAction) => void
  onEndGame: () => void
}

const CARD_COLORS: Record<number, string> = {
  1: 'from-sky-500 to-blue-700',
  2: 'from-emerald-500 to-teal-700',
  3: 'from-amber-500 to-orange-700',
  4: 'from-purple-500 to-indigo-700',
  5: 'from-pink-500 to-rose-700',
  6: 'from-cyan-500 to-sky-700',
  7: 'from-yellow-400 via-amber-500 to-yellow-600 ring-2 ring-yellow-300',
  8: 'from-fuchsia-500 to-purple-800',
  9: 'from-lime-500 to-green-700',
  10: 'from-red-500 to-rose-800',
  11: 'from-violet-500 to-indigo-800',
  12: 'from-teal-400 to-emerald-800',
}

export function TrioGameModal({
  open,
  onClose,
  localPeerId,
  gameState,
  onStartGame,
  onAction,
  onEndGame,
}: TrioGameModalProps) {
  const phase = gameState?.phase
  const winnerId = gameState?.winnerId

  useEffect(() => {
    if (phase === 'finished' && winnerId) {
      playUiSfx(winnerId === localPeerId ? 'win' : 'lose')
    } else if (phase === 'trio-claimed') {
      playUiSfx('join')
    } else if (phase === 'mismatch') {
      playUiSfx('mute')
    }
  }, [phase, winnerId, localPeerId])

  if (!open) return null

  const currentPlayer = gameState ? gameState.players[gameState.turnIndex] : null
  const isMyTurn = !!gameState && gameState.phase === 'playing' && currentPlayer?.peerId === localPeerId

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="trio-game-title"
      widthClass="max-w-4xl"
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
          <Layers size={20} />
        </span>
      }
      title="Mesa da Sala · TRIO (Jogo de Cartas e Memória)"
      footer={
        gameState ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <button type="button" onClick={onEndGame} className="dc-btn-ghost text-xs text-dc-red hover:bg-dc-red/15">
              Encerrar Mesa
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onStartGame}
                className="dc-btn-ghost text-xs"
                title="Embaralhar e distribuir novamente"
              >
                <RotateCcw size={14} /> Nova Partida
              </button>
              <button type="button" onClick={onClose} className="dc-btn-primary px-4 py-2 text-xs">
                Minimizar Mesa
              </button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={onClose} className="dc-btn-ghost text-xs">
            Fechar
          </button>
        )
      }
    >
      {!gameState ? (
        <div className="space-y-4 py-2">
          <div className="rounded-xl border border-white/10 bg-dc-darkest/80 p-4 text-sm leading-relaxed text-dc-text">
            <h3 className="flex items-center gap-2 text-base font-bold text-white">
              <Sparkles size={18} className="text-amber-400" /> Como jogar TRIO com a sala:
            </h3>
            <ul className="mt-2.5 space-y-1.5 text-xs text-dc-muted">
              <li>
                • <strong className="text-dc-header">Baralho de 36 cartas:</strong> números de <b>1 a 12</b> (3 cartas de cada
                número).
              </li>
              <li>
                • <strong className="text-dc-header">Mãos Ordenadas:</strong> cada jogador recebe suas cartas ordenadas da{' '}
                <b>menor (esquerda)</b> para a <b>maior (direita)</b>. Você só vê os números da sua própria mão!
              </li>
              <li>
                • <strong className="text-dc-header">No seu turno:</strong> revele cartas uma a uma escolhendo entre:
                <span className="mt-1 block pl-3 text-dc-text">
                  1. Pedir a carta <b>Mais Baixa</b> ou <b>Mais Alta</b> da mão de qualquer jogador (inclusive da sua).
                  <br />
                  2. Virar uma carta oculta do <b>Centro da Mesa</b>.
                </span>
              </li>
              <li>
                • <strong className="text-dc-header">Objetivo:</strong> revele 3 cartas iguais seguidas para ganhar o Trio!
                Vence imediatamente quem conseguir <b className="text-amber-400">3 Trios</b> ou o lendário{' '}
                <b className="text-amber-400">Trio de 7 (7-7-7)</b>!
              </li>
            </ul>
          </div>

          <button type="button" onClick={onStartGame} className="dc-btn-primary w-full py-3 text-sm">
            <Play size={17} /> Distribuir Cartas e Iniciar TRIO
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Banner de Turno / Status */}
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-xs ${
              gameState.phase === 'finished'
                ? 'border-amber-400/50 bg-amber-500/15 text-amber-200'
                : gameState.phase === 'mismatch'
                  ? 'border-dc-red/40 bg-dc-red/15 text-dc-red'
                  : gameState.phase === 'trio-claimed'
                    ? 'border-dc-green/40 bg-dc-green/15 text-dc-green'
                    : isMyTurn
                      ? 'border-dc-brand bg-dc-brand/20 text-white'
                      : 'border-white/10 bg-dc-darkest text-dc-text'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-current" />
              <span>{gameState.lastEvent}</span>
            </div>

            <div className="flex items-center gap-2">
              {gameState.currentReveals.length > 0 && (
                <div className="flex items-center gap-1 rounded-md bg-black/30 px-2 py-1">
                  <span className="text-[11px] text-dc-muted">Reveladas no turno:</span>
                  {gameState.currentReveals.map((r, idx) => (
                    <span
                      key={idx}
                      className="inline-flex h-5 w-5 items-center justify-center rounded bg-white/15 font-mono text-xs font-extrabold text-white"
                    >
                      {r.value}
                    </span>
                  ))}
                </div>
              )}
              {isMyTurn && (
                <span className="rounded-full bg-dc-green px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-white shadow">
                  Sua Vez!
                </span>
              )}
            </div>
          </div>

          {/* Tela de Vencedor */}
          {gameState.phase === 'finished' && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-amber-400/40 bg-gradient-to-b from-amber-500/20 to-dc-darkest p-5 text-center">
              <Trophy size={38} className="text-amber-400" />
              <h3 className="text-lg font-extrabold text-white">
                {gameState.winnerName} venceu a partida de TRIO!
              </h3>
              <p className="text-xs text-amber-200">{gameState.winReason}</p>
              <button type="button" onClick={onStartGame} className="dc-btn-primary mt-2 px-5 py-2 text-xs">
                <RotateCcw size={14} /> Jogar Novamente
              </button>
            </div>
          )}

          {/* Centro da Mesa */}
          <div className="rounded-xl border border-white/10 bg-dc-darkest/90 p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-dc-muted">
                Centro da Mesa ({gameState.tableCards.length} cartas)
              </span>
              <span className="text-[11px] text-dc-faint">
                {isMyTurn ? 'Clique em uma carta oculta para virá-la' : 'Aguardando jogada do turno'}
              </span>
            </div>

            {gameState.tableCards.length === 0 ? (
              <p className="py-3 text-center text-xs text-dc-faint">Todas as cartas da mesa já foram coletadas.</p>
            ) : (
              <div className="flex flex-wrap justify-center gap-2">
                {gameState.tableCards.map((card, i) => {
                  const canClick = isMyTurn && !card.revealed
                  return (
                    <button
                      key={card.uid}
                      type="button"
                      disabled={!canClick}
                      onClick={() => onAction({ kind: 'reveal-table', cardUid: card.uid })}
                      className={`relative flex h-16 w-12 flex-col items-center justify-center rounded-lg border font-mono transition ${
                        card.revealed
                          ? `border-white/30 bg-gradient-to-br ${CARD_COLORS[card.value] ?? 'from-indigo-500 to-indigo-800'} text-white shadow-lg scale-105`
                          : canClick
                            ? 'border-dc-brand/40 bg-dc-darker text-dc-muted hover:-translate-y-1 hover:border-dc-brand hover:text-white'
                            : 'border-white/5 bg-dc-darker/70 text-dc-faint opacity-80'
                      }`}
                      title={card.revealed ? `Carta ${card.value}` : `Carta da mesa #${i + 1}`}
                    >
                      {card.revealed ? (
                        <>
                          <span className="text-lg font-extrabold">{card.value}</span>
                          {card.value === 7 && <span className="text-[9px] font-bold text-yellow-200">★ 7 ★</span>}
                        </>
                      ) : (
                        <>
                          <span className="text-sm">🂠</span>
                          <span className="text-[9px] text-dc-faint">#{i + 1}</span>
                        </>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Mãos dos Jogadores */}
          <div className="grid gap-3 md:grid-cols-2">
            {gameState.players.map((p, idx) => {
              const isTurn = idx === gameState.turnIndex && gameState.phase !== 'finished'
              const isMe = p.peerId === localPeerId
              const hasUnrevealed = p.hand.some((c) => !c.revealed)
              const firstUnrevealedUid = p.hand.find((c) => !c.revealed)?.uid
              const lastUnrevealedUid = [...p.hand].reverse().find((c) => !c.revealed)?.uid

              return (
                <div
                  key={p.peerId}
                  className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
                    isTurn
                      ? 'border-dc-brand bg-dc-brand/10 ring-1 ring-dc-brand/40'
                      : 'border-white/10 bg-dc-darkest/75'
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-dc-header">
                          {p.name} {isMe && <span className="text-xs font-normal text-dc-brand-soft">(Você)</span>}
                        </span>
                        {isTurn && (
                          <span className="rounded bg-dc-brand px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                            Na Vez
                          </span>
                        )}
                      </div>

                      {/* Trios conquistados pelo jogador */}
                      <div className="flex items-center gap-1">
                        <Crown size={13} className="text-amber-400" />
                        <span className="text-[11px] font-semibold text-dc-muted">Trios:</span>
                        {p.trios.length === 0 ? (
                          <span className="text-[11px] text-dc-faint">0/3</span>
                        ) : (
                          p.trios.map((t, tIdx) => (
                            <span
                              key={tIdx}
                              className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-extrabold ${
                                t === 7 ? 'bg-amber-400 text-black' : 'bg-dc-green/25 text-dc-green'
                              }`}
                            >
                              {t}-{t}-{t}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Cartas na mão (ordenadas do menor para o maior) */}
                    <div className="mt-3">
                      {p.hand.length === 0 ? (
                        <p className="py-3 text-center text-xs text-dc-faint">Sem cartas na mão</p>
                      ) : (
                        <>
                          <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-dc-faint">
                            <span>⬅ Menor</span>
                            <span>{p.hand.length} cartas ordenadas</span>
                            <span>Maior ➡</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-1.5">
                            {p.hand.map((card) => {
                              const visibleToMe = isMe || card.revealed || gameState.phase === 'finished'
                              const isEdgeLow = card.uid === firstUnrevealedUid
                              const isEdgeHigh = card.uid === lastUnrevealedUid

                              return (
                                <div
                                  key={card.uid}
                                  className={`relative flex h-14 w-10 flex-col items-center justify-center rounded-md border font-mono text-xs transition ${
                                    card.revealed
                                      ? `border-white bg-gradient-to-br ${CARD_COLORS[card.value] ?? 'from-indigo-500 to-indigo-800'} text-white ring-2 ring-amber-300 scale-105`
                                      : visibleToMe
                                        ? `border-white/20 bg-gradient-to-br ${CARD_COLORS[card.value] ?? 'from-indigo-500 to-indigo-800'} text-white/95`
                                        : 'border-white/10 bg-dc-darker text-dc-muted'
                                  }`}
                                  title={
                                    card.revealed
                                      ? `Revelada na mesa: ${card.value}`
                                      : isMe
                                        ? `Sua carta: ${card.value}`
                                        : 'Carta oculta'
                                  }
                                >
                                  {visibleToMe ? (
                                    <span className="text-base font-extrabold">{card.value}</span>
                                  ) : (
                                    <span className="text-xs">🂠</span>
                                  )}

                                  {card.revealed && (
                                    <span className="mt-0.5 flex items-center gap-0.5 rounded bg-black/50 px-1 text-[8px] font-bold uppercase text-amber-300">
                                      <Eye size={8} /> Visto
                                    </span>
                                  )}

                                  {!card.revealed && (isEdgeLow || isEdgeHigh) && (
                                    <span className="text-[8px] font-bold uppercase opacity-75">
                                      {isEdgeLow && isEdgeHigh ? 'Única' : isEdgeLow ? 'Min' : 'Max'}
                                    </span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Ações de revelar carta Mais Baixa ou Mais Alta deste jogador */}
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-2.5">
                    <button
                      type="button"
                      disabled={!isMyTurn || !hasUnrevealed}
                      onClick={() => onAction({ kind: 'reveal-hand', targetPeerId: p.peerId, edge: 'lowest' })}
                      className="rounded-md bg-dc-light px-2.5 py-1.5 text-[11px] font-semibold text-dc-text transition hover:bg-dc-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ⬅ Revelar Mais Baixa
                    </button>
                    <button
                      type="button"
                      disabled={!isMyTurn || !hasUnrevealed}
                      onClick={() => onAction({ kind: 'reveal-hand', targetPeerId: p.peerId, edge: 'highest' })}
                      className="rounded-md bg-dc-light px-2.5 py-1.5 text-[11px] font-semibold text-dc-text transition hover:bg-dc-brand hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Revelar Mais Alta ➡
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}

