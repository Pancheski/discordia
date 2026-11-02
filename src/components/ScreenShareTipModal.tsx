import { useState } from 'react'
import { AppWindow, Lightbulb, Monitor, MonitorUp, PanelTop, Volume2 } from 'lucide-react'
import { Modal } from './Modal'

export const SCREEN_TIP_SKIP_KEY = 'discordia:skip-screen-tip'

interface ScreenShareTipModalProps {
  open: boolean
  onClose: () => void
  /** Chamado no clique (gesto do usuário) — necessário para o getDisplayMedia. */
  onContinue: () => void
  onOpenDrmHelp: () => void
}

/**
 * Dica exibida ANTES de abrir o seletor nativo de captura: orienta a escolher
 * "Guia do Chrome" + "Compartilhar áudio da guia", que captura somente o áudio
 * daquela aba — sem as vozes da call, eliminando o eco.
 */
export function ScreenShareTipModal({ open, onClose, onContinue, onOpenDrmHelp }: ScreenShareTipModalProps) {
  const [dontShow, setDontShow] = useState(false)

  const handleContinue = () => {
    if (dontShow) {
      try {
        localStorage.setItem(SCREEN_TIP_SKIP_KEY, '1')
      } catch {
        /* modo privado */
      }
    }
    onContinue()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="screen-tip-title"
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-dc-yellow/15 text-dc-yellow">
          <Lightbulb size={20} />
        </span>
      }
      title="Dica rápida antes de transmitir"
      footer={
        <>
          <label className="mr-auto flex cursor-pointer select-none items-center gap-2 text-xs text-dc-muted">
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-4 w-4 accent-dc-brand"
            />
            Não mostrar novamente
          </label>
          <button type="button" onClick={onClose} className="dc-btn-ghost">
            Cancelar
          </button>
          <button id="screen-tip-continue" type="button" onClick={handleContinue} className="dc-btn-primary px-4 py-2 text-sm" autoFocus>
            <MonitorUp size={16} /> Escolher o que transmitir
          </button>
        </>
      }
    >
      <p className="rounded-lg border border-dc-brand/30 bg-dc-brand/10 p-3 text-sm leading-relaxed text-dc-text">
        Para transmitir vídeos/músicas <b>sem eco das vozes</b>, escolha a opção{' '}
        <b className="text-white">"Guia do Chrome"</b> (Tab) e marque <b className="text-white">"Compartilhar áudio da guia"</b>.
      </p>

      {/* Ilustração do seletor nativo do Chrome */}
      <div className="mt-4 overflow-hidden rounded-lg border border-white/10 bg-[#202124] text-[12px] text-[#e8eaed]" aria-hidden="true">
        <p className="px-4 pt-3 font-semibold">Escolha o que compartilhar</p>
        <div className="mt-2 flex gap-4 border-b border-white/10 px-4">
          <span className="flex items-center gap-1.5 border-b-2 border-[#8ab4f8] pb-2 font-semibold text-[#8ab4f8]">
            <PanelTop size={13} /> Guia do Chrome
          </span>
          <span className="flex items-center gap-1.5 pb-2 text-[#9aa0a6]">
            <AppWindow size={13} /> Janela
          </span>
          <span className="flex items-center gap-1.5 pb-2 text-[#9aa0a6]">
            <Monitor size={13} /> Tela inteira
          </span>
        </div>
        <div className="space-y-1 p-3">
          <div className="flex items-center gap-2 rounded bg-[#394457] px-2 py-1.5">
            <span className="h-3 w-3 rounded-sm bg-[#e50914]" />
            <span className="truncate">Netflix · YouTube · Spotify…</span>
          </div>
          <div className="flex items-center gap-2 rounded px-2 py-1.5 text-[#9aa0a6]">
            <span className="h-3 w-3 rounded-sm bg-[#9aa0a6]/40" />
            <span className="truncate">Outra guia</span>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-2.5">
          <span className="flex items-center gap-2 rounded-md px-1 ring-2 ring-dc-yellow">
            <span className="relative inline-flex h-4 w-8 rounded-full bg-[#8ab4f8]/60">
              <span className="absolute right-[-2px] top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full bg-[#8ab4f8]" />
            </span>
            <Volume2 size={13} /> Compartilhar áudio da guia
          </span>
          <span className="rounded-full bg-[#8ab4f8] px-3 py-1 font-semibold text-[#202124]">Compartilhar</span>
        </div>
      </div>

      <ul className="mt-4 space-y-1.5 text-xs leading-relaxed text-dc-muted">
        <li>
          • <b className="text-dc-text">Tela inteira</b> captura o som do sistema todo — incluindo as vozes da call, o que
          gera eco para os outros.
        </li>
        <li>
          • A aba do próprio Discordia é ocultada da lista automaticamente para evitar o efeito "túnel infinito".
        </li>
        <li>
          • Netflix/Prime/Disney+ aparecendo preto?{' '}
          <button type="button" onClick={onOpenDrmHelp} className="font-semibold text-dc-brand-soft hover:underline">
            Veja como resolver
          </button>
          .
        </li>
      </ul>
    </Modal>
  )
}
