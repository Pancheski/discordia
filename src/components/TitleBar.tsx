import { useEffect, useState, type CSSProperties } from 'react'
import { Download, Headphones, Minus, RefreshCw, Square, X } from 'lucide-react'

const dragStyle: CSSProperties = {
  WebkitAppRegion: 'drag',
} as CSSProperties

const noDragStyle: CSSProperties = {
  WebkitAppRegion: 'no-drag',
} as CSSProperties

export function TitleBar() {
  const isElectron = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'downloading' | 'downloaded'>('idle')
  const [updateVersion, setUpdateVersion] = useState<string>('')

  useEffect(() => {
    if (!isElectron || !window.electron) return

    const unsubAvail = window.electron.onUpdateAvailable((info) => {
      setUpdateStatus('downloading')
      if (info?.version) setUpdateVersion(info.version)
    })

    const unsubDown = window.electron.onUpdateDownloaded((info) => {
      setUpdateStatus('downloaded')
      if (info?.version) setUpdateVersion(info.version)
    })

    return () => {
      unsubAvail?.()
      unsubDown?.()
    }
  }, [isElectron])

  if (!isElectron) return null

  return (
    <div
      style={dragStyle}
      className="flex h-7 shrink-0 select-none items-center justify-between border-b border-black/40 bg-[#111214] pl-3 text-xs text-dc-muted"
    >
      <div className="flex items-center gap-2">
        <Headphones size={13} className="text-dc-brand-soft" />
        <span className="text-[11px] font-bold tracking-wide text-dc-header">Discordia</span>

        {updateStatus === 'downloading' && (
          <span className="ml-2 inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
            <Download size={10} className="animate-bounce" />
            <span>Baixando atualização{updateVersion ? ` (${updateVersion})` : ''}...</span>
          </span>
        )}

        {updateStatus === 'downloaded' && (
          <button
            type="button"
            style={noDragStyle}
            onClick={() => window.electron?.restartAndInstallUpdate()}
            className="ml-2 inline-flex items-center gap-1.5 rounded bg-emerald-500/25 px-2 py-0.5 text-[10px] font-bold text-emerald-200 ring-1 ring-emerald-400/40 transition hover:bg-emerald-500/35"
            title="Clique para reiniciar e instalar a nova versão"
          >
            <RefreshCw size={10} />
            <span>Atualização pronta. Reiniciar agora</span>
          </button>
        )}
      </div>

      <div style={noDragStyle} className="flex h-full items-stretch">
        <button
          type="button"
          onClick={() => window.electron?.minimizeWindow()}
          className="flex w-10 items-center justify-center text-dc-muted transition hover:bg-white/10 hover:text-white"
          aria-label="Minimizar"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={() => window.electron?.maximizeWindow()}
          className="flex w-10 items-center justify-center text-dc-muted transition hover:bg-white/10 hover:text-white"
          aria-label="Maximizar"
        >
          <Square size={12} />
        </button>
        <button
          type="button"
          onClick={() => window.electron?.closeWindow()}
          className="flex w-10 items-center justify-center text-dc-muted transition hover:bg-dc-red hover:text-white"
          aria-label="Fechar"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
