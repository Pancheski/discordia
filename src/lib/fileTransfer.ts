import type { DataConnection } from 'peerjs'
import { readSlice, sanitizeFileName } from './fileUtils'
import type { FileControlPacket, FileStartPacket } from '../types'

/**
 * PROTOCOLO DE TRANSFERÊNCIA DE ARQUIVOS P2P SEM CORRUPÇÃO (WebRTC DataChannel)
 * ──────────────────────────────────────────────────────────────────────────────
 * Por que a implementação anterior corrompia arquivos?
 *   1. O modo padrão `serialization: 'binary'` do PeerJS empacota cada mensagem com BinaryPack
 *      e, quando o payload passa de `chunkedMTU` (16.300 bytes), re-fatia recursivamente em
 *      sub-blocos sem controle de backpressure, descartando/embaralhando bytes no buffer SCTP.
 *   2. Disparar leituras sem aguardar `dataChannel.onbufferedamountlow` estoura a fila de envio
 *      do SCTP (`bufferedAmount`), causando perda silenciosa ou fechamento abrupto do canal.
 *
 * Solução implementada aqui:
 *   • Canal aberto com `serialization: 'raw'` e `dataChannel.binaryType = 'arraybuffer'`
 *     (zero interferência do BinaryPack do PeerJS — os bytes chegam idênticos bit a bit).
 *   • Tamanho de bloco seguro para MTU SCTP/WebRTC: **16 KB (16.384 bytes)**.
 *   • Backpressure estrito via `bufferedAmount`:
 *       - `dataChannel.bufferedAmountLowThreshold = 65536` (64 KB)
 *       - Se `dataChannel.bufferedAmount > 262144` (256 KB), pausa a leitura e aguarda o
 *         evento `dataChannel.onbufferedamountlow` antes de enviar o próximo chunk.
 *   • Protocolo estruturado:
 *       1. Header JSON (`type: "file-start"`) com `fileId`, `name`, `size`, `mimeType`, `totalChunks`
 *       2. `totalChunks` pacotes binários (`ArrayBuffer` puro de até 16.384 bytes)
 *       3. Pacote de conclusão JSON (`type: "file-end"`, `fileId`) que dispara `new Blob(receivedChunks)`
 */

/** 16 KB (16.384 bytes) — abaixo do MTU de fragmentação SCTP dos navegadores. */
export const FILE_CHUNK_SIZE = 16_384

/** 64 KB (65.536 bytes) — limiar em que `onbufferedamountlow` é disparado. */
export const BUFFER_LOW_THRESHOLD = 65_536

/** 256 KB (262.144 bytes) — limite máximo no buffer antes de pausar o envio. */
export const BUFFER_HIGH_THRESHOLD = 262_144

export function computeTotalChunks(byteLength: number): number {
  if (byteLength <= 0) return 0
  return Math.ceil(byteLength / FILE_CHUNK_SIZE)
}

/** Configura o RTCDataChannel subjacente para transmissão binária pura com backpressure. */
export function configureRawDataChannel(dc: RTCDataChannel): void {
  dc.binaryType = 'arraybuffer'
  dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD
}

/**
 * Aguarda o buffer do `RTCDataChannel` drenar quando `bufferedAmount > 262144` (256 KB),
 * usando `dataChannel.onbufferedamountlow` (disparado ao atingir 64 KB).
 */
export function waitForBufferDrain(dc: RTCDataChannel, shouldAbort: () => boolean): Promise<void> {
  if (dc.readyState !== 'open') {
    return Promise.reject(new Error('DataChannel fechado durante a transferência'))
  }
  if (shouldAbort() || dc.bufferedAmount <= BUFFER_HIGH_THRESHOLD) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD

    const cleanup = () => {
      dc.onbufferedamountlow = null
      dc.removeEventListener('close', onClose)
      dc.removeEventListener('error', onClose)
    }

    const onLow = () => {
      if (dc.bufferedAmount <= BUFFER_HIGH_THRESHOLD || shouldAbort()) {
        cleanup()
        resolve()
      }
    }

    const onClose = () => {
      cleanup()
      reject(new Error('DataChannel fechado durante o controle de backpressure'))
    }

    dc.onbufferedamountlow = onLow
    dc.addEventListener('close', onClose, { once: true })
    dc.addEventListener('error', onClose, { once: true })
  })
}

/** Aguarda o buffer esvaziar completamente antes de fechar ou concluir. */
function waitForCompleteFlush(dc: RTCDataChannel, shouldAbort: () => boolean): Promise<void> {
  if (dc.readyState !== 'open' || dc.bufferedAmount === 0 || shouldAbort()) {
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    dc.bufferedAmountLowThreshold = 0
    const finish = () => {
      window.clearTimeout(timer)
      dc.onbufferedamountlow = null
      dc.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD
      resolve()
    }
    const timer = window.setTimeout(finish, 150)
    dc.onbufferedamountlow = finish
  })
}

export interface SendFileOptions {
  fileId: string
  file: File
  conn: DataConnection
  shouldAbort: () => boolean
  onProgress: (chunksProcessed: number, totalChunks: number, bytesSent: number) => void
}

/**
 * Transmite um arquivo inteiro pelo `RTCDataChannel` em blocos de 16 KB (16.384 bytes)
 * com controle de vazão (`bufferedAmount` / `onbufferedamountlow`).
 */
export async function sendFileOverDataChannel(options: SendFileOptions): Promise<void> {
  const { fileId, file, conn, shouldAbort, onProgress } = options
  const dc = conn.dataChannel
  if (!conn.open || !dc || dc.readyState !== 'open') {
    throw new Error('Canal de dados não está aberto')
  }

  configureRawDataChannel(dc)

  const totalChunks = computeTotalChunks(file.size)
  const startPacket: FileStartPacket = {
    type: 'file-start',
    fileId,
    name: sanitizeFileName(file.name),
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    totalChunks,
  }

  // 1. Envia Pacote de Início (Header JSON)
  dc.send(JSON.stringify(startPacket))

  // 2. Envia Pacotes de Dados (ArrayBuffer puro de 16 KB) com Backpressure
  let offset = 0
  let chunksProcessed = 0

  while (offset < file.size) {
    if (shouldAbort()) {
      sendAbortPacket(dc, fileId)
      throw new Error('Transferência cancelada')
    }

    if (dc.bufferedAmount > BUFFER_HIGH_THRESHOLD) {
      await waitForBufferDrain(dc, shouldAbort)
    }

    if (shouldAbort()) {
      sendAbortPacket(dc, fileId)
      throw new Error('Transferência cancelada')
    }

    const end = Math.min(offset + FILE_CHUNK_SIZE, file.size)
    const chunkBuffer = await readSlice(file, offset, end)

    if (shouldAbort()) {
      sendAbortPacket(dc, fileId)
      throw new Error('Transferência cancelada')
    }
    if (dc.readyState !== 'open') {
      throw new Error('Falha na transferência do arquivo')
    }

    dc.send(chunkBuffer)
    offset = end
    chunksProcessed++
    onProgress(chunksProcessed, totalChunks, offset)
  }

  // Garante que todos os chunks saíram para o buffer de rede antes do pacote de conclusão
  await waitForCompleteFlush(dc, shouldAbort)

  if (shouldAbort()) {
    sendAbortPacket(dc, fileId)
    throw new Error('Transferência cancelada')
  }

  // 3. Envia Pacote de Conclusão
  dc.send(JSON.stringify({ type: 'file-end', fileId }))
}

function sendAbortPacket(dc: RTCDataChannel, fileId: string): void {
  try {
    if (dc.readyState === 'open') {
      dc.send(JSON.stringify({ type: 'file-abort', fileId }))
    }
  } catch {
    /* ignore */
  }
}

// ════════════════════════════════════════════════════════════════════
//  Receptor de Arquivos (Destinatário)
// ════════════════════════════════════════════════════════════════════

export interface IncomingFileState {
  metadata: FileStartPacket
  chunks: ArrayBuffer[]
  chunksProcessed: number
  bytesReceived: number
  startedAt: number
}

export interface FileReceiverCallbacks {
  onStart: (metadata: FileStartPacket) => void
  onProgress: (fileId: string, chunksProcessed: number, totalChunks: number, bytesReceived: number, rate: number) => void
  onComplete: (fileId: string, metadata: FileStartPacket, blob: Blob) => void
  onAbort: (fileId: string) => void
  onError: (fileId: string, message: string) => void
}

/**
 * Gerencia a recepção de arquivos em um `RTCDataChannel` (um por par remetente).
 * Vincula os `ArrayBuffer`s recebidos ao `fileId` em uma lista ordenada `chunks: ArrayBuffer[]`
 * e reconstrói o `Blob` íntegro ao receber `file-end`.
 */
export class PeerFileReceiver {
  private readonly transfers = new Map<string, IncomingFileState>()
  private activeFileId: string | null = null
  private readonly cb: FileReceiverCallbacks
  private messageQueue: Promise<void> = Promise.resolve()

  constructor(callbacks: FileReceiverCallbacks) {
    this.cb = callbacks
  }

  /** Anexa os listeners diretamente ao `RTCDataChannel` com `binaryType = "arraybuffer"`. */
  attach(conn: DataConnection): void {
    const dc = conn.dataChannel
    if (dc) {
      configureRawDataChannel(dc)
    }

    conn.on('data', (raw) => {
      // Enfileira para garantir ordem estrita caso algum browser entregue Blob assíncrono
      this.messageQueue = this.messageQueue
        .then(() => this.processMessage(raw))
        .catch((err) => console.warn('[discordia] erro ao processar pacote de arquivo', err))
    })

    conn.on('close', () => this.discardAll('Falha na transferência do arquivo'))
    conn.on('error', () => this.discardAll('Falha na transferência do arquivo'))
  }

  /** Descarta um arquivo específico (ex.: cancelamento pelo usuário). */
  discard(fileId: string): void {
    const state = this.transfers.get(fileId)
    if (state) {
      state.chunks = []
      this.transfers.delete(fileId)
    }
    if (this.activeFileId === fileId) {
      this.activeFileId = null
    }
  }

  /** Se a conexão cair no meio, descarta todos os pedaços parciais e notifica erro. */
  discardAll(reason = 'Falha na transferência do arquivo'): void {
    for (const [fileId, state] of this.transfers.entries()) {
      state.chunks = []
      this.cb.onError(fileId, reason)
    }
    this.transfers.clear()
    this.activeFileId = null
  }

  private async processMessage(raw: unknown): Promise<void> {
    // 1) Pacote de Controle JSON (string ou objeto já parseado)
    if (typeof raw === 'string') {
      this.handleControlPacket(raw)
      return
    }

    if (raw && typeof raw === 'object' && !(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw) && !(raw instanceof Blob)) {
      if ('type' in raw) {
        this.handleParsedControl(raw as FileControlPacket)
      }
      return
    }

    // 2) Pacote Binário (ArrayBuffer puro de 16 KB)
    const buffer = await toArrayBuffer(raw)
    if (!buffer) return

    const fileId = this.activeFileId
    if (!fileId) return
    const state = this.transfers.get(fileId)
    if (!state) return

    state.chunks.push(buffer)
    state.chunksProcessed++
    state.bytesReceived += buffer.byteLength

    if (state.bytesReceived > state.metadata.size || state.chunksProcessed > state.metadata.totalChunks) {
      state.chunks = []
      this.transfers.delete(fileId)
      this.activeFileId = null
      this.cb.onError(fileId, 'Falha na transferência do arquivo')
      return
    }

    const elapsedSec = (performance.now() - state.startedAt) / 1000
    const rate = elapsedSec > 0 ? state.bytesReceived / elapsedSec : 0
    this.cb.onProgress(
      fileId,
      state.chunksProcessed,
      state.metadata.totalChunks,
      state.bytesReceived,
      rate,
    )
  }

  private handleControlPacket(jsonText: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      return
    }
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) return
    this.handleParsedControl(parsed as FileControlPacket)
  }

  private handleParsedControl(pkt: FileControlPacket): void {
    switch (pkt.type) {
      case 'file-start': {
        if (!pkt.fileId || typeof pkt.size !== 'number' || pkt.size < 0) return
        const totalChunks =
          typeof pkt.totalChunks === 'number' && pkt.totalChunks >= 0
            ? pkt.totalChunks
            : computeTotalChunks(pkt.size)
        const metadata: FileStartPacket = {
          type: 'file-start',
          fileId: pkt.fileId,
          name: sanitizeFileName(pkt.name),
          size: pkt.size,
          mimeType: typeof pkt.mimeType === 'string' && pkt.mimeType ? pkt.mimeType : 'application/octet-stream',
          totalChunks,
        }
        this.transfers.set(metadata.fileId, {
          metadata,
          chunks: [],
          chunksProcessed: 0,
          bytesReceived: 0,
          startedAt: performance.now(),
        })
        this.activeFileId = metadata.fileId
        this.cb.onStart(metadata)
        return
      }

      case 'file-end': {
        const state = this.transfers.get(pkt.fileId)
        if (!state) return
        this.transfers.delete(pkt.fileId)
        if (this.activeFileId === pkt.fileId) this.activeFileId = null

        const { metadata, chunks: receivedChunks, bytesReceived, chunksProcessed } = state
        if (bytesReceived !== metadata.size || chunksProcessed !== metadata.totalChunks) {
          state.chunks = []
          this.cb.onError(pkt.fileId, 'Falha na transferência do arquivo')
          return
        }

        // Reconstrói o arquivo íntegro em um único Blob a partir dos ArrayBuffers ordenados
        const finalBlob = new Blob(receivedChunks, {
          type: metadata.mimeType || 'application/octet-stream',
        })
        state.chunks = []
        this.cb.onComplete(pkt.fileId, metadata, finalBlob)
        return
      }

      case 'file-abort': {
        this.discard(pkt.fileId)
        this.cb.onAbort(pkt.fileId)
        return
      }

      default:
        return
    }
  }
}

async function toArrayBuffer(raw: unknown): Promise<ArrayBuffer | null> {
  if (raw instanceof ArrayBuffer) return raw
  if (ArrayBuffer.isView(raw)) {
    // Cria uma cópia exata da fatia (evita incluir bytes extras de um underlying buffer compartilhado)
    const copy = new Uint8Array(raw.byteLength)
    copy.set(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength))
    return copy.buffer
  }
  if (raw instanceof Blob) {
    return await raw.arrayBuffer()
  }
  return null
}

