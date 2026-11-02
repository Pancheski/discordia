import { useEffect, useRef } from 'react'
import { Crown, Eye, Layers, Minimize2, Play, Power, RotateCcw, Trophy } from 'lucide-react'
import { playUiSfx } from '../hooks/useAudioSystem'
import type { TrioAction, TrioCard, TrioGameState } from '../types'

interface TrioGame3DProps {
  open: boolean
  onClose: () => void
  localPeerId: string
  gameState: TrioGameState | null
  onStartGame: () => void
  onAction: (action: TrioAction) => void
  onEndGame: () => void
}

const CARD_THEMES: Record<number, { bg: string; ring: string; label: string }> = {
  1: { bg: 'from-sky-400 via-blue-600 to-blue-900', ring: 'ring-sky-300', label: 'Ás Solar' },
  2: { bg: 'from-emerald-400 via-teal-600 to-teal-900', ring: 'ring-emerald-300', label: 'Duque' },
  3: { bg: 'from-amber-400 via-orange-600 to-orange-900', ring: 'ring-amber-300', label: 'Tríade' },
  4: { bg: 'from-purple-400 via-indigo-600 to-indigo-900', ring: 'ring-purple-300', label: 'Quartzo' },
  5: { bg: 'from-pink-400 via-rose-600 to-rose-900', ring: 'ring-pink-300', label: 'Pentagrama' },
  6: { bg: 'from-cyan-400 via-sky-600 to-sky-900', ring: 'ring-cyan-300', label: 'Hexa' },
  7: { bg: 'from-yellow-300 via-amber-500 to-yellow-800', ring: 'ring-yellow-200', label: 'SETE DOURADO' },
  8: { bg: 'from-fuchsia-400 via-purple-600 to-purple-900', ring: 'ring-fuchsia-300', label: 'Infinito' },
  9: { bg: 'from-lime-400 via-green-600 to-green-900', ring: 'ring-lime-300', label: 'Nove Real' },
  10: { bg: 'from-red-400 via-rose-600 to-rose-950', ring: 'ring-red-300', label: 'Décima' },
  11: { bg: 'from-violet-400 via-indigo-600 to-indigo-950', ring: 'ring-violet-300', label: 'Valete' },
  12: { bg: 'from-teal-300 via-emerald-600 to-emerald-950', ring: 'ring-teal-200', label: 'Coroa 12' },
}

const CONFETTI_COLORS = ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#f87171']

export function TrioGame3D({
  open,
  onClose,
  localPeerId,
  gameState,
  onStartGame,
  onAction,
  onEndGame,
}: TrioGame3DProps) {
  const phase = gameState?.phase
  const winnerId = gameState?.winnerId
  const revealCount = gameState?.currentReveals.length ?? 0
  const prevRevealCountRef = useRef(0)

  // Efeito sonoro tátil de carta virando a cada nova revelação
  useEffect(() => {
    if (revealCount > prevRevealCountRef.current) {
      playUiSfx('cardFlip')
    }
    prevRevealCountRef.current = revealCount
  }, [revealCount])

  useEffect(() => {
    if (phase === 'finished' && winnerId) {
      playUiSfx(winnerId === localPeerId ? 'win' : 'lose')
    } else if (phase === 'trio-claimed') {
      playUiSfx('win')
    } else if (phase === 'mismatch') {
      playUiSfx('mute')
    }
  }, [phase, winnerId, localPeerId])

  if (!open) return null

  const currentPlayer = gameState ? gameState.players[gameState.turnIndex] : null
  const isMyTurn = !!gameState && gameState.phase === 'playing' && currentPlayer?.peerId === localPeerId
  const showConfetti = gameState?.phase === 'trio-claimed' || gameState?.phase === 'finished'

  return (
    <div
      aria-labelledby="trio-3d-title"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-dc-darker shadow-2xl"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-dc-darkest/90 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300">
            <Layers size={18} />
          </span>
          <h2 id="trio-3d-title" className="text-sm font-extrabold text-white">
            TRIO
          </h2>
        </div>

        <div className="flex items-center gap-2">
          {gameState && (
            <button
              type="button"
              onClick={onStartGame}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-dc-text transition hover:bg-white/10 hover:text-white"
            >
              <RotateCcw size={14} />
              <span className="hidden sm:inline">Reiniciar</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-dc-light px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-dc-hover"
          >
            <Minimize2 size={14} />
            <span>Minimizar</span>
          </button>
          <button
            type="button"
            onClick={onEndGame}
            className="inline-flex items-center gap-1.5 rounded-lg bg-dc-red/20 px-3 py-1.5 text-xs font-semibold text-dc-red transition hover:bg-dc-red hover:text-white"
          >
            <Power size={14} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
      {!gameState ? (
        <div className="flex h-full items-center justify-center py-8">
          <button type="button" onClick={onStartGame} className="dc-btn-primary px-8 py-3.5 text-sm shadow-lg">
            <Play size={18} /> Jogar
          </button>
        </div>
      ) : (
        <div className="relative space-y-4 overflow-hidden">
          {/* Explosão de confetes quando forma um Trio ou vence */}
          {showConfetti && <ConfettiBurst />}

          {/* Barra superior de status do turno */}
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-xs shadow ${
              gameState.phase === 'finished'
                ? 'border-amber-400/60 bg-amber-500/20 text-amber-100'
                : gameState.phase === 'mismatch'
                  ? 'border-dc-red/50 bg-dc-red/20 text-red-200'
                  : gameState.phase === 'trio-claimed'
                    ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                    : isMyTurn
                      ? 'border-dc-brand bg-dc-brand/25 text-white'
                      : 'border-white/10 bg-dc-darkest text-dc-text'
            }`}
          >
            <div className="flex items-center gap-2 font-semibold">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-current" />
              <span>{gameState.lastEvent}</span>
            </div>

            {isMyTurn && (
              <span className="rounded-full bg-dc-green px-3 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-white shadow">
                Sua Vez de Jogar!
              </span>
            )}
          </div>

          {/* Tela de Campeão */}
          {gameState.phase === 'finished' && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-amber-400/50 bg-gradient-to-b from-amber-500/25 via-dc-darkest to-dc-darkest p-5 text-center shadow-xl">
              <Trophy size={42} className="text-amber-400 drop-shadow" />
              <h3 className="text-xl font-extrabold text-white">
                {gameState.winnerName} venceu!
              </h3>
              <p className="text-xs font-medium text-amber-200">{gameState.winReason}</p>
              <button type="button" onClick={onStartGame} className="dc-btn-primary mt-2 px-5 py-2 text-xs">
                <RotateCcw size={14} /> Jogar Novamente
              </button>
            </div>
          )}

          {/* MESA DE FELTRO 3D COM PERSPECTIVA ISOMÉTRICA */}
          <div className="trio-scene px-2 pt-2 pb-4">
            <div className="trio-felt-table relative rounded-3xl px-5 py-6">
              {/* Ornamento dourado interno do feltro */}
              <div className="pointer-events-none absolute inset-3 rounded-2xl border border-amber-300/20" />

              {/* Palco Flutuante de Revelação (Cartas levitando em conferência 3D) */}
              <div className="relative z-10 mb-5 flex flex-col items-center">
                <span className="mb-2 rounded-full bg-black/45 px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-emerald-200/90 ring-1 ring-white/10">
                  Conferência do Trio ({gameState.currentReveals.length}/3)
                </span>
                <div className="flex min-h-[5.5rem] items-center justify-center gap-4">
                  {[0, 1, 2].map((slotIdx) => {
                    const rev = gameState.currentReveals[slotIdx]
                    if (!rev) {
                      return (
                        <div
                          key={slotIdx}
                          className="flex h-20 w-14 items-center justify-center rounded-xl border border-dashed border-white/20 bg-black/25 font-mono text-xs text-white/35"
                        >
                          {slotIdx + 1}ª
                        </div>
                      )
                    }
                    const theme = CARD_THEMES[rev.value] ?? CARD_THEMES[1]
                    return (
                      <div
                        key={`${rev.cardUid}-${slotIdx}`}
                        className={`relative flex h-20 w-14 -translate-y-1 flex-col items-center justify-between overflow-hidden rounded-xl border border-white/40 bg-gradient-to-br ${theme.bg} p-1.5 font-mono text-white shadow-2xl ring-2 ${theme.ring} animate-fade-up`}
                      >
                        <div className="trio-foil-sheen pointer-events-none absolute inset-0" />
                        <span className="self-start text-[9px] font-black opacity-85">{rev.value}</span>
                        <span className="text-2xl font-black drop-shadow">{rev.value}</span>
                        <span className="text-[7px] font-bold uppercase tracking-tighter opacity-90">
                          {rev.source === 'table' ? 'Mesa' : 'Mão'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Cartas do Centro da Mesa dispostas com leve angulação orgânica */}
              <div className="relative z-10">
                <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-emerald-100/80">
                  <span>🂠 Centro do Feltro ({gameState.tableCards.length} cartas restantes)</span>
                  <span>{isMyTurn ? 'Passe o mouse e clique para virar em 3D' : 'Aguarde sua vez'}</span>
                </div>

                {gameState.tableCards.length === 0 ? (
                  <p className="py-4 text-center text-xs text-emerald-200/60">Todas as cartas do feltro foram recolhidas.</p>
                ) : (
                  <div className="flex flex-wrap justify-center gap-2.5 py-2">
                    {gameState.tableCards.map((card, i) => {
                      const canFlip = isMyTurn && !card.revealed
                      // Leve rotação determinística para parecer cartas reais espalhadas no feltro
                      const tiltDeg = ((i * 37) % 9) - 4
                      return (
                        <TableCard3D
                          key={card.uid}
                          card={card}
                          index={i}
                          tiltDeg={tiltDeg}
                          canFlip={canFlip}
                          onFlip={() => onAction({ kind: 'reveal-table', cardUid: card.uid })}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mãos dos Jogadores na parte inferior inclinadas para a câmera */}
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
                  className={`flex flex-col justify-between rounded-2xl border p-3.5 transition ${
                    isTurn
                      ? 'border-emerald-400/70 bg-gradient-to-b from-emerald-950/60 to-dc-darkest ring-1 ring-emerald-400/40'
                      : 'border-white/10 bg-dc-darkest/85'
                  }`}
                >
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-dc-header">
                          {p.name} {isMe && <span className="text-xs font-normal text-emerald-300">(Sua Mão)</span>}
                        </span>
                        {isTurn && (
                          <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold uppercase text-black">
                            Jogando
                          </span>
                        )}
                      </div>

                      {/* Trios conquistados */}
                      <div className="flex items-center gap-1">
                        <Crown size={13} className="text-amber-400" />
                        <span className="text-[11px] font-semibold text-dc-muted">Trios:</span>
                        {p.trios.length === 0 ? (
                          <span className="text-[11px] text-dc-faint">0/3</span>
                        ) : (
                          p.trios.map((t, tIdx) => (
                            <span
                              key={tIdx}
                              className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-extrabold shadow ${
                                t === 7 ? 'bg-amber-400 text-black' : 'bg-emerald-500/25 text-emerald-300'
                              }`}
                            >
                              {t}·{t}·{t}
                            </span>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Leque de cartas ordenadas */}
                    <div className="mt-3">
                      {p.hand.length === 0 ? (
                        <p className="py-3 text-center text-xs text-dc-faint">Mão vazia</p>
                      ) : (
                        <>
                          <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-emerald-300/80">
                            <span>⬅ Menor Carta</span>
                            <span className="text-dc-muted">{p.hand.length} cartas</span>
                            <span>Maior Carta ➡</span>
                          </div>
                          <div className="flex flex-wrap items-center justify-center gap-1.5 py-1">
                            {p.hand.map((card, cIdx) => {
                              const faceUp = isMe || card.revealed || gameState.phase === 'finished'
                              const isEdgeLow = card.uid === firstUnrevealedUid
                              const isEdgeHigh = card.uid === lastUnrevealedUid
                              const fanAngle = (cIdx - (p.hand.length - 1) / 2) * 2.2

                              return (
                                <HandCard3D
                                  key={card.uid}
                                  card={card}
                                  faceUp={faceUp}
                                  fanAngle={fanAngle}
                                  isEdgeLow={isEdgeLow}
                                  isEdgeHigh={isEdgeHigh}
                                />
                              )
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Botões de revelar extremidades */}
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/5 pt-2.5">
                    <button
                      type="button"
                      disabled={!isMyTurn || !hasUnrevealed}
                      onClick={() => onAction({ kind: 'reveal-hand', targetPeerId: p.peerId, edge: 'lowest' })}
                      className="rounded-lg bg-dc-light px-2.5 py-2 text-[11px] font-bold text-dc-text transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      ⬅ Pedir Mais Baixa
                    </button>
                    <button
                      type="button"
                      disabled={!isMyTurn || !hasUnrevealed}
                      onClick={() => onAction({ kind: 'reveal-hand', targetPeerId: p.peerId, edge: 'highest' })}
                      className="rounded-lg bg-dc-light px-2.5 py-2 text-[11px] font-bold text-dc-text transition hover:bg-emerald-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Pedir Mais Alta ➡
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  )
}

function TableCard3D({
  card,
  index,
  tiltDeg,
  canFlip,
  onFlip,
}: {
  card: TrioCard
  index: number
  tiltDeg: number
  canFlip: boolean
  onFlip: () => void
}) {
  const theme = CARD_THEMES[card.value] ?? CARD_THEMES[1]

  return (
    <button
      type="button"
      disabled={!canFlip}
      onClick={onFlip}
      style={{ transform: card.revealed ? undefined : `rotateZ(${tiltDeg}deg)` }}
      className={`trio-card-3d relative h-20 w-14 rounded-xl select-none ${
        card.revealed ? 'is-flipped' : canFlip ? 'cursor-pointer' : 'opacity-85'
      }`}
      title={card.revealed ? `Carta ${card.value}` : `Carta da mesa #${index + 1}`}
    >
      {/* Verso da carta (padrão geométrico de baralho físico) */}
      <div className="trio-card-face trio-card-back-pattern absolute inset-0 flex flex-col items-center justify-between rounded-xl border-2 border-amber-200/35 p-1.5">
        <span className="self-start font-mono text-[8px] font-bold text-amber-200/70">#{index + 1}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-300/40 bg-black/30 text-xs font-extrabold text-amber-300">
          T
        </span>
        <span className="self-end font-mono text-[8px] text-amber-200/50">3D</span>
      </div>

      {/* Frente da carta (relevo + foil) */}
      <div
        className={`trio-card-face trio-card-front absolute inset-0 flex flex-col items-center justify-between overflow-hidden rounded-xl border-2 border-white/60 bg-gradient-to-br ${theme.bg} p-1.5 text-white`}
      >
        <div className="trio-foil-sheen pointer-events-none absolute inset-0" />
        <span className="self-start font-mono text-[9px] font-black">{card.value}</span>
        <span className="font-mono text-2xl font-black drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]">{card.value}</span>
        <span className="truncate text-[7px] font-bold uppercase tracking-wider opacity-90">{theme.label}</span>
      </div>
    </button>
  )
}

function HandCard3D({
  card,
  faceUp,
  fanAngle,
  isEdgeLow,
  isEdgeHigh,
}: {
  card: TrioCard
  faceUp: boolean
  fanAngle: number
  isEdgeLow: boolean
  isEdgeHigh: boolean
}) {
  const theme = CARD_THEMES[card.value] ?? CARD_THEMES[1]

  return (
    <div
      style={{ transform: `rotateZ(${fanAngle}deg) ${card.revealed ? 'translateY(-6px) scale(1.07)' : ''}` }}
      className={`relative flex h-16 w-11 flex-col items-center justify-between overflow-hidden rounded-lg border font-mono transition duration-300 shadow-md ${
        faceUp
          ? `border-white/50 bg-gradient-to-br ${theme.bg} text-white ${card.revealed ? 'ring-2 ring-amber-300' : ''}`
          : 'trio-card-back-pattern border-amber-200/30 text-amber-200'
      }`}
    >
      {faceUp && <div className="trio-foil-sheen pointer-events-none absolute inset-0" />}
      <span className="self-start px-1 pt-0.5 text-[8px] font-bold opacity-80">
        {!card.revealed && (isEdgeLow || isEdgeHigh) ? (isEdgeLow ? 'MIN' : 'MAX') : ''}
      </span>
      <span className="text-lg font-black drop-shadow">{faceUp ? card.value : '🂠'}</span>
      {card.revealed ? (
        <span className="mb-0.5 flex items-center gap-0.5 rounded bg-black/55 px-1 text-[7px] font-bold uppercase text-amber-300">
          <Eye size={7} /> Visto
        </span>
      ) : (
        <span className="pb-0.5 text-[7px] opacity-70">{faceUp && card.value === 7 ? '★7★' : ''}</span>
      )}
    </div>
  )
}

function ConfettiBurst() {
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 28 }).map((_, i) => {
        const left = `${(i * 100) / 28}%`
        const dx = `${((i % 7) - 3) * 28}px`
        const delay = `${(i % 5) * 0.08}s`
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
        return (
          <span
            key={i}
            style={{ left, backgroundColor: color, animationDelay: delay, '--dx': dx } as React.CSSProperties}
            className="animate-confetti absolute top-0 h-3 w-2 rounded-sm"
          />
        )
      })}
    </div>
  )
}

