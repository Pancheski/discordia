/**
 * Sanitização de entradas do usuário, validação de URLs e Type Guards de pacotes P2P.
 *
 * Previne XSS, injeção de caracteres invisíveis/bidi, URLs maliciosas (`javascript:`, `data:`)
 * e payloads corrompidos/fora de faixa no DataChannel (Remote Play e Mini Golf).
 */

export const MAX_USERNAME_LENGTH = 24
export const MAX_ROOM_NAME_LENGTH = 32
export const MAX_CHAT_MESSAGE_LENGTH = 1000

const HTML_TAG_RE = /<\/?[a-z][^>]*>/gi
const CONTROL_CHARS_INLINE_RE = /[\p{Cc}\p{Cf}]/gu
const CONTROL_CHARS_MULTILINE_RE = /(?!\n)[\p{Cc}\p{Cf}]/gu

/** Remove tags HTML e caracteres de controle invisíveis (incluindo bidi overrides). */
export function stripHtmlAndControl(input: string, preserveNewlines = false): string {
  const withoutTags = input.replace(HTML_TAG_RE, '').replace(/[<>]/g, '')
  return withoutTags.replace(preserveNewlines ? CONTROL_CHARS_MULTILINE_RE : CONTROL_CHARS_INLINE_RE, '')
}

/** Sanitiza apelido do usuário (máx. 24 chars, sem HTML/controle). */
export function sanitizeUsername(value: unknown): string {
  if (typeof value !== 'string') return 'Anônimo'
  const clean = stripHtmlAndControl(value, false).replace(/\s+/g, ' ').trim().slice(0, MAX_USERNAME_LENGTH)
  return clean || 'Anônimo'
}

/** Normaliza nome de sala para slug seguro (máx. 32 chars, apenas `[a-z0-9-]`). */
export function sanitizeRoomSlug(value: unknown): string {
  if (typeof value !== 'string') return ''
  return stripHtmlAndControl(value, false)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ROOM_NAME_LENGTH)
}

/** Sanitiza nome de exibição da sala (máx. 32 chars, sem HTML/controle). */
export function sanitizeRoomDisplayName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return stripHtmlAndControl(value, false).replace(/\s+/g, ' ').trim().slice(0, MAX_ROOM_NAME_LENGTH)
}

/** Sanitiza mensagem de chat (máx. 1000 chars, preserva quebras de linha, remove HTML/controle). */
export function sanitizeChatMessage(value: unknown): string {
  if (typeof value !== 'string') return ''
  return stripHtmlAndControl(value, true).trim().slice(0, MAX_CHAT_MESSAGE_LENGTH)
}

/** Valida URLs renderizadas em links/previews: permite SOMENTE `http:` e `https:`. */
export function sanitizeUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) return null
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.href
  } catch {
    return null
  }
}

// ─── Type Guards e Sanitizadores de Pacotes DataChannel ──────────────────────

export interface SanitizedGamepadPacket {
  type: 'gamepad:state'
  slot: number
  player: number
  buttons: number[]
  axes: [number, number, number, number]
  triggers?: [number, number]
}

const MAX_GAMEPAD_BUTTONS = 17
const MAX_GOLF_VELOCITY = 100

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isValidSlot(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4
}

/**
 * Type Guard estrito para pacotes `gamepad:state`.
 * Descarta propriedades desconhecidas e garante limites numéricos de controle (botões 0..1, eixos -1..1).
 */
export function sanitizeGamepadPayload(raw: unknown, authorizedSlot: number): SanitizedGamepadPacket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!isValidSlot(authorizedSlot)) return null

  const obj = raw as Record<string, unknown>
  if (obj.type !== undefined && obj.type !== 'gamepad:state') return null

  if (!Array.isArray(obj.buttons) || obj.buttons.length > MAX_GAMEPAD_BUTTONS) return null
  if (!Array.isArray(obj.axes) || obj.axes.length !== 4) return null

  const buttons: number[] = []
  for (const b of obj.buttons) {
    if (!isFiniteNumber(b)) return null
    buttons.push(clampNum(b, 0, 1))
  }

  const axesRaw: number[] = []
  for (const a of obj.axes) {
    if (!isFiniteNumber(a)) return null
    axesRaw.push(clampNum(a, -1, 1))
  }

  const packet: SanitizedGamepadPacket = {
    type: 'gamepad:state',
    slot: authorizedSlot,
    player: authorizedSlot,
    buttons,
    axes: [axesRaw[0], axesRaw[1], axesRaw[2], axesRaw[3]],
  }

  if (obj.triggers !== undefined) {
    if (!Array.isArray(obj.triggers) || obj.triggers.length !== 2) return null
    if (!isFiniteNumber(obj.triggers[0]) || !isFiniteNumber(obj.triggers[1])) return null
    packet.triggers = [clampNum(obj.triggers[0], 0, 1), clampNum(obj.triggers[1], 0, 1)]
  }

  return packet
}

export interface SanitizedGolfStroke {
  vx: number
  vz: number
}

export function sanitizeGolfStroke(raw: unknown): SanitizedGolfStroke | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (!isFiniteNumber(obj.vx) || !isFiniteNumber(obj.vz)) return null
  return {
    vx: clampNum(obj.vx, -MAX_GOLF_VELOCITY, MAX_GOLF_VELOCITY),
    vz: clampNum(obj.vz, -MAX_GOLF_VELOCITY, MAX_GOLF_VELOCITY),
  }
}

export interface SanitizedGolfReset {
  courseIndex: number
}

export function sanitizeGolfReset(raw: unknown): SanitizedGolfReset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj.courseIndex === undefined) return { courseIndex: 0 }
  if (!isFiniteNumber(obj.courseIndex) || !Number.isInteger(obj.courseIndex)) return null
  if (obj.courseIndex < 0 || obj.courseIndex > 50) return null
  return { courseIndex: obj.courseIndex }
}

export interface SanitizedGolfHole {
  seed: number
  holeNumber: number
  par: number
}

export function sanitizeGolfHole(raw: unknown): SanitizedGolfHole | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (!isFiniteNumber(obj.seed)) return null
  const holeNumber = obj.holeNumber === undefined ? 1 : obj.holeNumber
  const par = obj.par === undefined ? 3 : obj.par
  if (!isFiniteNumber(holeNumber) || !Number.isInteger(holeNumber) || holeNumber < 1 || holeNumber > 99) return null
  if (!isFiniteNumber(par) || !Number.isInteger(par) || par < 1 || par > 12) return null
  return { seed: obj.seed, holeNumber, par }
}