export type RoomStatus = 'idle' | 'connecting' | 'connected' | 'error'

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
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

/** Mensagens trocadas pelo DataChannel de controle */
export type PeerMessage =
  | { type: 'hello'; name: string; muted: boolean; sharing: boolean }
  | { type: 'state'; muted: boolean; sharing: boolean }
  | { type: 'bye' }
