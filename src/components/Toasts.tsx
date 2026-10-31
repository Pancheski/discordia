import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { Toast, ToastKind } from '../types'

const STYLES: Record<ToastKind, { icon: typeof Info; accent: string }> = {
  info: { icon: Info, accent: 'text-dc-brand-soft' },
  success: { icon: CheckCircle2, accent: 'text-dc-green' },
  warning: { icon: AlertTriangle, accent: 'text-dc-yellow' },
  error: { icon: XCircle, accent: 'text-dc-red' },
}

interface ToastsProps {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export function Toasts({ toasts, onDismiss }: ToastsProps) {
  return (
    <div
      className="pointer-events-none fixed inset-x-3 top-3 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:top-4 sm:items-end"
      role="region"
      aria-live="polite"
      aria-label="Notificações"
    >
      {toasts.map((toast) => {
        const { icon: Icon, accent } = STYLES[toast.kind]
        return (
          <div
            key={toast.id}
            className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-lg border border-white/5 bg-dc-darkest/95 p-3 pr-2 shadow-2xl shadow-black/50 backdrop-blur"
            role={toast.kind === 'error' ? 'alert' : 'status'}
          >
            <Icon size={18} className={`mt-0.5 shrink-0 ${accent}`} />
            <p className="flex-1 text-sm leading-snug text-dc-text">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="rounded p-1 text-dc-muted transition hover:bg-dc-hover hover:text-dc-text"
              aria-label="Fechar notificação"
            >
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
