import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import {
  CloudUpload,
  ExternalLink,
  Globe,
  MessageSquare,
  Paperclip,
  SendHorizontal,
  X,
} from 'lucide-react'
import { Avatar } from './Avatar'
import { FileTransferCard } from './FileTransfer'
import { useFileDrop } from '../hooks/useFileDrop'
import type { ChatMessage, ChatSnapshot } from '../types'

interface ChatSidebarProps {
  room: string
  open: boolean
  onClose: () => void
  chat: ChatSnapshot
  onSendText: (text: string) => boolean
  onSendFiles: (files: Iterable<File>) => void
  onCancelTransfer: (id: string) => void
  onSaveTransfer: (id: string) => void
}

const URL_REGEX = /(https?:\/\/[^\s<>"']+)/gi
const IMAGE_URL_REGEX = /\.(?:png|jpe?g|gif|webp|avif|svg)(?:\?[^\s]*)?$/i

function extractUrls(text: string): string[] {
  const matches = text.match(URL_REGEX)
  if (!matches) return []
  const unique = new Set<string>()
  for (const raw of matches) {
    const cleaned = raw.replace(/[.,;:!?)]+$/, '')
    try {
      const u = new URL(cleaned)
      if (u.protocol === 'http:' || u.protocol === 'https:') unique.add(u.toString())
    } catch {
      /* ignore invalid URL */
    }
  }
  return [...unique].slice(0, 3)
}

function getYouTubeId(urlStr: string): string | null {
  try {
    const u = new URL(urlStr)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v')
      if (v) return v
      const parts = u.pathname.split('/')
      const idx = parts.findIndex((p) => p === 'shorts' || p === 'embed')
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1]
    }
  } catch {
    /* ignore */
  }
  return null
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function ChatSidebar({
  room,
  open,
  onClose,
  chat,
  onSendText,
  onSendFiles,
  onCancelTransfer,
  onSaveTransfer,
}: ChatSidebarProps) {
  const [text, setText] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { dragging, bind } = useFileDrop(onSendFiles, open)

  // Auto-scroll ao receber novas mensagens
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [chat.messages.length, open])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    if (onSendText(text)) setText('')
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (text.trim() && onSendText(text)) setText('')
    }
  }

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : []
    if (files.length > 0) onSendFiles(files)
    e.target.value = ''
  }

  return (
    <>
      {/* Overlay mobile */}
      <div
        className={`fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        {...bind}
        aria-label="Chat da sala"
        className={`fixed inset-y-0 right-0 z-40 flex w-80 max-w-[92vw] flex-col border-l border-black/30 bg-dc-darker transition-all duration-300 sm:w-96 lg:static ${
          open ? 'translate-x-0 lg:w-80 xl:w-96' : 'translate-x-full lg:w-0 lg:overflow-hidden lg:border-l-0'
        }`}
      >
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-50 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-dc-brand bg-dc-darkest/95 p-6 text-center shadow-2xl">
            <CloudUpload size={40} className="animate-bounce text-dc-brand-soft" />
            <p className="text-sm font-bold text-dc-header">Solte para enviar em #{room}</p>
          </div>
        )}

        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-black/30 px-4 shadow-sm">
          <div className="flex min-w-0 items-center gap-2">
            <MessageSquare size={18} className="shrink-0 text-dc-muted" />
            <h2 className="truncate font-semibold text-dc-header">#{room}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-dc-muted transition hover:bg-dc-hover hover:text-dc-text"
            title="Recolher chat"
            aria-label="Recolher chat"
          >
            <X size={16} />
          </button>
        </header>

        {/* Lista de mensagens */}
        <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-4">
          {chat.messages.length === 0 ? (
            <div className="my-8 rounded-xl border border-dashed border-dc-border p-5 text-center">
              <MessageSquare size={26} className="mx-auto mb-2 text-dc-faint" />
              <p className="text-sm font-semibold text-dc-header">Bem-vindo a #{room}</p>
              <p className="mt-1 text-xs text-dc-muted">Comece a conversa ou arraste arquivos aqui.</p>
            </div>
          ) : (
            chat.messages.map((msg) => (
              <MessageItem
                key={msg.id}
                msg={msg}
                transfers={chat.transfers}
                onCancelTransfer={onCancelTransfer}
                onSaveTransfer={onSaveTransfer}
              />
            ))
          )}
        </div>

        {/* Input de mensagem + upload */}
        <form onSubmit={handleSubmit} className="shrink-0 border-t border-black/30 bg-dc-darkest/60 p-3">
          <input ref={fileInputRef} type="file" multiple onChange={handleFileChange} className="hidden" />
          <div className="flex items-end gap-1.5 rounded-lg bg-dc-light px-2.5 py-2 ring-1 ring-transparent focus-within:ring-dc-brand">
            <button
              id="chat-attach-button"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="rounded p-1.5 text-dc-muted transition hover:bg-dc-hover hover:text-dc-header"
              title="Enviar arquivo P2P (ou arraste para o chat)"
              aria-label="Enviar arquivo"
            >
              <Paperclip size={18} />
            </button>

            <textarea
              id="chat-input"
              rows={1}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Conversar em #${room}…`}
              maxLength={4000}
              className="max-h-28 min-h-[24px] flex-1 resize-none bg-transparent text-sm text-dc-header outline-none placeholder:text-dc-faint"
            />

            <button
              id="chat-send-button"
              type="submit"
              disabled={!text.trim()}
              className="rounded bg-dc-brand p-1.5 text-white transition hover:bg-dc-brand-hover disabled:opacity-40"
              title="Enviar mensagem (Enter)"
              aria-label="Enviar mensagem"
            >
              <SendHorizontal size={16} />
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}

function MessageItem({
  msg,
  transfers,
  onCancelTransfer,
  onSaveTransfer,
}: {
  msg: ChatMessage
  transfers: ChatSnapshot['transfers']
  onCancelTransfer: (id: string) => void
  onSaveTransfer: (id: string) => void
}) {
  if (msg.kind === 'system') {
    return (
      <div className="flex items-center gap-2 px-2 py-0.5 text-[11px] text-dc-muted">
        <span className="h-1 w-1 rounded-full bg-dc-faint" />
        <span className="flex-1">{msg.text}</span>
        <span className="text-[10px] text-dc-faint">{formatTime(msg.ts)}</span>
      </div>
    )
  }

  const transfer = msg.kind === 'file' ? transfers[msg.transferId] : undefined

  return (
    <div className="group flex items-start gap-2.5 rounded-md px-1.5 py-1 transition hover:bg-dc-hover/30">
      <Avatar name={msg.authorName} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-xs font-semibold text-dc-header">
            {msg.authorName}
            {msg.isLocal && <span className="ml-1 font-normal text-dc-muted">(você)</span>}
          </span>
          <span className="shrink-0 text-[10px] text-dc-faint">{formatTime(msg.ts)}</span>
        </div>

        {msg.kind === 'text' && <FormattedText text={msg.text} />}

        {msg.kind === 'file' && transfer && (
          <FileTransferCard transfer={transfer} onCancel={onCancelTransfer} onSave={onSaveTransfer} />
        )}
      </div>
    </div>
  )
}

function FormattedText({ text }: { text: string }) {
  const urls = useMemo(() => extractUrls(text), [text])
  const parts = useMemo(() => text.split(URL_REGEX), [text])

  return (
    <div className="mt-0.5 space-y-1.5">
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-dc-text">
        {parts.map((part, i) => {
          if ( i % 2 === 1 && /^https?:\/\//i.test(part)) {
            const href = part.replace(/[.,;:!?)]+$/, '')
            const trailing = part.slice(href.length)
            return (
              <span key={i}>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className=" break-all font-medium text-dc-brand-soft underline decoration-dc-brand-soft/40 underline-offset-2 hover:text-white hover:decoration-white"
                >
                  {href}
                </a>
                {trailing}
              </span>
            )
          }
          return <span key={i}>{part}</span>
        })}
      </p>

      {urls.map((url) => (
        <LinkPreview key={url} url={url} />
      ))}
    </div>
  )
}

function LinkPreview({ url }: { url: string }) {
  const ytId = getYouTubeId(url)
  let hostname = ''
  try {
    hostname = new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return null
  }

  if (IMAGE_URL_REGEX.test(url)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="block max-w-xs overflow-hidden rounded-lg border border-white/10 bg-black/30"
      >
        <img src={url} alt={hostname} loading="lazy" className="max-h-48 w-full object-contain" />
      </a>
    )
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col overflow-hidden rounded-lg border border-l-4 border-white/10 border-l-dc-brand bg-dc-darkest/80 transition hover:bg-dc-darkest"
    >
      {ytId && (
        <img
          src={`https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`}
          alt="YouTube thumbnail"
          loading="lazy"
          className="h-36 w-full object-cover"
        />
      )}
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <Globe size={14} className="shrink-0 text-dc-brand-soft" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-dc-header">{ytId ? 'YouTube · Vídeo' : hostname}</p>
          <p className="truncate text-[11px] text-dc-muted">{url}</p>
        </div>
        <ExternalLink size={13} className="shrink-0 text-dc-muted" />
      </div>
    </a>
  )
}

