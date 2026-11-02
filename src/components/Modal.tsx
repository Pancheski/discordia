import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: ReactNode
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  widthClass?: string
  labelledBy: string
}

/** Modal acessível (ESC fecha, foco inicial no diálogo, clique fora fecha). */
export function Modal({ open, onClose, title, icon, children, footer, widthClass = 'max-w-lg', labelledBy }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className={`relative flex max-h-[92dvh] w-full ${widthClass} animate-fade-up flex-col overflow-hidden rounded-xl border border-white/5 bg-dc-dark shadow-2xl shadow-black/60 outline-none`}
      >
        <header className="flex items-start gap-3 px-5 pb-3 pt-5">
          {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
          <h2 id={labelledBy} className="flex-1 text-lg font-bold leading-snug text-dc-header">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1.5 text-dc-muted transition hover:bg-dc-hover hover:text-dc-text"
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <footer className="flex flex-wrap items-center justify-end gap-2 bg-dc-darker px-5 py-3.5">{footer}</footer>}
      </div>
    </div>
  )
}

