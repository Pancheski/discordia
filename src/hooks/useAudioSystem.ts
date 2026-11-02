import { useCallback, useEffect, useState } from 'react'

/**
 * SISTEMA DE ÁUDIO DE INTERFACE (UI SFX) E SOUNDBOARD (Web Audio API)
 * ───────────────────────────────────────────────────────────────────
 * • Zero dependência de assets externos para UI SFX e sons padrões do Soundboard.
 * • Controle de volume global dos sons do app (0..1) + botão de mute persistidos no localStorage.
 * • Suporte a sons personalizados (.mp3 / .wav / .ogg até 300 KB e 5s) salvos em Base64.
 */

const VOL_KEY = 'discordia:sfx-volume'
const MUTE_KEY = 'discordia:sfx-muted'
const CUSTOM_SFX_KEY = 'discordia:custom-sfx:v1'

export const MAX_CUSTOM_SFX_BYTES = 300 * 1024 // 300 KB
export const MAX_CUSTOM_SFX_DURATION_SEC = 5.2
export const SOUNDBOARD_COOLDOWN_MS = 2000

export type UiSfxKind =
  | 'message'
  | 'join'
  | 'leave'
  | 'mute'
  | 'unmute'
  | 'win'
  | 'lose'
  | 'tick'
  | 'clack'
  | 'cardFlip'
  | 'putt'
  | 'hole'

export interface PresetSound {
  id: string
  name: string
  emoji: string
}

export interface CustomSound {
  id: string
  name: string
  dataUrl: string
}

export const PRESET_SOUNDS: PresetSound[] = [
  { id: 'airhorn', name: 'Airhorn', emoji: '📢' },
  { id: 'badumtss', name: 'Ba-dum-tss', emoji: '🥁' },
  { id: 'victory', name: 'Vitória', emoji: '🏆' },
  { id: 'fail', name: 'Fracasso', emoji: '🎺' },
  { id: 'quack', name: 'Quack', emoji: '🦆' },
  { id: 'applause', name: 'Aplausos', emoji: '👏' },
  { id: 'coin', name: 'Moeda 8-Bit', emoji: '🪙' },
]

// ─── Contexto e estado singleton ────────────────────────────────────────

let sharedCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!sharedCtx || sharedCtx.state === 'closed') {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    sharedCtx = new Ctor()
  }
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume().catch(() => undefined)
  }
  return sharedCtx
}

function readStoredVolume(): number {
  try {
    const raw = localStorage.getItem(VOL_KEY)
    if (raw === null) return 0.7
    const n = Number(raw)
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.7
  } catch {
    return 0.7
  }
}

function readStoredMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function readStoredCustomSounds(): CustomSound[] {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_SFX_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (item): item is CustomSound =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as CustomSound).id === 'string' &&
        typeof (item as CustomSound).name === 'string' &&
        typeof (item as CustomSound).dataUrl === 'string' &&
        (item as CustomSound).dataUrl.startsWith('data:audio/'),
    )
  } catch {
    return []
  }
}

function writeStoredCustomSounds(list: CustomSound[]): void {
  try {
    localStorage.setItem(CUSTOM_SFX_KEY, JSON.stringify(list))
  } catch {
    /* quota */
  }
}

let currentVolume = readStoredVolume()
let currentMuted = readStoredMuted()
const remoteCustomCache = new Map<string, { name: string; dataUrl: string }>()
const listeners = new Set<() => void>()

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
}

function effectiveGain(multiplier = 1): number {
  if (currentMuted || currentVolume <= 0) return 0
  return Math.min(1, currentVolume * multiplier)
}

// ─── Sintetizador de UI SFX (Web Audio API) ─────────────────────────────

function scheduleTone(
  ctx: AudioContext,
  freq: number,
  startOffset: number,
  duration: number,
  type: OscillatorType,
  gainPeak: number,
  endFreq?: number,
): void {
  const now = ctx.currentTime + startOffset
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, now)
  if (endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + duration)
  }
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainPeak), now + Math.min(0.018, duration * 0.25))
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(now)
  osc.stop(now + duration + 0.01)
}

export function playUiSfx(kind: UiSfxKind): void {
  const master = effectiveGain(0.35)
  if (master <= 0) return
  const ctx = getCtx()
  if (!ctx) return

  switch (kind) {
    case 'message':
      // Notificação curta e suave (dois tons cristalinos)
      scheduleTone(ctx, 587.33, 0, 0.09, 'sine', master * 0.7) // D5
      scheduleTone(ctx, 880, 0.065, 0.14, 'sine', master * 0.85) // A5
      break
    case 'join':
      // Acorde ascendente de 2 tons
      scheduleTone(ctx, 523.25, 0, 0.12, 'triangle', master * 0.85) // C5
      scheduleTone(ctx, 783.99, 0.1, 0.18, 'triangle', master) // G5
      break
    case 'leave':
      // Acorde descendente de 2 tons
      scheduleTone(ctx, 659.25, 0, 0.12, 'triangle', master * 0.8) // E5
      scheduleTone(ctx, 440, 0.1, 0.2, 'triangle', master * 0.75) // A4
      break
    case 'mute':
      // Tom grave/seco de bloqueio
      scheduleTone(ctx, 320, 0, 0.085, 'sine', master * 0.8, 190)
      break
    case 'unmute':
      // Tom agudo/aberto de ativação
      scheduleTone(ctx, 420, 0, 0.095, 'sine', master * 0.8, 660)
      break
    case 'win':
      scheduleTone(ctx, 523.25, 0, 0.11, 'triangle', master * 0.9)
      scheduleTone(ctx, 659.25, 0.09, 0.11, 'triangle', master * 0.9)
      scheduleTone(ctx, 783.99, 0.18, 0.11, 'triangle', master * 0.9)
      scheduleTone(ctx, 1046.5, 0.27, 0.28, 'triangle', master)
      break
    case 'lose':
      scheduleTone(ctx, 392, 0, 0.16, 'sawtooth', master * 0.55)
      scheduleTone(ctx, 349.23, 0.15, 0.16, 'sawtooth', master * 0.55)
      scheduleTone(ctx, 311.13, 0.3, 0.32, 'sawtooth', master * 0.55, 261.63)
      break
    case 'tick':
      scheduleTone(ctx, 700, 0, 0.04, 'sine', master * 0.45)
      break
    case 'clack':
      // Clique mecânico da lingueta da roleta batendo no pino
      scheduleTone(ctx, 1350, 0, 0.022, 'triangle', master * 0.65, 380)
      break
    case 'cardFlip':
      // Som tátil de carta deslizando/virando no feltro
      playNoiseBurst(ctx, 0, 0.055, 2400, 1.8, master * 0.45)
      scheduleTone(ctx, 520, 0.01, 0.045, 'sine', master * 0.3, 760)
      break
    case 'putt':
      // Impacto seco do taco na bola de golf
      scheduleTone(ctx, 260, 0, 0.055, 'triangle', master * 0.85, 95)
      playNoiseBurst(ctx, 0, 0.03, 1800, 2.5, master * 0.4)
      break
    case 'hole':
      // Bola caindo no copo + arpejo curto
      scheduleTone(ctx, 190, 0, 0.08, 'sine', master * 0.8, 360)
      scheduleTone(ctx, 587.33, 0.07, 0.1, 'triangle', master * 0.75)
      scheduleTone(ctx, 880, 0.15, 0.18, 'triangle', master * 0.9)
      break
  }
}

// ─── Sintetizador de Sons Padrões do Soundboard ─────────────────────────

function playNoiseBurst(
  ctx: AudioContext,
  startOffset: number,
  duration: number,
  filterFreq: number,
  q: number,
  peak: number,
): void {
  const sampleRate = ctx.sampleRate
  const length = Math.max(1, Math.floor(sampleRate * duration))
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1
  }

  const now = ctx.currentTime + startOffset
  const source = ctx.createBufferSource()
  source.buffer = buffer

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.setValueAtTime(filterFreq, now)
  filter.Q.setValueAtTime(q, now)

  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)

  source.connect(filter)
  filter.connect(gain)
  gain.connect(ctx.destination)
  source.start(now)
  source.stop(now + duration + 0.01)
}

function playPresetSound(sfxId: string): boolean {
  const master = effectiveGain(0.55)
  if (master <= 0) return true
  const ctx = getCtx()
  if (!ctx) return false

  switch (sfxId) {
    case 'airhorn': {
      // Buzina de estádio (múltiplos osciladores dente-de-serra desafinados)
      const freqs = [380, 385, 570, 760]
      for (const f of freqs) {
        scheduleTone(ctx, f * 0.88, 0, 0.14, 'sawtooth', master * 0.32, f)
        scheduleTone(ctx, f, 0.16, 0.55, 'sawtooth', master * 0.35, f * 0.97)
      }
      return true
    }
    case 'badumtss': {
      // Bumbo (Ba) -> Tom (dum) -> Prato (tss)
      scheduleTone(ctx, 150, 0, 0.14, 'sine', master * 0.95, 52)
      scheduleTone(ctx, 195, 0.16, 0.16, 'sine', master * 0.9, 68)
      playNoiseBurst(ctx, 0.35, 0.55, 6500, 1.2, master * 0.7)
      return true
    }
    case 'victory': {
      // Fanfarra clássica de vitória
      scheduleTone(ctx, 523.25, 0, 0.13, 'triangle', master * 0.85) // C5
      scheduleTone(ctx, 523.25, 0.14, 0.13, 'triangle', master * 0.85) // C5
      scheduleTone(ctx, 523.25, 0.28, 0.13, 'triangle', master * 0.85) // C5
      scheduleTone(ctx, 659.25, 0.42, 0.32, 'triangle', master * 0.9) // E5
      scheduleTone(ctx, 587.33, 0.76, 0.18, 'triangle', master * 0.85) // D5
      scheduleTone(ctx, 659.25, 0.96, 0.18, 'triangle', master * 0.9) // E5
      scheduleTone(ctx, 783.99, 1.16, 0.48, 'triangle', master) // G5
      return true
    }
    case 'fail': {
      // Trombeta triste (Wah-wah-wah-waaaah)
      scheduleTone(ctx, 392, 0, 0.3, 'sawtooth', master * 0.5, 370) // G4
      scheduleTone(ctx, 369.99, 0.33, 0.3, 'sawtooth', master * 0.5, 349) // F#4
      scheduleTone(ctx, 349.23, 0.66, 0.3, 'sawtooth', master * 0.5, 330) // F4
      scheduleTone(ctx, 329.63, 0.99, 0.65, 'sawtooth', master * 0.55, 277) // E4 -> C#4
      return true
    }
    case 'quack': {
      // Quack de pato (varredura nasal rápida)
      scheduleTone(ctx, 340, 0, 0.09, 'sawtooth', master * 0.65, 680)
      scheduleTone(ctx, 680, 0.08, 0.14, 'sawtooth', master * 0.65, 290)
      return true
    }
    case 'applause': {
      // Palmas em camadas
      for (let i = 0; i < 18; i++) {
        const offset = i * 0.055 + Math.random() * 0.025
        const freq = 1100 + Math.random() * 900
        playNoiseBurst(ctx, offset, 0.08, freq, 2.2, master * 0.55)
      }
      return true
    }
    case 'coin': {
      // Moeda 8-bit clássica (B5 -> E6)
      scheduleTone(ctx, 987.77, 0, 0.08, 'square', master * 0.45)
      scheduleTone(ctx, 1318.51, 0.08, 0.32, 'square', master * 0.45)
      return true
    }
    default:
      return false
  }
}

export function playDataUrlSound(dataUrl: string): void {
  const gain = effectiveGain(0.85)
  if (gain <= 0) return
  try {
    const audio = new Audio(dataUrl)
    audio.volume = gain
    void audio.play().catch((err) => console.warn('[discordia] falha ao reproduzir áudio customizado', err))
  } catch (err) {
    console.warn('[discordia] erro ao criar elemento Audio', err)
  }
}

/**
 * Toca qualquer efeito do Soundboard (padrão ou customizado local/remoto).
 * Se `incomingDataUrl` vier no pacote P2P, armazena no cache de sessão para próximas execuções.
 */
export function playSoundboardSfx(sfxId: string, incomingDataUrl?: string, incomingName?: string): void {
  if (incomingDataUrl && incomingDataUrl.startsWith('data:audio/')) {
    remoteCustomCache.set(sfxId, { name: incomingName ?? 'Som customizado', dataUrl: incomingDataUrl })
  }
  if (playPresetSound(sfxId)) return

  const cached = remoteCustomCache.get(sfxId)
  if (cached) {
    playDataUrlSound(cached.dataUrl)
    return
  }

  const localCustom = readStoredCustomSounds().find((s) => s.id === sfxId)
  if (localCustom) {
    playDataUrlSound(localCustom.dataUrl)
  }
}

export function setGlobalSfxVolume(value: number): void {
  currentVolume = Math.min(1, Math.max(0, value))
  try {
    localStorage.setItem(VOL_KEY, String(currentVolume))
  } catch {
    /* ignore */
  }
  notifyListeners()
}

export function toggleGlobalSfxMuted(): void {
  currentMuted = !currentMuted
  try {
    localStorage.setItem(MUTE_KEY, currentMuted ? '1' : '0')
  } catch {
    /* ignore */
  }
  notifyListeners()
}

// ─── Validação e conversão de áudio customizado (até 300 KB / 5s) ───────

function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Falha ao ler arquivo de áudio'))
    reader.readAsDataURL(file)
  })
}

function getAudioDuration(dataUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio()
    const cleanup = () => {
      audio.removeAttribute('src')
      audio.load()
    }
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      const duration = audio.duration
      cleanup()
      resolve(Number.isFinite(duration) ? duration : 0)
    }
    audio.onerror = () => {
      cleanup()
      reject(new Error('Formato de áudio inválido ou não suportado'))
    }
    audio.src = dataUrl
  })
}

// ─── Hook React `useAudioSystem` ────────────────────────────────────────

export function useAudioSystem() {
  const [volume, setVolumeState] = useState(currentVolume)
  const [muted, setMutedState] = useState(currentMuted)
  const [customSounds, setCustomSounds] = useState<CustomSound[]>(() => readStoredCustomSounds())

  useEffect(() => {
    const sync = () => {
      setVolumeState(currentVolume)
      setMutedState(currentMuted)
    }
    listeners.add(sync)
    return () => {
      listeners.delete(sync)
    }
  }, [])

  const setVolume = useCallback((v: number) => {
    setGlobalSfxVolume(v)
  }, [])

  const toggleMute = useCallback(() => {
    toggleGlobalSfxMuted()
  }, [])

  const addCustomSound = useCallback(async (file: File): Promise<{ ok: boolean; error?: string; sound?: CustomSound }> => {
    if (!/\.(mp3|wav|ogg|m4a|webm)$/i.test(file.name) && !file.type.startsWith('audio/')) {
      return { ok: false, error: 'Selecione um arquivo de áudio (.mp3, .wav ou .ogg).' }
    }
    if (file.size > MAX_CUSTOM_SFX_BYTES) {
      return { ok: false, error: 'O arquivo excede o limite de 300 KB.' }
    }

    try {
      const dataUrl = await fileToDataUrl(file)
      const duration = await getAudioDuration(dataUrl)
      if (duration > MAX_CUSTOM_SFX_DURATION_SEC) {
        return { ok: false, error: `O áudio tem ${duration.toFixed(1)}s (máximo permitido: 5 segundos).` }
      }

      const cleanName = file.name.replace(/\.[^.]+$/, '').trim().slice(0, 22) || 'Som custom'
      const sound: CustomSound = {
        id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name: cleanName,
        dataUrl,
      }
      remoteCustomCache.set(sound.id, { name: sound.name, dataUrl: sound.dataUrl })

      setCustomSounds((prev) => {
        const next = [...prev.slice(-11), sound]
        writeStoredCustomSounds(next)
        return next
      })
      return { ok: true, sound }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Não foi possível carregar o som.' }
    }
  }, [])

  const removeCustomSound = useCallback((id: string) => {
    remoteCustomCache.delete(id)
    setCustomSounds((prev) => {
      const next = prev.filter((s) => s.id !== id)
      writeStoredCustomSounds(next)
      return next
    })
  }, [])

  return {
    sfxVolume: volume,
    sfxMuted: muted,
    setSfxVolume: setVolume,
    toggleSfxMute: toggleMute,
    customSounds,
    addCustomSound,
    removeCustomSound,
    playUiSfx,
    playSoundboardSfx,
  }
}

