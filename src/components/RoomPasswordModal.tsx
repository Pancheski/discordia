import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Eye, EyeOff, LoaderCircle, Lock } from 'lucide-react'
import { Modal } from './Modal'

interface RoomPasswordModalProps {
  open: boolean
  roomName: string
  /** Retorna `true` se a senha estiver correta. */
  onSubmit: (password: string) => Promise<boolean>
  onCancel: () => void
}

/** Modal estilo Discord para desbloquear salas protegidas por senha. */
export function RoomPasswordModal({ open, roomName, onSubmit, onCancel }: RoomPasswordModalProps) {
  const [password, setPassword] = useState('')
  const [visible, setVisible] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shakeKey, setShakeKey] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // O estado é zerado a cada abertura porque o App remonta o modal (prop `key` por sala).
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password.trim() || checking) return
    setChecking(true)
    setError(null)
    try {
      const ok = await onSubmit(password)
      if (!ok) {
        setError('Senha incorreta. Tente novamente.')
        setShakeKey((k) => k + 1)
        setPassword('')
        inputRef.current?.focus()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível validar a senha.')
      setShakeKey((k) => k + 1)
    } finally {
      setChecking(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      labelledBy="room-password-title"
      widthClass="max-w-sm"
      icon={<Lock size={20} className="text-dc-brand-soft" />}
      title={
        <>
          Sala protegida
          <span className="mt-0.5 block truncate text-xs font-medium text-dc-muted">#{roomName}</span>
        </>
      }
    >
      <form onSubmit={handleSubmit} noValidate>
        <p className="mb-4 text-sm leading-relaxed text-dc-muted">
          Esta sala é privada. Digite a senha para entrar na chamada.
        </p>

        <label htmlFor="room-password-input" className="dc-label">
          Senha da sala
        </label>
        <div key={shakeKey} className={`relative ${shakeKey > 0 ? 'animate-shake' : ''}`}>
          <input
            ref={inputRef}
            id="room-password-input"
            type={visible ? 'text' : 'password'}
            className={`dc-input pr-10 ${error ? 'ring-1 ring-dc-red' : ''}`}
            placeholder="••••••••"
            value={password}
            maxLength={128}
            autoComplete="current-password"
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'room-password-error' : undefined}
            onChange={(e) => {
              setPassword(e.target.value)
              if (error) setError(null)
            }}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-dc-muted transition hover:text-dc-text"
            aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
            title={visible ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        <p
          id="room-password-error"
          role="alert"
          className={`mt-2 min-h-[1rem] text-xs font-medium text-dc-red transition-opacity ${error ? 'opacity-100' : 'opacity-0'}`}
        >
          {error ?? ''}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="dc-btn-ghost px-4 py-2 text-sm">
            Cancelar
          </button>
          <button type="submit" disabled={!password.trim() || checking} className="dc-btn-primary px-4 py-2 text-sm">
            {checking ? <LoaderCircle size={16} className="animate-spin" /> : <Lock size={15} />}
            Entrar
          </button>
        </div>
      </form>
    </Modal>
  )
}
