import { useEffect, useMemo, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Copy,
  Dices,
  Headphones,
  Link2,
  Loader2,
  Mic,
  MonitorUp,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from 'lucide-react'
import {
  MAX_PEERS,
  buildRoomLink,
  copyToClipboard,
  detectCapabilities,
  getRoomFromUrl,
  hasRoomInUrl,
  randomRoomName,
  slugifyRoom,
} from '../lib/utils'
import type { ToastKind } from '../types'

const NICK_KEY = 'discordia:nickname'

interface LobbyProps {
  joining: boolean
  onJoin: (name: string, room: string) => void
  onToast: (kind: ToastKind, message: string) => void
}

export function Lobby({ joining, onJoin, onToast }: LobbyProps) {
  const [nickname, setNickname] = useState(() => localStorage.getItem(NICK_KEY) ?? '')
  const [roomName, setRoomName] = useState(() => getRoomFromUrl() || randomRoomName())
  const [isInvited] = useState(() => hasRoomInUrl())
  const [copied, setCopied] = useState(false)
  const caps = useMemo(() => detectCapabilities(), [])
  const slug = slugifyRoom(roomName)
  const link = slug ? buildRoomLink(slug) : ''
  const canJoin = nickname.trim().length > 0 && slug.length > 0 && !joining

  useEffect(() => {
    const onLocationChange = () => {
      const fromUrl = getRoomFromUrl()
      if (fromUrl) setRoomName(fromUrl)
    }
    window.addEventListener('hashchange', onLocationChange)
    window.addEventListener('popstate', onLocationChange)
    return () => {
      window.removeEventListener('hashchange', onLocationChange)
      window.removeEventListener('popstate', onLocationChange)
    }
  }, [])

  const handleCopy = async () => {
    if (!link) return
    const ok = await copyToClipboard(link)
    if (ok) {
      setCopied(true)
      onToast('success', 'Link da sala copiado! Envie para seus amigos.')
      window.setTimeout(() => setCopied(false), 1800)
    } else {
      onToast('error', 'Não foi possível copiar o link automaticamente.')
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!canJoin) return
    localStorage.setItem(NICK_KEY, nickname.trim())
    onJoin(nickname.trim(), slug)
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-dc-darkest px-4 py-10">
      {/* Fundo animado */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute -left-32 -top-32 h-[28rem] w-[28rem] animate-float rounded-full bg-dc-brand/25 blur-[110px]" />
        <div
          className="absolute -bottom-40 -right-24 h-[32rem] w-[32rem] animate-float rounded-full bg-fuchsia-500/15 blur-[120px]"
          style={{ animationDelay: '-4s' }}
        />
        <div
          className="absolute left-1/2 top-1/3 h-72 w-72 animate-float rounded-full bg-cyan-400/10 blur-[100px]"
          style={{ animationDelay: '-2s' }}
        />
        <div className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:22px_22px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />
      </div>

      <main className="relative z-10 grid w-full max-w-4xl animate-fade-up overflow-hidden rounded-2xl border border-white/5 bg-dc-dark/90 shadow-2xl shadow-black/60 backdrop-blur-xl md:grid-cols-[1.15fr_1fr]">
        {/* Formulário */}
        <section className="p-7 sm:p-9">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-dc-brand-soft to-dc-brand-hover shadow-lg shadow-dc-brand/30">
              <Headphones size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-dc-header">Discordia</h1>
              <p className="text-sm text-dc-muted">Voz e tela P2P para o seu grupo</p>
            </div>
          </div>

          {isInvited && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-dc-brand/30 bg-dc-brand/10 p-3 text-xs leading-relaxed text-dc-text animate-fade-up">
              <Sparkles size={16} className="mt-0.5 shrink-0 text-dc-brand-soft" />
              <span>
                Você recebeu um convite para a sala <strong className="font-semibold text-white">#{slug}</strong>. Escolha seu apelido abaixo para entrar na chamada!
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <div>
              <label htmlFor="nickname-input" className="dc-label">
                Apelido <span className="text-dc-red">*</span>
              </label>
              <input
                id="nickname-input"
                className="dc-input"
                placeholder="Como seus amigos te chamam?"
                value={nickname}
                maxLength={32}
                autoComplete="nickname"
                autoFocus={!nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
            </div>

            <div>
              <label htmlFor="room-input" className="dc-label">
                Nome da sala <span className="text-dc-red">*</span>
              </label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg font-semibold text-dc-faint">
                    #
                  </span>
                  <input
                    id="room-input"
                    className="dc-input pl-7"
                    placeholder="sala-dos-amigos"
                    value={roomName}
                    maxLength={48}
                    onChange={(e) => setRoomName(e.target.value)}
                  />
                </div>
                <button
                  id="random-room-button"
                  type="button"
                  onClick={() => setRoomName(randomRoomName())}
                  className="dc-btn-ghost px-3"
                  title="Gerar nome aleatório"
                  aria-label="Gerar nome de sala aleatório"
                >
                  <Dices size={18} />
                </button>
              </div>
              {slug && slug !== roomName && (
                <p className="mt-1.5 text-xs text-dc-muted">
                  ID da sala: <span className="font-mono text-dc-text">{slug}</span>
                </p>
              )}
            </div>

            <div>
              <span className="dc-label">Convite</span>
              <div className="flex items-center gap-2 rounded-md bg-dc-darkest p-1.5 pl-3">
                <Link2 size={16} className="shrink-0 text-dc-faint" />
                <span className="flex-1 truncate font-mono text-xs text-dc-muted" title={link}>
                  {link || 'Digite um nome de sala'}
                </span>
                <button
                  id="copy-link-button"
                  type="button"
                  onClick={handleCopy}
                  disabled={!link}
                  className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition disabled:opacity-40 ${
                    copied ? 'bg-dc-green text-white' : 'bg-dc-brand text-white hover:bg-dc-brand-hover'
                  }`}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
            </div>

            <button id="join-button" type="submit" disabled={!canJoin} className="dc-btn-primary w-full py-3 text-[15px]">
              {joining ? (
                <>
                  <Loader2 size={18} className="animate-spin" /> Conectando…
                </>
              ) : (
                <>
                  Entrar na sala <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          {/* Avisos de compatibilidade */}
          <div className="mt-5 space-y-2">
            {!caps.secureContext && (
              <Warning>
                Página fora de contexto seguro. Microfone e tela exigem <b>HTTPS</b> ou <b>localhost</b>.
              </Warning>
            )}
            {caps.secureContext && !caps.microphone && (
              <Warning>Este navegador não oferece acesso ao microfone. Você entrará apenas como ouvinte.</Warning>
            )}
            {caps.secureContext && !caps.screenShare && (
              <Warning>
                Compartilhamento de tela indisponível neste navegador/dispositivo (comum em celulares). Você ainda pode
                assistir às transmissões.
              </Warning>
            )}
          </div>
        </section>

        {/* Painel informativo */}
        <aside className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-dc-brand/90 via-dc-brand-hover to-indigo-900 p-9 text-white md:flex">
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
          <div className="relative">
            <h2 className="text-xl font-bold leading-tight">Sua call, sem servidor no meio.</h2>
            <p className="mt-2 text-sm text-white/75">
              Áudio e vídeo trafegam direto entre os navegadores via WebRTC — latência mínima e privacidade.
            </p>
          </div>
          <ul className="relative mt-8 space-y-4 text-sm">
            <Feature icon={Mic} title="Voz cristalina" text="Cancelamento de eco e detecção de fala." />
            <Feature icon={MonitorUp} title="Tela a 60 fps com áudio" text="Microfone e tela em canais independentes." />
            <Feature icon={Zap} title="Zero configuração" text="Só compartilhe o link da sala." />
            <Feature icon={Users} title={`Até ${MAX_PEERS} pessoas`} text="Malha P2P completa entre todos." />
            <Feature icon={ShieldCheck} title="Criptografado" text="DTLS-SRTP de ponta a ponta." />
          </ul>
        </aside>
      </main>
    </div>
  )
}

function Feature({ icon: Icon, title, text }: { icon: typeof Mic; title: string; text: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
        <Icon size={16} />
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="text-white/70">{text}</span>
      </span>
    </li>
  )
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dc-yellow/25 bg-dc-yellow/10 p-2.5 text-xs leading-relaxed text-dc-yellow">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  )
}
