import { randomId } from './fileUtils'
import type { TrioAction, TrioCard, TrioGameState, TrioPlayerState } from '../types'

/**
 * MOTOR DE REGRAS DO JOGO DE CARTAS "TRIO" (Memória e Dedução)
 * ────────────────────────────────────────────────────────────
 * • Baralho de 36 cartas: números de 1 a 12 (3 cópias de cada número).
 * • Mãos obrigatoriamente ordenadas do menor para o maior.
 * • Vitória imediata ao conquistar 3 Trios OU o Trio de número 7.
 */

export const BOT_PEER_ID = '__trio_bot__'

function createShuffledDeck(): TrioCard[] {
  const deck: TrioCard[] = []
  for (let value = 1; value <= 12; value++) {
    for (let copy = 0; copy < 3; copy++) {
      deck.push({
        uid: `c-${value}-${copy}`,
        value,
        revealed: false,
      })
    }
  }
  // Fisher-Yates shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = deck[i]
    deck[i] = deck[j]
    deck[j] = tmp
  }
  return deck
}

function cardsPerPlayerForCount(playerCount: number): number {
  switch (playerCount) {
    case 2:
      return 9 // 18 nas mãos, 18 na mesa
    case 3:
      return 9 // 27 nas mãos, 9 na mesa
    case 4:
      return 7 // 28 nas mãos, 8 na mesa
    case 5:
      return 6 // 30 nas mãos, 6 na mesa
    default:
      return 5 // 30 nas mãos, 6 na mesa
  }
}

export function createInitialTrioState(
  hostId: string,
  roster: Array<{ peerId: string; name: string }>,
): TrioGameState {
  const participants = [...roster]
  // Se o jogador abrir a mesa sozinho na sala, adiciona um Bot oponente para permitir partida solo
  if (participants.length === 1) {
    participants.push({ peerId: BOT_PEER_ID, name: 'Bot Croupier 🤖' })
  }

  const deck = createShuffledDeck()
  const perPlayer = cardsPerPlayerForCount(participants.length)
  let cursor = 0

  const players: TrioPlayerState[] = participants.map((p) => {
    const slice = deck.slice(cursor, cursor + perPlayer)
    cursor += perPlayer
    // Regra obrigatória do TRIO: mão ordenada do menor para o maior
    slice.sort((a, b) => a.value - b.value)
    return {
      peerId: p.peerId,
      name: p.name,
      hand: slice,
      trios: [],
    }
  })

  const tableCards = deck.slice(cursor)

  return {
    matchId: randomId(),
    hostId,
    phase: 'playing',
    players,
    tableCards,
    turnIndex: 0,
    currentReveals: [],
    lastEvent: `Partida iniciada! Vez de ${players[0]?.name ?? 'Jogador'} revelar uma carta.`,
    winnerId: null,
    winnerName: null,
    winReason: null,
  }
}

/** Clona profundamente o estado para evitar mutação acidental em React. */
function cloneState(state: TrioGameState): TrioGameState {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      hand: p.hand.map((c) => ({ ...c })),
      trios: [...p.trios],
    })),
    tableCards: state.tableCards.map((c) => ({ ...c })),
    currentReveals: state.currentReveals.map((r) => ({ ...r })),
  }
}

function nextActiveTurnIndex(players: TrioPlayerState[], fromIndex: number): number {
  const n = players.length
  if (n === 0) return 0
  return (fromIndex + 1) % n
}

/**
 * Aplica uma ação do jogador da vez sobre o estado do TRIO.
 * Retorna `{ next, scheduleResolution }` onde `scheduleResolution` indica se o Host deve
 * agendar `resolveTrioTurnAfterDelay` após ~1.9s (para mostrar as cartas antes de virá-las/limpá-las).
 */
export function applyTrioAction(
  prev: TrioGameState,
  actorId: string,
  action: TrioAction,
): { next: TrioGameState; needsDelayResolution: boolean } {
  if (prev.phase !== 'playing') {
    return { next: prev, needsDelayResolution: false }
  }

  const currentPlayer = prev.players[prev.turnIndex]
  if (!currentPlayer || currentPlayer.peerId !== actorId) {
    return { next: prev, needsDelayResolution: false }
  }

  const state = cloneState(prev)
  let revealedCard: TrioCard | undefined
  let revealSourceDesc = ''

  if (action.kind === 'reveal-hand') {
    const target = state.players.find((p) => p.peerId === action.targetPeerId)
    if (!target) return { next: prev, needsDelayResolution: false }

    // Filtra as cartas que ainda estão ocultas na mão ordenada do alvo
    const unrevealed = target.hand.filter((c) => !c.revealed)
    if (unrevealed.length === 0) return { next: prev, needsDelayResolution: false }

    revealedCard = action.edge === 'lowest' ? unrevealed[0] : unrevealed[unrevealed.length - 1]
    revealedCard.revealed = true
    const edgeLabel = action.edge === 'lowest' ? 'carta MAIS BAIXA' : 'carta MAIS ALTA'
    revealSourceDesc =
      target.peerId === actorId
        ? `${currentPlayer.name} revelou sua própria ${edgeLabel}: [${revealedCard.value}]`
        : `${currentPlayer.name} pediu a ${edgeLabel} de ${target.name}: [${revealedCard.value}]`

    state.currentReveals.push({
      source: 'hand',
      targetPeerId: target.peerId,
      edge: action.edge,
      cardUid: revealedCard.uid,
      value: revealedCard.value,
    })
  } else if (action.kind === 'reveal-table') {
    const card = state.tableCards.find((c) => c.uid === action.cardUid && !c.revealed)
    if (!card) return { next: prev, needsDelayResolution: false }
    card.revealed = true
    revealedCard = card
    revealSourceDesc = `${currentPlayer.name} virou uma carta da mesa: [${card.value}]`

    state.currentReveals.push({
      source: 'table',
      cardUid: card.uid,
      value: card.value,
    })
  } else {
    return { next: prev, needsDelayResolution: false }
  }

  const firstValue = state.currentReveals[0].value
  const allMatch = state.currentReveals.every((r) => r.value === firstValue)

  // Caso 1: Divergência! Entra em 'mismatch' para todos memorizarem antes de ocultar
  if (!allMatch) {
    state.phase = 'mismatch'
    state.lastEvent = `${revealSourceDesc} — Número diferente! As cartas voltarão a ficar ocultas…`
    return { next: state, needsDelayResolution: true }
  }

  // Caso 2: 3 cartas iguais reveladas seguidas -> TRIO CONQUISTADO!
  if (state.currentReveals.length === 3) {
    const winnerPlayer = state.players[state.turnIndex]
    winnerPlayer.trios.push(firstValue)

    // Verifica vitória imediata (Trio de 7 ou 3 Trios)
    if (firstValue === 7) {
      state.phase = 'finished'
      state.winnerId = winnerPlayer.peerId
      state.winnerName = winnerPlayer.name
      state.winReason = 'Conquistou o lendário TRIO DE 7! ✨'
      state.lastEvent = `🏆 ${winnerPlayer.name} formou o TRIO DE 7 e venceu a partida!`
      removeClaimedCards(state)
      return { next: state, needsDelayResolution: false }
    }

    if (winnerPlayer.trios.length >= 3) {
      state.phase = 'finished'
      state.winnerId = winnerPlayer.peerId
      state.winnerName = winnerPlayer.name
      state.winReason = `Conquistou 3 Trios (${winnerPlayer.trios.join(', ')})!`
      state.lastEvent = `🏆 ${winnerPlayer.name} completou 3 Trios e venceu a partida!`
      removeClaimedCards(state)
      return { next: state, needsDelayResolution: false }
    }

    state.phase = 'trio-claimed'
    state.lastEvent = `🎉 ${winnerPlayer.name} formou o Trio de [${firstValue}]!`
    return { next: state, needsDelayResolution: true }
  }

  // Caso 3: 1ª ou 2ª carta igual -> continua jogando no mesmo turno
  const remaining = 3 - state.currentReveals.length
  state.lastEvent = `${revealSourceDesc} — Falta${remaining > 1 ? 'm' : ''} ${remaining} carta${remaining > 1 ? 's' : ''} [${firstValue}] para fechar o Trio!`
  return { next: state, needsDelayResolution: false }
}

function removeClaimedCards(state: TrioGameState): void {
  const claimedUids = new Set(state.currentReveals.map((r) => r.cardUid))
  for (const p of state.players) {
    p.hand = p.hand.filter((c) => !claimedUids.has(c.uid))
  }
  state.tableCards = state.tableCards.filter((c) => !claimedUids.has(c.uid))
  state.currentReveals = []
}

/**
 * Chamado após o intervalo de visualização de 'mismatch' ou 'trio-claimed'
 * para ocultar as cartas (ou remover o trio conquistado) e passar a vez.
 */
export function resolveTrioTurnAfterDelay(prev: TrioGameState): TrioGameState {
  if (prev.phase !== 'mismatch' && prev.phase !== 'trio-claimed') return prev
  const state = cloneState(prev)

  if (state.phase === 'trio-claimed') {
    removeClaimedCards(state)
  } else {
    for (const p of state.players) {
      for (const c of p.hand) c.revealed = false
    }
    for (const c of state.tableCards) c.revealed = false
    state.currentReveals = []
  }

  state.turnIndex = nextActiveTurnIndex(state.players, state.turnIndex)
  state.phase = 'playing'
  const nextPlayer = state.players[state.turnIndex]
  state.lastEvent = `Vez de ${nextPlayer?.name ?? 'Jogador'} revelar uma carta.`
  return state
}

/** Escolhe uma ação inteligente/aleatória para o Bot quando for a vez dele (modo solo). */
export function chooseBotTrioAction(state: TrioGameState): TrioAction | null {
  const bot = state.players[state.turnIndex]
  if (!bot || bot.peerId !== BOT_PEER_ID || state.phase !== 'playing') return null

  const availableHands = state.players.filter((p) => p.hand.some((c) => !c.revealed))
  const availableTable = state.tableCards.filter((c) => !c.revealed)

  if (availableTable.length > 0 && (availableHands.length === 0 || Math.random() < 0.45)) {
    const pick = availableTable[Math.floor(Math.random() * availableTable.length)]
    return { kind: 'reveal-table', cardUid: pick.uid }
  }

  if (availableHands.length > 0) {
    const target = availableHands[Math.floor(Math.random() * availableHands.length)]
    const edge: 'lowest' | 'highest' = Math.random() < 0.5 ? 'lowest' : 'highest'
    return { kind: 'reveal-hand', targetPeerId: target.peerId, edge }
  }

  return null
}

