import { useEffect, useState } from 'react'
import { Check, LoaderCircle, RotateCcw, Swords, Trophy, X } from 'lucide-react'
import { Modal } from './Modal'
import { playUiSfx } from '../hooks/useAudioSystem'
import type { RpsChoice, RpsDuelState } from '../types'

interface RpsDuelModalProps {
  localName: string
  duel: RpsDuelState | null
  onAccept: () => void
  onDecline: () => void
  onChoose: (choice: RpsChoice) => void
  onRematch: () => void
  onClose: () => void
}

const CHOICES: Array<{ id: RpsChoice; label: string; emoji: string }> = [
  { id: 'rock', label: 'Pedra', emoji: '🪨' },
  { id: 'paper', label: 'Papel', emoji: '📄' },
  { id: 'scissors', label: 'Tesoura', emoji: '✂️' },
]

function choiceMeta(choice: RpsChoice | null) {
  return CHOICES.find((c) => c.id === choice) ?? { id: 'rock', label: '?', emoji: '❔' }
}

export function RpsDuelModal({
  localName,
  duel,
  onAccept,
  onDecline,
  onChoose,
  onRematch,
  onClose,
}: RpsDuelModalProps) {
  const status = duel?.status
  const matchWinner = duel?.matchWinner ?? null

  // Toca efeito sonoro de vitória ou derrota ao finalizar a melhor de 3
  useEffect(() => {
    if (status !== 'finished' || !matchWinner) return
    playUiSfx(matchWinner === 'me' ? 'win' : 'lose')
  }, [status, matchWinner])

  if (!duel) return null

  // 1) Convite recebido
  if (duel.status === 'incoming-invite') {
    return (
      <Modal
        open
        onClose={onDecline}
        labelledBy="rps-invite-title"
        widthClass="max-w-md"
        icon={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-dc-brand/20 text-dc-brand-soft">
            <Swords size={20} />
          </span>
        }
        title="Desafio 1v1: Pedra, Papel e Tesoura!"
        footer={
          <>
            <button type="button" onClick={onDecline} className="dc-btn-ghost">
              <X size={15} /> Recusar
            </button>
            <button type="button" onClick={onAccept} className="dc-btn-primary px-5 py-2 text-sm" autoFocus>
              <Check size={16} /> Aceitar Desafio
            </button>
          </>
        }
      >
        <p className="text-sm leading-relaxed text-dc-text">
          <strong className="font-bold text-white">{duel.opponentName}</strong> desafiou você para um{' '}
          <strong className="text-dc-brand-soft">Pedra, Papel e Tesoura (Melhor de 3)</strong>!
        </p>
        <div className="mt-4 flex items-center justify-center gap-4 rounded-xl border border-white/5 bg-dc-darkest p-4 text-3xl">
          <span>🪨</span>
          <span className="text-sm font-bold text-dc-muted">VS</span>
          <span>📄</span>
          <span className="text-sm font-bold text-dc-muted">VS</span>
          <span>✂️</span>
        </div>
      </Modal>
    )
  }

  // 2) Aguardando oponente aceitar
  if (duel.status === 'waiting-accept') {
    return (
      <Modal
        open
        onClose={onClose}
        labelledBy="rps-wait-title"
        widthClass="max-w-md"
        icon={
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-dc-brand/20 text-dc-brand-soft">
            <Swords size={20} />
          </span>
        }
        title="Desafio Enviado"
        footer={
          <button type="button" onClick={onClose} className="dc-btn-ghost">
            Cancelar
          </button>
        }
      >
        <div className="flex flex-col items-center justify-center gap-3 py-6 text-center">
          <LoaderCircle size={32} className="animate-spin text-dc-brand-soft" />
          <p className="text-sm text-dc-text">
            Aguardando <strong className="text-white">{duel.opponentName}</strong> aceitar o duelo (Melhor de 3)…
          </p>
        </div>
      </Modal>
    )
  }

  // 3) Partida ativa / revelação / finalizada
  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="rps-match-title"
      widthClass="max-w-lg"
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-dc-brand/20 text-dc-brand-soft">
          <Swords size={20} />
        </span>
      }
      title={`Duelo 1v1 · Rodada ${duel.round}`}
      footer={
        duel.status === 'finished' ? (
          <>
            <button type="button" onClick={onClose} className="dc-btn-ghost">
              Fechar
            </button>
            <button type="button" onClick={onRematch} className="dc-btn-primary px-4 py-2 text-sm">
              <RotateCcw size={15} /> Pedir Revanche
            </button>
          </>
        ) : (
          <button type="button" onClick={onClose} className="dc-btn-ghost text-xs">
            Abandonar Duelo
          </button>
        )
      }
    >
      {/* Placar Melhor de 3 */}
      <div className="rounded-xl border border-white/10 bg-dc-darkest p-3.5 text-center">
        <p className="text-[11px] font-bold uppercase tracking-wider text-dc-muted">
          Melhor de 3 · Primeiro a fazer 2 pontos vence
        </p>
        <div className="mt-2 flex items-center justify-between gap-2 px-2">
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-xs font-semibold text-dc-header">{localName} (Você)</p>
            <div className="mt-1 flex gap-1">
              {[0, 1].map((i) => (
                <span
                  key={i}
                  className={`h-2.5 w-6 rounded-full transition ${
                    duel.myScore > i ? 'bg-dc-green shadow-[0_0_8px_#23a55a]' : 'bg-dc-light'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="shrink-0 rounded-lg bg-dc-darker px-3 py-1 font-mono text-xl font-extrabold text-white">
            {duel.myScore} <span className="text-sm text-dc-muted">vs</span> {duel.opponentScore}
          </div>

          <div className="min-w-0 flex-1 text-right">
            <p className="truncate text-xs font-semibold text-dc-header">{duel.opponentName}</p>
            <div className="mt-1 flex justify-end gap-1">
              {[0, 1].map((i) => (
                <span
                  key={i}
                  className={`h-2.5 w-6 rounded-full transition ${
                    duel.opponentScore > i ? 'bg-dc-brand shadow-[0_0_8px_#5865f2]' : 'bg-dc-light'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Estado: Escolhendo na rodada */}
      {duel.status === 'playing' && (
        <RpsPlayingRound
          key={`${duel.matchId}-${duel.round}`}
          myChoice={duel.myChoice}
          opponentName={duel.opponentName}
          opponentLockedIn={duel.opponentLockedIn}
          onChoose={onChoose}
        />
      )}

      {/* Estado: Revelação simultânea da rodada */}
      {(duel.status === 'round-reveal' || duel.status === 'finished') && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-3 items-center gap-2 rounded-xl border border-white/10 bg-dc-darkest/90 p-4 text-center">
            <div>
              <span className="block text-4xl">{choiceMeta(duel.myChoice).emoji}</span>
              <span className="mt-1 block text-xs font-bold text-dc-header">{choiceMeta(duel.myChoice).label}</span>
              <span className="text-[10px] text-dc-muted">Você</span>
            </div>

            <div className="text-xs font-extrabold uppercase tracking-wider text-dc-muted">VS</div>

            <div>
              <span className="block text-4xl">{choiceMeta(duel.opponentChoice).emoji}</span>
              <span className="mt-1 block text-xs font-bold text-dc-header">{choiceMeta(duel.opponentChoice).label}</span>
              <span className="text-[10px] text-dc-muted">{duel.opponentName}</span>
            </div>
          </div>

          {duel.status === 'round-reveal' && (
            <div
              className={`rounded-lg p-3 text-center text-sm font-bold ${
                duel.roundWinner === 'me'
                  ? 'bg-dc-green/20 text-dc-green'
                  : duel.roundWinner === 'opponent'
                    ? 'bg-dc-red/20 text-dc-red'
                    : 'bg-dc-yellow/20 text-dc-yellow'
              }`}
            >
              {duel.roundWinner === 'me'
                ? '🎉 Você venceu esta rodada!'
                : duel.roundWinner === 'opponent'
                  ? `${duel.opponentName} venceu esta rodada!`
                  : '🤝 Empate! Repetindo rodada…'}
            </div>
          )}

          {duel.status === 'finished' && (
            <div
              className={`flex flex-col items-center gap-2 rounded-xl border p-5 text-center ${
                duel.matchWinner === 'me'
                  ? 'border-dc-green/40 bg-dc-green/15 text-dc-green'
                  : 'border-dc-red/40 bg-dc-red/15 text-dc-red'
              }`}
            >
              <Trophy size={36} className={duel.matchWinner === 'me' ? 'text-dc-yellow' : 'text-dc-red'} />
              <h3 className="text-xl font-extrabold text-white">
                {duel.matchWinner === 'me' ? 'Vitória!' : 'Derrota!'}
              </h3>
              <p className="text-xs text-dc-text">
                {duel.matchWinner === 'me'
                  ? `Você derrotou ${duel.opponentName} por ${duel.myScore} a ${duel.opponentScore}!`
                  : `${duel.opponentName} venceu o duelo por ${duel.opponentScore} a ${duel.myScore}.`}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function RpsPlayingRound({
  myChoice,
  opponentName,
  opponentLockedIn,
  onChoose,
}: {
  myChoice: RpsChoice | null
  opponentName: string
  opponentLockedIn: boolean
  onChoose: (choice: RpsChoice) => void
}) {
  const [secondsLeft, setSecondsLeft] = useState(5)

  useEffect(() => {
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval)
          return 0
        }
        playUiSfx('tick')
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (secondsLeft === 0 && !myChoice) {
      const randomPick = CHOICES[Math.floor(Math.random() * CHOICES.length)].id
      onChoose(randomPick)
    }
  }, [secondsLeft, myChoice, onChoose])

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-dc-text">
          {myChoice ? 'Jogada confirmada!' : 'Escolha sua jogada:'}
        </span>
        <span
          className={`rounded-full px-2.5 py-0.5 font-mono font-bold ${
            secondsLeft <= 2 ? 'animate-pulse bg-dc-red/20 text-dc-red' : 'bg-dc-brand/20 text-dc-brand-soft'
          }`}
        >
          ⏱️ {secondsLeft}s
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-dc-light">
        <div
          className="h-full rounded-full bg-dc-brand transition-all duration-300"
          style={{ width: `${(secondsLeft / 5) * 100}%` }}
        />
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {CHOICES.map((c) => {
          const selected = myChoice === c.id
          return (
            <button
              key={c.id}
              type="button"
              disabled={!!myChoice}
              onClick={() => onChoose(c.id)}
              className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-4 transition active:scale-95 ${
                selected
                  ? 'border-dc-brand bg-dc-brand/25 text-white ring-2 ring-dc-brand'
                  : 'border-white/10 bg-dc-darkest/80 text-dc-text hover:border-dc-brand/50 hover:bg-dc-hover disabled:opacity-45'
              }`}
            >
              <span className="text-4xl">{c.emoji}</span>
              <span className="text-xs font-bold">{c.label}</span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-center gap-2 rounded-lg bg-dc-darkest/70 py-2.5 text-xs text-dc-muted">
        <LoaderCircle size={14} className="animate-spin text-dc-brand-soft" />
        {myChoice
          ? `Aguardando ${opponentName} escolher…`
          : opponentLockedIn
            ? `${opponentName} já escolheu! Faça sua jogada!`
            : 'Escolhas ocultas até ambos votarem…'}
      </div>
    </div>
  )
}
