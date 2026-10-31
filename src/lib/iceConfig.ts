/**
 * Configuração de servidores ICE (STUN e TURN) para permitir conexões WebRTC
 * na internet pública atravessando NAT, CGNAT e firewalls residenciais/móveis.
 */

export const DEFAULT_STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
]

let cachedIceServers: RTCIceServer[] | null = null

/**
 * Monta a lista completa de servidores ICE (STUN + TURN).
 * Suporta:
 * 1. Variáveis de ambiente estáticas (VITE_TURN_URLS, VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL)
 * 2. API REST do Metered.ca (VITE_METERED_DOMAIN e VITE_METERED_API_KEY) — 50GB/mês grátis
 * 3. Fallback para os 5 servidores STUN públicos do Google
 */
export async function getIceServers(): Promise<RTCIceServer[]> {
  if (cachedIceServers) {
    return cachedIceServers
  }

  const servers: RTCIceServer[] = [...DEFAULT_STUN_SERVERS]

  // 1. Verifica se há credenciais da API Metered.ca
  const meteredDomain = import.meta.env.VITE_METERED_DOMAIN as string | undefined
  const meteredApiKey = import.meta.env.VITE_METERED_API_KEY as string | undefined

  if (meteredDomain && meteredApiKey) {
    try {
      const endpoint = `https://${meteredDomain}/api/v1/turn/credentials?apiKey=${meteredApiKey}`
      const response = await fetch(endpoint, { method: 'GET' })
      if (response.ok) {
        const meteredServers = (await response.json()) as RTCIceServer[]
        if (Array.isArray(meteredServers) && meteredServers.length > 0) {
          console.info(`[discordia] ${meteredServers.length} servidores TURN da Metered carregados com sucesso.`)
          cachedIceServers = [...servers, ...meteredServers]
          return cachedIceServers
        }
      } else {
        console.warn('[discordia] Falha ao consultar API Metered.ca:', response.statusText)
      }
    } catch (err) {
      console.warn('[discordia] Erro ao buscar credenciais TURN da Metered:', err)
    }
  }

  // 2. Verifica se há credenciais TURN estáticas no .env
  const turnUrls = import.meta.env.VITE_TURN_URLS as string | undefined
  const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined

  if (turnUrls && turnUsername && turnCredential) {
    const urlsList = turnUrls
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean)

    if (urlsList.length > 0) {
      servers.push({
        urls: urlsList,
        username: turnUsername,
        credential: turnCredential,
      })
      console.info(`[discordia] Servidor TURN configurado via .env (${urlsList.length} endpoints).`)
    }
  } else {
    console.info(
      '[discordia] Operando com STUN público do Google. Para redes com CGNAT rígido, adicione TURN no .env (ver .env.example).',
    )
  }

  cachedIceServers = servers
  return servers
}

/** Retorna true se houver ao menos um servidor TURN configurado */
export function hasTurnConfigured(): boolean {
  if (!cachedIceServers) {
    return !!(
      (import.meta.env.VITE_TURN_URLS && import.meta.env.VITE_TURN_USERNAME) ||
      (import.meta.env.VITE_METERED_DOMAIN && import.meta.env.VITE_METERED_API_KEY)
    )
  }
  return cachedIceServers.some((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls]
    return urls.some((u) => typeof u === 'string' && (u.startsWith('turn:') || u.startsWith('turns:')))
  })
}
