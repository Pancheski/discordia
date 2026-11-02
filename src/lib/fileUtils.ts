/** Utilitários de arquivos compartilhados entre a camada WebRTC e a UI. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / Math.pow(1024, exp)
  return `${value.toFixed(exp === 0 ? 0 : digits)} ${UNITS[exp]}`
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

/** Remove separadores de caminho e caracteres de controle de nomes recebidos da rede. */
export function sanitizeFileName(value: unknown): string {
  if (typeof value !== 'string') return 'arquivo'
  const clean = value
    .replace(/\p{Cc}/gu, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 200)
  return clean || 'arquivo'
}

export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp|svg\+xml)$/i.test(mime)
}

/** Dispara o download de um Object URL usando um <a download> temporário. */
export function downloadUrl(url: string, fileName: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  window.setTimeout(() => a.remove(), 0)
}

/** Lê um intervalo do arquivo como ArrayBuffer via FileReader (sem carregar o arquivo inteiro). */
export function readSlice(file: Blob, start: number, end: number): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo'))
    reader.onabort = () => reject(new Error('Leitura abortada'))
    reader.readAsArrayBuffer(file.slice(start, end))
  })
}

export function randomId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

