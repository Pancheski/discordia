/** Prefixo global usado nos IDs do servidor público do PeerJS (evita colisão com outros apps). */
export const APP_PREFIX = 'discordia-v1'

/** Limite de participantes por sala (mesh completo: n*(n-1) conexões). */
export const MAX_PEERS = 6

/** Normaliza o nome da sala para um slug seguro para IDs PeerJS e URLs. */
export function slugifyRoom(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

/** Gera ou recupera um ID único de sessão para a aba atual no sessionStorage */
export function getOrCreateSessionId(room: string): string {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const key = `discordia:session:${room}`
      let sid = sessionStorage.getItem(key)
      if (!sid || sid.length < 4) {
        sid = Math.random().toString(36).slice(2, 10)
        sessionStorage.setItem(key, sid)
      }
      return sid
    }
  } catch {
    /* fallback */
  }
  return Math.random().toString(36).slice(2, 10)
}

/** Gera um peerId determinístico e único para a sessão da aba na sala */
export function generateSessionPeerId(room: string, customSessionId?: string): string {
  const sid = customSessionId || getOrCreateSessionId(room)
  return `${APP_PREFIX}-${room}-${sid}`
}

/** Mantido para retrocompatibilidade em discovery */
export function slotPeerId(room: string, slot: number): string {
  return `${APP_PREFIX}-${room}-${slot}`
}

/** Obtém o nome da sala a partir da URL (?room=nome ou #nome) */
export function getRoomFromUrl(): string {
  try {
    if (typeof window === 'undefined') return ''

    // 1. Tenta query param: ?room=minha-sala
    const params = new URLSearchParams(window.location.search)
    const fromQuery = params.get('room')
    if (fromQuery) return slugifyRoom(fromQuery)

    // 2. Tenta hash: /#minha-sala ou #minha-sala
    const rawHash = window.location.hash.replace(/^#\/?/, '')
    if (rawHash) return slugifyRoom(decodeURIComponent(rawHash))
  } catch {
    /* fallback */
  }
  return ''
}

/** Alias para compatibilidade */
export const getRoomFromHash = getRoomFromUrl

/** Verifica se a URL atual contém uma indicação explícita de sala */
export function hasRoomInUrl(): boolean {
  return getRoomFromUrl().length > 0
}

/** Gera a URL formatada pronta para compartilhamento */
export function buildRoomLink(room: string): string {
  if (typeof window === 'undefined') return ''
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}?room=${encodeURIComponent(slugifyRoom(room))}`
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = ['#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c', '#e67e22']

export function colorFromString(value: string): string {
  let hash = 0
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}

export function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return 'Anônimo'
  const clean = value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 32)
  return clean || 'Anônimo'
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* cai no fallback abaixo */
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

const ROOM_A = ['sala', 'toca', 'base', 'covil', 'bunker', 'taverna', 'garagem']
const ROOM_B = ['dos-amigos', 'secreta', 'gamer', 'noturna', 'do-caos', 'lendaria', 'chill']

export function randomRoomName(): string {
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
  return `${pick(ROOM_A)}-${pick(ROOM_B)}-${Math.floor(100 + Math.random() * 900)}`
}

export interface MediaCapabilities {
  secureContext: boolean
  microphone: boolean
  screenShare: boolean
}

export function detectCapabilities(): MediaCapabilities {
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
  return {
    secureContext: typeof window !== 'undefined' && window.isSecureContext,
    microphone: !!md?.getUserMedia,
    screenShare: !!md?.getDisplayMedia,
  }
}
