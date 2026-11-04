/**
 * Otimizações seguras de RTCRtpSender e RTCRtpReceiver para baixa latência,
 * áudio cristalino e transmissão de tela em alta definição (720p/1080p 60fps),
 * sem manipulação destrutiva de SDP.
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
 * Ordena a preferência de codecs mantendo TODOS os codecs nativos (H264, VP8, VP9, AV1, RTX, RED, ULPFEC)
 * como fallback na lista para nunca quebrar a negociação SDP entre peers diferentes.
 */
export function preferH264Codec(pc: RTCPeerConnection): void {
  try {
    const capabilities =
      (typeof RTCRtpReceiver !== 'undefined' && RTCRtpReceiver.getCapabilities?.('video')) ||
      (typeof RTCRtpSender !== 'undefined' && RTCRtpSender.getCapabilities?.('video'))
    if (!capabilities || !capabilities.codecs || capabilities.codecs.length === 0) return

    const allCodecs = capabilities.codecs
    type CodecItem = (typeof allCodecs)[number]
    const h264Codecs: CodecItem[] = []
    const fallbackCodecs: CodecItem[] = []

    for (const c of allCodecs) {
      const mime = (c.mimeType || '').toLowerCase()
      if (mime === 'video/h264') {
        h264Codecs.push(c)
      } else {
        // Mantém VP8, VP9, AV1 e payloads auxiliares (rtx, red, ulpfec) intactos como fallback
        fallbackCodecs.push(c)
      }
    }

    if (h264Codecs.length === 0) return
    const preferredOrder = [...h264Codecs, ...fallbackCodecs]

    const transceivers = typeof pc.getTransceivers === 'function' ? pc.getTransceivers() : []
    for (const tc of transceivers) {
      try {
        const isVideo =
          tc.receiver?.track?.kind === 'video' ||
          tc.sender?.track?.kind === 'video'
        if (isVideo && typeof tc.setCodecPreferences === 'function') {
          tc.setCodecPreferences(preferredOrder)
        }
      } catch {
        /* Ignora se o navegador/transceiver não permitir reordenação neste estado */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Configura os parâmetros seguros de codificação da track de vídeo da tela:
 * - Modo Jogo (720p 60 FPS • Latência Zero):
 *   degradationPreference: 'maintain-framerate', maxBitrate: 4 Mbps
 * - Alta Qualidade (1080p 60 FPS):
 *   degradationPreference: 'maintain-resolution', maxBitrate: 10 Mbps
 */
export async function tuneScreenSender(
  pc: RTCPeerConnection,
  preset: 'game' | 'quality' = 'quality',
): Promise<void> {
  try {
    const senders = typeof pc.getSenders === 'function' ? pc.getSenders() : []
    for (const sender of senders) {
      try {
        const track = sender.track
        if (!track) continue

        if (track.kind === 'video') {
          try {
            track.contentHint = preset === 'game' ? 'motion' : 'detail'
          } catch {
            /* ignore */
          }
        }

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
            enc.maxBitrate = 4_000_000
            delete enc.minBitrate
            params.degradationPreference = 'maintain-framerate'
          } else {
            enc.maxBitrate = 10_000_000
            params.degradationPreference = 'maintain-resolution'
          }

          await sender.setParameters(params)
        } else if (track.kind === 'audio') {
          enc.priority = 'high'
          enc.networkPriority = 'high'
          await sender.setParameters(params)
        }
      } catch (err) {
        console.debug('[discordia] setParameters screen sender:', err)
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Configura playoutDelayHint = 0 nos receptores para reduzir latência de reprodução,
 * sempre protegido por try/catch.
 */
export function tuneReceiversZeroLatency(pc: RTCPeerConnection): void {
  try {
    const receivers = typeof pc.getReceivers === 'function' ? pc.getReceivers() : []
    for (const receiver of receivers) {
      try {
        if ('playoutDelayHint' in receiver) {
          ;(receiver as unknown as { playoutDelayHint: number }).playoutDelayHint = 0
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/**
 * Aplica parâmetros seguros de bitrate e framerate nos senders da RTCPeerConnection.
 */
export async function tuneSenders(
  pc: RTCPeerConnection,
  _kind: 'mic' | 'screen',
  preferResolution = true,
): Promise<void> {
  try {
    const senders = typeof pc.getSenders === 'function' ? pc.getSenders() : []
    for (const sender of senders) {
      try {
        const track = sender.track
        if (!track) continue

        const params = sender.getParameters() as ExtendedSendParameters
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}]
        }
        const enc = params.encodings[0] as ExtendedEncoding

        if (track.kind === 'video') {
          enc.maxBitrate = 10_000_000
          enc.maxFramerate = 60
          enc.scaleResolutionDownBy = 1.0
          enc.priority = 'high'
          enc.networkPriority = 'high'
          params.degradationPreference = preferResolution ? 'maintain-resolution' : 'maintain-framerate'
          await sender.setParameters(params)
        } else {
          enc.priority = 'high'
          enc.networkPriority = 'high'
          await sender.setParameters(params)
        }
      } catch (err) {
        console.debug('[discordia] setParameters sender:', err)
      }
    }
  } catch {
    /* ignore */
  }
}
