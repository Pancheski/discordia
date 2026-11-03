import { useCallback, useEffect, useState } from 'react'
import { AppWindow, Check, Film, LoaderCircle, Monitor, RefreshCw, Volume2, X, Zap } from 'lucide-react'
import type { DesktopSourceInfo, ScreenSharePreset } from '../types'

interface DesktopScreenPickerModalProps {
  open: boolean
  onClose: () => void
  initialPreset?: ScreenSharePreset
  onSelectSource: (sourceId: string, preset: ScreenSharePreset) => void
}

export function DesktopScreenPickerModal({
  open,
  onClose,
  initialPreset = 'game',
  onSelectSource,
}: DesktopScreenPickerModalProps) {
  const [sources, setSources] = useState<DesktopSourceInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'windows' | 'screens'>('windows')
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [preset, setPreset] = useState<ScreenSharePreset>(initialPreset)

  const refreshSources = useCallback(async () => {
    if (!window.electron?.getDesktopSources) return
    setLoading(true)
    try {
      const list = await window.electron.getDesktopSources()
      setSources(list)
      setSelectedSourceId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev
        const windows = list.filter((s) => !s.isScreen && s.name.trim().length > 0)
        const screens = list.filter((s) => s.isScreen)
        return windows[0]?.id || screens[0]?.id || list[0]?.id || null
      })
    } catch (err) {
      console.warn('[DesktopPicker] Falha ao listar telas/janelas:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !window.electron?.getDesktopSources) return
    let active = true
    window.electron
      .getDesktopSources()
      .then((list) => {
        if (!active) return
        setSources(list)
        const windows = list.filter((s) => !s.isScreen && s.name.trim().length > 0)
        const screens = list.filter((s) => s.isScreen)
        setSelectedSourceId(windows[0]?.id || screens[0]?.id || list[0]?.id || null)
      })
      .catch((err) => {
        console.warn('[DesktopPicker] Falha ao listar telas/janelas:', err)
      })
    return () => {
      active = false
    }
  }, [open])

  if (!open) return null

  const screens = sources.filter((s) => s.isScreen)
  const windows = sources.filter((s) => !s.isScreen && s.name.trim().length > 0)
  const activeSources = activeTab === 'windows' ? windows : screens

  const handleConfirm = (overrideId?: string) => {
    const idToUse = overrideId || selectedSourceId
    if (!idToUse) return
    onSelectSource(idToUse, preset)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-picker-title"
        className="flex flex-col w-full max-w-3xl max-h-[88vh] rounded-2xl border border-white/10 bg-dc-dark shadow-2xl overflow-hidden"
      >
        {/* Cabeçalho */}
        <header className="flex items-center justify-between border-b border-white/[0.08] px-5 py-3.5 bg-dc-darkest/90">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-dc-brand/20 text-dc-brand">
              <Monitor size={18} />
            </span>
            <h2 id="desktop-picker-title" className="text-base font-extrabold text-white">
              Compartilhar sua tela
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refreshSources}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-dc-text transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              title="Recarregar janelas abertas"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Atualizar</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-dc-muted transition hover:bg-white/10 hover:text-white"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* Abas: Aplicativos / Janelas vs Telas Inteiras */}
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-dc-darkest/50 px-5 pt-3 pb-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('windows')
              if (windows[0] && (!selectedSourceId || !windows.some((w) => w.id === selectedSourceId))) {
                setSelectedSourceId(windows[0].id)
              }
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeTab === 'windows'
                ? 'bg-dc-brand text-white shadow'
                : 'text-dc-muted hover:bg-white/5 hover:text-dc-text'
            }`}
          >
            <AppWindow size={15} />
            <span>Aplicativos / Janelas</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                activeTab === 'windows' ? 'bg-white/20 text-white' : 'bg-white/10 text-dc-muted'
              }`}
            >
              {windows.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('screens')
              if (screens[0] && (!selectedSourceId || !screens.some((s) => s.id === selectedSourceId))) {
                setSelectedSourceId(screens[0].id)
              }
            }}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold transition ${
              activeTab === 'screens'
                ? 'bg-dc-brand text-white shadow'
                : 'text-dc-muted hover:bg-white/5 hover:text-dc-text'
            }`}
          >
            <Monitor size={15} />
            <span>Telas Inteiras</span>
            <span
              className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                activeTab === 'screens' ? 'bg-white/20 text-white' : 'bg-white/10 text-dc-muted'
              }`}
            >
              {screens.length}
            </span>
          </button>
        </div>

        {/* Grade de Miniaturas / Janelas */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {loading && sources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-dc-muted">
              <LoaderCircle size={28} className="animate-spin text-dc-brand mb-3" />
              <p className="text-sm font-semibold text-white">Detectando janelas e telas disponíveis…</p>
            </div>
          ) : activeSources.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-dc-muted">
              <AppWindow size={36} className="text-dc-faint mb-2" />
              <p className="text-sm font-semibold text-white">Nenhuma fonte encontrada nesta aba.</p>
              <p className="text-xs text-dc-muted mt-1">Abra um aplicativo ou alterne para a outra aba.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3">
              {activeSources.map((source) => {
                const isSelected = source.id === selectedSourceId
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setSelectedSourceId(source.id)}
                    onDoubleClick={() => handleConfirm(source.id)}
                    className={`group relative flex flex-col rounded-xl border p-2 text-left transition cursor-pointer select-none ${
                      isSelected
                        ? 'border-dc-brand bg-dc-brand/10 ring-2 ring-dc-brand/60 shadow-lg shadow-dc-brand/20'
                        : 'border-white/10 bg-black/40 hover:border-white/25 hover:bg-black/60'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-black/80 shadow-inner">
                      <img
                        src={source.thumbnail}
                        alt={source.name}
                        className="h-full w-full object-cover transition duration-150 group-hover:scale-[1.02]"
                      />
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-dc-brand text-white shadow">
                          <Check size={12} strokeWidth={3} />
                        </div>
                      )}
                    </div>

                    {/* Título e Ícone */}
                    <div className="mt-2 flex items-center gap-1.5 min-w-0 px-0.5">
                      {source.appIcon ? (
                        <img src={source.appIcon} alt="" className="h-4 w-4 shrink-0 rounded" />
                      ) : (
                        <AppWindow size={14} className="shrink-0 text-dc-muted" />
                      )}
                      <span className="truncate text-xs font-semibold text-white" title={source.name}>
                        {source.name}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Rodapé: Seletor de Qualidade + Ações */}
        <footer className="flex flex-col gap-3.5 border-t border-white/[0.08] bg-dc-darkest/95 p-4 sm:flex-row sm:items-center sm:justify-between">
          {/* Seletor Rápido de Resolução / Framerate */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-bold text-dc-muted uppercase tracking-wider mr-1">Qualidade:</span>
            <button
              type="button"
              onClick={() => setPreset('game')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                preset === 'game'
                  ? 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/40 shadow-sm'
                  : 'bg-white/5 text-dc-muted hover:text-white'
              }`}
            >
              <Zap size={13} className="fill-amber-400 text-amber-400" />
              <span>720p 60 FPS</span>
            </button>

            <button
              type="button"
              onClick={() => setPreset('quality')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition ${
                preset === 'quality'
                  ? 'bg-dc-brand/20 text-indigo-300 ring-1 ring-dc-brand/40 shadow-sm'
                  : 'bg-white/5 text-dc-muted hover:text-white'
              }`}
            >
              <Film size={13} />
              <span>1080p 60 FPS</span>
            </button>

            <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-emerald-400 ml-2">
              <Volume2 size={13} /> Áudio incluso
            </span>
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-xs font-semibold text-dc-muted transition hover:bg-white/5 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => handleConfirm()}
              disabled={!selectedSourceId}
              className="dc-btn-primary px-5 py-2 text-xs font-bold shadow-lg shadow-dc-brand/20 disabled:opacity-40"
            >
              Compartilhar
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
