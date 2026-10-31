/**
 * Utilitários de áudio: contexto Web Audio para mic local, stream silenciosa
 * e detectores de fala de baixa latência e zero-stuttering.
 */

let sharedContext: AudioContext | null = null

export function getAudioContext(): AudioContext {
  if (!sharedContext || sharedContext.state === 'closed') {
    sharedContext = new AudioContext({ latencyHint: 'interactive' })
  }
  if (sharedContext.state === 'suspended') {
    void sharedContext.resume().catch(() => undefined)
  }
  return sharedContext
}

export async function closeAudioContext(): Promise<void> {
  const ctx = sharedContext
  sharedContext = null
  if (ctx && ctx.state !== 'closed') {
    await ctx.close().catch(() => undefined)
  }
}

/**
 * Cria uma faixa de áudio silenciosa. Usada quando o usuário nega o microfone:
 * a chamada de voz é estabelecida mesmo assim e, se ele liberar o microfone
 * depois, apenas trocamos a faixa com `RTCRtpSender.replaceTrack` (sem renegociar).
 */
export function createSilentStream(): MediaStream {
  const ctx = getAudioContext()
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  gain.gain.value = 0
  const destination = ctx.createMediaStreamDestination()
  oscillator.connect(gain).connect(destination)
  oscillator.start()
  const stream = destination.stream
  stream.getAudioTracks().forEach((track) => {
    track.addEventListener('ended', () => {
      try {
        oscillator.stop()
        oscillator.disconnect()
        gain.disconnect()
      } catch {
        /* já parado */
      }
    })
  })
  return stream
}

/**
 * Detector de fala para o MICROFONE LOCAL usando RMS da entrada Web Audio.
 * Não envia áudio para speakers locais (evita eco/feedback).
 */
export class LocalSpeakingDetector {
  private readonly source: MediaStreamAudioSourceNode
  private readonly analyser: AnalyserNode
  private readonly buffer: Float32Array<ArrayBuffer>
  private readonly onChange: (speaking: boolean) => void
  private readonly threshold: number
  private timer: number | null = null
  private speaking = false
  private lastLoudAt = 0

  constructor(stream: MediaStream, onChange: (speaking: boolean) => void, threshold = 0.015) {
    const ctx = getAudioContext()
    this.onChange = onChange
    this.threshold = threshold
    this.source = ctx.createMediaStreamSource(stream)
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.2
    this.source.connect(this.analyser)
    this.buffer = new Float32Array(this.analyser.fftSize)
    this.timer = window.setInterval(() => this.tick(), 75)
  }

  private tick(): void {
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (let i = 0; i < this.buffer.length; i++) {
      sum += this.buffer[i] * this.buffer[i]
    }
    const rms = Math.sqrt(sum / this.buffer.length)
    const now = performance.now()
    if (rms > this.threshold) this.lastLoudAt = now
    const speaking = now - this.lastLoudAt < 280
    if (speaking !== this.speaking) {
      this.speaking = speaking
      this.onChange(speaking)
    }
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    try {
      this.source.disconnect()
      this.analyser.disconnect()
    } catch {
      /* contexto já fechado */
    }
    if (this.speaking) {
      this.speaking = false
      this.onChange(false)
    }
  }
}

/**
 * Detector de fala para PARTICIPANTES REMOTOS:
 * Lê os metadados nativos de áudio RTP (RFC 6464 / audioLevel) do RTCRtpReceiver ou getStats.
 * CRÍTICO: NÃO conecta a stream remota ao Web Audio, prevenindo contenção de buffers,
 * clock drift e o engasgo/stuttering na reprodução do elemento de áudio!
 */
export class RemoteSpeakingDetector {
  private readonly pc: RTCPeerConnection
  private readonly onChange: (speaking: boolean) => void
  private readonly threshold: number
  private timer: number | null = null
  private speaking = false
  private lastLoudAt = 0

  constructor(
    pc: RTCPeerConnection,
    onChange: (speaking: boolean) => void,
    threshold = 0.015,
  ) {
    this.pc = pc
    this.onChange = onChange
    this.threshold = threshold
    this.timer = window.setInterval(() => this.tick(), 80)
  }

  private tick(): void {
    if (this.pc.connectionState !== 'connected' && this.pc.iceConnectionState !== 'connected') {
      return
    }

    const receiver = this.pc.getReceivers().find((r) => r.track?.kind === 'audio')
    if (!receiver) return

    let level = 0
    try {
      const sources = receiver.getSynchronizationSources?.()
      if (sources && sources.length > 0 && typeof sources[0]?.audioLevel === 'number') {
        level = sources[0].audioLevel
      }
    } catch {
      /* fallback */
    }

    const now = performance.now()
    if (level > this.threshold) {
      this.lastLoudAt = now
    }
    const speaking = now - this.lastLoudAt < 280
    if (speaking !== this.speaking) {
      this.speaking = speaking
      this.onChange(speaking)
    }
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    if (this.speaking) {
      this.speaking = false
      this.onChange(false)
    }
  }
}
