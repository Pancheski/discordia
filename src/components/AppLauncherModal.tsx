import { Disc, Flag, Layers, Play, Power, Rocket } from 'lucide-react'
import { Modal } from './Modal'
import type { AppActivityId } from '../types'

interface AppLauncherModalProps {
  open: boolean
  onClose: () => void
  activeApp: AppActivityId
  onLaunchApp: (appId: Exclude<AppActivityId, null>) => void
  onStopApp: () => void
}

interface ActivityCatalogItem {
  id: Exclude<AppActivityId, null>
  title: string
  gradient: string
  accent: string
  icon: typeof Layers
}

const ACTIVITIES: ActivityCatalogItem[] = [
  {
    id: 'trio',
    title: 'TRIO',
    gradient: 'from-emerald-600/25 via-teal-900/30 to-dc-darkest',
    accent: 'text-emerald-300 bg-emerald-500/20 ring-emerald-400/30',
    icon: Layers,
  },
  {
    id: 'wheel',
    title: 'Roleta',
    gradient: 'from-fuchsia-600/25 via-purple-900/30 to-dc-darkest',
    accent: 'text-fuchsia-300 bg-fuchsia-500/20 ring-fuchsia-400/30',
    icon: Disc,
  },
  {
    id: 'golf',
    title: 'Mini Golf',
    gradient: 'from-sky-600/25 via-indigo-900/30 to-dc-darkest',
    accent: 'text-sky-300 bg-sky-500/20 ring-sky-400/30',
    icon: Flag,
  },
]

export function AppLauncherModal({
  open,
  onClose,
  activeApp,
  onLaunchApp,
  onStopApp,
}: AppLauncherModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="app-launcher-title"
      widthClass="max-w-lg"
      icon={
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-dc-brand/20 text-dc-brand-soft">
          <Rocket size={18} />
        </span>
      }
      title="Atividades"
      footer={
        activeApp ? (
          <button
            type="button"
            onClick={onStopApp}
            className="inline-flex items-center gap-1.5 rounded-md bg-dc-red/15 px-3 py-1.5 text-xs font-semibold text-dc-red transition hover:bg-dc-red/25"
          >
            <Power size={14} /> Encerrar Atividade
          </button>
        ) : undefined
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {ACTIVITIES.map((item) => {
          const Icon = item.icon
          const isRunning = activeApp === item.id
          return (
            <div
              key={item.id}
              className={`group flex flex-col items-center justify-between gap-4 rounded-xl border bg-gradient-to-b ${item.gradient} p-4 text-center transition duration-150 hover:-translate-y-0.5 ${
                isRunning ? 'border-dc-green ring-1 ring-dc-green/40' : 'border-white/10 hover:border-dc-brand/60'
              }`}
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl ring-1 ${item.accent}`}>
                <Icon size={24} />
              </span>

              <h3 className="text-sm font-bold text-white">{item.title}</h3>

              <button
                type="button"
                onClick={() => onLaunchApp(item.id)}
                className={`w-full rounded-lg py-2 text-xs font-bold text-white shadow transition active:scale-95 ${
                  isRunning ? 'bg-dc-green hover:bg-[#1f8b4c]' : 'bg-dc-brand hover:bg-dc-brand-hover'
                }`}
              >
                <span className="inline-flex items-center justify-center gap-1.5">
                  <Play size={13} />
                  Jogar
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
