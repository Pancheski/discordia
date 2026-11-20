/**
 * Hash de senhas de sala no cliente (Web Crypto API nativa).
 *
 * A senha original NUNCA sai do navegador: apenas o SHA-256 de `${roomId}:${senha}`
 * é gravado no Firebase. O `roomId` funciona como salt, então a mesma senha gera
 * hashes diferentes em salas diferentes.
 */

const SESSION_PREFIX = 'discordia:room-auth:'

function getSubtle(): SubtleCrypto {
  const subtle = typeof window !== 'undefined' ? window.crypto?.subtle : undefined
  if (!subtle) {
    throw new Error('Criptografia indisponível: a página precisa estar em HTTPS ou localhost.')
  }
  return subtle
}

export async function hashRoomPassword(roomId: string, password: string): Promise<string> {
  const data = new TextEncoder().encode(`${roomId}:${password.trim()}`)
  const digest = await getSubtle().digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Comparação em tempo constante (evita vazar prefixos corretos por timing). */
export function safeEqualHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Hash validado da sala salvo na aba atual (permite F5 sem digitar a senha de novo). */
export function getStoredRoomHash(roomId: string): string | null {
  try {
    return sessionStorage.getItem(SESSION_PREFIX + roomId)
  } catch {
    return null
  }
}

export function storeRoomHash(roomId: string, hash: string): void {
  try {
    sessionStorage.setItem(SESSION_PREFIX + roomId, hash)
  } catch {
    /* modo privado / quota */
  }
}

export function clearStoredRoomHash(roomId: string): void {
  try {
    sessionStorage.removeItem(SESSION_PREFIX + roomId)
  } catch {
    /* noop */
  }
}

