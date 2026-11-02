import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { AudioWaveform, Clock, Plus, Trash, Volume2, VolumeX, X } from 'lucide-react'
import {
  MAX_CUSTOM_SFX_BYTES,
  PRESET_SOUNDS,
  SOUNDBOARD_COOLDOWN_MS,
  useAudioSystem,
} from '../hooks/useAudioSystem'
import type { CustomSound } from '../hooks/useAudioSystem'
import { formatBytes } from '../lib/fileUtils'
import type { ToastKind } from '../types'

interface SoundboardPopoverProps {
  open: boolean
  onClose: () => void
  onPlaySfx: (sfxId: string, custom?: CustomSound) => void
  onToast: (kind: ToastKind, message: string) => void
}

export function SoundboardPopover({ open, onClose, onPlaySfx, onToast }: SoundboardPopoverProps) {
  const {
    sfxVolume,
    sfxMuted,
    setSfxVolume,
    toggleSfxMute,
    customSounds,
    addCustomSound,
    removeCustomSound,
  } = useAudioSystem()

  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [activeId, setActiveId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const onCooldown = now < cooldownUntil
  const remainingSec = Math.max(0, (cooldownUntil - now) / 1000)

  useEffect(() => {
    if (!onCooldown) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [onCooldown])

  const triggerSound = useCallback(
    (sfxId: string, custom?: CustomSound) => {
      const current = Date.now()
      if (current < cooldownUntil) return
      setNow(current)
      setCooldownUntil(current + SOUNDBOARD_COOLDOWN_MS)
      setActiveId(sfxId)
      window.setTimeout(() => setActiveId((prev) => (prev === sfxId ? null : prev)), 650)
      onPlaySfx(sfxId, custom)
    },
    [cooldownUntil, onPlaySfx],
  )

  if (!open) return null

  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const result = await addCustomSound(file)
    if (!result.ok) {
      onToast('error', result.error ?? 'Erro ao adicionar som.')
    } else {
      onToast('success', `Som "${result.sound?.name}" salvo no seu Soundboard!`)
    }
  }

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 mx-auto w-auto max-w-md animate-fade-up rounded-2xl border border-white/10 bg-dc-darker p-4 shadow-2xl shadow-black/70 sm:inset-x-auto sm:left-1/2 sm:w-[26rem] sm:-translate-x-1/2">
      <header className="mb-3 flex items-center justify-between gap-2 border-b border-white/5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-dc-brand/20 text-dc-brand-soft">
            <AudioWaveform size={18} />
          </span>
          <div>
            <h3 className="text-sm font-bold text-dc-header">Soundboard da Sala</h3>
            <p className="text-[11px] text-dc-muted">Toca sincronizado para todos via P2P</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {onCooldown && (
            <span className="inline-flex items-center gap-1 rounded-full bg-dc-yellow/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-dc-yellow">
              <Clock size={11} /> {remainingSec.toFixed(1)}s
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-dc-muted transition hover:bg-dc-hover hover:text-dc-text"
            aria-label="Fechar Soundboard"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Sons Padrões */}
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-dc-muted">Efeitos Clássicos</p>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {PRESET_SOUNDS.map((s) => {
          const isPlaying = activeId === s.id
          return (
            <button
              key={s.id}
              type="button"
              disabled={onCooldown}
              onClick={() => triggerSound(s.id)}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${
                isPlaying
                  ? 'border-dc-brand bg-dc-brand/25 text-white ring-2 ring-dc-brand/40'
                  : 'border-white/5 bg-dc-darkest/80 text-dc-text hover:border-dc-brand/40 hover:bg-dc-hover'
              }`}
            >
              <span className="text-base leading-none">{s.emoji}</span>
              <span className="truncate">{s.name}</span>
            </button>
          )
        })}
      </div>

      {/* Sons Personalizados */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-dc-muted">
            Seus Sons ({customSounds.length})
          </span>
          <span className="text-[10px] text-dc-faint">Máx. {formatBytes(MAX_CUSTOM_SFX_BYTES, 0)} · 5s</span>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/ogg,audio/webm,audio/mp4,.mp3,.wav,.ogg"
          onChange={(e) => void handleUpload(e)}
          className="hidden"
        />

        <div className="grid grid-cols-2 gap-1.5">
          {customSounds.map((c) => {
            const isPlaying = activeId === c.id
            return (
              <div
                key={c.id}
                className={`group flex items-center rounded-lg border transition ${
                  isPlaying
                    ? 'border-dc-brand bg-dc-brand/25 ring-2 ring-dc-brand/40'
                    : 'border-white/5 bg-dc-darkest/80 hover:border-dc-brand/40'
                }`}
              >
                <button
                  type="button"
                  disabled={onCooldown}
                  onClick={() => triggerSound(c.id, c)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 px-2.5 py-2 text-left text-xs font-semibold text-dc-text disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="text-sm">🎵</span>
                  <span className="truncate">{c.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeCustomSound(c.id)}
                  className="mr-1 rounded p-1 text-dc-faint opacity-70 transition hover:bg-dc-red/20 hover:text-dc-red group-hover:opacity-100"
                  title="Remover som"
                  aria-label={`Remover ${c.name}`}
                >
                  <Trash size={13} />
                </button>
              </div>
            )
          })}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-dc-border bg-dc-darkest/40 px-2.5 py-2 text-xs font-semibold text-dc-brand-soft transition hover:border-dc-brand hover:bg-dc-brand/10"
          >
            <Plus size={14} /> Adicionar Som
          </button>
        </div>
      </div>

      {/* Controle de volume dos sons do app */}
      <div className="mt-4 flex items-center gap-2.5 border-t border-white/5 pt-3">
        <button
          type="button"
          onClick={toggleSfxMute}
          className={`rounded p-1.5 transition hover:bg-dc-hover ${sfxMuted ? 'text-dc-red' : 'text-dc-muted hover:text-dc-text'}`}
          title={sfxMuted ? 'Ativar sons do app' : 'Mutar sons do app'}
        >
          {sfxMuted || sfxVolume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        <div className="flex-1">
          <div className="mb-1 flex items-center justify-between text-[11px] text-dc-muted">
            <span>Volume dos Sons do App</span>
            <span className="font-mono text-dc-text">{sfxMuted ? 'Mudo' : `${Math.round(sfxVolume * 100)}%`}</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={sfxMuted ? 0 : Math.round(sfxVolume * 100)}
            onChange={(e) => {
              const next = Number(e.target.value) / 100
              if (sfxMuted && next > 0) toggleSfxMute()
              setSfxVolume(next)
            }}
            style={{ '--val': `${sfxMuted ? 0 : Math.round(sfxVolume * 100)}%` } as React.CSSProperties}
            className="dc-range w-full"
          />
        </div>
      </div>
    </div>
  )
}
