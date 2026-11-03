import { useEffect, useRef, useState } from 'react'
import type { GamepadStatePayload } from '../types'

const DEADZONE = 0.08
const HIGH_FREQ_POLL_MS = 8 // 120 Hz para captura instantânea sem latência
const HEARTBEAT_INTERVAL_MS = 16 // 60 Hz de heartbeat contínuo

function applyDeadzone(value: number, deadzone = DEADZONE): number {
  if (!Number.isFinite(value)) return 0
  if (Math.abs(value) < deadzone) return 0
  // Re-escala suavemente de [deadzone..1] para [0..1] mantendo o sinal
  const sign = Math.sign(value)
  const normalized = (Math.abs(value) - deadzone) / (1 - deadzone)
  return Number((sign * Math.min(1, Math.max(0, normalized))).toFixed(3))
}

function roundTrigger(value: number): number {
  if (!Number.isFinite(value) || value < 0.02) return 0
  return Number(Math.min(1, Math.max(0, value)).toFixed(3))
}

export interface LiveGamepadVisualState {
  connected: boolean
  id: string
  buttons: number[]
  axes: [number, number, number, number]
  triggers: [number, number]
}

const INITIAL_VISUAL_STATE: LiveGamepadVisualState = {
  connected: false,
  id: '',
  buttons: Array.from({ length: 17 }, () => 0),
  axes: [0, 0, 0, 0],
  triggers: [0, 0],
}

/**
 * Hook de captura de controle físico via Gamepad API (padrão W3C / XInput).
 * • Executa polling em `requestAnimationFrame` monitorando `navigator.getGamepads()`.
 * • Aplica deadzone de 0.08 nos analógicos para evitar drift.
 * • Envia pacotes compactados `gamepad:state` quando há alteração ou a cada 16ms (60 Hz).
 */
export function useGamepadCapture(
  enabled: boolean,
  onSendState: (payload: GamepadStatePayload) => void,
): LiveGamepadVisualState {
  const [visual, setVisual] = useState<LiveGamepadVisualState>(INITIAL_VISUAL_STATE)
  const onSendRef = useRef(onSendState)

  useEffect(() => {
    onSendRef.current = onSendState
  }, [onSendState])

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return
    }

    let rafId = 0
    let lastSentAt = 0
    let lastUiUpdateAt = 0
    let lastSignature = ''
    let wasConnected = false

    const poll = (now: number) => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : []
      let activePad: Gamepad | null = null
      for (const pad of pads) {
        if (pad && pad.connected) {
          activePad = pad
          break
        }
      }

      if (!activePad) {
        if (wasConnected) {
          wasConnected = false
          lastSignature = ''
          setVisual(INITIAL_VISUAL_STATE)
        }
        rafId = window.requestAnimationFrame(poll)
        return
      }

      wasConnected = true

      // Mapeamento XInput / Standard Gamepad (17 botões: A, B, X, Y, LB, RB, LT, RT, Select, Start, L3, R3, Up, Down, Left, Right, Guide)
      const buttons: number[] = []
      for (let i = 0; i < 17; i++) {
        const b = activePad.buttons[i]
        if (!b) {
          buttons.push(0)
        } else if (i === 6 || i === 7) {
          // Gatilhos analógicos LT (6) e RT (7) preservam valor contínuo [0..1]
          buttons.push(roundTrigger(typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0))
        } else {
          buttons.push(b.pressed || b.value > 0.5 ? 1 : 0)
        }
      }

      const lx = applyDeadzone(activePad.axes[0] ?? 0)
      const ly = applyDeadzone(activePad.axes[1] ?? 0)
      const rx = applyDeadzone(activePad.axes[2] ?? 0)
      const ry = applyDeadzone(activePad.axes[3] ?? 0)
      const axes: [number, number, number, number] = [lx, ly, rx, ry]
      const triggers: [number, number] = [buttons[6] ?? 0, buttons[7] ?? 0]

      const signature = `${buttons.join(',')}|${axes.join(',')}`
      const changed = signature !== lastSignature
      const intervalElapsed = now - lastSentAt >= HEARTBEAT_INTERVAL_MS

      // Dispara imediatamente quando houver alteração de botões/eixos (amostragem em 120 Hz)
      // ou a cada 16ms (60 Hz) como heartbeat de estabilidade
      if (changed || intervalElapsed) {
        lastSignature = signature
        lastSentAt = now
        onSendRef.current({
          type: 'gamepad:state',
          player: 1,
          buttons,
          axes,
          triggers,
        })
      }

      if (changed || now - lastUiUpdateAt >= 48) {
        lastUiUpdateAt = now
        setVisual({
          connected: true,
          id: activePad.id,
          buttons,
          axes,
          triggers,
        })
      }
    }

    // Loop híbrido: interval de 8ms (120 Hz) para captura instantânea de input
    // + requestAnimationFrame para sincronia visual com a taxa de atualização do monitor
    const timerId = window.setInterval(() => {
      poll(performance.now())
    }, HIGH_FREQ_POLL_MS)

    const rafLoop = (time: number) => {
      poll(time)
      rafId = window.requestAnimationFrame(rafLoop)
    }
    rafId = window.requestAnimationFrame(rafLoop)

    return () => {
      window.clearInterval(timerId)
      window.cancelAnimationFrame(rafId)
    }
  }, [enabled])

  return enabled ? visual : INITIAL_VISUAL_STATE
}

