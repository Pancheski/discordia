import { useEffect, useState } from 'react'
import { Check, Keyboard, Mic, RotateCcw, VolumeX } from 'lucide-react'
import { Modal } from './Modal'
import {
  DEFAULT_KEYBINDS,
  eventToAccelerator,
  formatAcceleratorDisplay,
  loadSavedKeybinds,
  saveKeybinds,
  type KeybindShortcuts,
} from '../lib/keybinds'

interface KeybindSettingsModalProps {
  open: boolean
  onClose: () => void
  onSave?: (shortcuts: KeybindShortcuts) => void
}

export function KeybindSettingsModal({ open, onClose, onSave }: KeybindSettingsModalProps) {
  const [keybinds, setKeybinds] = useState<KeybindShortcuts>(loadSavedKeybinds)
  const [listeningAction, setListeningAction] = useState<'toggleMute' | 'toggleDeafen' | null>(null)
  const [prevOpen, setPrevOpen] = useState(open)
  const isElectron = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setKeybinds(loadSavedKeybinds())
      setListeningAction(null)
    }
  }

  useEffect(() => {
    if (!listeningAction) return

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setListeningAction(null)
        return
      }

      const accel = eventToAccelerator(e)
      if (accel) {
        const next = { ...keybinds, [listeningAction]: accel }
        setKeybinds(next)
        saveKeybinds(next)
        setListeningAction(null)
        if (isElectron && window.electron?.registerGlobalShortcuts) {
          window.electron.registerGlobalShortcuts(next)
        }
        onSave?.(next)
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [listeningAction, keybinds, isElectron, onSave])

  const handleReset = () => {
    setKeybinds(DEFAULT_KEYBINDS)
    saveKeybinds(DEFAULT_KEYBINDS)
    setListeningAction(null)
    if (isElectron && window.electron?.registerGlobalShortcuts) {
      window.electron.registerGlobalShortcuts(DEFAULT_KEYBINDS)
    }
    onSave?.(DEFAULT_KEYBINDS)
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        setListeningAction(null)
        onClose()
      }}
      labelledBy="keybind-settings-title"
      widthClass="max-w-md"
      icon={
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-dc-brand/20 text-dc-brand-soft">
          <Keyboard size={18} />
        </span>
      }
      title="Atalhos de Teclado"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-dc-muted transition hover:bg-white/5 hover:text-white"
          >
            <RotateCcw size={13} />
            <span>Restaurar Padrão</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setListeningAction(null)
              onClose()
            }}
            className="dc-btn-primary px-4 py-1.5 text-xs"
          >
            <Check size={14} />
            <span>Concluído</span>
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {isElectron && (
          <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 px-3 py-2 text-[11px] text-emerald-200">
            <span className="font-semibold">Atalhos Globais Ativos:</span> funcionam em segundo plano mesmo com jogos em tela cheia.
          </div>
        )}

        <div className="space-y-3">
          {/* Toggle Mute */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-dc-darkest p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-dc-text">
                <Mic size={16} />
              </span>
              <div>
                <p className="text-xs font-bold text-white">Mutar Microfone</p>
                <p className="text-[11px] text-dc-muted">Alterna o microfone local</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setListeningAction('toggleMute')}
              className={`min-w-28 rounded-lg px-3 py-2 text-center font-mono text-xs font-bold transition ${
                listeningAction === 'toggleMute'
                  ? 'border border-dc-brand bg-dc-brand text-white shadow animate-pulse'
                  : 'border border-white/10 bg-dc-darker text-dc-header hover:border-white/20'
              }`}
            >
              {listeningAction === 'toggleMute' ? 'Pressione a tecla...' : formatAcceleratorDisplay(keybinds.toggleMute)}
            </button>
          </div>

          {/* Toggle Deafen */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-dc-darkest p-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-dc-text">
                <VolumeX size={16} />
              </span>
              <div>
                <p className="text-xs font-bold text-white">Ensurdecer</p>
                <p className="text-[11px] text-dc-muted">Muta a call e seu microfone</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setListeningAction('toggleDeafen')}
              className={`min-w-28 rounded-lg px-3 py-2 text-center font-mono text-xs font-bold transition ${
                listeningAction === 'toggleDeafen'
                  ? 'border border-dc-brand bg-dc-brand text-white shadow animate-pulse'
                  : 'border border-white/10 bg-dc-darker text-dc-header hover:border-white/20'
              }`}
            >
              {listeningAction === 'toggleDeafen' ? 'Pressione a tecla...' : formatAcceleratorDisplay(keybinds.toggleDeafen)}
            </button>
          </div>
        </div>

        <p className="text-[11px] text-dc-muted">
          Clique no campo e pressione a combinação desejada (ex: <kbd className="rounded bg-white/10 px-1 py-0.5 text-white">Ctrl + Shift + M</kbd> ou <kbd className="rounded bg-white/10 px-1 py-0.5 text-white">F8</kbd>). Pressione <kbd className="rounded bg-white/10 px-1 py-0.5 text-white">Esc</kbd> para cancelar.
        </p>
      </div>
    </Modal>
  )
}

