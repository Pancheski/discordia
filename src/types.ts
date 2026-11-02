export type RoomStatus = 'idle' | 'connecting' | 'connected' | 'error'

export type PeerConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'error'

export type MediaKind = 'mic' | 'screen'

export interface RemoteParticipant {
  peerId: string
  name: string
  muted: boolean
  sharing: boolean
  speaking: boolean
  micStream: MediaStream | null
  screenStream: MediaStream | null
  /** 0..1 — volume local aplicado à voz deste participante */
  voiceVolume: number
  /** 0..1 — volume local aplicado ao áudio da tela deste participante */
  screenVolume: number
  /** Estado detalhado da conexão P2P/ICE com este participante */
  connectionState: PeerConnectionState
}

export interface LocalState {
  peerId: string
  name: string
  slot: number
  muted: boolean
  micAvailable: boolean
  speaking: boolean
  screenStream: MediaStream | null
  screenHasAudio: boolean
}

export interface RoomSnapshot {
  status: RoomStatus
  room: string
  local: LocalState
  participants: RemoteParticipant[]
  /** Mapa explícito e isolado apenas com as faixas de áudio de voz (microfone) por peerId */
  voiceStreams: Record<string, MediaStream>
  /** Mapa explícito e isolado apenas com as faixas de vídeo/áudio de tela por peerId */
  screenStreams: Record<string, MediaStream>
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

/** Metadados de um arquivo anunciado na sala */
export interface FileMeta {
  name: string
  size: number
  mime: string
}

/** Mensagens trocadas pelo DataChannel de controle */
export type PeerMessage =
  | { type: 'hello'; name: string; muted: boolean; sharing: boolean }
  | { type: 'hello-ack'; name: string; muted: boolean; sharing: boolean }
  | { type: 'state'; muted: boolean; sharing: boolean }
  | { type: 'bye' }
  | { type: 'chat'; id: string; text: string; ts: number }
  | { type: 'file-offer'; id: string; ts: number; file: FileMeta }
  | { type: 'file-cancel'; id: string }
  | { type: 'play-sfx'; sfxId: string; customName?: string; dataUrl?: string }
  | { type: 'rps-challenge'; matchId: string }
  | { type: 'rps-accept'; matchId: string }
  | { type: 'rps-decline'; matchId: string }
  | { type: 'rps-move'; matchId: string; round: number; choice: RpsChoice }
  | { type: 'rps-rematch'; matchId: string }
  | { type: 'rps-close'; matchId: string }
  | { type: 'game-state'; state: TrioGameState | null }
  | { type: 'game-action'; action: TrioAction }
  | { type: 'app:launch'; appId: AppActivityId }
  | { type: 'wheel:update'; options: string[] }
  | { type: 'wheel:spin'; targetAngle: number; winnerIndex: number; startedBy: string; options: string[] }
  | { type: 'golf:stroke'; peerId: string; name: string; vx: number; vz: number }
  | { type: 'golf:reset'; courseIndex?: number }
  | {
      type: 'gamepad:grant'
      hostId: string
      hostName: string
      guestId: string | null
      guestName: string | null
    }
  | {
      type: 'gamepad:state'
      player: number
      buttons: number[]
      axes: [number, number, number, number]
      triggers?: [number, number]
    }
  | { type: 'gamepad:release' }

// ─── Remote Play / Jogar Junto (Gamepad API -> WebRTC -> ViGEmBus) ──────

export interface GamepadStatePayload {
  type: 'gamepad:state'
  player: number
  /** 17 botões padrão W3C/XInput (0 ou 1; índices 6 e 7 podem conter o valor contínuo 0..1 dos gatilhos LT/RT) */
  buttons: number[]
  /** [LeftStickX, LeftStickY, RightStickX, RightStickY] em [-1, 1] já com deadzone aplicada */
  axes: [number, number, number, number]
  /** [LeftTrigger, RightTrigger] em [0, 1] */
  triggers?: [number, number]
}

export interface RemotePlayGrant {
  hostId: string
  hostName: string
  guestId: string | null
  guestName: string | null
}

// ─── Central de Atividades / Apps da Sala ───────────────────────────────

export type AppActivityId = 'trio' | 'wheel' | 'golf' | null

// ─── Roleta de Decisões 3D (Wheel of Decisions) ─────────────────────────

export interface WheelSpinEvent {
  spinId: number
  targetAngle: number
  winnerIndex: number
  startedBy: string
  options: string[]
}

export interface WheelState {
  options: string[]
  lastSpin: WheelSpinEvent | null
}

// ─── Mini Golf 3D Multiplayer ───────────────────────────────────────────

export interface GolfStrokeEvent {
  seq: number
  peerId: string
  name: string
  vx: number
  vz: number
}

export interface GolfResetEvent {
  seq: number
  courseIndex: number
}

// ─── Duelo 1v1: Pedra, Papel e Tesoura (Melhor de 3) ────────────────────

export type RpsChoice = 'rock' | 'paper' | 'scissors'

export type RpsDuelStatus = 'incoming-invite' | 'waiting-accept' | 'playing' | 'round-reveal' | 'finished'

export interface RpsDuelState {
  matchId: string
  status: RpsDuelStatus
  opponentId: string
  opponentName: string
  round: number
  myScore: number
  opponentScore: number
  myChoice: RpsChoice | null
  opponentChoice: RpsChoice | null
  /** Indica se o oponente já escolheu na rodada atual (mantendo o voto secreto até ambos votarem) */
  opponentLockedIn: boolean
  roundWinner: 'me' | 'opponent' | 'draw' | null
  matchWinner: 'me' | 'opponent' | null
}

// ─── Minigame de Sala: Jogo de Cartas TRIO ──────────────────────────────

export interface TrioCard {
  uid: string
  /** 1..12 (3 cópias de cada número no baralho de 36 cartas) */
  value: number
  revealed: boolean
}

export interface TrioPlayerState {
  peerId: string
  name: string
  /** Sempre ordenada do menor para o maior */
  hand: TrioCard[]
  /** Números dos trios já conquistados por este jogador */
  trios: number[]
}

export interface TrioTurnReveal {
  source: 'hand' | 'table'
  targetPeerId?: string
  edge?: 'lowest' | 'highest'
  cardUid: string
  value: number
}

export type TrioPhase = 'playing' | 'mismatch' | 'trio-claimed' | 'finished'

export interface TrioGameState {
  matchId: string
  hostId: string
  phase: TrioPhase
  players: TrioPlayerState[]
  tableCards: TrioCard[]
  turnIndex: number
  currentReveals: TrioTurnReveal[]
  lastEvent: string
  winnerId: string | null
  winnerName: string | null
  winReason: string | null
}

export type TrioAction =
  | { kind: 'reveal-hand'; targetPeerId: string; edge: 'lowest' | 'highest' }
  | { kind: 'reveal-table'; cardUid: string }
  | { kind: 'restart' }

/**
 * Protocolo de pacotes estruturados do canal de arquivos (serialization: 'raw', binaryType: 'arraybuffer').
 * • Pacotes de controle (file-start, file-end, file-abort) trafegam como JSON string.
 * • Pacotes de dados trafegam como ArrayBuffer puro de 16 KB (16.384 bytes) em ordem.
 */
export interface FileStartPacket {
  type: 'file-start'
  fileId: string
  name: string
  size: number
  mimeType: string
  totalChunks: number
}

export interface FileEndPacket {
  type: 'file-end'
  fileId: string
}

export interface FileAbortPacket {
  type: 'file-abort'
  fileId: string
}

export type FileControlPacket = FileStartPacket | FileEndPacket | FileAbortPacket

// ─── Chat ───────────────────────────────────────────────────────────────

export type TransferStatus = 'pending' | 'transferring' | 'done' | 'error' | 'canceled'

export interface FileTransfer {
  id: string
  direction: 'send' | 'receive'
  file: FileMeta
  /** Chunks de 16 KB já enviados/recebidos */
  chunksProcessed: number
  /** Total de chunks de 16 KB do arquivo */
  totalChunks: number
  /** Bytes confirmados (envio: mínimo entre os destinatários; recebimento: bytes recebidos) */
  bytes: number
  status: TransferStatus
  /** Object URL do Blob reconstruído (recebimento concluído) ou do arquivo local (envio) */
  url: string | null
  /** Taxa média em bytes/s */
  rate: number
  error?: string
}

interface ChatMessageBase {
  id: string
  authorId: string
  authorName: string
  ts: number
  isLocal: boolean
}

export interface ChatTextMessage extends ChatMessageBase {
  kind: 'text'
  text: string
}

export interface ChatFileMessage extends ChatMessageBase {
  kind: 'file'
  transferId: string
}

export interface ChatSystemMessage extends ChatMessageBase {
  kind: 'system'
  text: string
}

export type ChatMessage = ChatTextMessage | ChatFileMessage | ChatSystemMessage

export interface ChatSnapshot {
  messages: ChatMessage[]
  transfers: Record<string, FileTransfer>
}

export interface ElectronBridge {
  isElectron: boolean
  platform: string
  sendGamepadState: (payload: unknown) => void
  releaseGamepad: () => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
}

declare global {
  interface Window {
    electron?: ElectronBridge
  }
}

