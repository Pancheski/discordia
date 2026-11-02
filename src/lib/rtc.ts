/**
 * Ajustes finos de SDP / RTCRtpSender para baixa latência, áudio cristalino e
 * transmissão de tela em altíssima definição (1080p/4K 60fps).
 */

type RTCPriorityType = 'very-low' | 'low' | 'medium' | 'high'

type ExtendedEncoding = RTCRtpEncodingParameters & {
  maxFramerate?: number
  minBitrate?: number
  scaleResolutionDownBy?: number
  priority?: RTCPriorityType
  networkPriority?: RTCPriorityType
}

type ExtendedSendParameters = RTCRtpSendParameters & {
  degradationPreference?: 'maintain-framerate' | 'maintain-resolution' | 'balanced'
}

/**
 * Atualiza ou insere parâmetros na linha a=fmtp do payload especificado.
 */
function updateFmtpParams(sdp: string, payloadType: string, newParams: Record<string, string>): string {
  const fmtpRegex = new RegExp(`a=fmtp:${payloadType} ([^\\r\\n]*)`)
  const match = fmtpRegex.exec(sdp)

  if (!match) {
    // Insere logo após o a=rtpmap:<pt>
    const rtpmapRegex = new RegExp(`(a=rtpmap:${payloadType} [^\\r\\n]+)`)
    const paramStr = Object.entries(newParams)
      .map(([k, v]) => `${k}=${v}`)
      .join(';')
    return sdp.replace(rtpmapRegex, `$1\r\na=fmtp:${payloadType} ${paramStr}`)
  }

  // Já existe a=fmtp: mescla preservando parâmetros existentes que não foram sobrescritos
  const existingStr = match[1]
  const currentParams: Record<string, string> = {}
  for (const pair of existingStr.split(';')) {
    const [k, v] = pair.trim().split('=')
    if (k) currentParams[k] = v ?? ''
  }

  Object.assign(currentParams, newParams)

  const mergedStr = Object.entries(currentParams)
    .map(([k, v]) => (v !== '' ? `${k}=${v}` : k))
    .join(';')

  return sdp.replace(fmtpRegex, `a=fmtp:${payloadType} ${mergedStr}`)
}

/**
 * Otimiza o SDP para o canal de VOZ (Microfone).
 * - usedtx=0: Desativa DTX para evitar que o áudio corte ou fique picotado em falas baixas ou pausas.
 * - useinbandfec=1: Habilita Forward Error Correction para recompor pacotes perdidos sem engasgo.
 * - minptime=10 / ptime=20: Pacotes de baixa latência.
 * - maxaveragebitrate=64000: 64 kbps (padrão de voz do Discord, cristalino).
 * - cbr=1: Constant Bitrate para evitar variações bruscas no jitter buffer.
 * - stereo=0;sprop-stereo=0: Mono otimizado para voz.
 */
export function tuneVoiceSdp(sdp: string): string {
  const match = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(sdp)
  if (!match) return sdp
  const pt = match[1]

  return updateFmtpParams(sdp, pt, {
    usedtx: '0',
    useinbandfec: '1',
    minptime: '10',
    ptime: '20',
    maxaveragebitrate: '64000',
    stereo: '0',
    'sprop-stereo': '0',
    cbr: '1',
  })
}

/**
 * Otimiza o SDP para o canal de TELA (Áudio de Sistema em Estéreo de alta fidelidade
 * e Vídeo a até 12 Mbps sem congelamento ou degradação embaçada).
 */
export function tuneScreenSdp(sdp: string): string {
  let modified = sdp

  // 1. Áudio de sistema / música (Opus estéreo de estúdio a 256 kbps)
  const opusMatch = /a=rtpmap:(\d+) opus\/48000\/2/i.exec(modified)
  if (opusMatch) {
    const pt = opusMatch[1]
    modified = updateFmtpParams(modified, pt, {
      usedtx: '0',
      useinbandfec: '1',
      stereo: '1',
      'sprop-stereo': '1',
      maxaveragebitrate: '256000',
      cbr: '1',
    })
  }

  // 2. Modificadores de largura de banda na seção m=video (até 12 Mbps)
  // b=AS:12000 (12.000 kbps) e b=TIAS:12000000 (12.000.000 bps)
  if (modified.includes('m=video')) {
    modified = modified.replace(/(m=video [^\r\n]+)/, (line) => {
      let extra = ''
      if (!modified.includes('b=AS:')) extra += '\r\nb=AS:12000'
      if (!modified.includes('b=TIAS:')) extra += '\r\nb=TIAS:12000000'
      return line + extra
    })

    // Injeta hints de bitrate do Chrome (evita que a transmissão inicie a 300kbps embaçada)
    const videoPts = [...modified.matchAll(/a=rtpmap:(\d+) (?:VP8|VP9|H264)\/90000/gi)].map((m) => m[1])
    for (const pt of videoPts) {
      modified = updateFmtpParams(modified, pt, {
        'x-google-min-bitrate': '2500',
        'x-google-start-bitrate': '6000',
        'x-google-max-bitrate': '12000',
      })
    }
  }

  return modified
}

/**
 * Configura os parâmetros de codificação da track de vídeo da tela:
 * - Modo Jogo (720p 60 FPS • Latência Zero):
 *   degradationPreference: 'maintain-framerate'
 *   encodings[0].maxBitrate = 4000000 (4 Mbps para evitar filas de rede)
 *   encodings[0].maxFramerate = 60
 *   encodings[0].priority = 'high'
 *   encodings[0].networkPriority = 'high'
 *
 * - Alta Qualidade (1080p 60 FPS):
 *   degradationPreference: 'maintain-resolution'
 *   encodings[0].maxBitrate = 12000000 (12 Mbps)
 *   encodings[0].maxFramerate = 60
 *   encodings[0].priority = 'high'
 *   encodings[0].networkPriority = 'high'
 */
export async function tuneScreenSender(
  pc: RTCPeerConnection,
  preset: 'game' | 'quality' = 'quality',
): Promise<void> {
  for (const sender of pc.getSenders()) {
    const track = sender.track
    if (!track) continue

    const params = sender.getParameters() as ExtendedSendParameters
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    const enc = params.encodings[0] as ExtendedEncoding

    if (track.kind === 'video') {
      enc.scaleResolutionDownBy = 1.0
      enc.maxFramerate = 60
      enc.priority = 'high'
      enc.networkPriority = 'high'

      if (preset === 'game') {
        enc.maxBitrate = 4_000_000 // 4 Mbps para evitar buffer na rede
        delete enc.minBitrate
        params.degradationPreference = 'maintain-framerate'
      } else {
        enc.maxBitrate = 12_000_000 // 12 Mbps
        enc.minBitrate = 2_500_000
        params.degradationPreference = 'maintain-resolution'
      }

      try {
        await sender.setParameters(params)
      } catch (err) {
        console.debug('[discordia] setParameters screen video:', err)
      }
    } else if (track.kind === 'audio') {
      enc.priority = 'high'
      enc.networkPriority = 'high'
      try {
        await sender.setParameters(params)
      } catch (err) {
        console.debug('[discordia] setParameters screen audio:', err)
      }
    }
  }
}

/**
 * Zera o jitter buffer nos receptores Chromium para resposta em tempo real imediata.
 */
export function tuneReceiversZeroLatency(pc: RTCPeerConnection): void {
  for (const receiver of pc.getReceivers()) {
    try {
      if ('playoutDelayHint' in receiver) {
        ;(receiver as unknown as { playoutDelayHint: number }).playoutDelayHint = 0
      }
      if ('jitterBufferTarget' in receiver) {
        ;(receiver as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0
      }
    } catch {
      /* ignore */
    }
  }
}

/**
 * Aplica parâmetros avançados de bitrate, framerate e preservação de resolução
 * diretamente nos senders da RTCPeerConnection.
 */
export async function tuneSenders(
  pc: RTCPeerConnection,
  _kind: 'mic' | 'screen',
  preferResolution = true,
): Promise<void> {
  for (const sender of pc.getSenders()) {
    const track = sender.track
    if (!track) continue

    const params = sender.getParameters() as ExtendedSendParameters
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    const enc = params.encodings[0] as ExtendedEncoding

    if (track.kind === 'video') {
      enc.maxBitrate = 12_000_000 // 12 Mbps max
      enc.minBitrate = 2_500_000 // Garante qualidade mínima alta (não deixa cair em resolução borrada)
      enc.maxFramerate = 60
      enc.scaleResolutionDownBy = 1.0 // NUNCA reduz a escala da resolução (mantém Full HD / 2K nítido)
      enc.priority = 'high'
      enc.networkPriority = 'high'

      // maintain-resolution garante nitidez impecável de textos, interfaces e janelas
      params.degradationPreference = preferResolution ? 'maintain-resolution' : 'maintain-framerate'

      try {
        await sender.setParameters(params)
      } catch (err) {
        console.debug('[discordia] setParameters video:', err)
      }
    } else {
      // Prioridade máxima de rede para pacotes de áudio (evita jitter e atraso)
      enc.priority = 'high'
      enc.networkPriority = 'high'
      try {
        await sender.setParameters(params)
      } catch (err) {
        console.debug('[discordia] setParameters audio:', err)
      }
    }
  }
}
