import type { DataConnection } from 'peerjs'
import {
  FILE_CHUNK_SIZE,
  PeerFileReceiver,
  computeTotalChunks,
  configureRawDataChannel,
  sendFileOverDataChannel,
} from './fileTransfer'
import { downloadUrl, randomId, sanitizeFileName } from './fileUtils'
import { sanitizeName } from './utils'
import type {
  ChatMessage,
  ChatSnapshot,
  FileMeta,
  FileTransfer,
  PeerMessage,
  ToastKind,
} from '../types'

export { FILE_CHUNK_SIZE }

const FILE_CHANNEL_OPEN_TIMEOUT_MS = 12000
const EMIT_THROTTLE_MS = 100
const MAX_MESSAGES = 500
const MAX_TEXT_LENGTH = 4000

export interface ChatPeer {
  id: string
  name: string
  data: DataConnection
}

export interface ChatTransport {
  localId(): string
  localName(): string
  /** Pares com canal de controle aberto e já apresentados (hello). */
  peers(): ChatPeer[]
  peerName(id: string): string
  sendControl(conn: DataConnection, msg: PeerMessage): void
  /** Abre um DataConnection RAW dedicado a arquivos com o par. */
  openFileChannel(peerId: string): DataConnection | null
}

export interface ChatCallbacks {
  onChange: (snapshot: ChatSnapshot) => void
  onToast: (kind: ToastKind, message: string) => void
}

interface OutgoingTransfer {
  id: string
  file: File
  meta: FileMeta
  totalChunks: number
  startedAt: number
  recipients: Set<string>
  bytesByPeer: Map<string, number>
  chunksByPeer: Map<string, number>
  finished: Set<string>
  failed: Set<string>
  canceledPeers: Set<string>
  canceled: boolean
}

function sanitizeMeta(raw: unknown): FileMeta | null {
  if (!raw || typeof raw !== 'object') return null
  const m = raw as Partial<FileMeta>
  const size = Number(m.size)
  if (!Number.isFinite(size) || size < 0) return null
  return {
    name: sanitizeFileName(m.name),
    size,
    mime: typeof m.mime === 'string' && m.mime ? m.mime.slice(0, 128) : 'application/octet-stream',
  }
}

function isValidId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64
}

export class ChatService {
  private readonly transport: ChatTransport
  private readonly cb: ChatCallbacks
  private messages: ChatMessage[] = []
  private readonly transfers = new Map<string, FileTransfer>()
  private readonly outgoing = new Map<string, OutgoingTransfer>()
  private readonly receivers = new Map<string, PeerFileReceiver>()
  private readonly fileChannels = new Map<string, Promise<DataConnection>>()
  private readonly sendQueues = new Map<string, Promise<void>>()
  private readonly inboundChannels = new Set<DataConnection>()
  private readonly objectUrls = new Set<string>()
  private emitTimer: number | null = null
  private disposed = false

  constructor(transport: ChatTransport, callbacks: ChatCallbacks) {
    this.transport = transport
    this.cb = callbacks
  }

  // ════════════════════════════════════════════════════════════════════
  //  API pública (chamada pela UI via RoomManager)
  // ════════════════════════════════════════════════════════════════════

  sendText(raw: string): boolean {
    const text = raw.trim().slice(0, MAX_TEXT_LENGTH)
    if (!text || this.disposed) return false
    const id = randomId()
    const ts = Date.now()
    for (const p of this.transport.peers()) {
      this.transport.sendControl(p.data, { type: 'chat', id, text, ts })
    }
    this.pushMessage({
      kind: 'text',
      id,
      text,
      ts,
      authorId: this.transport.localId(),
      authorName: this.transport.localName(),
      isLocal: true,
    })
    this.emitNow()
    return true
  }

  sendFiles(files: Iterable<File>): void {
    if (this.disposed) return
    const peers = this.transport.peers()
    if (peers.length === 0) {
      this.cb.onToast('warning', 'Ninguém na sala para receber o arquivo ainda. Convide alguém primeiro!')
      return
    }
    for (const file of files) this.startOutgoing(file, peers)
    this.emitNow()
  }

  cancelTransfer(id: string): void {
    const tx = this.outgoing.get(id)
    if (tx) {
      if (tx.canceled) return
      tx.canceled = true
      for (const p of this.transport.peers()) {
        if (tx.recipients.has(p.id)) this.transport.sendControl(p.data, { type: 'file-cancel', id })
      }
      this.patchTransfer(id, { status: 'canceled' })
      this.emitNow()
      return
    }

    const record = this.transfers.get(id)
    if (!record || record.direction !== 'receive') return
    if (record.status !== 'pending' && record.status !== 'transferring') return

    const senderId = this.messages.find((m) => m.kind === 'file' && m.transferId === id)?.authorId ?? ''
    this.receivers.get(senderId)?.discard(id)
    const peer = this.transport.peers().find((p) => p.id === senderId)
    if (peer) this.transport.sendControl(peer.data, { type: 'file-cancel', id })
    this.patchTransfer(id, { status: 'canceled' })
    this.emitNow()
  }

  /** Salva novamente um arquivo já recebido. */
  saveTransfer(id: string): void {
    const t = this.transfers.get(id)
    if (t?.url) downloadUrl(t.url, t.file.name)
  }

  addSystemMessage(text: string): void {
    if (this.disposed) return
    this.pushMessage({
      kind: 'system',
      id: randomId(),
      text,
      ts: Date.now(),
      authorId: '',
      authorName: '',
      isLocal: false,
    })
    this.emitNow()
  }

  // ════════════════════════════════════════════════════════════════════
  //  Entrada: canal de controle
  // ════════════════════════════════════════════════════════════════════

  handleControl(fromId: string, msg: PeerMessage): void {
    if (this.disposed) return
    switch (msg.type) {
      case 'chat': {
        if (!isValidId(msg.id) || typeof msg.text !== 'string') return
        if (this.messages.some((m) => m.id === msg.id)) return
        const text = msg.text.trim().slice(0, MAX_TEXT_LENGTH)
        if (!text) return
        this.pushMessage({
          kind: 'text',
          id: msg.id,
          text,
          ts: Date.now(),
          authorId: fromId,
          authorName: sanitizeName(this.transport.peerName(fromId)),
          isLocal: false,
        })
        this.emitNow()
        return
      }
      case 'file-offer': {
        const meta = sanitizeMeta(msg.file)
        if (!isValidId(msg.id) || !meta) return
        this.ensureIncomingRecord(msg.id, fromId, meta, computeTotalChunks(meta.size))
        this.emitNow()
        return
      }
      case 'file-cancel': {
        if (!isValidId(msg.id)) return
        const tx = this.outgoing.get(msg.id)
        if (tx) {
          tx.canceledPeers.add(fromId)
          this.refreshOutgoing(tx)
          return
        }
        this.receivers.get(fromId)?.discard(msg.id)
        const current = this.transfers.get(msg.id)
        if (current && (current.status === 'pending' || current.status === 'transferring')) {
          this.patchTransfer(msg.id, { status: 'canceled' })
          this.emitNow()
        }
        return
      }
      default:
        return
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Entrada: canal dedicado de arquivos (serialization: 'raw')
  // ════════════════════════════════════════════════════════════════════

  acceptFileChannel(conn: DataConnection): void {
    if (this.disposed) {
      conn.close()
      return
    }
    this.inboundChannels.add(conn)
    const fromId = conn.peer

    const receiver = new PeerFileReceiver({
      onStart: (metadata) => {
        const current = this.transfers.get(metadata.fileId)
        if (current?.status === 'canceled') {
          receiver.discard(metadata.fileId)
          return
        }
        const meta: FileMeta = {
          name: metadata.name,
          size: metadata.size,
          mime: metadata.mimeType,
        }
        this.ensureIncomingRecord(metadata.fileId, fromId, meta, metadata.totalChunks)
        this.patchTransfer(metadata.fileId, {
          file: meta,
          status: 'transferring',
          chunksProcessed: 0,
          totalChunks: metadata.totalChunks,
          bytes: 0,
        })
        this.emitNow()
      },
      onProgress: (fileId, chunksProcessed, totalChunks, bytesReceived, rate) => {
        this.patchTransfer(fileId, {
          status: 'transferring',
          chunksProcessed,
          totalChunks,
          bytes: bytesReceived,
          rate,
        })
        this.scheduleEmit()
      },
      onComplete: (fileId, metadata, finalBlob) => {
        const url = this.createUrl(finalBlob)
        this.patchTransfer(fileId, {
          status: 'done',
          chunksProcessed: metadata.totalChunks,
          totalChunks: metadata.totalChunks,
          bytes: metadata.size,
          url,
        })
        this.emitNow()
        this.cb.onToast('info', `Arquivo "${metadata.name}" recebido no chat.`)
      },
      onAbort: (fileId) => {
        this.patchTransfer(fileId, { status: 'canceled' })
        this.emitNow()
      },
      onError: (fileId, message) => {
        this.patchTransfer(fileId, { status: 'error', error: message })
        this.cb.onToast('error', message)
        this.emitNow()
      },
    })

    this.receivers.set(fromId, receiver)
    receiver.attach(conn)

    conn.on('close', () => {
      this.inboundChannels.delete(conn)
      if (this.receivers.get(fromId) === receiver) {
        this.receivers.delete(fromId)
      }
    })
  }

  // ════════════════════════════════════════════════════════════════════
  //  Ciclo de vida dos pares
  // ════════════════════════════════════════════════════════════════════

  handlePeerLeft(peerId: string): void {
    const receiver = this.receivers.get(peerId)
    if (receiver) {
      receiver.discardAll('Falha na transferência do arquivo')
      this.receivers.delete(peerId)
    }
    this.failPendingFrom(peerId, 'Falha na transferência do arquivo')

    const channel = this.fileChannels.get(peerId)
    this.fileChannels.delete(peerId)
    this.sendQueues.delete(peerId)
    void channel?.then((c) => c.close()).catch(() => undefined)

    for (const tx of this.outgoing.values()) {
      if (tx.recipients.has(peerId) && !tx.finished.has(peerId)) {
        tx.failed.add(peerId)
        this.refreshOutgoing(tx)
      }
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.emitTimer !== null) window.clearTimeout(this.emitTimer)
    for (const tx of this.outgoing.values()) tx.canceled = true
    this.outgoing.clear()
    for (const r of this.receivers.values()) r.discardAll('Transferência encerrada')
    this.receivers.clear()
    for (const p of this.fileChannels.values()) void p.then((c) => c.close()).catch(() => undefined)
    this.fileChannels.clear()
    this.sendQueues.clear()
    for (const c of this.inboundChannels) c.close()
    this.inboundChannels.clear()
    const urls = [...this.objectUrls]
    this.objectUrls.clear()
    window.setTimeout(() => urls.forEach((u) => URL.revokeObjectURL(u)), 4000)
  }

  // ════════════════════════════════════════════════════════════════════
  //  Envio (Chunking de 16 KB + Backpressure 64 KB / 256 KB)
  // ════════════════════════════════════════════════════════════════════

  private startOutgoing(file: File, peers: ChatPeer[]): void {
    const id = randomId()
    const meta: FileMeta = {
      name: sanitizeFileName(file.name),
      size: file.size,
      mime: file.type || 'application/octet-stream',
    }
    const totalChunks = computeTotalChunks(file.size)
    const ts = Date.now()
    const tx: OutgoingTransfer = {
      id,
      file,
      meta,
      totalChunks,
      startedAt: performance.now(),
      recipients: new Set(peers.map((p) => p.id)),
      bytesByPeer: new Map(),
      chunksByPeer: new Map(),
      finished: new Set(),
      failed: new Set(),
      canceledPeers: new Set(),
      canceled: false,
    }
    this.outgoing.set(id, tx)
    this.transfers.set(id, {
      id,
      direction: 'send',
      file: meta,
      chunksProcessed: 0,
      totalChunks,
      bytes: 0,
      status: 'transferring',
      url: this.createUrl(file),
      rate: 0,
    })
    this.pushMessage({
      kind: 'file',
      id: `msg-${id}`,
      transferId: id,
      ts,
      authorId: this.transport.localId(),
      authorName: this.transport.localName(),
      isLocal: true,
    })

    for (const p of peers) {
      this.transport.sendControl(p.data, { type: 'file-offer', id, ts, file: meta })
      this.enqueuePeerSend(tx, p.id)
    }
  }

  private stopped(tx: OutgoingTransfer, peerId: string): boolean {
    return this.disposed || tx.canceled || tx.canceledPeers.has(peerId) || tx.failed.has(peerId)
  }

  /** Enfileira envios por destinatário para que pacotes de arquivos distintos nunca se intercalem. */
  private enqueuePeerSend(tx: OutgoingTransfer, peerId: string): void {
    const prev = this.sendQueues.get(peerId) ?? Promise.resolve()
    const next = prev
      .catch(() => undefined)
      .then(() => this.pumpToPeer(tx, peerId))
    this.sendQueues.set(peerId, next)
  }

  private async pumpToPeer(tx: OutgoingTransfer, peerId: string): Promise<void> {
    const shouldAbort = () => this.stopped(tx, peerId)
    if (shouldAbort()) {
      this.refreshOutgoing(tx)
      return
    }

    try {
      const conn = await this.getFileChannel(peerId)
      await sendFileOverDataChannel({
        fileId: tx.id,
        file: tx.file,
        conn,
        shouldAbort,
        onProgress: (chunksProcessed, _totalChunks, bytesSent) => {
          tx.chunksByPeer.set(peerId, chunksProcessed)
          tx.bytesByPeer.set(peerId, bytesSent)
          this.refreshOutgoing(tx, false)
        },
      })
      tx.chunksByPeer.set(peerId, tx.totalChunks)
      tx.bytesByPeer.set(peerId, tx.meta.size)
      tx.finished.add(peerId)
    } catch (err) {
      if (!tx.canceled && !tx.canceledPeers.has(peerId)) {
        console.warn('[discordia] falha ao enviar arquivo', err)
        tx.failed.add(peerId)
        this.cb.onToast('error', 'Falha na transferência do arquivo')
      }
    }
    this.refreshOutgoing(tx)
  }

  private getFileChannel(peerId: string): Promise<DataConnection> {
    const cached = this.fileChannels.get(peerId)
    if (cached) return cached

    const promise = new Promise<DataConnection>((resolve, reject) => {
      const conn = this.transport.openFileChannel(peerId)
      if (!conn) {
        reject(new Error('Falha na transferência do arquivo'))
        return
      }
      const timer = window.setTimeout(() => {
        conn.close()
        reject(new Error('Falha na transferência do arquivo'))
      }, FILE_CHANNEL_OPEN_TIMEOUT_MS)

      conn.on('open', () => {
        window.clearTimeout(timer)
        if (conn.dataChannel) configureRawDataChannel(conn.dataChannel)
        resolve(conn)
      })
      conn.on('error', (err) => {
        window.clearTimeout(timer)
        if (this.fileChannels.get(peerId) === promise) this.fileChannels.delete(peerId)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
      conn.on('close', () => {
        window.clearTimeout(timer)
        if (this.fileChannels.get(peerId) === promise) this.fileChannels.delete(peerId)
        reject(new Error('Falha na transferência do arquivo'))
      })
    })

    this.fileChannels.set(peerId, promise)
    promise.catch(() => {
      if (this.fileChannels.get(peerId) === promise) this.fileChannels.delete(peerId)
    })
    return promise
  }

  private refreshOutgoing(tx: OutgoingTransfer, immediate = true): void {
    const record = this.transfers.get(tx.id)
    if (!record || record.status === 'canceled') return

    const active = [...tx.recipients].filter((id) => !tx.failed.has(id) && !tx.canceledPeers.has(id))
    const settled = [...tx.recipients].every(
      (id) => tx.finished.has(id) || tx.failed.has(id) || tx.canceledPeers.has(id),
    )

    const bytes = active.length > 0 ? Math.min(...active.map((id) => tx.bytesByPeer.get(id) ?? 0)) : record.bytes
    const chunksProcessed =
      active.length > 0 ? Math.min(...active.map((id) => tx.chunksByPeer.get(id) ?? 0)) : record.chunksProcessed

    const elapsed = (performance.now() - tx.startedAt) / 1000
    const patch: Partial<FileTransfer> = {
      bytes,
      chunksProcessed,
      totalChunks: tx.totalChunks,
      rate: elapsed > 0 ? bytes / elapsed : 0,
    }

    if (settled) {
      this.outgoing.delete(tx.id)
      if (tx.finished.size > 0) {
        patch.status = 'done'
        patch.bytes = tx.meta.size
        patch.chunksProcessed = tx.totalChunks
        if (tx.failed.size > 0) patch.error = `Não entregue para ${tx.failed.size} pessoa(s).`
      } else if (tx.failed.size > 0) {
        patch.status = 'error'
        patch.error = 'Falha na transferência do arquivo'
      } else {
        patch.status = 'canceled'
      }
    }

    this.patchTransfer(tx.id, patch)
    if (immediate || settled) this.emitNow()
    else this.scheduleEmit()
  }

  // ════════════════════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════════════════════

  private ensureIncomingRecord(id: string, fromId: string, meta: FileMeta, totalChunks: number): void {
    if (this.transfers.has(id)) return
    this.transfers.set(id, {
      id,
      direction: 'receive',
      file: meta,
      chunksProcessed: 0,
      totalChunks,
      bytes: 0,
      status: 'pending',
      url: null,
      rate: 0,
    })
    this.pushMessage({
      kind: 'file',
      id: `msg-${id}`,
      transferId: id,
      ts: Date.now(),
      authorId: fromId,
      authorName: sanitizeName(this.transport.peerName(fromId)),
      isLocal: false,
    })
  }

  private failPendingFrom(peerId: string, error: string): void {
    for (const t of this.transfers.values()) {
      if (t.direction === 'receive' && (t.status === 'pending' || t.status === 'transferring')) {
        const msg = this.messages.find((m) => m.kind === 'file' && m.transferId === t.id)
        if (msg?.authorId === peerId) {
          this.patchTransfer(t.id, { status: 'error', error })
        }
      }
    }
    this.emitNow()
  }

  private patchTransfer(id: string, patch: Partial<FileTransfer>): void {
    const current = this.transfers.get(id)
    if (current) this.transfers.set(id, { ...current, ...patch })
  }

  private pushMessage(msg: ChatMessage): void {
    this.messages = [...this.messages, msg]
    if (this.messages.length > MAX_MESSAGES) {
      const removed = this.messages.slice(0, this.messages.length - MAX_MESSAGES)
      this.messages = this.messages.slice(-MAX_MESSAGES)
      for (const m of removed) {
        if (m.kind !== 'file') continue
        const t = this.transfers.get(m.transferId)
        if (t && t.status !== 'transferring' && t.status !== 'pending') {
          if (t.url) {
            URL.revokeObjectURL(t.url)
            this.objectUrls.delete(t.url)
          }
          this.transfers.delete(m.transferId)
        }
      }
    }
  }

  private createUrl(blob: Blob): string {
    const url = URL.createObjectURL(blob)
    this.objectUrls.add(url)
    return url
  }

  private scheduleEmit(): void {
    if (this.emitTimer !== null || this.disposed) return
    this.emitTimer = window.setTimeout(() => {
      this.emitTimer = null
      this.emitNow()
    }, EMIT_THROTTLE_MS)
  }

  private emitNow(): void {
    if (this.disposed) return
    if (this.emitTimer !== null) {
      window.clearTimeout(this.emitTimer)
      this.emitTimer = null
    }
    this.cb.onChange({ messages: this.messages, transfers: Object.fromEntries(this.transfers) })
  }
}
