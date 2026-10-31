import Peer from 'peerjs'
import type { DataConnection, MediaConnection } from 'peerjs'
import { LocalSpeakingDetector, RemoteSpeakingDetector, closeAudioContext, createSilentStream } from './audio'
import { getIceServers } from './iceConfig'
import { tuneScreenSdp, tuneSenders, tuneVoiceSdp } from './rtc'
import { MAX_PEERS, clamp, sanitizeName, slotPeerId, slugifyRoom } from './utils'
import type {
  LocalState,
  MediaKind,
  PeerMessage,
  RemoteParticipant,
  RoomSnapshot,
  RoomStatus,
  ToastKind,
} from '../types'

/**
 * ARQUITETURA
 * ───────────
 * • Descoberta sem backend: cada sala tem MAX_PEERS "assentos" com IDs determinísticos
 *   (`discordia-v1-<sala>-<0..5>`) no servidor público do PeerJS.
 * • Malha completa (mesh): um DataConnection de controle por par (nome, mute, tela, bye).
 * • Mídia em conexões INDEPENDENTES e unidirecionais:
 *     - "mic": voz em 64 kbps, FEC habilitado, sem DTX (elimina picotes/cortes).
 *     - "screen": tela em até 12 Mbps / 60fps com maintain-resolution e som estéreo a 256 kbps.
 * • Deteção de fala remota via estatísticas RTP nativas (RFC 6464), sem AudioContext para
 *   evitar clock drift e stuttering na reprodução.
 */

interface PeerLink {
  id: string
  data: DataConnection | null
  micOut: MediaConnection | null
  screenOut: MediaConnection | null
  micIn: MediaConnection | null
  screenIn: MediaConnection | null
  detector: RemoteSpeakingDetector | null
  teardownTimer: number | null
  greeted: boolean
  info: RemoteParticipant
}

interface PeerErrorLike {
  type: string
  message: string
}

export interface RoomManagerCallbacks {
  onChange: (snapshot: RoomSnapshot) => void
  onToast: (kind: ToastKind, message: string) => void
}

const DISCOVERY_INTERVAL_MS = 6000
const CONNECT_TIMEOUT_MS = 8000
const CLAIM_TIMEOUT_MS = 12000
const DATA_TEARDOWN_GRACE_MS = 2500
const ORPHAN_LINK_TIMEOUT_MS = 15000
const JOIN_QUIET_PERIOD_MS = 3500
const EMPTY_SLOT_COOLDOWN_MS = 24000

function isPeerError(err: unknown): err is PeerErrorLike {
  return typeof err === 'object' && err !== null && 'type' in err && typeof (err as PeerErrorLike).type === 'string'
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (isPeerError(err)) return `${err.type}: ${err.message}`
  return String(err)
}

export class RoomManager {
  private readonly cb: RoomManagerCallbacks
  private peer: Peer | null = null
  private readonly links = new Map<string, PeerLink>()
  private readonly pending = new Map<string, DataConnection>()
  private readonly emptySlotCooldowns = new Map<string, number>()
  private reconnectAttempts = 0
  private reconnectTimer: number | null = null
  private micStream: MediaStream | null = null
  private screenStream: MediaStream | null = null
  private localDetector: LocalSpeakingDetector | null = null
  private discoveryTimer: number | null = null
  private destroyed = false
  private joinedAt = 0
  private lastSignalWarnAt = 0
  private room = ''
  private status: RoomStatus = 'idle'
  private local: LocalState = {
    peerId: '',
    name: '',
    slot: -1,
    muted: false,
    micAvailable: false,
    speaking: false,
    screenStream: null,
    screenHasAudio: false,
  }

  constructor(callbacks: RoomManagerCallbacks) {
    this.cb = callbacks
  }

  // ════════════════════════════════════════════════════════════════════
  //  API pública
  // ════════════════════════════════════════════════════════════════════

  async join(name: string, rawRoom: string): Promise<boolean> {
    const room = slugifyRoom(rawRoom)
    if (!room) {
      this.toast('error', 'Nome de sala inválido. Use letras e números.')
      return false
    }
    this.room = room
    this.local.name = sanitizeName(name)
    this.status = 'connecting'
    this.emit()

    // 1) Microfone (sem ele entra como ouvinte)
    await this.acquireMicrophone(true)
    if (this.destroyed) return false

    // 2) Reivindica um assento livre na sala
    let lastError: unknown = null
    for (let slot = 0; slot < MAX_PEERS; slot++) {
      if (this.destroyed) return false
      try {
        const peer = await this.claimSlot(slotPeerId(room, slot))
        if (this.destroyed) {
          peer.destroy()
          return false
        }
        this.peer = peer
        this.local.slot = slot
        this.local.peerId = peer.id
        break
      } catch (err) {
        if (isPeerError(err) && err.type === 'unavailable-id') continue
        lastError = err
        break
      }
    }

    if (!this.peer) {
      this.toast(
        'error',
        lastError
          ? `Não foi possível conectar ao servidor de sinalização (${describeError(lastError)}).`
          : `A sala "${room}" está cheia (máximo de ${MAX_PEERS} pessoas).`,
      )
      this.releaseLocalMedia()
      this.status = 'error'
      this.emit()
      return false
    }

    // 3) Escuta eventos e descobre os outros participantes
    this.bindPeerEvents(this.peer)
    this.status = 'connected'
    this.joinedAt = Date.now()
    window.addEventListener('pagehide', this.handleUnload)
    window.addEventListener('beforeunload', this.handleUnload)
    this.discover()
    this.discoveryTimer = window.setInterval(() => this.discover(), DISCOVERY_INTERVAL_MS)
    this.emit()
    return true
  }

  toggleMute(): void {
    if (this.destroyed) return
    if (!this.local.micAvailable) {
      void this.acquireMicrophone(false).then(() => this.emit())
      return
    }
    const track = this.micStream?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    this.local.muted = !track.enabled
    if (this.local.muted) this.local.speaking = false
    this.broadcastState()
    this.emit()
  }

  async startScreenShare(): Promise<void> {
    if (this.destroyed || this.screenStream) return
    const md = navigator.mediaDevices
    if (!md?.getDisplayMedia) {
      this.toast(
        'error',
        'Seu navegador não suporta compartilhamento de tela (getDisplayMedia). Use Chrome, Edge ou Firefox no desktop.',
      )
      return
    }

    let stream: MediaStream
    try {
      const options = {
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920, max: 3840 },
          height: { ideal: 1080, max: 2160 },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: false,
          channelCount: 2,
          sampleRate: 48000,
        },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
        surfaceSwitching: 'include',
        preferCurrentTab: false,
      } as DisplayMediaStreamOptions
      stream = await md.getDisplayMedia(options)
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotAllowedError' || name === 'AbortError') {
        this.toast('info', 'Compartilhamento de tela cancelado.')
      } else if (name === 'NotReadableError') {
        this.toast('error', 'Não foi possível capturar a tela (fonte em uso ou bloqueada pelo sistema).')
      } else {
        this.toast('error', `Falha ao compartilhar tela: ${describeError(err)}`)
      }
      return
    }

    if (this.destroyed) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }

    const videoTrack = stream.getVideoTracks()[0]
    if (videoTrack) {
      // 'detail' informa ao encoder para preservar texto nítido e definição máxima de pixels
      videoTrack.contentHint = 'detail'
      videoTrack.addEventListener('ended', () => this.stopScreenShare())
    }

    const hasAudio = stream.getAudioTracks().length > 0
    if (!hasAudio) {
      this.toast(
        'warning',
        'Transmitindo sem áudio. Para incluir som, marque "Compartilhar áudio" na janela de seleção do Chrome/Edge.',
      )
    } else {
      stream.getAudioTracks().forEach((t) => {
        t.contentHint = 'music'
      })
    }

    this.screenStream = stream
    this.local.screenHasAudio = hasAudio
    for (const link of this.links.values()) {
      if (link.data?.open) this.callPeer(link, 'screen')
    }
    this.broadcastState()
    this.toast('success', 'Você está transmitindo sua tela em 60 fps e alta nitidez.')
    this.emit()
  }

  stopScreenShare(silent = false): void {
    const stream = this.screenStream
    if (!stream) return
    this.screenStream = null
    this.local.screenHasAudio = false
    stream.getTracks().forEach((t) => t.stop())
    for (const link of this.links.values()) {
      if (link.screenOut) {
        const call = link.screenOut
        link.screenOut = null
        call.close()
      }
    }
    if (!this.destroyed) {
      this.broadcastState()
      if (!silent) this.toast('info', 'Transmissão de tela encerrada.')
      this.emit()
    }
  }

  setParticipantVolume(peerId: string, kind: MediaKind, value: number): void {
    const link = this.links.get(peerId)
    if (!link) return
    if (kind === 'mic') link.info.voiceVolume = clamp(value)
    else link.info.screenVolume = clamp(value)
    this.emit()
  }

  leave(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('pagehide', this.handleUnload)
    window.removeEventListener('beforeunload', this.handleUnload)
    if (this.discoveryTimer !== null) {
      window.clearInterval(this.discoveryTimer)
      this.discoveryTimer = null
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    for (const link of this.links.values()) {
      if (link.data) this.send(link.data, { type: 'bye' })
    }

    this.stopScreenShare(true)

    for (const id of [...this.links.keys()]) {
      this.destroyLink(id)
    }
    for (const conn of this.pending.values()) conn.close()
    this.pending.clear()
    this.emptySlotCooldowns.clear()

    this.releaseLocalMedia()

    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
    void closeAudioContext()
    this.status = 'idle'
  }

  // ════════════════════════════════════════════════════════════════════
  //  Mídia local
  // ════════════════════════════════════════════════════════════════════

  private async acquireMicrophone(initial: boolean): Promise<boolean> {
    let stream: MediaStream | null = null
    const md = navigator.mediaDevices

    if (!md?.getUserMedia) {
      this.toast(
        'error',
        'Acesso ao microfone indisponível. É necessário HTTPS (ou localhost) e um navegador compatível.',
      )
    } else {
      try {
        const devices = await md.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
        if (devices.length > 0 && !devices.some((d) => d.kind === 'audioinput')) {
          throw new DOMException('Nenhum dispositivo de entrada de áudio', 'NotFoundError')
        }
        stream = await md.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            // autoGainControl DESATIVADO evita o bombeamento dinâmico que corta o início/fim das palavras
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 16,
          },
          video: false,
        })
      } catch (err) {
        this.reportMicError(err)
      }
    }

    if (this.destroyed) {
      stream?.getTracks().forEach((t) => t.stop())
      return false
    }

    if (stream) {
      const track = stream.getAudioTracks()[0]
      track.contentHint = 'speech'
      track.addEventListener('ended', () => {
        if (this.destroyed || this.micStream !== stream) return
        this.toast('warning', 'Microfone desconectado. Clique no botão do microfone para reconectar.')
        this.useSilentMicrophone()
        this.emit()
      })
      this.swapMicStream(stream)
      this.local.micAvailable = true
      this.local.muted = false
      this.restartLocalDetector()
      if (!initial) {
        this.toast('success', 'Microfone ativado.')
        this.broadcastState()
      }
      return true
    }

    if (!this.micStream) this.useSilentMicrophone()
    return false
  }

  private useSilentMicrophone(): void {
    this.swapMicStream(createSilentStream())
    this.local.micAvailable = false
    this.local.muted = true
    this.local.speaking = false
    this.localDetector?.stop()
    this.localDetector = null
    this.broadcastState()
  }

  private swapMicStream(next: MediaStream): void {
    const previous = this.micStream
    this.micStream = next
    const newTrack = next.getAudioTracks()[0] ?? null
    for (const link of this.links.values()) {
      const pc = link.micOut?.peerConnection
      if (!pc) continue
      const sender = pc.getSenders().find((s) => s.track?.kind === 'audio') ?? pc.getSenders()[0]
      if (sender) void sender.replaceTrack(newTrack).catch((e) => console.warn('[discordia] replaceTrack', e))
    }
    previous?.getTracks().forEach((t) => t.stop())
  }

  private restartLocalDetector(): void {
    this.localDetector?.stop()
    this.localDetector = null
    if (!this.micStream || !this.local.micAvailable) return
    try {
      this.localDetector = new LocalSpeakingDetector(this.micStream, (speaking) => {
        this.local.speaking = speaking && !this.local.muted
        this.emit()
      })
    } catch (err) {
      console.warn('[discordia] detector local indisponível', err)
    }
  }

  private reportMicError(err: unknown): void {
    const name = err instanceof DOMException ? err.name : ''
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        this.toast(
          'warning',
          'Permissão de microfone negada. Você entrou como ouvinte — clique no microfone para tentar de novo.',
        )
        break
      case 'NotFoundError':
      case 'OverconstrainedError':
        this.toast('warning', 'Nenhum microfone detectado. Você entrou como ouvinte.')
        break
      case 'NotReadableError':
        this.toast('error', 'O microfone está em uso por outro aplicativo ou bloqueado pelo sistema.')
        break
      default:
        this.toast('error', `Erro ao acessar o microfone: ${describeError(err)}`)
    }
  }

  private releaseLocalMedia(): void {
    this.localDetector?.stop()
    this.localDetector = null
    this.micStream?.getTracks().forEach((t) => t.stop())
    this.micStream = null
    this.screenStream?.getTracks().forEach((t) => t.stop())
    this.screenStream = null
  }

  // ════════════════════════════════════════════════════════════════════
  //  Sinalização / descoberta
  // ════════════════════════════════════════════════════════════════════

  private async claimSlot(id: string): Promise<Peer> {
    const iceServers = await getIceServers()
    const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:'

    return new Promise((resolve, reject) => {
      const peer = new Peer(id, {
        debug: 1,
        secure: isHttps,
        config: {
          iceServers,
          iceCandidatePoolSize: 10,
          bundlePolicy: 'max-bundle',
          rtcpMuxPolicy: 'require',
        },
      })
      let settled = false
      const finish = (err?: unknown) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        peer.off('open', onOpen)
        peer.off('error', onError)
        if (err) {
          peer.destroy()
          reject(err)
        } else {
          resolve(peer)
        }
      }
      const onOpen = () => finish()
      const onError = (err: unknown) => finish(err ?? new Error('erro desconhecido'))
      const timer = window.setTimeout(
        () => finish(new Error('tempo esgotado ao contatar o servidor PeerJS')),
        CLAIM_TIMEOUT_MS,
      )
      peer.on('open', onOpen)
      peer.on('error', onError)
    })
  }

  private scheduleReconnect(): void {
    if (this.destroyed || !this.peer || this.peer.destroyed || this.reconnectTimer !== null) return
    const delay = Math.min(1200 * Math.pow(1.4, this.reconnectAttempts), 8000)
    this.reconnectAttempts++
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      if (this.destroyed || !this.peer || this.peer.destroyed || !this.peer.disconnected) return
      try {
        this.peer.reconnect()
      } catch (err) {
        console.warn('[discordia] reconnect error', err)
        this.scheduleReconnect()
      }
    }, delay)
  }

  private bindPeerEvents(peer: Peer): void {
    peer.on('connection', (conn) => {
      if (this.destroyed) {
        conn.close()
        return
      }
      this.emptySlotCooldowns.delete(conn.peer)
      conn.on('open', () => this.attachData(conn, 'in'))
      conn.on('error', (err) => console.warn('[discordia] data (in)', err))
    })

    peer.on('call', (call) => this.handleIncomingCall(call))

    peer.on('open', () => {
      if (this.reconnectAttempts > 0) {
        this.reconnectAttempts = 0
        this.toast('success', 'Reconectado ao servidor de sinalização!')
      }
    })

    peer.on('disconnected', () => {
      if (this.destroyed || peer.destroyed) return
      this.scheduleReconnect()
    })

    peer.on('error', (err: unknown) => this.handlePeerError(err))
  }

  private handlePeerError(err: unknown): void {
    if (!isPeerError(err)) {
      console.warn('[discordia] erro desconhecido', err)
      return
    }
    switch (err.type) {
      case 'peer-unavailable': {
        const match = /peer\s+([\w-]+)/i.exec(err.message)
        if (match) {
          const peerId = match[1]
          this.emptySlotCooldowns.set(peerId, Date.now() + EMPTY_SLOT_COOLDOWN_MS)
          const conn = this.pending.get(peerId)
          if (conn) {
            this.pending.delete(peerId)
            conn.close()
          }
        }
        return
      }
      case 'network':
      case 'socket-error':
      case 'socket-closed':
      case 'server-error':
      case 'disconnected': {
        const now = Date.now()
        if (now - this.lastSignalWarnAt > 15000) {
          this.lastSignalWarnAt = now
          this.toast('warning', 'Conexão com o servidor de sinalização instável. Reconectando...')
        }
        this.scheduleReconnect()
        return
      }
      case 'browser-incompatible':
        this.toast('error', 'Seu navegador não suporta WebRTC.')
        return
      case 'webrtc':
        console.warn('[discordia] webrtc', err.message)
        return
      default:
        console.warn('[discordia] peer error', err.type, err.message)
    }
  }

  private discover(): void {
    const peer = this.peer
    if (this.destroyed || !peer || peer.destroyed || peer.disconnected) return

    const now = Date.now()
    for (let slot = 0; slot < MAX_PEERS; slot++) {
      const id = slotPeerId(this.room, slot)
      if (id === this.local.peerId) continue
      const link = this.links.get(id)
      if (link?.data?.open) {
        if (!link.micOut) this.callPeer(link, 'mic')
        if (this.screenStream && !link.screenOut) this.callPeer(link, 'screen')
        continue
      }
      if (this.pending.has(id)) continue

      // Respeita cooldown para assentos vazios (economiza CPU e rede)
      const cd = this.emptySlotCooldowns.get(id)
      if (cd && now < cd) continue

      this.connectTo(id)
    }
  }

  private connectTo(id: string): void {
    const peer = this.peer
    if (!peer) return
    const conn = peer.connect(id, { reliable: true, metadata: { name: this.local.name } })
    if (!conn) return
    this.pending.set(id, conn)

    const clear = () => {
      window.clearTimeout(timer)
      if (this.pending.get(id) === conn) this.pending.delete(id)
    }
    const timer = window.setTimeout(() => {
      if (this.pending.get(id) === conn) {
        this.pending.delete(id)
        if (!conn.open) conn.close()
      }
    }, CONNECT_TIMEOUT_MS)

    conn.on('open', () => {
      clear()
      this.emptySlotCooldowns.delete(id)
      this.attachData(conn, 'out')
    })
    conn.on('error', clear)
    conn.on('close', clear)
  }

  // ════════════════════════════════════════════════════════════════════
  //  Links (um por participante remoto)
  // ════════════════════════════════════════════════════════════════════

  private ensureLink(id: string, name?: unknown): PeerLink {
    let link = this.links.get(id)
    if (link) return link
    link = {
      id,
      data: null,
      micOut: null,
      screenOut: null,
      micIn: null,
      screenIn: null,
      detector: null,
      teardownTimer: null,
      greeted: false,
      info: {
        peerId: id,
        name: typeof name === 'string' ? sanitizeName(name) : 'Conectando…',
        muted: false,
        sharing: false,
        speaking: false,
        micStream: null,
        screenStream: null,
        voiceVolume: 1,
        screenVolume: 1,
      },
    }
    link.teardownTimer = window.setTimeout(() => {
      const l = this.links.get(id)
      if (l && !l.data) this.removeLink(id, false)
    }, ORPHAN_LINK_TIMEOUT_MS)
    this.links.set(id, link)
    return link
  }

  private attachData(conn: DataConnection, direction: 'in' | 'out'): void {
    const id = conn.peer
    if (this.destroyed) {
      conn.close()
      return
    }
    const link = this.ensureLink(id, (conn.metadata as { name?: unknown } | undefined)?.name)

    if (link.data && link.data !== conn && link.data.open) {
      const myId = this.local.peerId
      const initiator = direction === 'out' ? myId : id
      const preferred = myId < id ? myId : id
      if (initiator !== preferred) {
        conn.close()
        return
      }
      const old = link.data
      link.data = conn
      old.close()
    } else {
      link.data = conn
    }

    if (link.teardownTimer !== null) {
      window.clearTimeout(link.teardownTimer)
      link.teardownTimer = null
    }

    conn.on('data', (raw) => this.handleData(id, raw))
    conn.on('close', () => this.handleDataClosed(id, conn))
    conn.on('error', (err) => console.warn('[discordia] data', err))

    this.send(conn, {
      type: 'hello',
      name: this.local.name,
      muted: this.local.muted,
      sharing: !!this.screenStream,
    })

    if (!link.micOut) this.callPeer(link, 'mic')
    if (this.screenStream && !link.screenOut) this.callPeer(link, 'screen')
    this.emit()
  }

  private handleDataClosed(id: string, conn: DataConnection): void {
    const link = this.links.get(id)
    if (!link || link.data !== conn) return
    link.data = null
    if (link.teardownTimer !== null) window.clearTimeout(link.teardownTimer)
    link.teardownTimer = window.setTimeout(() => {
      const l = this.links.get(id)
      if (l && !l.data) this.removeLink(id, true)
    }, DATA_TEARDOWN_GRACE_MS)
  }

  private handleData(id: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const msg = raw as PeerMessage
    const link = this.links.get(id)
    if (!link) return

    switch (msg.type) {
      case 'hello': {
        link.info.name = sanitizeName(msg.name)
        link.info.muted = !!msg.muted
        this.applyRemoteSharing(link, !!msg.sharing)
        if (!link.greeted) {
          link.greeted = true
          if (Date.now() - this.joinedAt > JOIN_QUIET_PERIOD_MS) {
            this.toast('info', `${link.info.name} entrou na sala.`)
          }
        }
        break
      }
      case 'state': {
        link.info.muted = !!msg.muted
        this.applyRemoteSharing(link, !!msg.sharing)
        break
      }
      case 'bye': {
        this.removeLink(id, true)
        return
      }
      default:
        return
    }
    this.emit()
  }

  private applyRemoteSharing(link: PeerLink, sharing: boolean): void {
    link.info.sharing = sharing
    if (!sharing) {
      link.info.screenStream = null
      if (link.screenIn) {
        const call = link.screenIn
        link.screenIn = null
        call.close()
      }
    }
  }

  private removeLink(id: string, notify: boolean): void {
    const link = this.links.get(id)
    if (!link) return
    const name = link.info.name
    const wasGreeted = link.greeted
    this.destroyLink(id)
    if (notify && wasGreeted && !this.destroyed) this.toast('info', `${name} saiu da sala.`)
    this.emit()
  }

  private destroyLink(id: string): void {
    const link = this.links.get(id)
    if (!link) return
    this.links.delete(id)
    if (link.teardownTimer !== null) window.clearTimeout(link.teardownTimer)
    link.detector?.stop()
    link.detector = null
    for (const call of [link.micOut, link.screenOut, link.micIn, link.screenIn]) {
      try {
        call?.close()
      } catch {
        /* ignore */
      }
    }
    link.micOut = link.screenOut = link.micIn = link.screenIn = null
    link.info.micStream?.getTracks().forEach((t) => t.stop())
    link.info.screenStream?.getTracks().forEach((t) => t.stop())
    link.info.micStream = null
    link.info.screenStream = null
    if (link.data) {
      const data = link.data
      link.data = null
      try {
        data.close()
      } catch {
        /* ignore */
      }
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Chamadas de mídia (mic e tela em conexões separadas com SDP tuning)
  // ════════════════════════════════════════════════════════════════════

  private callPeer(link: PeerLink, kind: MediaKind): void {
    const peer = this.peer
    if (!peer || peer.destroyed || peer.disconnected) return
    const stream = kind === 'mic' ? this.micStream : this.screenStream
    if (!stream) return

    const call = peer.call(link.id, stream, {
      metadata: { kind, name: this.local.name },
      sdpTransform: kind === 'mic' ? tuneVoiceSdp : tuneScreenSdp,
    })
    if (!call) return

    if (kind === 'mic') link.micOut = call
    else link.screenOut = call

    call.on('close', () => {
      const l = this.links.get(link.id)
      if (!l) return
      if (kind === 'mic' && l.micOut === call) l.micOut = null
      if (kind === 'screen' && l.screenOut === call) l.screenOut = null
    })
    call.on('error', (err) => console.warn(`[discordia] call ${kind} (out)`, err))
    this.watchConnection(call, kind, true)
  }

  private handleIncomingCall(call: MediaConnection): void {
    if (this.destroyed) {
      call.close()
      return
    }
    const id = call.peer
    const meta = (call.metadata ?? {}) as { kind?: unknown; name?: unknown }
    const kind: MediaKind = meta.kind === 'screen' ? 'screen' : 'mic'
    const link = this.ensureLink(id, meta.name)

    call.answer(undefined, {
      sdpTransform: kind === 'mic' ? tuneVoiceSdp : tuneScreenSdp,
    })

    if (kind === 'screen') {
      if (link.screenIn && link.screenIn !== call) link.screenIn.close()
      link.screenIn = call
    } else {
      if (link.micIn && link.micIn !== call) link.micIn.close()
      link.micIn = call
    }

    call.on('stream', (stream) => {
      const l = this.links.get(id)
      if (!l || this.destroyed) return
      if (kind === 'screen') {
        if (l.screenIn !== call || l.info.screenStream?.id === stream.id) return
        l.info.screenStream = stream
        l.info.sharing = true
        this.toast('info', `${l.info.name} começou a transmitir a tela.`)
      } else {
        if (l.micIn !== call || l.info.micStream?.id === stream.id) return
        l.info.micStream = stream
        l.detector?.stop()

        // Usa detecção nativa RTP pelo RTCPeerConnection (NÃO cria nós de AudioContext)
        const pc = call.peerConnection as RTCPeerConnection | undefined
        if (pc) {
          l.detector = new RemoteSpeakingDetector(pc, (speaking) => {
            l.info.speaking = speaking
            this.emit()
          })
        }
      }
      this.emit()
    })

    call.on('close', () => {
      const l = this.links.get(id)
      if (!l) return
      if (kind === 'screen' && l.screenIn === call) {
        l.screenIn = null
        l.info.screenStream = null
      } else if (kind === 'mic' && l.micIn === call) {
        l.micIn = null
        l.info.micStream = null
        l.detector?.stop()
        l.detector = null
        l.info.speaking = false
      }
      this.emit()
    })
    call.on('error', (err) => console.warn(`[discordia] call ${kind} (in)`, err))
    this.watchConnection(call, kind, false)
  }

  private watchConnection(call: MediaConnection, kind: MediaKind, outgoing: boolean): void {
    const pc = call.peerConnection as RTCPeerConnection | undefined
    if (!pc) return

    const applyTuning = () => {
      if (outgoing) void tuneSenders(pc, kind)
    }

    const onState = () => {
      if (pc.connectionState === 'connected') {
        applyTuning()
      } else if (pc.connectionState === 'failed') {
        pc.removeEventListener('connectionstatechange', onState)
        call.close()
      }
    }
    pc.addEventListener('connectionstatechange', onState)

    if (pc.connectionState === 'connected') {
      applyTuning()
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════════════════════

  private send(conn: DataConnection, msg: PeerMessage): void {
    try {
      if (conn.open) void conn.send(msg)
    } catch (err) {
      console.warn('[discordia] send', err)
    }
  }

  private broadcastState(): void {
    const msg: PeerMessage = { type: 'state', muted: this.local.muted, sharing: !!this.screenStream }
    for (const link of this.links.values()) {
      if (link.data) this.send(link.data, msg)
    }
  }

  private toast(kind: ToastKind, message: string): void {
    this.cb.onToast(kind, message)
  }

  private readonly handleUnload = () => this.leave()

  private emit(): void {
    if (this.destroyed) return
    const participants = [...this.links.values()]
      .filter((l) => l.greeted)
      .map((l) => ({ ...l.info }))
    this.cb.onChange({
      status: this.status,
      room: this.room,
      local: { ...this.local, screenStream: this.screenStream },
      participants,
    })
  }
}
