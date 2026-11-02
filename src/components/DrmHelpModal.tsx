import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy, Cpu, MonitorX, RotateCcw, Settings, Share2 } from 'lucide-react'
import { Modal } from './Modal'
import { copyToClipboard } from '../lib/utils'

interface DrmHelpModalProps {
  open: boolean
  onClose: () => void
}

const SETTINGS_URLS = [
  { label: 'Chrome', url: 'chrome://settings/system' },
  { label: 'Edge', url: 'edge://settings/system' },
  { label: 'Brave', url: 'brave://settings/system' },
]

/**
 * Explica por que Netflix / Prime Video / Disney+ aparecem pretos na transmissão:
 * o DRM Widevine renderiza o vídeo protegido por um caminho de GPU (overlay seguro) que
 * a captura de tela não consegue ler. Com a aceleração de hardware desligada o vídeo passa
 * a ser composto por software e volta a aparecer na captura.
 */
export function DrmHelpModal({ open, onClose }: DrmHelpModalProps) {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = async (url: string) => {
    if (await copyToClipboard(url)) {
      setCopied(url)
      window.setTimeout(() => setCopied((c) => (c === url ? null : c)), 1800)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="drm-help-title"
      widthClass="max-w-xl"
      icon={
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-dc-red/15 text-dc-red">
          <MonitorX size={20} />
        </span>
      }
      title="A tela da Netflix/streaming ficou preta?"
      footer={
        <button type="button" onClick={onClose} className="dc-btn-primary px-5 py-2 text-sm">
          Entendi
        </button>
      }
    >
      <p className="text-sm leading-relaxed text-dc-muted">
        Netflix, Prime Video, Disney+, Max e similares usam proteção <b className="text-dc-text">DRM (Widevine)</b>. Com a
        aceleração de hardware ligada, o vídeo é desenhado direto pela placa de vídeo e a captura de tela recebe só um
        quadro preto. Desligando a aceleração, o navegador renderiza por software e a imagem volta a aparecer.
      </p>

      <ol className="mt-5 space-y-4">
        <Step n={1} icon={Settings} title="Abra as configurações de sistema do navegador">
          <p>Cole o endereço abaixo na barra de endereços (por segurança, sites não podem abri-lo diretamente):</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {SETTINGS_URLS.map(({ label, url }) => (
              <button
                key={url}
                type="button"
                onClick={() => void copy(url)}
                className="inline-flex items-center gap-1.5 rounded-md bg-dc-darkest px-2.5 py-1.5 font-mono text-xs text-dc-text ring-1 ring-white/5 transition hover:ring-dc-brand"
                title={`Copiar endereço do ${label}`}
              >
                {copied === url ? <Check size={13} className="text-dc-green" /> : <Copy size={13} className="text-dc-faint" />}
                {url}
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} icon={Cpu} title='Desative "Usar aceleração de hardware quando disponível"'>
          <p>No Chrome recente a opção pode se chamar "Usar aceleração gráfica quando disponível".</p>
          <SettingsIllustration />
        </Step>

        <Step n={3} icon={RotateCcw} title="Reinicie o navegador">
          <p>
            Clique em <b className="text-dc-text">Reiniciar</b> ao lado da opção (ou feche todas as janelas). Suas abas são
            restauradas.
          </p>
        </Step>

        <Step n={4} icon={Share2} title="Compartilhe a guia do streaming novamente">
          <p>
            Volte para a sala, clique em compartilhar e escolha <b className="text-dc-text">Guia do Chrome</b> com{' '}
            <b className="text-dc-text">"Compartilhar áudio da guia"</b> marcado.
          </p>
        </Step>
      </ol>

      <div className="mt-5 space-y-1.5 rounded-lg bg-dc-darkest/70 p-3 text-xs leading-relaxed text-dc-muted">
        <p>
          <b className="text-dc-text">Firefox:</b> Configurações → Geral → Desempenho → desmarque "Usar configurações
          recomendadas" e "Usar aceleração de hardware quando disponível".
        </p>
        <p>
          <b className="text-dc-text">Dica:</b> só quem está <i>transmitindo</i> precisa fazer isso. Depois da sessão, você
          pode reativar a aceleração para recuperar o desempenho em jogos e vídeos.
        </p>
      </div>
    </Modal>
  )
}

function Step({
  n,
  icon: Icon,
  title,
  children,
}: {
  n: number
  icon: typeof Settings
  title: string
  children: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dc-brand text-xs font-bold text-white">
        {n}
      </span>
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-dc-muted">
        <p className="mb-1 flex items-center gap-1.5 font-semibold text-dc-header">
          <Icon size={15} className="shrink-0 text-dc-brand-soft" /> {title}
        </p>
        {children}
      </div>
    </li>
  )
}

/** Ilustração estilizada da tela chrome://settings/system com o toggle sendo desligado. */
function SettingsIllustration() {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-[#202124] text-[12px] shadow-lg" aria-hidden="true">
      <div className="flex items-center gap-1.5 border-b border-white/5 bg-[#35363a] px-3 py-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <span className="ml-2 flex-1 truncate rounded-full bg-[#202124] px-3 py-0.5 font-mono text-[11px] text-[#9aa0a6]">
          chrome://settings/system
        </span>
      </div>
      <div className="flex">
        <div className="hidden w-28 shrink-0 space-y-1 border-r border-white/5 p-2 text-[#9aa0a6] sm:block">
          <div className="rounded px-2 py-1">Aparência</div>
          <div className="rounded px-2 py-1">Downloads</div>
          <div className="rounded bg-[#394457] px-2 py-1 font-semibold text-[#8ab4f8]">Sistema</div>
          <div className="rounded px-2 py-1">Redefinir</div>
        </div>
        <div className="flex-1 space-y-2 p-3 text-[#e8eaed]">
          <p className="font-semibold">Sistema</p>
          <div className="flex items-center justify-between gap-3 rounded-md bg-[#292a2d] px-3 py-2 opacity-60">
            <span>Continuar executando apps em segundo plano</span>
            <Toggle on />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md bg-[#292a2d] px-3 py-2 ring-2 ring-dc-yellow">
            <span className="font-medium">Usar aceleração de hardware quando disponível</span>
            <span className="flex items-center gap-2">
              <span className="rounded bg-[#8ab4f8] px-2 py-0.5 text-[11px] font-semibold text-[#202124]">Reiniciar</span>
              <Toggle on={false} />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-flex h-4 w-8 shrink-0 rounded-full transition ${on ? 'bg-[#8ab4f8]/60' : 'bg-[#5f6368]'}`}>
      <span
        className={`absolute top-1/2 h-[18px] w-[18px] -translate-y-1/2 rounded-full shadow transition-all ${
          on ? 'right-[-2px] bg-[#8ab4f8]' : 'left-[-2px] bg-[#bdc1c6]'
        }`}
      />
    </span>
  )
}
