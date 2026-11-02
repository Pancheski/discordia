import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Disc, Minimize2, Plus, Power, RotateCw, Sparkles, Trash, Trophy, Users } from 'lucide-react'
import { playUiSfx } from '../hooks/useAudioSystem'
import type { WheelState } from '../types'

interface Roulette3DProps {
  open: boolean
  onClose: () => void
  onEndApp: () => void
  wheelState: WheelState
  roomMemberNames: string[]
  onUpdateOptions: (options: string[]) => void
  onTriggerSpin: (winnerIndex: number, targetAngle: number, options: string[]) => void
}

const SLICE_PALETTE = [
  '#5865f2',
  '#eb459e',
  '#23a55a',
  '#f0b232',
  '#da373c',
  '#06b6d4',
  '#8b5cf6',
  '#f97316',
  '#14b8a6',
  '#ec4899',
]

const SPIN_DURATION_MS = 4600
const DEFAULT_WHEEL_OPTIONS = ['Pizza 🍕', 'Hambúrguer 🍔', 'Sushi 🍣', 'Tacos 🌮']

function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4)
}

export function Roulette3D({
  open,
  onClose,
  onEndApp,
  wheelState,
  roomMemberNames,
  onUpdateOptions,
  onTriggerSpin,
}: Roulette3DProps) {
  const [newItem, setNewItem] = useState('')
  const [spinning, setSpinning] = useState(false)
  const [flapperKick, setFlapperKick] = useState(false)
  const [winnerBanner, setWinnerBanner] = useState<{ text: string; startedBy: string } | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const angleDegRef = useRef(0)
  const animFrameRef = useRef<number | null>(null)
  const lastProcessedSpinIdRef = useRef<number>(0)

  const options = wheelState.options.length >= 2 ? wheelState.options : DEFAULT_WHEEL_OPTIONS

  // Desenha o disco 3D no Canvas (fatias, textos, aro metálico, pinos e botão central)
  const drawWheel = useCallback(
    (angleDeg: number, items: string[]) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      const size = 340
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr
        canvas.height = size * dpr
      }
      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, size, size)

      const cx = size / 2
      const cy = size / 2
      const radius = size / 2 - 18
      const count = Math.max(2, items.length)
      const sliceRad = (Math.PI * 2) / count
      const rotRad = (angleDeg * Math.PI) / 180

      // Sombra externa 3D e aro metálico
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy + 5, radius + 11, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fill()

      const rimGrad = ctx.createLinearGradient(0, 0, size, size)
      rimGrad.addColorStop(0, '#fde68a')
      rimGrad.addColorStop(0.5, '#b45309')
      rimGrad.addColorStop(1, '#fef08a')
      ctx.beginPath()
      ctx.arc(cx, cy, radius + 9, 0, Math.PI * 2)
      ctx.fillStyle = rimGrad
      ctx.fill()
      ctx.restore()

      // Fatias (começando em -90° = topo 12h)
      for (let i = 0; i < count; i++) {
        const start = i * sliceRad - Math.PI / 2 + rotRad
        const end = start + sliceRad
        const color = SLICE_PALETTE[i % SLICE_PALETTE.length]

        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.arc(cx, cy, radius, start, end)
        ctx.closePath()
        ctx.fillStyle = color
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(255,255,255,0.22)'
        ctx.stroke()

        // Texto da fatia
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(start + sliceRad / 2)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 13px Inter, system-ui, sans-serif'
        ctx.shadowColor = 'rgba(0,0,0,0.55)'
        ctx.shadowBlur = 4
        const label = items[i].length > 18 ? `${items[i].slice(0, 17)}…` : items[i]
        ctx.fillText(label, radius - 16, 4.5)
        ctx.restore()
      }

      // Iluminação radial (efeito chanfro 3D)
      const gloss = ctx.createRadialGradient(cx, cy - radius * 0.35, 10, cx, cy, radius)
      gloss.addColorStop(0, 'rgba(255,255,255,0.22)')
      gloss.addColorStop(0.65, 'rgba(255,255,255,0)')
      gloss.addColorStop(1, 'rgba(0,0,0,0.35)')
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fillStyle = gloss
      ctx.fill()

      // Pinos cromados na borda entre fatias
      for (let i = 0; i < count; i++) {
        const pegAngle = i * sliceRad - Math.PI / 2 + rotRad
        const px = cx + Math.cos(pegAngle) * (radius + 2)
        const py = cy + Math.sin(pegAngle) * (radius + 2)
        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#fef9c3'
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.strokeStyle = '#713f12'
        ctx.stroke()
      }

      // Calota central metálica 3D
      const capGrad = ctx.createRadialGradient(cx - 5, cy - 5, 2, cx, cy, 26)
      capGrad.addColorStop(0, '#fef08a')
      capGrad.addColorStop(0.7, '#d97706')
      capGrad.addColorStop(1, '#78350f')
      ctx.beginPath()
      ctx.arc(cx, cy, 25, 0, Math.PI * 2)
      ctx.fillStyle = capGrad
      ctx.fill()
      ctx.lineWidth = 3
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'
      ctx.stroke()

      ctx.restore()
    },
    [],
  )

  // Redesenha quando abre ou quando as opções mudam
  useEffect(() => {
    if (!open) return
    drawWheel(angleDegRef.current, options)
  }, [open, options, drawWheel])

  // Executa a animação física sincronizada quando chega um novo `lastSpin`
  useEffect(() => {
    const spin = wheelState.lastSpin
    if (!spin || spin.spinId === lastProcessedSpinIdRef.current) return
    lastProcessedSpinIdRef.current = spin.spinId

    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current)
    }

    const items = spin.options.length >= 2 ? spin.options : options
    const count = items.length
    const sliceDeg = 360 / count
    const startAngle = angleDegRef.current % 360
    const targetAngle = spin.targetAngle
    const startTime = performance.now()
    let lastPegBucket = Math.floor(startAngle / sliceDeg)

    setSpinning(true)
    setWinnerBanner(null)

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / SPIN_DURATION_MS)
      const eased = easeOutQuart(progress)
      const currentAngle = startAngle + (targetAngle - startAngle) * eased
      angleDegRef.current = currentAngle
      drawWheel(currentAngle, items)

      // Detecta passagem de pino pelo ponteiro do topo -> clique mecânico + ricochete da lingueta
      const currentPegBucket = Math.floor(currentAngle / sliceDeg)
      if (currentPegBucket !== lastPegBucket) {
        lastPegBucket = currentPegBucket
        playUiSfx('clack')
        setFlapperKick(true)
        window.setTimeout(() => setFlapperKick(false), 65)
      }

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(step)
      } else {
        animFrameRef.current = null
        setSpinning(false)
        const wonText = items[spin.winnerIndex] ?? items[0]
        setWinnerBanner({ text: wonText, startedBy: spin.startedBy })
        playUiSfx('win')
      }
    }

    animFrameRef.current = requestAnimationFrame(step)

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current)
      }
    }
  }, [wheelState.lastSpin, options, drawWheel])

  if (!open) return null

  const handleSpinClick = () => {
    if (spinning || options.length < 2) return
    const count = options.length
    const sliceDeg = 360 / count
    const winnerIndex = Math.floor(Math.random() * count)
    // Posição angular exata para que a fatia `winnerIndex` pare sob o ponteiro do topo (12h)
    const jitter = (Math.random() - 0.5) * 0.55
    const desiredStopMod = (360 - (((winnerIndex + 0.5 + jitter) * sliceDeg) % 360)) % 360
    const extraTurns = (6 + Math.floor(Math.random() * 3)) * 360
    const targetAngle = extraTurns + desiredStopMod
    onTriggerSpin(winnerIndex, targetAngle, options)
  }

  const handleAddOption = (e: FormEvent) => {
    e.preventDefault()
    const clean = newItem.trim().slice(0, 36)
    if (!clean || spinning) return
    setNewItem('')
    onUpdateOptions([...options, clean])
  }

  const handleRemoveOption = (idx: number) => {
    if (spinning || options.length <= 2) return
    onUpdateOptions(options.filter((_, i) => i !== idx))
  }

  const handleFillParticipants = () => {
    if (spinning) return
    const names = roomMemberNames.filter(Boolean)
    if (names.length >= 2) {
      onUpdateOptions(names)
    } else if (names.length === 1) {
      onUpdateOptions([names[0], `${names[0]} paga a pizza 🍕`, 'Revezamento'])
    }
  }

  if (!open) return null

  return (
    <div
      aria-labelledby="roulette-3d-title"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-dc-darker shadow-2xl"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-dc-darkest/90 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-500/20 text-fuchsia-300">
            <Disc size={18} />
          </span>
          <h2 id="roulette-3d-title" className="text-sm font-extrabold text-white">
            Roleta
          </h2>
        </div>

        <div className="flex items-center gap-2">
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
            onClick={onEndApp}
            className="inline-flex items-center gap-1.5 rounded-lg bg-dc-red/20 px-3 py-1.5 text-xs font-semibold text-dc-red transition hover:bg-dc-red hover:text-white"
          >
            <Power size={14} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <div className="grid items-center gap-6 md:grid-cols-[1.1fr_1fr]">
        {/* Coluna Esquerda: Disco 3D + Lingueta + Botão Girar */}
        <div className="relative flex flex-col items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-b from-purple-950/50 via-dc-darkest to-dc-darkest p-5 shadow-inner">
          {/* Lingueta / Ponteiro físico no topo com ricochete */}
          <div
            style={{
              transform: flapperKick ? 'rotate(-26deg) scale(1.06)' : 'rotate(0deg)',
              transformOrigin: '50% 15%',
            }}
            className="z-20 -mb-4 flex flex-col items-center transition-transform duration-75"
          >
            <div className="h-3.5 w-3.5 rounded-full border-2 border-amber-200 bg-amber-500 shadow" />
            <div
              className="h-6 w-5 bg-gradient-to-b from-red-500 to-red-700 shadow-lg"
              style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
            />
          </div>

          {/* Disco em perspectiva 3D */}
          <div style={{ perspective: '900px' }} className="relative flex items-center justify-center">
            <div style={{ transform: 'rotateX(14deg)' }} className="transition-transform duration-300">
              <canvas ref={canvasRef} className="h-[310px] w-[310px] sm:h-[340px] sm:w-[340px]" />
            </div>
          </div>

          <button
            id="spin-wheel-button"
            type="button"
            disabled={spinning}
            onClick={handleSpinClick}
            className="mt-3 inline-flex w-full max-w-xs items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-fuchsia-600 via-pink-600 to-amber-500 py-3 text-sm font-extrabold uppercase tracking-wider text-white shadow-lg shadow-fuchsia-600/30 transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCw size={18} className={spinning ? 'animate-spin' : ''} />
            {spinning ? 'Girando…' : 'Girar'}
          </button>

          {/* Resultado vencedor com celebração */}
          {winnerBanner && (
            <div className="mt-4 flex w-full animate-fade-up items-center gap-3 rounded-xl border border-amber-400/50 bg-amber-500/15 px-4 py-3">
              <Trophy size={26} className="shrink-0 text-amber-400" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-wider text-amber-300">
                  Sorteado por {winnerBanner.startedBy}:
                </p>
                <p className="truncate text-base font-extrabold text-white">{winnerBanner.text}</p>
              </div>
              <Sparkles size={18} className="shrink-0 text-amber-300" />
            </div>
          )}
        </div>

        {/* Coluna Direita: Customização de Opções */}
        <div className="flex flex-col justify-between rounded-2xl border border-white/10 bg-dc-darkest/85 p-4">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-dc-header">Opções na Roleta ({options.length})</h3>
              <button
                type="button"
                disabled={spinning}
                onClick={handleFillParticipants}
                className="inline-flex items-center gap-1.5 rounded-lg bg-dc-brand/20 px-2.5 py-1.5 text-[11px] font-semibold text-dc-brand-soft transition hover:bg-dc-brand hover:text-white disabled:opacity-40"
                title="Substituir opções pelos nomes das pessoas conectadas na chamada"
              >
                <Users size={13} /> Preencher com amigos da sala
              </button>
            </div>

            <form onSubmit={handleAddOption} className="mt-3 flex gap-2">
              <input
                type="text"
                value={newItem}
                disabled={spinning}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder="Ex: Pizza, Sushi, Quem apresenta…"
                maxLength={36}
                className="dc-input py-2 text-xs"
              />
              <button
                type="submit"
                disabled={spinning || !newItem.trim()}
                className="dc-btn-primary shrink-0 px-3 py-2 text-xs"
              >
                <Plus size={15} /> Adicionar
              </button>
            </form>

            <ul className="mt-3 max-h-60 space-y-1.5 overflow-y-auto pr-1">
              {options.map((item, idx) => (
                <li
                  key={`${item}-${idx}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-dc-darker px-3 py-2 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      style={{ backgroundColor: SLICE_PALETTE[idx % SLICE_PALETTE.length] }}
                      className="h-3 w-3 shrink-0 rounded-full"
                    />
                    <span className="truncate font-medium text-dc-text">{item}</span>
                  </div>
                  <button
                    type="button"
                    disabled={spinning || options.length <= 2}
                    onClick={() => handleRemoveOption(idx)}
                    className="rounded p-1 text-dc-muted transition hover:bg-dc-red/20 hover:text-dc-red disabled:opacity-30"
                    title={options.length <= 2 ? 'Mínimo de 2 opções' : 'Remover opção'}
                  >
                    <Trash size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}
