import Peer from 'peerjs'
import type { DataConnection, MediaConnection } from 'peerjs'
import { LocalSpeakingDetector, RemoteSpeakingDetector, closeAudioContext, createSilentStream } from './audio'
import { ChatService } from './ChatService'
import { randomId } from './fileUtils'
import { getIceServers } from './iceConfig'
import { getPresence } from './presence'
import type { PresenceRoomMember } from './presence'
import {
  tuneReceiversZeroLatency,
  tuneScreenSdp,
  tuneScreenSender,
  tuneSenders,
  tuneVoiceSdp,
} from './rtc'
import {
  BOT_PEER_ID,
  applyTrioAction,
  chooseBotTrioAction,
  createInitialTrioState,
  resolveTrioTurnAfterDelay,
} from './trioEngine'
import { MAX_PEERS, clamp, sanitizeName, slotPeerId, slugifyRoom } from './utils'
import { playSoundboardSfx, playUiSfx } from '../hooks/useAudioSystem'
import type {
  AppActivityId,
  ChatSnapshot,
  GamepadStatePayload,
  GolfResetEvent,
  GolfStrokeEvent,
  LocalState,
  MediaKind,
  PeerMessage,
  RemoteParticipant,
  RemotePlayGrant,
  RoomSnapshot,
  RoomStatus,
  RpsChoice,
  RpsDuelState,
  ScreenSharePreset,
  ToastKind,
  TrioAction,
  TrioGameState,
  WheelState,
} from '../types'

/**
 * ARQUITETURA
 * ───────────
 * • Descoberta híbrida (Firebase Presence + Assentos Determinísticos PeerJS):
 *   cada sala tem MAX_PEERS "assentos" (`discordia-v1-<sala>-<0..5>`).
 * • Malha completa (Full Mesh):
 *   - Os veteranos que já estão na sala detectam a entrada do novato e iniciam
 *     `peer.connect` (DataChannel) e `peer.call` (voz/tela) em direção ao novato.
 *   - O novato atende automaticamente `peer.on('call')` com seu stream atual
 *     (microfone ou stream silencioso se estiver sem microfone) e `peer.on('connection')`.
 * • DataConnection DEDICADO a arquivos (metadata.channel = 'files'), aberto sob demanda
 *   pelo remetente — ver ChatService (chunking 16 KB + backpressure).
 */

/** Rótulo do DataConnection dedicado à transferência de arquivos. */
const FILES_CHANNEL = 'files'
/** Rótulo do RTCDataChannel dedicado ao Remote Play (UDP-like, sem retransmissão). */
const REMOTE_GAMEPAD_CHANNEL = 'remote-gamepad'
/** Endpoint do Discordia Host Companion local no PC do Host. */
const COMPANION_WS_URL = 'ws://127.0.0.1:8765'

interface PeerLink {
  id: string
  data: DataConnection | null
  gamepadChannel: RTCDataChannel | null
  micOut: MediaConnection | null
  screenOut: MediaConnection | null
  micIn: MediaConnection | null
  screenIn: MediaConnection | null
  detector: RemoteSpeakingDetector | null
  teardownTimer: number | null
  helloTimer: number | null
  retryTimer: number | null
  discoveredAt: number
  visible: boolean
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
  onChat: (snapshot: ChatSnapshot) => void
  onRpsChange: (duel: RpsDuelState | null) => void
  onTrioChange: (state: TrioGameState | null) => void
  onActiveAppChange: (appId: AppActivityId) => void
  onWheelChange: (state: WheelState) => void
  onGolfStroke: (stroke: GolfStrokeEvent | null) => void
  onGolfReset: (reset: GolfResetEvent | null) => void
  onRemotePlayChange: (state: { grant: RemotePlayGrant | null; companionConnected: boolean }) => void
}

const DISCOVERY_INTERVAL_MS = 3000
const CONNECT_TIMEOUT_MS = 7000
const CLAIM_TIMEOUT_MS = 12000
const DATA_TEARDOWN_GRACE_MS = 3000
const ORPHAN_LINK_TIMEOUT_MS = 20000
const JOIN_QUIET_PERIOD_MS = 3500
const EMPTY_SLOT_COOLDOWN_MS = 4500
const PEER_RECONNECT_DELAY_MS = 3000
const MIC_ACQUIRE_TIMEOUT_MS = 6000

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
  private readonly voiceStreams: Record<string, MediaStream> = {}
  private readonly screenStreams: Record<string, MediaStream> = {}
  private localDetector: LocalSpeakingDetector | null = null
  private discoveryTimer: number | null = null
  private presenceUnsub: (() => void) | null = null
  private destroyed = false
  private joinedAt = 0
  private lastSignalWarnAt = 0
  private room = ''
  private status: RoomStatus = 'idle'
  private rpsDuel: RpsDuelState | null = null
  private rpsRevealTimer: number | null = null
  private trioState: TrioGameState | null = null
  private trioResolveTimer: number | null = null
  private trioBotTimer: number | null = null
  private activeApp: AppActivityId = null
  private wheelState: WheelState = {
    options: ['Pizza 🍕', 'Hambúrguer 🍔', 'Sushi 🍣', 'Tacos 🌮'],
    lastSpin: null,
  }
  private spinSeq = 0
  private golfSeq = 0
  private remotePlayGrant: RemotePlayGrant | null = null
  private companionWs: WebSocket | null = null
  private companionConnected = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)
  private companionRetryTimer: number | null = null
  private readonly sentCustomSfxByPeer = new Map<string, Set<string>>()
  private local: LocalState = {
    peerId: '',
    name: '',
    slot: -1,
    muted: false,
    deafened: false,
    micAvailable: false,
    speaking: false,
    screenStream: null,
    screenHasAudio: false,
    screenPreset: 'quality',
  }
  private screenPreset: ScreenSharePreset = 'quality'

  constructor(callbacks: RoomManagerCallbacks) {
    this.cb = callbacks
    this.chat = new ChatService(
      {
        localId: () => this.local.peerId,
        localName: () => this.local.name,
        peers: () =>
          [...this.links.values()]
            .filter((l) => l.data?.open)
            .map((l) => ({ id: l.id, name: l.info.name, data: l.data as DataConnection })),
        peerName: (id) => this.links.get(id)?.info.name ?? 'Anônimo',
        sendControl: (conn, msg) => this.send(conn, msg),
        openFileChannel: (peerId) => this.openFileChannel(peerId),
      },
      { onChange: callbacks.onChat, onToast: callbacks.onToast },
    )
  }

  /** Chat de texto + arquivos P2P (DataChannel). */
  readonly chat: ChatService

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

    // 1) Desacopla permissão de mídia da entrada na sala:
    //    Se o microfone falhar, for recusado ou não existir, inicializa normalmente
    //    com stream silencioso/mutado e segue para o registro do Peer.
    try {
      await this.acquireMicrophone(true)
    } catch (err) {
      console.warn('[WebRTC] Falha ao capturar microfone na entrada, entrando mutado:', err)
      this.useSilentMicrophone()
      this.toast('warning', 'Microfone desativado ou não detectado')
    }
    if (this.destroyed) return false

    // 2) Reivindica um assento livre na sala e aguarda estritamente o evento peer.on('open')
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

    if (!this.peer || !this.local.peerId) {
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

    // 3) Somente APÓS peer.on('open') ter disparado:
    //    vincula listeners, publica presença no Firebase e inicia descoberta Full Mesh
    this.bindPeerEvents(this.peer)
    this.status = 'connected'
    this.joinedAt = Date.now()
    playUiSfx('join')
    window.addEventListener('pagehide', this.handleUnload)
    window.addEventListener('beforeunload', this.handleUnload)

    const presence = getPresence()
    void presence
      .heartbeat(this.room, this.room, { id: this.local.peerId, name: this.local.name, joinedAt: this.joinedAt }, 1)
      .catch((err) => console.warn('[WebRTC] Falha ao registrar presença inicial:', err))

    // Escuta em tempo real `discordia_rooms/${roomId}/members` via Firebase onValue
    this.presenceUnsub = presence.watchRoomMembers(this.room, (members) => {
      this.handlePresenceMembersChanged(members)
    })
    void this.syncPresenceAndDiscover()
    this.discoveryTimer = window.setInterval(() => void this.syncPresenceAndDiscover(), DISCOVERY_INTERVAL_MS)
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
    // Se estava ensurdecido e desmutou o microfone, desfaz o ensurdecer
    if (!this.local.muted && this.local.deafened) {
      this.local.deafened = false
    }
    playUiSfx(this.local.muted ? 'mute' : 'unmute')
    this.broadcastState()
    this.emit()
  }

  toggleDeafen(): void {
    if (this.destroyed) return
    const nextDeafen = !this.local.deafened
    this.local.deafened = nextDeafen

    if (nextDeafen) {
      // Ao ensurdecer: muta também o microfone local
      const track = this.micStream?.getAudioTracks()[0]
      if (track && track.enabled) {
        track.enabled = false
      }
      this.local.muted = true
      this.local.speaking = false
      playUiSfx('mute')
    } else {
      // Ao desensurdecer: desmuta o microfone se disponível
      if (this.local.micAvailable) {
        const track = this.micStream?.getAudioTracks()[0]
        if (track) {
          track.enabled = true
          this.local.muted = false
        }
      }
      playUiSfx('unmute')
    }

    this.broadcastState()
    this.emit()
  }

  async setScreenPreset(preset: ScreenSharePreset): Promise<void> {
    this.screenPreset = preset
    this.local.screenPreset = preset

    if (this.screenStream) {
      const videoTrack = this.screenStream.getVideoTracks()[0]
      if (videoTrack) {
        try {
          if (preset === 'game') {
            await videoTrack.applyConstraints({
              width: { ideal: 1280, max: 1280 },
              height: { ideal: 720, max: 720 },
              frameRate: { ideal: 60, max: 60 },
            })
            videoTrack.contentHint = 'motion'
          } else {
            await videoTrack.applyConstraints({
              width: { ideal: 1920, max: 3840 },
              height: { ideal: 1080, max: 2160 },
              frameRate: { ideal: 60, max: 60 },
            })
            videoTrack.contentHint = 'detail'
          }
        } catch (err) {
          console.warn('[WebRTC] Falha ao aplicar constraints no preset:', err)
        }
      }

      for (const link of this.links.values()) {
        const pc = link.screenOut?.peerConnection as RTCPeerConnection | undefined
        if (pc) {
          void tuneScreenSender(pc, preset)
        }
      }

      this.toast(
        'info',
        preset === 'game'
          ? '⚡ Modo Jogo ativado (720p 60 FPS • Latência Zero)'
          : '🎬 Alta Qualidade ativada (1080p 60 FPS)',
      )
    }

    this.emit()
  }

  async startScreenShare(preferredPreset?: ScreenSharePreset): Promise<void> {
    if (this.destroyed || this.screenStream) return
    const md = navigator.mediaDevices
    if (!md?.getDisplayMedia) {
      this.toast(
        'error',
        'Seu navegador não suporta compartilhamento de tela (getDisplayMedia). Use Chrome, Edge ou Firefox no desktop.',
      )
      return
    }

    const isRemotePlayHost = this.remotePlayGrant?.hostId === this.local.peerId
    const preset = preferredPreset ?? (isRemotePlayHost ? 'game' : this.screenPreset)
    this.screenPreset = preset
    this.local.screenPreset = preset

    let stream: MediaStream
    try {
      /**
       * PREVENÇÃO DE ECO E BAIXA LATÊNCIA
       */
      const isGame = preset === 'game'
      const options = {
        video: {
          displaySurface: 'browser',
          frameRate: { ideal: 60, max: 60 },
          width: isGame ? { ideal: 1280, max: 1280 } : { ideal: 1920, max: 3840 },
          height: isGame ? { ideal: 720, max: 720 } : { ideal: 1080, max: 2160 },
        },
        audio: {
          suppressLocalAudioPlayback: false,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
          restrictOwnAudio: true,
          channelCount: 2,
          sampleRate: 48000,
        },
        surfaceSwitching: 'include',
        selfBrowserSurface: 'exclude', // Evita loop visual da própria chamada
        systemAudio: 'include',
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
      // 'motion' prioriza fluidez e latência mínima; 'detail' preserva nitidez de texto
      videoTrack.contentHint = preset === 'game' ? 'motion' : 'detail'
      videoTrack.addEventListener('ended', () => this.stopScreenShare())
    }

    const hasAudio = stream.getAudioTracks().length > 0
    const surface = (videoTrack?.getSettings() as { displaySurface?: string } | undefined)?.displaySurface
    if (!hasAudio) {
      this.toast(
        'warning',
        'Transmitindo sem áudio. Para incluir som, escolha "Guia do Chrome" e marque "Compartilhar áudio da guia".',
      )
    } else {
      stream.getAudioTracks().forEach((t) => {
        t.contentHint = 'music'
      })
      if (surface === 'monitor' && !this.supportsOwnAudioRestriction()) {
        this.toast(
          'warning',
          'Você está transmitindo o áudio do sistema inteiro: os outros podem ouvir eco das próprias vozes. Para vídeos/músicas, prefira compartilhar uma "Guia do Chrome".',
        )
      }
    }

    this.screenStream = stream
    this.local.screenHasAudio = hasAudio
    for (const link of this.links.values()) {
      this.callPeer(link, 'screen')
    }
    this.broadcastState()
    this.toast(
      'success',
      preset === 'game'
        ? '⚡ Transmitindo em Modo Jogo: 720p 60 FPS e Latência Zero!'
        : '🎬 Transmitindo em Alta Qualidade: 1080p 60 FPS.',
    )
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

  sendChat(text: string): boolean {
    if (this.destroyed) return false
    return this.chat.sendText(text)
  }

  sendFiles(files: Iterable<File>): void {
    if (this.destroyed) return
    this.chat.sendFiles(files)
  }

  cancelTransfer(id: string): void {
    this.chat.cancelTransfer(id)
  }

  saveTransfer(id: string): void {
    this.chat.saveTransfer(id)
  }

  // ─── Soundboard P2P ────────────────────────────────────────────────────

  playSfx(sfxId: string, custom?: { name: string; dataUrl: string }): void {
    if (this.destroyed) return
    playSoundboardSfx(sfxId, custom?.dataUrl, custom?.name)

    for (const link of this.links.values()) {
      if (!link.greeted || !link.data?.open) continue
      if (custom) {
        let sentSet = this.sentCustomSfxByPeer.get(link.id)
        if (!sentSet) {
          sentSet = new Set()
          this.sentCustomSfxByPeer.set(link.id, sentSet)
        }
        if (!sentSet.has(sfxId)) {
          sentSet.add(sfxId)
          this.send(link.data, {
            type: 'play-sfx',
            sfxId,
            customName: custom.name,
            dataUrl: custom.dataUrl,
          })
          continue
        }
      }
      this.send(link.data, { type: 'play-sfx', sfxId })
    }
  }

  // ─── Duelo 1v1: Pedra, Papel e Tesoura (Melhor de 3) ───────────────────

  challengeRps(opponentId: string): void {
    if (this.destroyed) return
    const link = this.links.get(opponentId)
    if (!link?.data?.open || !link.greeted) {
      this.toast('warning', 'Não foi possível desafiar este participante agora.')
      return
    }
    this.clearRpsTimer()
    const matchId = randomId()
    this.rpsDuel = {
      matchId,
      status: 'waiting-accept',
      opponentId,
      opponentName: link.info.name,
      round: 1,
      myScore: 0,
      opponentScore: 0,
      myChoice: null,
      opponentChoice: null,
      opponentLockedIn: false,
      roundWinner: null,
      matchWinner: null,
    }
    this.send(link.data, { type: 'rps-challenge', matchId })
    this.cb.onRpsChange({ ...this.rpsDuel })
  }

  acceptRps(): void {
    const duel = this.rpsDuel
    if (!duel || duel.status !== 'incoming-invite') return
    const link = this.links.get(duel.opponentId)
    if (!link?.data?.open) {
      this.closeRps()
      return
    }
    duel.status = 'playing'
    this.send(link.data, { type: 'rps-accept', matchId: duel.matchId })
    this.cb.onRpsChange({ ...duel })
  }

  declineRps(): void {
    const duel = this.rpsDuel
    if (!duel) return
    const link = this.links.get(duel.opponentId)
    if (link?.data?.open) {
      this.send(link.data, { type: 'rps-decline', matchId: duel.matchId })
    }
    this.clearRpsTimer()
    this.rpsDuel = null
    this.cb.onRpsChange(null)
  }

  chooseRps(choice: RpsChoice): void {
    const duel = this.rpsDuel
    if (!duel || duel.status !== 'playing' || duel.myChoice) return
    const link = this.links.get(duel.opponentId)
    if (!link?.data?.open) {
      this.closeRps()
      return
    }
    duel.myChoice = choice
    this.send(link.data, { type: 'rps-move', matchId: duel.matchId, round: duel.round, choice })
    if (duel.opponentChoice) {
      this.resolveRpsRound()
    } else {
      this.cb.onRpsChange({ ...duel })
    }
  }

  rematchRps(): void {
    const duel = this.rpsDuel
    if (!duel) return
    const link = this.links.get(duel.opponentId)
    if (!link?.data?.open) {
      this.closeRps()
      return
    }
    this.clearRpsTimer()
    duel.status = 'playing'
    duel.round = 1
    duel.myScore = 0
    duel.opponentScore = 0
    duel.myChoice = null
    duel.opponentChoice = null
    duel.opponentLockedIn = false
    duel.roundWinner = null
    duel.matchWinner = null
    this.send(link.data, { type: 'rps-rematch', matchId: duel.matchId })
    this.cb.onRpsChange({ ...duel })
  }

  closeRps(): void {
    const duel = this.rpsDuel
    if (!duel) return
    const link = this.links.get(duel.opponentId)
    if (link?.data?.open) {
      this.send(link.data, { type: 'rps-close', matchId: duel.matchId })
    }
    this.clearRpsTimer()
    this.rpsDuel = null
    this.cb.onRpsChange(null)
  }

  // ─── Minigame de Sala: Jogo de Cartas TRIO ─────────────────────────────

  startTrioGame(): void {
    if (this.destroyed || !this.local.peerId) return
    this.clearTrioTimers()
    const roster = [
      { peerId: this.local.peerId, name: this.local.name },
      ...[...this.links.values()]
        .filter((l) => l.greeted && l.data?.open)
        .map((l) => ({ peerId: l.id, name: l.info.name })),
    ]
    const state = createInitialTrioState(this.local.peerId, roster)
    this.trioState = state
    this.broadcastTrioState(state)
    this.cb.onTrioChange(state)
    this.scheduleTrioBotIfNeeded()
  }

  sendTrioAction(action: TrioAction): void {
    if (this.destroyed || !this.trioState) return
    if (action.kind === 'restart') {
      this.startTrioGame()
      return
    }
    if (this.trioState.hostId === this.local.peerId) {
      this.handleHostTrioAction(this.local.peerId, action)
    } else {
      const hostLink = this.links.get(this.trioState.hostId)
      if (hostLink?.data?.open) {
        this.send(hostLink.data, { type: 'game-action', action })
      } else {
        this.toast('warning', 'O anfitrião da mesa desconectou. Inicie uma nova partida.')
      }
    }
  }

  endTrioGame(): void {
    this.clearTrioTimers()
    this.trioState = null
    this.broadcastTrioState(null)
    this.cb.onTrioChange(null)
    if (this.activeApp === 'trio') {
      this.activeApp = null
      this.broadcastMsg({ type: 'app:launch', appId: null })
      this.cb.onActiveAppChange(null)
    }
  }

  // ─── Hub de Atividades P2P (Apps / Roleta 3D / Mini Golf 3D) ───────────

  launchApp(appId: AppActivityId): void {
    if (this.destroyed) return
    this.activeApp = appId
    if (appId === 'trio' && !this.trioState) {
      this.startTrioGame()
    } else if (appId === null && this.trioState) {
      this.clearTrioTimers()
      this.trioState = null
      this.broadcastTrioState(null)
      this.cb.onTrioChange(null)
    }
    this.broadcastMsg({ type: 'app:launch', appId })
    this.cb.onActiveAppChange(appId)
  }

  updateWheelOptions(options: string[]): void {
    if (this.destroyed) return
    this.wheelState = { ...this.wheelState, options }
    this.broadcastMsg({ type: 'wheel:update', options })
    this.cb.onWheelChange(this.wheelState)
  }

  spinWheel(winnerIndex: number, targetAngle: number, options: string[]): void {
    if (this.destroyed) return
    const spinId = ++this.spinSeq
    const startedBy = this.local.name || 'Você'
    this.wheelState = {
      options,
      lastSpin: {
        spinId,
        targetAngle,
        winnerIndex,
        startedBy,
        options,
      },
    }
    this.broadcastMsg({
      type: 'wheel:spin',
      targetAngle,
      winnerIndex,
      startedBy,
      options,
    })
    this.cb.onWheelChange(this.wheelState)
  }

  sendGolfStroke(vx: number, vz: number): void {
    if (this.destroyed || !this.local.peerId) return
    const stroke: GolfStrokeEvent = {
      seq: ++this.golfSeq,
      peerId: this.local.peerId,
      name: this.local.name || 'Você',
      vx,
      vz,
    }
    this.cb.onGolfStroke(stroke)
    this.broadcastMsg({
      type: 'golf:stroke',
      peerId: stroke.peerId,
      name: stroke.name,
      vx,
      vz,
    })
  }

  sendGolfReset(): void {
    if (this.destroyed) return
    const reset: GolfResetEvent = {
      seq: ++this.golfSeq,
      courseIndex: 0,
    }
    this.cb.onGolfReset(reset)
    this.broadcastMsg({
      type: 'golf:reset',
      courseIndex: 0,
    })
  }

  // ─── Remote Play / Jogar Junto (Gamepad API -> WebRTC -> ViGEmBus) ──────

  grantRemotePlay(guestId: string | null): void {
    if (this.destroyed || !this.local.peerId) return
    if (!guestId) {
      this.sendCompanionRelease()
      this.remotePlayGrant = null
      this.broadcastMsg({
        type: 'gamepad:grant',
        hostId: this.local.peerId,
        hostName: this.local.name,
        guestId: null,
        guestName: null,
      })
      this.notifyRemotePlay()
      return
    }

    const link = this.links.get(guestId)
    const guestName = link?.info.name ?? 'Jogador 2'
    this.remotePlayGrant = {
      hostId: this.local.peerId,
      hostName: this.local.name || 'Host',
      guestId,
      guestName,
    }
    this.connectCompanionBridge()
    this.broadcastMsg({
      type: 'gamepad:grant',
      hostId: this.local.peerId,
      hostName: this.local.name || 'Host',
      guestId,
      guestName,
    })
    this.toast('success', `🎮 Controle (Jogador 2) liberado para ${guestName}!`)
    if (this.screenStream && this.screenPreset !== 'game') {
      void this.setScreenPreset('game')
    }
    this.notifyRemotePlay()
  }

  sendGamepadState(payload: GamepadStatePayload): void {
    if (this.destroyed || !this.remotePlayGrant) return
    if (this.remotePlayGrant.guestId !== this.local.peerId) return
    const hostId = this.remotePlayGrant.hostId
    if (!hostId || hostId === this.local.peerId) return

    const link = this.links.get(hostId)
    if (!link) return

    // Tenta enviar pelo RTCDataChannel dedicado "remote-gamepad" (ordered: false, maxRetransmits: 0)
    const ch = this.ensureGamepadChannel(link)
    if (ch && ch.readyState === 'open') {
      try {
        ch.send(JSON.stringify(payload))
        return
      } catch {
        /* fallback para o DataConnection principal */
      }
    }

    if (link.data?.open) {
      this.send(link.data, payload)
    }
  }

  connectCompanionBridge(): void {
    if (this.destroyed) return
    if (typeof window !== 'undefined' && window.electron?.isElectron) {
      if (!this.companionConnected) {
        this.companionConnected = true
        this.notifyRemotePlay()
      }
      return
    }
    if (
      this.companionWs &&
      (this.companionWs.readyState === WebSocket.OPEN || this.companionWs.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    if (this.companionRetryTimer !== null) {
      window.clearTimeout(this.companionRetryTimer)
      this.companionRetryTimer = null
    }

    let ws: WebSocket
    try {
      ws = new WebSocket(COMPANION_WS_URL)
    } catch {
      this.companionConnected = false
      this.notifyRemotePlay()
      this.scheduleCompanionReconnect()
      return
    }

    this.companionWs = ws

    ws.onopen = () => {
      if (this.destroyed || this.companionWs !== ws) {
        ws.close()
        return
      }
      const wasConnected = this.companionConnected
      this.companionConnected = true
      this.notifyRemotePlay()
      if (!wasConnected) {
        this.toast('success', '🟢 Discordia Host detectado — Pronto para jogar!')
      }
    }

    ws.onclose = () => {
      if (this.companionWs === ws) {
        this.companionWs = null
        this.companionConnected = false
        this.notifyRemotePlay()
        if (this.remotePlayGrant?.hostId === this.local.peerId && this.remotePlayGrant.guestId) {
          this.scheduleCompanionReconnect()
        }
      }
    }

    ws.onerror = () => {
      if (this.companionWs === ws) {
        this.companionConnected = false
        this.notifyRemotePlay()
      }
    }
  }

  private scheduleCompanionReconnect(): void {
    if (this.destroyed || this.companionRetryTimer !== null) return
    if (typeof window !== 'undefined' && window.electron?.isElectron) return
    this.companionRetryTimer = window.setTimeout(() => {
      this.companionRetryTimer = null
      if (this.destroyed) return
      if (this.remotePlayGrant?.hostId === this.local.peerId && this.remotePlayGrant.guestId) {
        this.connectCompanionBridge()
      }
    }, 1500)
  }

  private sendCompanionRelease(): void {
    if (typeof window !== 'undefined' && window.electron?.isElectron) {
      window.electron.releaseGamepad()
      return
    }
    if (this.companionWs && this.companionWs.readyState === WebSocket.OPEN) {
      try {
        this.companionWs.send(JSON.stringify({ type: 'gamepad:release' }))
      } catch {
        /* ignore */
      }
    }
  }

  private closeCompanionBridge(): void {
    if (this.companionRetryTimer !== null) {
      window.clearTimeout(this.companionRetryTimer)
      this.companionRetryTimer = null
    }
    this.sendCompanionRelease()
    if (this.companionWs) {
      const ws = this.companionWs
      this.companionWs = null
      try {
        ws.close()
      } catch {
        /* ignore */
      }
    }
    this.companionConnected = typeof window !== 'undefined' && Boolean(window.electron?.isElectron)
  }

  private notifyRemotePlay(): void {
    this.cb.onRemotePlayChange({
      grant: this.remotePlayGrant ? { ...this.remotePlayGrant } : null,
      companionConnected: this.companionConnected,
    })
  }

  leave(): void {
    if (this.destroyed) return
    this.destroyed = true
    window.removeEventListener('pagehide', this.handleUnload)
    window.removeEventListener('beforeunload', this.handleUnload)
    if (this.presenceUnsub) {
      this.presenceUnsub()
      this.presenceUnsub = null
    }
    if (this.room && this.local.peerId) {
      const remainingPeers = [...this.links.values()].filter((l) => l.visible || l.greeted).length
      getPresence().leave(this.room, this.local.peerId, remainingPeers === 0)
    }
    if (this.discoveryTimer !== null) {
      window.clearInterval(this.discoveryTimer)
      this.discoveryTimer = null
    }
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.clearRpsTimer()
    this.clearTrioTimers()
    this.closeCompanionBridge()
    this.remotePlayGrant = null
    this.sentCustomSfxByPeer.clear()
    playUiSfx('leave')

    for (const link of this.links.values()) {
      if (link.data) this.send(link.data, { type: 'bye' })
    }

    this.stopScreenShare(true)
    this.chat.dispose()

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
  //  Mídia local (Desacoplada da Entrada na Sala)
  // ════════════════════════════════════════════════════════════════════

  private async acquireMicrophone(initial: boolean): Promise<boolean> {
    let stream: MediaStream | null = null
    const md = navigator.mediaDevices

    try {
      if (!md?.getUserMedia) {
        throw new DOMException('getUserMedia indisponível', 'NotFoundError')
      }
      const devices = await md.enumerateDevices().catch(() => [] as MediaDeviceInfo[])
      if (devices.length > 0 && !devices.some((d) => d.kind === 'audioinput')) {
        throw new DOMException('Nenhum dispositivo de entrada de áudio', 'NotFoundError')
      }
      stream = await Promise.race([
        md.getUserMedia({
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
        }),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), MIC_ACQUIRE_TIMEOUT_MS)),
      ])
      if (!stream) {
        throw new DOMException('Tempo esgotado ao solicitar microfone', 'NotAllowedError')
      }
    } catch (err) {
      this.reportMicError(err, initial)
    }

    if (this.destroyed) {
      stream?.getTracks().forEach((t) => t.stop())
      return false
    }

    if (stream) {
      const track = stream.getAudioTracks()[0]
      if (track) {
        track.contentHint = 'speech'
        track.addEventListener('ended', () => {
          if (this.destroyed || this.micStream !== stream) return
          this.toast('warning', 'Microfone desativado ou não detectado')
          this.useSilentMicrophone()
          this.emit()
        })
      }
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
      for (const call of [link.micOut, link.micIn]) {
        const pc = call?.peerConnection as RTCPeerConnection | undefined
        if (!pc) continue
        const sender = pc.getSenders().find((s) => s.track?.kind === 'audio') ?? pc.getSenders()[0]
        if (sender) void sender.replaceTrack(newTrack).catch((e) => console.warn('[WebRTC] replaceTrack', e))
      }
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
      console.warn('[WebRTC] detector local indisponível', err)
    }
  }

  private reportMicError(err: unknown, initial: boolean): void {
    const name = err instanceof DOMException ? err.name : ''
    console.warn('[WebRTC] Microfone indisponível/recusado:', name || err)
    if (initial) {
      this.toast('warning', 'Microfone desativado ou não detectado')
      return
    }
    switch (name) {
      case 'NotAllowedError':
      case 'SecurityError':
        this.toast('warning', 'Microfone desativado ou não detectado (permissão negada pelo navegador).')
        break
      case 'NotFoundError':
      case 'OverconstrainedError':
        this.toast('warning', 'Microfone desativado ou não detectado.')
        break
      case 'NotReadableError':
        this.toast('error', 'O microfone está em uso por outro aplicativo ou bloqueado pelo sistema.')
        break
      default:
        this.toast('warning', 'Microfone desativado ou não detectado')
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
  //  Sinalização / descoberta / Full Mesh
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
      const finish = (err?: unknown, registeredId?: string) => {
        if (settled) return
        settled = true
        window.clearTimeout(timer)
        peer.off('open', onOpen)
        peer.off('error', onError)
        if (err) {
          peer.destroy()
          reject(err)
        } else {
          console.info(`[WebRTC] Peer registrado com ID: ${registeredId ?? peer.id}`)
          resolve(peer)
        }
      }
      const onOpen = (openId: string) => finish(undefined, openId)
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
        console.info('[WebRTC] Tentando reconectar ao servidor de sinalização PeerJS...')
        this.peer.reconnect()
      } catch (err) {
        console.warn('[WebRTC] reconnect error', err)
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
      const meta = (conn.metadata ?? {}) as { channel?: unknown }
      if (meta.channel === FILES_CHANNEL) {
        // Canal dedicado de arquivos (unidirecional: o par remoto envia, nós recebemos)
        conn.on('open', () => this.chat.acceptFileChannel(conn))
        conn.on('error', (err) => console.warn('[WebRTC] files (in)', err))
        return
      }
      this.prepareIncomingData(conn)
    })

    peer.on('call', (call) => this.handleIncomingCall(call))

    peer.on('open', (id) => {
      console.info(`[WebRTC] Peer registrado com ID: ${id}`)
      if (this.reconnectAttempts > 0) {
        this.reconnectAttempts = 0
        this.toast('success', 'Reconectado ao servidor de sinalização!')
        void this.syncPresenceAndDiscover()
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
      console.warn('[WebRTC] erro desconhecido', err)
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
        console.warn('[WebRTC] webrtc error:', err.message)
        return
      default:
        console.warn('[WebRTC] peer error:', err.type, err.message)
    }
  }

  /**
   * Processa em tempo real a lista de membros vinda de `discordia_rooms/${roomId}/members`:
   * 1. Itera sobre todos os IDs em `members`, ignorando o próprio `peerId`.
   * 2. Alimenta a lista de participantes da interface com o nome/avatar do Firebase ("A ligar..." -> "Conectado").
   * 3. Regra determinística anti-colisão: o utilizador cujo `peerId` for alfanumericamente maior
   *    (`this.local.peerId > remotePeerId`) assume a responsabilidade primária de iniciar `peer.call` e `peer.connect`.
   *    Se após 2.5s a ligação ainda não tiver sido estabelecida, o outro par também tenta como fallback.
   */
  private handlePresenceMembersChanged(members: PresenceRoomMember[]): void {
    const peer = this.peer
    if (this.destroyed || !peer || peer.destroyed) return
    if (peer.disconnected) {
      this.scheduleReconnect()
      return
    }

    const activeIds = new Set<string>()
    for (const m of members) {
      if (!m.id || m.id === this.local.peerId) continue
      activeIds.add(m.id)
      this.emptySlotCooldowns.delete(m.id)

      const link = this.ensureLink(m.id, m.name, true)
      const hasData = !!link.data?.open
      const hasMedia = !!link.info.micStream || !!link.micOut || !!link.micIn

      // Regra determinística: peerId alfanumericamente maior inicia imediatamente;
      // o menor aguarda atender em peer.on('call') / peer.on('connection'), com fallback após 2.5s
      const iAmHigherId = this.local.peerId > m.id
      const fallbackElapsed = Date.now() - link.discoveredAt > 2500

      if (iAmHigherId || fallbackElapsed) {
        if (!hasData && !this.pending.has(m.id)) {
          this.connectTo(m.id)
        }
        if (!hasMedia) {
          this.callPeer(link, 'mic')
        }
        if (this.screenStream && !link.screenOut) {
          this.callPeer(link, 'screen')
        }
      } else if (!hasData || !hasMedia) {
        // Agenda verificação de fallback caso o par com ID maior demore mais de 2.5s
        this.schedulePeerRecovery(m.id)
      }
    }

    // Remove links que saíram do nó `members` no Firebase e não têm canal P2P aberto
    for (const [id, link] of this.links.entries()) {
      if (!activeIds.has(id) && !link.data?.open && !link.info.micStream) {
        this.removeLink(id, false)
      }
    }

    this.emit()
  }

  private async syncPresenceAndDiscover(): Promise<void> {
    const peer = this.peer
    if (this.destroyed || !peer || peer.destroyed) return
    if (peer.disconnected) {
      this.scheduleReconnect()
      return
    }

    try {
      const members = await getPresence().getRoomMembers(this.room)
      if (this.destroyed) return
      if (members.length > 0) {
        this.handlePresenceMembersChanged(members)
      }
    } catch (err) {
      console.warn('[WebRTC] Falha ao consultar membros da sala:', err)
    }

    this.discover()
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
        if (!link.greeted) {
          this.sendHello(link.data)
        }
        if (!link.micOut && !link.info.micStream) this.callPeer(link, 'mic')
        if (this.screenStream && !link.screenOut) this.callPeer(link, 'screen')
        continue
      }
      if (this.pending.has(id)) continue

      // Para descoberta cega de slots (quando Firebase está off), aplica a mesma regra determinística
      // de preferência pelo peerId maior na primeira janela de 2.5s para evitar chamadas duplicadas
      if (this.local.peerId < id && now - this.joinedAt < 2500) continue

      const cd = this.emptySlotCooldowns.get(id)
      if (cd && now < cd) continue

      this.connectTo(id)
    }
  }

  private connectTo(id: string): void {
    const peer = this.peer
    if (!peer || peer.destroyed || peer.disconnected) return
    const existing = this.links.get(id)
    if (existing?.data?.open) return

    const conn = peer.connect(id, {
      reliable: true,
      metadata: { name: this.local.name, joinedAt: this.joinedAt },
    })
    if (!conn) return
    this.pending.set(id, conn)

    // Escuta dados imediatamente antes mesmo de 'open' para nunca perder pacotes iniciais
    conn.on('data', (raw) => this.handleData(id, raw))

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
    conn.on('error', (err) => {
      clear()
      console.warn('[WebRTC] data (out) error:', err)
    })
    conn.on('close', clear)
  }

  private prepareIncomingData(conn: DataConnection): void {
    const id = conn.peer
    const meta = (conn.metadata ?? {}) as { name?: unknown }
    this.ensureLink(id, meta.name, true)
    this.emit()

    // Registra o listener de dados IMEDIATAMENTE (antes de 'open') para não perder o 'hello'
    conn.on('data', (raw) => this.handleData(id, raw))
    conn.on('error', (err) => console.warn('[WebRTC] data (in) error:', err))

    if (conn.open) {
      this.attachData(conn, 'in')
    } else {
      conn.on('open', () => this.attachData(conn, 'in'))
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Links (um por participante remoto)
  // ════════════════════════════════════════════════════════════════════

  private ensureLink(id: string, name?: unknown, markVisible = false): PeerLink {
    let link = this.links.get(id)
    if (link) {
      if (typeof name === 'string' && name.trim() && (link.info.name === 'Conectando…' || !link.greeted)) {
        link.info.name = sanitizeName(name)
      }
      if (markVisible) link.visible = true
      return link
    }
    link = {
      id,
      data: null,
      gamepadChannel: null,
      micOut: null,
      screenOut: null,
      micIn: null,
      screenIn: null,
      detector: null,
      teardownTimer: null,
      helloTimer: null,
      retryTimer: null,
      discoveredAt: Date.now(),
      visible: markVisible,
      greeted: false,
      info: {
        peerId: id,
        name: typeof name === 'string' && name.trim() ? sanitizeName(name) : 'Conectando…',
        muted: false,
        sharing: false,
        speaking: false,
        micStream: null,
        screenStream: null,
        voiceVolume: 1,
        screenVolume: 1,
        connectionState: 'connecting',
      },
    }
    link.teardownTimer = window.setTimeout(() => {
      const l = this.links.get(id)
      if (l && !l.data?.open && !l.info.micStream) this.removeLink(id, false)
    }, ORPHAN_LINK_TIMEOUT_MS)
    this.links.set(id, link)
    return link
  }

  private attachData(conn: DataConnection, _direction: 'in' | 'out'): void {
    const id = conn.peer
    if (this.destroyed) {
      conn.close()
      return
    }
    const meta = (conn.metadata ?? {}) as { name?: unknown }
    const link = this.ensureLink(id, meta.name, true)

    // Se já houver um canal aberto e funcional, mantém o atual sem derrubar o handshake,
    // mas também envia 'hello' no novo canal para garantir que ambos os lados recebam.
    if (!link.data || !link.data.open) {
      link.data = conn
    }

    if (link.teardownTimer !== null) {
      window.clearTimeout(link.teardownTimer)
      link.teardownTimer = null
    }
    if (link.retryTimer !== null) {
      window.clearTimeout(link.retryTimer)
      link.retryTimer = null
    }

    conn.on('close', () => this.handleDataClosed(id, conn))
    this.watchDataIce(link, conn)

    this.sendHello(conn)
    if (link.data && link.data !== conn && link.data.open) {
      this.sendHello(link.data)
    }

    // Garante reenvio de hello até receber confirmação (evita perda silenciosa em glare)
    if (link.helloTimer !== null) window.clearInterval(link.helloTimer)
    link.helloTimer = window.setInterval(() => {
      const l = this.links.get(id)
      if (!l || l.greeted || this.destroyed) {
        if (l?.helloTimer) {
          window.clearInterval(l.helloTimer)
          l.helloTimer = null
        }
        return
      }
      if (l.data?.open) this.sendHello(l.data)
    }, 1200)

    // Evita colisão de chamadas duplicadas de voz quando ambos os lados abrem o DataChannel:
    // só inicia micOut se ainda não houver stream/chamada de voz ativa e este peer tiver precedência
    const hasVoice = !!link.info.micStream || !!link.micOut || !!link.micIn
    if (!hasVoice && (this.local.peerId > id || Date.now() - link.discoveredAt > 2500)) {
      this.callPeer(link, 'mic')
    } else if (!link.info.micStream) {
      this.schedulePeerRecovery(id)
    }
    if (this.screenStream && !link.screenOut) this.callPeer(link, 'screen')
    this.emit()
  }

  private sendHello(conn: DataConnection): void {
    this.send(conn, {
      type: 'hello',
      name: this.local.name,
      muted: this.local.muted,
      sharing: !!this.screenStream,
    })
  }

  private ensureGamepadChannel(link: PeerLink): RTCDataChannel | null {
    if (link.gamepadChannel && link.gamepadChannel.readyState !== 'closed') {
      return link.gamepadChannel
    }
    const pc = (link.data as unknown as { peerConnection?: RTCPeerConnection } | null)?.peerConnection
    if (!pc || pc.signalingState === 'closed') return null

    try {
      const ch = pc.createDataChannel(REMOTE_GAMEPAD_CHANNEL, {
        ordered: false,
        maxRetransmits: 0,
      })
      this.bindGamepadChannel(link, ch)
      return ch
    } catch {
      return null
    }
  }

  private bindGamepadChannel(link: PeerLink, ch: RTCDataChannel): void {
    link.gamepadChannel = ch
    ch.onmessage = (ev) => {
      if (typeof ev.data === 'string') {
        this.forwardGamepadPacketFromPeer(link.id, ev.data)
      }
    }
    ch.onclose = () => {
      if (link.gamepadChannel === ch) {
        link.gamepadChannel = null
      }
    }
  }

  private forwardGamepadPacketFromPeer(fromId: string, rawJson: string): void {
    if (this.destroyed) return
    if (this.remotePlayGrant?.hostId !== this.local.peerId) return
    if (this.remotePlayGrant.guestId !== fromId) return

    if (typeof window !== 'undefined' && window.electron?.isElectron) {
      try {
        window.electron.sendGamepadState(JSON.parse(rawJson))
      } catch {
        /* ignore */
      }
      return
    }

    if (!this.companionWs || this.companionWs.readyState !== WebSocket.OPEN) {
      this.connectCompanionBridge()
      return
    }
    try {
      this.companionWs.send(rawJson)
    } catch {
      /* ignore */
    }
  }

  private watchDataIce(link: PeerLink, conn: DataConnection): void {
    const pc = (conn as unknown as { peerConnection?: RTCPeerConnection }).peerConnection
    if (!pc) return

    pc.addEventListener('datachannel', (ev) => {
      if (ev.channel?.label === REMOTE_GAMEPAD_CHANNEL) {
        this.bindGamepadChannel(link, ev.channel)
      }
    })

    const check = () => {
      if (this.destroyed || !this.links.has(link.id)) return
      const ice = pc.iceConnectionState
      const state = pc.connectionState
      if (ice === 'connected' || ice === 'completed' || state === 'connected') {
        if (link.info.connectionState !== 'connected') {
          link.info.connectionState = 'connected'
          this.emit()
        }
      } else if (ice === 'failed' || ice === 'disconnected' || state === 'failed') {
        console.warn(`[WebRTC] ICE/Conexão degradada com ${link.id}: ice=${ice} state=${state}`)
        try {
          pc.restartIce?.()
        } catch {
          /* ignore */
        }
        link.info.connectionState = 'error'
        this.emit()
        this.schedulePeerRecovery(link.id)
      }
    }
    pc.oniceconnectionstatechange = check
    pc.addEventListener('connectionstatechange', check)
  }

  /**
   * Se a conexão falhar ou cair para algum membro específico, dispara reconexão automática
   * (`peer.reconnect()`) e recria a chamada/DataChannel após 3 segundos.
   */
  private schedulePeerRecovery(peerId: string): void {
    const link = this.links.get(peerId)
    if (!link || this.destroyed || link.retryTimer !== null) return

    link.retryTimer = window.setTimeout(() => {
      link.retryTimer = null
      if (this.destroyed) return
      const current = this.links.get(peerId)
      if (!current) return

      console.info(`[WebRTC] Tentando recuperar conexão P2P com ${peerId} após 3s...`)
      if (this.peer && this.peer.disconnected && !this.peer.destroyed) {
        try {
          this.peer.reconnect()
        } catch (err) {
          console.warn('[WebRTC] Falha em peer.reconnect():', err)
        }
      }

      this.emptySlotCooldowns.delete(peerId)
      if (!current.data?.open && !this.pending.has(peerId)) {
        current.info.connectionState = 'reconnecting'
        this.emit()
        this.connectTo(peerId)
      }
      if (!current.micOut || !current.info.micStream) {
        this.callPeer(current, 'mic')
      }
      if (this.screenStream && !current.screenOut) {
        this.callPeer(current, 'screen')
      }
    }, PEER_RECONNECT_DELAY_MS)
  }

  private handleDataClosed(id: string, conn: DataConnection): void {
    const link = this.links.get(id)
    if (!link || link.data !== conn) return
    link.data = null
    link.info.connectionState = 'error'
    this.emit()
    this.schedulePeerRecovery(id)

    if (link.teardownTimer !== null) window.clearTimeout(link.teardownTimer)
    link.teardownTimer = window.setTimeout(async () => {
      const l = this.links.get(id)
      if (!l || l.data?.open) return
      // Verifica se o membro ainda está ativo na presença antes de removê-lo
      try {
        const activeMembers = await getPresence().getRoomMembers(this.room)
        if (activeMembers.some((m) => m.id === id)) {
          this.schedulePeerRecovery(id)
          return
        }
      } catch {
        /* ignore */
      }
      if (!l.data?.open) this.removeLink(id, true)
    }, DATA_TEARDOWN_GRACE_MS * 2)
  }

  private markPeerGreeted(link: PeerLink, name: string, muted: boolean, sharing: boolean): void {
    link.info.name = sanitizeName(name)
    link.info.muted = muted
    link.info.connectionState = 'connected'
    link.visible = true
    this.applyRemoteSharing(link, sharing)

    if (link.helloTimer !== null) {
      window.clearInterval(link.helloTimer)
      link.helloTimer = null
    }
    if (link.teardownTimer !== null) {
      window.clearTimeout(link.teardownTimer)
      link.teardownTimer = null
    }

    if (!link.greeted) {
      link.greeted = true
      if (Date.now() - this.joinedAt > JOIN_QUIET_PERIOD_MS) {
        this.toast('info', `${link.info.name} entrou na sala.`)
        playUiSfx('join')
      }
      this.chat.addSystemMessage(`${link.info.name} entrou na sala.`)
      if (this.trioState && this.trioState.hostId === this.local.peerId && link.data?.open) {
        this.send(link.data, { type: 'game-state', state: this.trioState })
      }
      if (this.activeApp && link.data?.open) {
        this.send(link.data, { type: 'app:launch', appId: this.activeApp })
        if (this.activeApp === 'wheel') {
          this.send(link.data, { type: 'wheel:update', options: this.wheelState.options })
        }
      }
      if (this.remotePlayGrant && this.remotePlayGrant.hostId === this.local.peerId && link.data?.open) {
        this.send(link.data, {
          type: 'gamepad:grant',
          hostId: this.remotePlayGrant.hostId,
          hostName: this.remotePlayGrant.hostName,
          guestId: this.remotePlayGrant.guestId,
          guestName: this.remotePlayGrant.guestName,
        })
      }
    }
  }

  private handleData(id: string, raw: unknown): void {
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return
    const msg = raw as PeerMessage
    const link = this.ensureLink(id, undefined, true)

    switch (msg.type) {
      case 'hello': {
        this.markPeerGreeted(link, msg.name, !!msg.muted, !!msg.sharing)
        if (link.data?.open) {
          this.send(link.data, {
            type: 'hello-ack',
            name: this.local.name,
            muted: this.local.muted,
            sharing: !!this.screenStream,
          })
        }
        break
      }
      case 'hello-ack': {
        this.markPeerGreeted(link, msg.name, !!msg.muted, !!msg.sharing)
        break
      }
      case 'state': {
        link.info.muted = !!msg.muted
        link.info.connectionState = 'connected'
        this.applyRemoteSharing(link, !!msg.sharing)
        break
      }
      case 'bye': {
        this.removeLink(id, true)
        return
      }
      case 'chat':
      case 'file-offer':
      case 'file-cancel': {
        this.chat.handleControl(id, msg)
        return
      }
      case 'play-sfx': {
        if (typeof msg.sfxId === 'string') {
          playSoundboardSfx(msg.sfxId, msg.dataUrl, msg.customName)
          this.toast('info', `🔊 ${link.info.name} tocou um som no Soundboard`)
        }
        return
      }
      case 'rps-challenge':
      case 'rps-accept':
      case 'rps-decline':
      case 'rps-move':
      case 'rps-rematch':
      case 'rps-close': {
        this.handleRpsMessage(id, link.info.name, msg)
        return
      }
      case 'game-state': {
        this.clearTrioTimers()
        this.trioState = msg.state
        this.cb.onTrioChange(msg.state)
        if (msg.state && !this.activeApp) {
          this.activeApp = 'trio'
          this.cb.onActiveAppChange('trio')
        }
        return
      }
      case 'game-action': {
        if (this.trioState && this.trioState.hostId === this.local.peerId) {
          this.handleHostTrioAction(id, msg.action)
        }
        return
      }
      case 'app:launch': {
        this.activeApp = msg.appId
        this.cb.onActiveAppChange(msg.appId)
        if (msg.appId) {
          const labels: Record<Exclude<AppActivityId, null>, string> = {
            trio: 'TRIO',
            wheel: 'Roleta',
            golf: 'Mini Golf',
          }
          this.toast('info', `🚀 ${link.info.name} iniciou ${labels[msg.appId]}`)
        }
        return
      }
      case 'wheel:update': {
        if (Array.isArray(msg.options)) {
          this.wheelState = { ...this.wheelState, options: msg.options }
          this.cb.onWheelChange(this.wheelState)
        }
        return
      }
      case 'wheel:spin': {
        if (typeof msg.targetAngle === 'number') {
          const spinId = ++this.spinSeq
          this.wheelState = {
            options: Array.isArray(msg.options) ? msg.options : this.wheelState.options,
            lastSpin: {
              spinId,
              targetAngle: msg.targetAngle,
              winnerIndex: msg.winnerIndex,
              startedBy: msg.startedBy || link.info.name,
              options: Array.isArray(msg.options) ? msg.options : this.wheelState.options,
            },
          }
          this.cb.onWheelChange(this.wheelState)
        }
        return
      }
      case 'golf:stroke': {
        if (typeof msg.vx === 'number' && typeof msg.vz === 'number') {
          this.cb.onGolfStroke({
            seq: ++this.golfSeq,
            peerId: msg.peerId || id,
            name: msg.name || link.info.name,
            vx: msg.vx,
            vz: msg.vz,
          })
        }
        return
      }
      case 'golf:reset': {
        this.cb.onGolfReset({
          seq: ++this.golfSeq,
          courseIndex: msg.courseIndex ?? 0,
        })
        return
      }
      case 'gamepad:grant': {
        if (!msg.guestId) {
          const wasMe = this.remotePlayGrant?.guestId === this.local.peerId
          this.remotePlayGrant = null
          this.notifyRemotePlay()
          if (wasMe) {
            this.toast('info', '🎮 O Host encerrou a sessão de Remote Play.')
          }
          return
        }
        this.remotePlayGrant = {
          hostId: msg.hostId || id,
          hostName: msg.hostName || link.info.name,
          guestId: msg.guestId,
          guestName: msg.guestName,
        }
        this.notifyRemotePlay()
        if (msg.guestId === this.local.peerId) {
          this.ensureGamepadChannel(link)
          this.toast('success', '🎮 Controle ativado! Conecte seu joystick para jogar')
        }
        return
      }
      case 'gamepad:state': {
        this.forwardGamepadPacketFromPeer(id, JSON.stringify(msg))
        return
      }
      case 'gamepad:release': {
        if (this.remotePlayGrant?.guestId === id) {
          this.sendCompanionRelease()
        }
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
      delete this.screenStreams[link.id]
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
    this.sentCustomSfxByPeer.delete(id)
    if (!this.destroyed) {
      this.chat.handlePeerLeft(id)
      if (wasGreeted) {
        this.chat.addSystemMessage(`${name} saiu da sala.`)
        playUiSfx('leave')
      }
      if (this.rpsDuel?.opponentId === id) {
        this.clearRpsTimer()
        this.rpsDuel = null
        this.cb.onRpsChange(null)
        this.toast('warning', `Duelo encerrado (${name} saiu da sala).`)
      }
      if (this.remotePlayGrant?.guestId === id || this.remotePlayGrant?.hostId === id) {
        this.sendCompanionRelease()
        this.remotePlayGrant = null
        this.notifyRemotePlay()
      }
    }
    if (notify && wasGreeted && !this.destroyed) this.toast('info', `${name} saiu da sala.`)
    this.emit()
  }

  private destroyLink(id: string): void {
    const link = this.links.get(id)
    if (!link) return
    this.links.delete(id)
    delete this.voiceStreams[id]
    delete this.screenStreams[id]
    if (link.teardownTimer !== null) window.clearTimeout(link.teardownTimer)
    if (link.helloTimer !== null) window.clearInterval(link.helloTimer)
    if (link.retryTimer !== null) window.clearTimeout(link.retryTimer)
    link.detector?.stop()
    link.detector = null
    if (link.gamepadChannel) {
      try {
        link.gamepadChannel.close()
      } catch {
        /* ignore */
      }
      link.gamepadChannel = null
    }
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
  //  Chamadas de mídia (separação rígida de voz e tela + SDP tuning)
  // ════════════════════════════════════════════════════════════════════

  private attachRemoteMicStream(link: PeerLink, call: MediaConnection, stream: MediaStream): void {
    // Nunca permite que uma chamada com trilha de vídeo sobrescreva o stream de voz
    if (stream.getVideoTracks().length > 0) {
      this.attachRemoteScreenStream(link, call, stream)
      return
    }
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) return

    if (link.info.micStream?.id === stream.id && this.voiceStreams[link.id]?.id === stream.id) return
    link.info.micStream = stream
    this.voiceStreams[link.id] = stream
    link.info.connectionState = 'connected'
    link.visible = true
    link.detector?.stop()

    const pc = call.peerConnection as RTCPeerConnection | undefined
    if (pc) {
      link.detector = new RemoteSpeakingDetector(pc, (speaking) => {
        link.info.speaking = speaking
        this.emit()
      })
    }
    this.emit()
  }

  private attachRemoteScreenStream(link: PeerLink, call: MediaConnection, stream: MediaStream): void {
    const pc = call.peerConnection as RTCPeerConnection | undefined
    if (pc) {
      tuneReceiversZeroLatency(pc)
    }
    const isNew = link.info.screenStream?.id !== stream.id
    link.info.screenStream = stream
    this.screenStreams[link.id] = stream
    link.info.sharing = true
    link.info.connectionState = 'connected'
    link.visible = true

    // Monitora adição ou desbloqueio (unmute) tardio de faixas de vídeo/áudio para evitar tela preta
    const onTrackChange = () => {
      if (this.destroyed || this.screenStreams[link.id]?.id !== stream.id) return
      this.emit()
    }
    stream.addEventListener('addtrack', onTrackChange)
    for (const track of stream.getVideoTracks()) {
      track.addEventListener('unmute', onTrackChange)
      track.addEventListener('ended', onTrackChange)
    }

    if (isNew) {
      this.toast('info', `🔴 ${link.info.name} iniciou uma transmissão de tela.`)
    }
    this.emit()
  }

  private hasLiveAudioTrack(stream: MediaStream | null | undefined): boolean {
    if (!stream) return false
    return stream.getAudioTracks().some((t) => t.readyState === 'live')
  }

  private callPeer(link: PeerLink, kind: MediaKind): void {
    const peer = this.peer
    if (!peer || peer.destroyed || peer.disconnected) return
    if (kind === 'mic' && !this.micStream) {
      this.useSilentMicrophone()
    }
    const stream = kind === 'mic' ? this.micStream : this.screenStream
    if (!stream) return

    const callSuffix = kind === 'screen' ? 'screen' : 'voice'
    const callId = `${this.local.peerId}-${callSuffix}`
    const call = peer.call(link.id, stream, {
      metadata: {
        kind,
        callId,
        streamType: callSuffix,
        name: this.local.name,
      },
      sdpTransform: kind === 'mic' ? tuneVoiceSdp : tuneScreenSdp,
    })
    if (!call) return

    if (kind === 'mic') {
      if (link.micOut && link.micOut !== call) {
        try {
          link.micOut.close()
        } catch {
          /* ignore */
        }
      }
      link.micOut = call
    } else {
      if (link.screenOut && link.screenOut !== call) {
        try {
          link.screenOut.close()
        } catch {
          /* ignore */
        }
      }
      link.screenOut = call
    }

    // Se o par responder call.answer(stream), separamos estritamente voz vs tela
    call.on('stream', (remoteStream) => {
      const l = this.links.get(link.id)
      if (!l || this.destroyed) return
      if (kind === 'screen' || remoteStream.getVideoTracks().length > 0) {
        this.attachRemoteScreenStream(l, call, remoteStream)
      } else if (remoteStream.getAudioTracks().length > 0) {
        this.attachRemoteMicStream(l, call, remoteStream)
      }
    })

    call.on('close', () => {
      const l = this.links.get(link.id)
      if (!l) return
      if (kind === 'mic' && l.micOut === call) {
        l.micOut = null
        // Só limpa o stream de voz se não houver outra chamada de voz ativa com áudio vivo
        if (!l.micIn && !this.hasLiveAudioTrack(l.info.micStream)) {
          l.info.micStream = null
          delete this.voiceStreams[link.id]
          this.emit()
        }
      }
      if (kind === 'screen' && l.screenOut === call) {
        l.screenOut = null
      }
    })
    call.on('error', (err) => {
      console.warn(`[WebRTC] call ${kind} (out)`, err)
      this.schedulePeerRecovery(link.id)
    })
    this.watchConnection(link, call, kind, true)
  }

  private handleIncomingCall(call: MediaConnection): void {
    if (this.destroyed) {
      call.close()
      return
    }
    const id = call.peer
    this.emptySlotCooldowns.delete(id)
    const meta = (call.metadata ?? {}) as {
      kind?: unknown
      callId?: unknown
      streamType?: unknown
      name?: unknown
    }
    const callIdStr = typeof meta.callId === 'string' ? meta.callId : ''
    const isScreenMeta =
      meta.kind === 'screen' || meta.streamType === 'screen' || callIdStr.endsWith('-screen')
    const kind: MediaKind = isScreenMeta ? 'screen' : 'mic'
    const link = this.ensureLink(id, meta.name, true)
    this.emit()

    // Chamadas de voz são atendidas com o microfone local; chamadas de tela nunca tocam no canal de voz
    if (kind === 'mic') {
      if (!this.micStream) this.useSilentMicrophone()
      call.answer(this.micStream ?? undefined, {
        sdpTransform: tuneVoiceSdp,
      })
      if (link.micIn && link.micIn !== call) {
        try {
          link.micIn.close()
        } catch {
          /* ignore */
        }
      }
      link.micIn = call
    } else {
      call.answer(undefined, {
        sdpTransform: tuneScreenSdp,
      })
      if (link.screenIn && link.screenIn !== call) {
        try {
          link.screenIn.close()
        } catch {
          /* ignore */
        }
      }
      link.screenIn = call
    }

    // Garante que o DataChannel também esteja ativo
    if (!link.data?.open && !this.pending.has(id)) {
      this.connectTo(id)
    }

    call.on('stream', (stream) => {
      const l = this.links.get(id)
      if (!l || this.destroyed) return
      const isScreenStream = kind === 'screen' || stream.getVideoTracks().length > 0
      if (isScreenStream) {
        l.screenIn = call
        this.attachRemoteScreenStream(l, call, stream)
      } else {
        this.attachRemoteMicStream(l, call, stream)
      }
    })

    call.on('close', () => {
      const l = this.links.get(id)
      if (!l) return
      if (kind === 'screen' && l.screenIn === call) {
        l.screenIn = null
        l.info.screenStream = null
        delete this.screenStreams[id]
      } else if (kind === 'mic' && l.micIn === call) {
        l.micIn = null
        // Preserva o áudio caso l.micOut continue ativo e fornecendo trilha viva
        if (!l.micOut || !this.hasLiveAudioTrack(l.info.micStream)) {
          l.info.micStream = null
          delete this.voiceStreams[id]
          l.detector?.stop()
          l.detector = null
          l.info.speaking = false
        }
      }
      this.emit()
    })
    call.on('error', (err) => {
      console.warn(`[WebRTC] call ${kind} (in)`, err)
      this.schedulePeerRecovery(id)
    })
    this.watchConnection(link, call, kind, false)
  }

  private watchConnection(link: PeerLink, call: MediaConnection, kind: MediaKind, outgoing: boolean): void {
    const pc = call.peerConnection as RTCPeerConnection | undefined
    if (!pc) return

    const applyTuning = () => {
      if (outgoing && kind === 'screen') {
        void tuneScreenSender(pc, this.screenPreset)
      } else if (outgoing || kind === 'mic') {
        void tuneSenders(pc, kind)
      }
      if (!outgoing && kind === 'screen') {
        tuneReceiversZeroLatency(pc)
      }
    }

    if (!outgoing && kind === 'screen') {
      try {
        pc.addEventListener('track', () => tuneReceiversZeroLatency(pc))
      } catch {
        /* ignore */
      }
    }

    const onState = () => {
      if (this.destroyed) return
      const state = pc.connectionState
      const ice = pc.iceConnectionState
      if (state === 'connected' || ice === 'connected' || ice === 'completed') {
        applyTuning()
        if (link.info.connectionState !== 'connected') {
          link.info.connectionState = 'connected'
          this.emit()
        }
      } else if (state === 'failed' || ice === 'failed' || ice === 'disconnected') {
        console.warn(`[WebRTC] ICE state=${ice} / conn=${state} (${kind}) com ${link.id}. Renegociando...`)
        try {
          pc.restartIce?.()
        } catch {
          /* ignore */
        }
        if (state === 'failed' || ice === 'failed') {
          pc.removeEventListener('connectionstatechange', onState)
          pc.oniceconnectionstatechange = null
          link.info.connectionState = 'error'
          this.emit()
          call.close()
        }
        this.schedulePeerRecovery(link.id)
      }
    }
    pc.addEventListener('connectionstatechange', onState)
    pc.oniceconnectionstatechange = onState

    if (pc.connectionState === 'connected') {
      applyTuning()
    }
  }

  // ════════════════════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════════════════════

  private clearRpsTimer(): void {
    if (this.rpsRevealTimer !== null) {
      window.clearTimeout(this.rpsRevealTimer)
      this.rpsRevealTimer = null
    }
  }

  private clearTrioTimers(): void {
    if (this.trioResolveTimer !== null) {
      window.clearTimeout(this.trioResolveTimer)
      this.trioResolveTimer = null
    }
    if (this.trioBotTimer !== null) {
      window.clearTimeout(this.trioBotTimer)
      this.trioBotTimer = null
    }
  }

  private handleRpsMessage(fromId: string, fromName: string, msg: PeerMessage): void {
    switch (msg.type) {
      case 'rps-challenge': {
        // Se já estiver em outro duelo ativo, recusa automaticamente
        if (this.rpsDuel && this.rpsDuel.opponentId !== fromId) {
          const challenger = this.links.get(fromId)
          if (challenger?.data?.open) {
            this.send(challenger.data, { type: 'rps-decline', matchId: msg.matchId })
          }
          return
        }
        this.clearRpsTimer()
        this.rpsDuel = {
          matchId: msg.matchId,
          status: 'incoming-invite',
          opponentId: fromId,
          opponentName: fromName,
          round: 1,
          myScore: 0,
          opponentScore: 0,
          myChoice: null,
          opponentChoice: null,
          opponentLockedIn: false,
          roundWinner: null,
          matchWinner: null,
        }
        playUiSfx('message')
        this.cb.onRpsChange({ ...this.rpsDuel })
        return
      }
      case 'rps-accept': {
        if (!this.rpsDuel || this.rpsDuel.matchId !== msg.matchId || this.rpsDuel.opponentId !== fromId) return
        this.rpsDuel.status = 'playing'
        playUiSfx('join')
        this.cb.onRpsChange({ ...this.rpsDuel })
        return
      }
      case 'rps-decline': {
        if (!this.rpsDuel || this.rpsDuel.matchId !== msg.matchId || this.rpsDuel.opponentId !== fromId) return
        this.clearRpsTimer()
        this.rpsDuel = null
        this.cb.onRpsChange(null)
        this.toast('info', `${fromName} recusou o desafio de Pedra, Papel e Tesoura.`)
        return
      }
      case 'rps-move': {
        const duel = this.rpsDuel
        if (!duel || duel.matchId !== msg.matchId || duel.opponentId !== fromId) return
        if (duel.status !== 'playing' || msg.round !== duel.round) return
        duel.opponentChoice = msg.choice
        duel.opponentLockedIn = true
        if (duel.myChoice) {
          this.resolveRpsRound()
        } else {
          // Mantém opponentChoice oculto na UI até o jogador local escolher
          this.cb.onRpsChange({ ...duel, opponentChoice: null })
        }
        return
      }
      case 'rps-rematch': {
        const duel = this.rpsDuel
        if (!duel || duel.matchId !== msg.matchId || duel.opponentId !== fromId) return
        this.clearRpsTimer()
        duel.status = 'playing'
        duel.round = 1
        duel.myScore = 0
        duel.opponentScore = 0
        duel.myChoice = null
        duel.opponentChoice = null
        duel.opponentLockedIn = false
        duel.roundWinner = null
        duel.matchWinner = null
        playUiSfx('join')
        this.cb.onRpsChange({ ...duel })
        return
      }
      case 'rps-close': {
        if (!this.rpsDuel || this.rpsDuel.matchId !== msg.matchId || this.rpsDuel.opponentId !== fromId) return
        this.clearRpsTimer()
        this.rpsDuel = null
        this.cb.onRpsChange(null)
        this.toast('info', `${fromName} fechou o duelo.`)
        return
      }
      default:
        return
    }
  }

  private resolveRpsRound(): void {
    const duel = this.rpsDuel
    if (!duel || !duel.myChoice || !duel.opponentChoice) return
    const a = duel.myChoice
    const b = duel.opponentChoice
    let winner: 'me' | 'opponent' | 'draw' = 'draw'
    if (a !== b) {
      const aWins =
        (a === 'rock' && b === 'scissors') ||
        (a === 'paper' && b === 'rock') ||
        (a === 'scissors' && b === 'paper')
      winner = aWins ? 'me' : 'opponent'
    }

    if (winner === 'me') duel.myScore++
    else if (winner === 'opponent') duel.opponentScore++

    duel.roundWinner = winner
    duel.status = 'round-reveal'
    this.cb.onRpsChange({ ...duel })

    this.clearRpsTimer()
    this.rpsRevealTimer = window.setTimeout(() => {
      this.rpsRevealTimer = null
      const current = this.rpsDuel
      if (!current || current.status !== 'round-reveal') return
      if (current.myScore >= 2 || current.opponentScore >= 2) {
        current.status = 'finished'
        current.matchWinner = current.myScore >= 2 ? 'me' : 'opponent'
      } else {
        current.round++
        current.status = 'playing'
        current.myChoice = null
        current.opponentChoice = null
        current.opponentLockedIn = false
        current.roundWinner = null
      }
      this.cb.onRpsChange({ ...current })
    }, 2100)
  }

  private handleHostTrioAction(actorId: string, action: TrioAction): void {
    if (!this.trioState || this.trioState.hostId !== this.local.peerId) return
    const { next, needsDelayResolution } = applyTrioAction(this.trioState, actorId, action)
    if (next === this.trioState) return

    this.clearTrioTimers()
    this.trioState = next
    this.broadcastTrioState(next)
    this.cb.onTrioChange(next)

    if (needsDelayResolution) {
      this.trioResolveTimer = window.setTimeout(() => {
        this.trioResolveTimer = null
        if (!this.trioState || this.trioState.hostId !== this.local.peerId) return
        const resolved = resolveTrioTurnAfterDelay(this.trioState)
        this.trioState = resolved
        this.broadcastTrioState(resolved)
        this.cb.onTrioChange(resolved)
        this.scheduleTrioBotIfNeeded()
      }, 2000)
    } else {
      this.scheduleTrioBotIfNeeded()
    }
  }

  private scheduleTrioBotIfNeeded(): void {
    const state = this.trioState
    if (!state || state.hostId !== this.local.peerId || state.phase !== 'playing') return
    const current = state.players[state.turnIndex]
    if (!current || current.peerId !== BOT_PEER_ID) return

    this.trioBotTimer = window.setTimeout(() => {
      this.trioBotTimer = null
      if (!this.trioState || this.trioState.phase !== 'playing') return
      const botAction = chooseBotTrioAction(this.trioState)
      if (botAction) this.handleHostTrioAction(BOT_PEER_ID, botAction)
    }, 1100)
  }

  private broadcastTrioState(state: TrioGameState | null): void {
    this.broadcastMsg({ type: 'game-state', state })
  }

  private broadcastMsg(msg: PeerMessage): void {
    for (const link of this.links.values()) {
      if (link.data?.open) this.send(link.data, msg)
    }
  }

  /**
   * Abre o DataConnection dedicado a arquivos em modo RAW (`serialization: 'raw'`),
   * sem BinaryPack do PeerJS, garantindo que ArrayBuffers de 16 KB cheguem intactos.
   */
  private openFileChannel(peerId: string): DataConnection | null {
    const peer = this.peer
    if (this.destroyed || !peer || peer.destroyed || peer.disconnected) return null
    return (
      peer.connect(peerId, {
        reliable: true,
        serialization: 'raw',
        metadata: { channel: FILES_CHANNEL, name: this.local.name },
      }) ?? null
    )
  }

  /** Chrome 141+ suporta remover o áudio do próprio documento da captura de sistema. */
  private supportsOwnAudioRestriction(): boolean {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() as Record<string, boolean> | undefined
    return !!supported?.restrictOwnAudio
  }

  private send(conn: DataConnection, msg: PeerMessage): void {
    try {
      if (conn.open) void conn.send(msg)
    } catch (err) {
      console.warn('[WebRTC] send', err)
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
      .filter((l) => l.visible || l.greeted)
      .map((l) => ({ ...l.info }))
    this.cb.onChange({
      status: this.status,
      room: this.room,
      local: { ...this.local, screenStream: this.screenStream },
      participants,
      voiceStreams: { ...this.voiceStreams },
      screenStreams: { ...this.screenStreams },
    })
  }
}
