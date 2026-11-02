import {
  Ban,
  Check,
  CircleAlert,
  Download,
  File,
  FileArchive,
  FileHeadphone,
  FileImage,
  FileText,
  FileVideoCamera,
  LoaderCircle,
  X,
} from 'lucide-react'
import { formatBytes, formatRate, isImageMime } from '../lib/fileUtils'
import type { FileTransfer as FileTransferModel } from '../types'

interface FileTransferCardProps {
  transfer: FileTransferModel
  onCancel: (id: string) => void
  onSave: (id: string) => void
}

function FileTypeIcon({ mime, name }: { mime: string; name: string }) {
  if (isImageMime(mime) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name)) return <FileImage size={20} />
  if (mime.startsWith('video/') || /\.(mp4|mkv|webm|mov|avi)$/i.test(name)) return <FileVideoCamera size={20} />
  if (mime.startsWith('audio/') || /\.(mp3|wav|ogg|flac|m4a)$/i.test(name)) return <FileHeadphone size={20} />
  if (/\.(zip|rar|7z|tar|gz|bz2)$/i.test(name) || mime.includes('zip') || mime.includes('compressed'))
    return <FileArchive size={20} />
  if (mime.startsWith('text/') || /\.(pdf|doc|docx|txt|md|json|csv|xml)$/i.test(name)) return <FileText size={20} />
  return <File size={20} />
}

/**
 * Cartão de transferência de arquivo P2P via DataChannel (download sob demanda).
 * • Não dispara download automático ao concluir (não interrompe tela cheia / jogos).
 * • Exibe preview inline clicável para imagens (`image/*`).
 * • Exibe botão explícito "Baixar Arquivo" com ícone de download.
 */
export function FileTransferCard({ transfer, onCancel, onSave }: FileTransferCardProps) {
  const { id, direction, file, chunksProcessed, totalChunks, bytes, status, url, rate, error } = transfer
  const pct =
    totalChunks > 0
      ? Math.min(100, Math.round((chunksProcessed / totalChunks) * 100))
      : status === 'done'
        ? 100
        : 0
  const isImage = (isImageMime(file.mime) || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name)) && !!url && status === 'done'
  const active = status === 'pending' || status === 'transferring'

  return (
    <div className="mt-1.5 overflow-hidden rounded-xl border border-white/10 bg-dc-darkest/95 p-3 text-xs shadow-md">
      {/* Preview inline clicável para imagens */}
      {isImage && url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="group/img relative mb-2.5 block overflow-hidden rounded-lg border border-white/5 bg-black/50"
          title="Clique para abrir a imagem em tamanho real"
        >
          <img
            src={url}
            alt={file.name}
            loading="lazy"
            className="max-h-52 w-full object-contain transition duration-200 group-hover/img:scale-[1.02]"
          />
        </a>
      )}

      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dc-brand/15 text-dc-brand-soft ring-1 ring-dc-brand/25">
          <FileTypeIcon mime={file.mime} name={file.name} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-dc-header" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 text-[11px] text-dc-muted">
            {formatBytes(file.size)}
            {active && rate > 0 && ` · ${formatRate(rate)}`}
            {active && totalChunks > 0 && ` · ${chunksProcessed}/${totalChunks} blocos`}
          </p>
        </div>

        {active && (
          <button
            type="button"
            onClick={() => onCancel(id)}
            className="rounded-md p-1.5 text-dc-muted transition hover:bg-dc-hover hover:text-dc-red"
            title="Cancelar transferência"
            aria-label="Cancelar transferência"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Barra de progresso em tempo real: (chunksProcessed / totalChunks) * 100 */}
      {active && (
        <div className="mt-2.5">
          <div className="mb-1 flex items-center justify-between text-[11px] text-dc-muted">
            <span className="inline-flex items-center gap-1">
              <LoaderCircle size={12} className="animate-spin text-dc-brand-soft" />
              {status === 'pending'
                ? 'Aguardando canal P2P…'
                : direction === 'send'
                  ? 'Enviando (16 KB/chunk)…'
                  : 'Recebendo (16 KB/chunk)…'}
            </span>
            <span className="font-mono font-semibold text-dc-text">
              {pct}% ({formatBytes(bytes)} / {formatBytes(file.size)})
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-dc-light">
            <div
              className="h-full rounded-full bg-dc-brand transition-[width] duration-150"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Botão explícito de download manual quando concluído */}
      {status === 'done' && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-2.5">
          <span className="inline-flex items-center gap-1 text-[11px] text-dc-green">
            <Check size={13} />
            {direction === 'send' ? 'Enviado via P2P' : 'Pronto para salvar'}
            {error ? <span className="text-dc-yellow"> · {error}</span> : null}
          </span>

          {url && (
            <button
              type="button"
              onClick={() => onSave(id)}
              className="inline-flex items-center gap-1.5 rounded-md bg-dc-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-dc-brand-hover active:scale-[0.98]"
              title={`Baixar ${file.name}`}
            >
              <Download size={14} /> Baixar Arquivo
            </button>
          )}
        </div>
      )}

      {status === 'canceled' && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-dc-muted">
          <Ban size={12} /> Transferência cancelada
        </p>
      )}

      {status === 'error' && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-dc-red">
          <CircleAlert size={12} /> {error ?? 'Falha na transferência do arquivo'}
        </p>
      )}
    </div>
  )
}
