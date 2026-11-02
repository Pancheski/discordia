import { getApps, initializeApp } from 'firebase/app'
import {
  getDatabase,
  onDisconnect,
  onValue,
  ref,
  remove,
  update,
} from 'firebase/database'
import type { Database } from 'firebase/database'

/**
 * PRESENÇA E SINALIZAÇÃO DE SALAS (Firebase Realtime Database + Fallback Local)
 * ─────────────────────────────────────────────────────────────────────────────
 * Estrutura em `/<root>/<roomId>`:
 *   {
 *     name: string,
 *     count: number,
 *     last_seen: number,
 *     members: {
 *       [peerId]: { name: string, last_seen: number, joined_at: number }
 *     }
 *   }
 *
 * Funcionalidades:
 * • Escuta ativa em tempo real (`onValue`) em `discordia_rooms/${roomId}/members`.
 * • `onDisconnect().remove()` nativo do Firebase + HTTP `DELETE` (`keepalive: true`) no unload.
 * • Sincronização automática de `count = Object.keys(roomData.members || {}).length`.
 */

export const PRESENCE_HEARTBEAT_MS = 15_000
export const PRESENCE_STALE_MS = 35_000
export const PRESENCE_POLL_MS = 5_000

export type PresenceKind = 'firebase' | 'local' | 'off'

export interface ActiveRoom {
  id: string
  name: string
  online: number
  lastSeen: number
}

export interface PresenceMember {
  id: string
  name: string
  joinedAt?: number
}

export interface PresenceRoomMember {
  id: string
  name: string
  joinedAt: number
  lastSeen: number
}

export interface PresenceProvider {
  readonly kind: PresenceKind
  list(): Promise<ActiveRoom[]>
  getRoomMembers(roomId: string): Promise<PresenceRoomMember[]>
  /** Escuta em tempo real as alterações em `discordia_rooms/${roomId}/members`. */
  watchRoomMembers(roomId: string, callback: (members: PresenceRoomMember[]) => void): () => void
  heartbeat(roomId: string, roomName: string | undefined, member: PresenceMember, count?: number): Promise<void>
  /** Remove `discordia_rooms/${roomId}/members/${memberId}` via SDK e HTTP DELETE keepalive. */
  leave(roomId: string, memberId: string, isLast: boolean): void
  /** Remove salas sem pulso (best-effort). */
  prune(roomIds: string[]): void
  /** Notificação push de mudanças nas salas. */
  subscribe?(listener: () => void): () => void
}

// ─── Modelo bruto + normalização ───────────────────────────────────────

interface RawMember {
  name?: unknown
  last_seen?: unknown
  joined_at?: unknown
}

interface RawRoom {
  name?: unknown
  count?: unknown
  last_seen?: unknown
  members?: Record<string, RawMember | null> | null
}

type RawTree = Record<string, RawRoom | null> | null

const ROOM_ID_RE = /^[a-z0-9-]{1,48}$/
const KEY_RE = /^[A-Za-z0-9_-]{1,96}$/

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function str(value: unknown, max = 48): string {
  return typeof value === 'string' ? value.replace(/\p{Cc}/gu, '').trim().slice(0, max) : ''
}

export interface NormalizedTree {
  active: ActiveRoom[]
  stale: string[]
}

export function normalizeTree(tree: RawTree, now = Date.now()): NormalizedTree {
  const active: ActiveRoom[] = []
  const stale: string[] = []
  if (!tree || typeof tree !== 'object') return { active, stale }

  for (const [id, room] of Object.entries(tree)) {
    if (!room || !ROOM_ID_RE.test(id)) continue
    const membersObj = room.members ?? {}
    const activeMembers = normalizeRoomMembers(membersObj, now)
    const memberTimes = Object.values(membersObj)
      .filter((m): m is RawMember => !!m)
      .map((m) => num(m.last_seen))
    const lastSeen = Math.max(num(room.last_seen), ...memberTimes, 0)
    const online = activeMembers.length

    if (online === 0) {
      if (now - lastSeen > PRESENCE_STALE_MS) stale.push(id)
      continue
    }
    active.push({ id, name: str(room.name) || id, online, lastSeen })
  }

  active.sort((a, b) => b.online - a.online || b.lastSeen - a.lastSeen)
  return { active, stale }
}

export function normalizeRoomMembers(
  rawMembers: Record<string, RawMember | null> | null | undefined,
  now = Date.now(),
): PresenceRoomMember[] {
  if (!rawMembers || typeof rawMembers !== 'object') return []
  const list: PresenceRoomMember[] = []
  for (const [id, m] of Object.entries(rawMembers)) {
    if (!m || !KEY_RE.test(id)) continue
    const lastSeen = num(m.last_seen)
    // Se last_seen for 0 (acabou de ser inserido sem timestamp ou relógio dessincronizado), aceita como ativo
    if (lastSeen > 0 && now - lastSeen > PRESENCE_STALE_MS) continue
    const joinedAt = num(m.joined_at) || lastSeen || now
    list.push({
      id,
      name: str(m.name, 32) || 'Anônimo',
      joinedAt,
      lastSeen: lastSeen || now,
    })
  }
  list.sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))
  return list
}

// ─── Firebase Realtime Database (WebSocket SDK + REST Keepalive) ───────

class FirebasePresence implements PresenceProvider {
  readonly kind = 'firebase' as const
  private readonly base: string
  private readonly root: string
  private readonly db: Database | null
  private readonly disconnectRegistered = new Set<string>()

  constructor(databaseUrl: string, root: string) {
    const cleanUrl = databaseUrl.replace(/\/+$/, '')
    this.base = `${cleanUrl}/${root}`
    this.root = root
    let dbInstance: Database | null = null
    try {
      const app = getApps().length > 0 ? getApps()[0] : initializeApp({ databaseURL: cleanUrl })
      dbInstance = getDatabase(app, cleanUrl)
    } catch (err) {
      console.warn('[Firebase] Falha ao inicializar SDK Realtime Database, usando fallback REST:', err)
    }
    this.db = dbInstance
  }

  private url(path = ''): string {
    return `${this.base}${path ? `/${path}` : ''}.json`
  }

  async list(): Promise<ActiveRoom[]> {
    const res = await fetch(this.url(), { cache: 'no-store' })
    if (!res.ok) throw new Error(`Firebase respondeu ${res.status}`)
    const tree = (await res.json()) as RawTree
    const { active, stale } = normalizeTree(tree)
    if (stale.length > 0) this.prune(stale)
    return active
  }

  async getRoomMembers(roomId: string): Promise<PresenceRoomMember[]> {
    if (!ROOM_ID_RE.test(roomId)) return []
    const res = await fetch(this.url(`${roomId}/members`), { cache: 'no-store' })
    if (!res.ok) return []
    const rawMembers = (await res.json()) as Record<string, RawMember | null> | null
    return normalizeRoomMembers(rawMembers)
  }

  watchRoomMembers(roomId: string, callback: (members: PresenceRoomMember[]) => void): () => void {
    if (!ROOM_ID_RE.test(roomId)) return () => {}

    // 1) Se o SDK WebSocket do Firebase estiver ativo, escuta em tempo real com onValue
    if (this.db) {
      const db = this.db
      const membersRef = ref(db, `${this.root}/${roomId}/members`)
      const roomRef = ref(db, `${this.root}/${roomId}`)

      const unsubscribe = onValue(
        membersRef,
        (snapshot) => {
          const rawMembers = (snapshot.val() ?? null) as Record<string, RawMember | null> | null
          const now = Date.now()
          const activeMembers = normalizeRoomMembers(rawMembers, now)

          // Remove membros expirados (stale) caso tenham ficado órfãos
          if (rawMembers && typeof rawMembers === 'object') {
            for (const [peerId, raw] of Object.entries(rawMembers)) {
              const lastSeen = num(raw?.last_seen)
              if (lastSeen > 0 && now - lastSeen > PRESENCE_STALE_MS) {
                void remove(ref(db, `${this.root}/${roomId}/members/${peerId}`)).catch(() => undefined)
              }
            }
          }

          // Atualiza `count` da sala para refletir Object.keys(roomData.members || {}).length
          const liveCount = activeMembers.length
          if (liveCount > 0) {
            void update(roomRef, { count: liveCount, last_seen: now }).catch(() => undefined)
          }

          callback(activeMembers)
        },
        (err) => {
          console.warn('[Firebase] Erro no onValue de members:', err)
        },
      )

      return () => {
        unsubscribe()
      }
    }

    // 2) Fallback por polling rápido caso o SDK não esteja disponível
    let disposed = false
    const poll = () => {
      if (disposed) return
      void this.getRoomMembers(roomId).then((members) => {
        if (!disposed) callback(members)
      })
    }
    poll()
    const timer = window.setInterval(poll, 2500)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }

  async heartbeat(roomId: string, roomName: string | undefined, member: PresenceMember, count?: number): Promise<void> {
    if (!ROOM_ID_RE.test(roomId) || !KEY_RE.test(member.id)) return
    const now = Date.now()
    const cleanName = str(member.name, 32) || 'Anônimo'
    const joinedAt = member.joinedAt ?? now
    const disconnectKey = `${roomId}/${member.id}`

    if (this.db) {
      const roomRef = ref(this.db, `${this.root}/${roomId}`)
      const memberRef = ref(this.db, `${this.root}/${roomId}/members/${member.id}`)

      // Configura onDisconnect().remove() para remover a chave mesmo se cair a energia ou fechar a aba
      if (!this.disconnectRegistered.has(disconnectKey)) {
        this.disconnectRegistered.add(disconnectKey)
        void onDisconnect(memberRef)
          .remove()
          .catch((err) => {
            this.disconnectRegistered.delete(disconnectKey)
            console.warn('[Firebase] Falha ao registrar onDisconnect().remove():', err)
          })
      }

      const payload: Record<string, unknown> = {
        last_seen: now,
        [`members/${member.id}`]: {
          name: cleanName,
          last_seen: now,
          joined_at: joinedAt,
        },
      }
      if (typeof count === 'number' && count > 0) payload.count = count
      const title = str(roomName)
      if (title) payload.name = title

      await update(roomRef, payload)
      return
    }

    // Fallback HTTP PATCH
    const body: Record<string, unknown> = {
      ...(typeof count === 'number' && count > 0 ? { count } : {}),
      last_seen: now,
      [`members/${member.id}`]: {
        name: cleanName,
        last_seen: now,
        joined_at: joinedAt,
      },
    }
    const name = str(roomName)
    if (name) body.name = name
    const res = await fetch(this.url(roomId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Firebase respondeu ${res.status}`)
  }

  leave(roomId: string, memberId: string, isLast: boolean): void {
    if (!ROOM_ID_RE.test(roomId) || !KEY_RE.test(memberId)) return
    this.disconnectRegistered.delete(`${roomId}/${memberId}`)

    // 1) Remoção imediata via SDK WebSocket
    if (this.db) {
      const targetPath = isLast ? `${this.root}/${roomId}` : `${this.root}/${roomId}/members/${memberId}`
      void remove(ref(this.db, targetPath)).catch(() => undefined)
    }

    // 2) Garantia adicional via HTTP DELETE com keepalive: true (executa mesmo durante unload da aba)
    const restPath = isLast ? roomId : `${roomId}/members/${memberId}`
    void fetch(this.url(restPath), { method: 'DELETE', keepalive: true }).catch(() => undefined)
  }

  prune(roomIds: string[]): void {
    for (const id of roomIds) {
      if (!ROOM_ID_RE.test(id)) continue
      if (this.db) {
        void remove(ref(this.db, `${this.root}/${id}`)).catch(() => undefined)
      }
      void fetch(this.url(id), { method: 'DELETE' }).catch(() => undefined)
    }
  }

  subscribe(listener: () => void): () => void {
    if (!this.db) return () => {}
    const rootRef = ref(this.db, this.root)
    const unsubscribe = onValue(rootRef, () => listener())
    return () => unsubscribe()
  }
}

// ─── Mock local (localStorage) ─────────────────────────────────────────

const LOCAL_KEY = 'discordia:presence:v1'

class LocalPresence implements PresenceProvider {
  readonly kind = 'local' as const

  private read(): Record<string, RawRoom> {
    try {
      const parsed = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as unknown
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, RawRoom>) : {}
    } catch {
      return {}
    }
  }

  private write(tree: Record<string, RawRoom>): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(tree))
    } catch {
      /* quota / modo privado */
    }
  }

  async list(): Promise<ActiveRoom[]> {
    const tree = this.read()
    const { active, stale } = normalizeTree(tree)
    if (stale.length > 0) this.prune(stale)
    return active
  }

  async getRoomMembers(roomId: string): Promise<PresenceRoomMember[]> {
    if (!ROOM_ID_RE.test(roomId)) return []
    const tree = this.read()
    return normalizeRoomMembers(tree[roomId]?.members)
  }

  watchRoomMembers(roomId: string, callback: (members: PresenceRoomMember[]) => void): () => void {
    if (!ROOM_ID_RE.test(roomId)) return () => {}
    const emit = () => {
      const tree = this.read()
      callback(normalizeRoomMembers(tree[roomId]?.members))
    }
    emit()
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_KEY) emit()
    }
    window.addEventListener('storage', onStorage)
    const timer = window.setInterval(emit, 2000)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.clearInterval(timer)
    }
  }

  async heartbeat(roomId: string, roomName: string | undefined, member: PresenceMember): Promise<void> {
    const tree = this.read()
    const now = Date.now()
    const room: RawRoom = tree[roomId] ?? {}
    const name = str(roomName)
    const nextMembers: Record<string, RawMember | null> = {
      ...(room.members ?? {}),
      [member.id]: {
        name: str(member.name, 32),
        last_seen: now,
        joined_at: member.joinedAt ?? now,
      },
    }
    const activeCount = normalizeRoomMembers(nextMembers, now).length
    tree[roomId] = {
      ...room,
      ...(name ? { name } : {}),
      count: activeCount,
      last_seen: now,
      members: nextMembers,
    }
    this.write(tree)
  }

  leave(roomId: string, memberId: string, isLast: boolean): void {
    const tree = this.read()
    const room = tree[roomId]
    if (!room) return
    if (isLast) {
      delete tree[roomId]
    } else if (room.members) {
      delete room.members[memberId]
      const remaining = normalizeRoomMembers(room.members).length
      if (remaining === 0) {
        delete tree[roomId]
      } else {
        room.count = remaining
      }
    }
    this.write(tree)
  }

  prune(roomIds: string[]): void {
    const tree = this.read()
    for (const id of roomIds) delete tree[id]
    this.write(tree)
  }

  subscribe(listener: () => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === LOCAL_KEY) listener()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }
}

// ─── Desativado ────────────────────────────────────────────────────────

class NoopPresence implements PresenceProvider {
  readonly kind = 'off' as const
  async list(): Promise<ActiveRoom[]> {
    return []
  }
  async getRoomMembers(): Promise<PresenceRoomMember[]> {
    return []
  }
  watchRoomMembers(): () => void {
    return () => {}
  }
  async heartbeat(): Promise<void> {}
  leave(): void {}
  prune(): void {}
}

// ─── Fábrica (configurada via .env) ────────────────────────────────────

let provider: PresenceProvider | null = null

export function getPresence(): PresenceProvider {
  if (provider) return provider
  const env = import.meta.env
  const requested = String(env.VITE_PRESENCE_PROVIDER ?? '').trim().toLowerCase()
  const dbUrl = String(env.VITE_FIREBASE_DATABASE_URL ?? '').trim()
  const root = String(env.VITE_PRESENCE_ROOT ?? 'discordia_rooms').trim().replace(/^\/+|\/+$/g, '') || 'discordia_rooms'

  if (requested === 'off') {
    provider = new NoopPresence()
  } else if ((requested === 'firebase' || requested === '') && /^https:\/\//i.test(dbUrl)) {
    provider = new FirebasePresence(dbUrl, root)
  } else {
    if (requested === 'firebase') {
      console.warn('[discordia] VITE_PRESENCE_PROVIDER=firebase, mas VITE_FIREBASE_DATABASE_URL é inválida. Usando mock local.')
    }
    provider = new LocalPresence()
  }
  console.info(`[discordia] Presença de salas: ${provider.kind}`)
  return provider
}
