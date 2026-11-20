import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, shell, session } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const DESKTOP_SOURCE_ID_RE = /^(screen|window):[A-Za-z0-9:_-]{1,128}$/
const ACCELERATOR_RE = /^[A-Za-z0-9+\-_]{1,64}$/
const MAX_GAMEPAD_BUTTONS = 17

function parseValidSlot(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 4 ? value : null
}

function clampFinite(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, value))
}

function sanitizeIpcGamepadState(raw: unknown): GamepadPacket | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (obj.type !== undefined && obj.type !== 'gamepad:state') return null

  const slot = parseValidSlot(obj.slot ?? obj.player ?? 1)
  if (slot === null) return null

  if (!Array.isArray(obj.buttons) || obj.buttons.length > MAX_GAMEPAD_BUTTONS) return null
  if (!Array.isArray(obj.axes) || obj.axes.length !== 4) return null

  const buttons: number[] = []
  for (const b of obj.buttons) {
    const clean = clampFinite(b, 0, 1)
    if (clean === null) return null
    buttons.push(clean)
  }

  const axes: number[] = []
  for (const a of obj.axes) {
    const clean = clampFinite(a, -1, 1)
    if (clean === null) return null
    axes.push(clean)
  }

  const packet: GamepadPacket = {
    type: 'gamepad:state',
    slot,
    player: slot,
    buttons,
    axes: [axes[0], axes[1], axes[2], axes[3]],
  }

  if (obj.triggers !== undefined) {
    if (!Array.isArray(obj.triggers) || obj.triggers.length !== 2) return null
    const lt = clampFinite(obj.triggers[0], 0, 1)
    const rt = clampFinite(obj.triggers[1], 0, 1)
    if (lt === null || rt === null) return null
    packet.triggers = [lt, rt]
  }

  return packet
}

function parseValidAccelerator(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 64 || !ACCELERATOR_RE.test(trimmed)) return null
  const parts = trimmed.split('+').filter(Boolean)
  if (parts.length === 0 || parts.length > 5) return null
  return trimmed
}

function isAllowedAppUrl(rawUrl: string): boolean {
  if (!rawUrl) return false
  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:') return true
    if (devServerUrl) {
      const devParsed = new URL(devServerUrl)
      return parsed.origin === devParsed.origin
    }
  } catch {
    return false
  }
  return false
}

function isFromMainWindow(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents)
}

interface GamepadPacket {
  type: 'gamepad:state' | 'gamepad:release' | 'gamepad:connect' | 'gamepad:disconnect' | 'driver:install'
  player?: number
  slot?: number
  buttons?: number[]
  axes?: [number, number, number, number]
  triggers?: [number, number]
}

interface NativeVigemController {
  connect: () => void
  disconnect?: () => void
  axis: {
    leftX: { setValue: (v: number) => void }
    leftY: { setValue: (v: number) => void }
    rightX: { setValue: (v: number) => void }
    rightY: { setValue: (v: number) => void }
    leftTrigger: { setValue: (v: number) => void }
    rightTrigger: { setValue: (v: number) => void }
    dpadHorz: { setValue: (v: number) => void }
    dpadVert: { setValue: (v: number) => void }
  }
  button: Record<string, { setValue: (pressed: boolean) => void }>
  update?: () => void
}

/**
 * Motor de Controle Virtual XInput integrado ao processo principal do Electron.
 */
class IntegratedGamepadHost {
  private vigemController: NativeVigemController | null = null
  private workerProcess: ChildProcess | null = null
  private wsSocket: WebSocket | null = null
  private wsConnecting = false
  private readonly sessionToken = crypto.randomBytes(32).toString('hex')

  start(): void {
    this.tryInitNativeVigem()
    if (!this.vigemController) {
      this.spawnEmbeddedWorker()
    }
  }

  private tryInitNativeVigem(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const ViGEmClient = require('node-vigem')
      const client = new ViGEmClient()
      if (client.connect() === null) {
        const controller = client.createX360Controller()
        if (controller.connect() === null) {
          this.vigemController = controller as NativeVigemController
        }
      }
    } catch {
      this.vigemController = null
    }
  }

  private spawnEmbeddedWorker(): void {
    if (process.platform !== 'win32' || this.workerProcess) return

    const candidates = [
      path.join(process.resourcesPath, 'DiscordiaHost.exe'),
      path.join(app.getAppPath(), 'public', 'DiscordiaHost.exe'),
      path.join(app.getAppPath(), 'DiscordiaHost.exe'),
    ]

    for (const exePath of candidates) {
      if (fs.existsSync(exePath)) {
        try {
          this.workerProcess = spawn(exePath, ['--session-token', this.sessionToken], {
            windowsHide: true,
            stdio: 'ignore',
            detached: false,
            env: { ...process.env, DISCORDIA_SESSION_TOKEN: this.sessionToken },
          })
          this.workerProcess.on('exit', () => {
            this.workerProcess = null
          })
          return
        } catch {
          /* fallback para python se disponível */
        }
      }
    }

    const scriptCandidates = [
      path.join(process.resourcesPath, 'discordia_companion.py'),
      path.join(app.getAppPath(), 'discordia_companion.py'),
    ]
    for (const scriptPath of scriptCandidates) {
      if (fs.existsSync(scriptPath)) {
        try {
          this.workerProcess = spawn('python', [scriptPath, '--session-token', this.sessionToken], {
            windowsHide: true,
            stdio: 'ignore',
            detached: false,
            env: { ...process.env, DISCORDIA_SESSION_TOKEN: this.sessionToken },
          })
          this.workerProcess.on('exit', () => {
            this.workerProcess = null
          })
          return
        } catch {
          /* ignore */
        }
      }
    }
  }

  private applyToNativeVigem(packet: GamepadPacket): boolean {
    const ctrl = this.vigemController
    if (!ctrl) return false

    try {
      if (packet.type === 'gamepad:release') {
        ctrl.axis.leftX.setValue(0)
        ctrl.axis.leftY.setValue(0)
        ctrl.axis.rightX.setValue(0)
        ctrl.axis.rightY.setValue(0)
        ctrl.axis.leftTrigger.setValue(0)
        ctrl.axis.rightTrigger.setValue(0)
        for (const btn of Object.values(ctrl.button)) {
          btn.setValue(false)
        }
        ctrl.update?.()
        return true
      }

      const b = packet.buttons ?? []
      const axes = packet.axes ?? [0, 0, 0, 0]
      const triggers = packet.triggers ?? [b[6] ?? 0, b[7] ?? 0]

      const buttonMap: [number, string][] = [
        [0, 'A'],
        [1, 'B'],
        [2, 'X'],
        [3, 'Y'],
        [4, 'LEFT_SHOULDER'],
        [5, 'RIGHT_SHOULDER'],
        [8, 'BACK'],
        [9, 'START'],
        [10, 'LEFT_THUMB'],
        [11, 'RIGHT_THUMB'],
      ]
      for (const [idx, name] of buttonMap) {
        ctrl.button[name]?.setValue(Boolean((b[idx] ?? 0) > 0.5))
      }

      const dpadX = (b[15] ?? 0) > 0.5 ? 1 : (b[14] ?? 0) > 0.5 ? -1 : 0
      const dpadY = (b[12] ?? 0) > 0.5 ? 1 : (b[13] ?? 0) > 0.5 ? -1 : 0
      ctrl.axis.dpadHorz?.setValue(dpadX)
      ctrl.axis.dpadVert?.setValue(dpadY)

      ctrl.axis.leftTrigger.setValue(Math.max(0, Math.min(1, triggers[0] ?? 0)))
      ctrl.axis.rightTrigger.setValue(Math.max(0, Math.min(1, triggers[1] ?? 0)))
      ctrl.axis.leftX.setValue(Math.max(-1, Math.min(1, axes[0] ?? 0)))
      ctrl.axis.leftY.setValue(Math.max(-1, Math.min(1, -(axes[1] ?? 0))))
      ctrl.axis.rightX.setValue(Math.max(-1, Math.min(1, axes[2] ?? 0)))
      ctrl.axis.rightY.setValue(Math.max(-1, Math.min(1, -(axes[3] ?? 0))))
      ctrl.update?.()
      return true
    } catch {
      return false
    }
  }

  private forwardToLocalLoopback(packet: GamepadPacket): void {
    if (this.wsSocket && this.wsSocket.readyState === WebSocket.OPEN) {
      try {
        this.wsSocket.send(JSON.stringify(packet))
      } catch {
        /* ignore */
      }
      return
    }

    if (this.wsConnecting) return
    this.wsConnecting = true

    const probe = new net.Socket()
    probe.setTimeout(350)
    probe.once('connect', () => {
      probe.destroy()
      try {
        const ws = new WebSocket('ws://127.0.0.1:8765')
        this.wsSocket = ws
        ws.onopen = () => {
          this.wsConnecting = false
          try {
            // Autentica o processo local do Electron via token efêmero antes de qualquer comando
            ws.send(JSON.stringify({ type: 'auth', token: this.sessionToken }))
            ws.send(JSON.stringify(packet))
          } catch {
            /* ignore */
          }
        }
        ws.onclose = () => {
          this.wsSocket = null
          this.wsConnecting = false
        }
        ws.onerror = () => {
          this.wsSocket = null
          this.wsConnecting = false
        }
      } catch {
        this.wsConnecting = false
      }
    })
    probe.once('error', () => {
      probe.destroy()
      this.wsConnecting = false
    })
    probe.once('timeout', () => {
      probe.destroy()
      this.wsConnecting = false
    })
    probe.connect(8765, '127.0.0.1')
  }

  handlePacket(packet: GamepadPacket): void {
    if (this.applyToNativeVigem(packet)) return
    this.forwardToLocalLoopback(packet)
  }

  stop(): void {
    this.handlePacket({ type: 'gamepad:release' })
    try {
      this.vigemController?.disconnect?.()
    } catch {
      /* ignore */
    }
    if (this.wsSocket) {
      try {
        this.wsSocket.close()
      } catch {
        /* ignore */
      }
      this.wsSocket = null
    }
    if (this.workerProcess) {
      try {
        this.workerProcess.kill()
      } catch {
        /* ignore */
      }
      this.workerProcess = null
    }
  }
}

const gamepadHost = new IntegratedGamepadHost()
let mainWindow: BrowserWindow | null = null
let selectedDesktopSourceId: string | null = null

function getAppIcon(): string {
  const candidates = [
    path.join(__dirname, '../public/icon.ico'),
    path.join(__dirname, '../dist/icon.ico'),
    path.join(app.getAppPath(), 'public/icon.ico'),
    path.join(app.getAppPath(), 'dist/icon.ico'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }
  return path.join(__dirname, '../public/icon.ico')
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    title: 'Discordia',
    icon: getAppIcon(),
    width: 1360,
    height: 840,
    minWidth: 940,
    minHeight: 620,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      backgroundThrottling: false,
    },
  })

  session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
    desktopCapturer
      .getSources({ types: ['screen', 'window'] })
      .then((sources) => {
        const targetId = selectedDesktopSourceId
        selectedDesktopSourceId = null
        const chosen = targetId ? sources.find((s) => s.id === targetId) : sources[0]
        if (chosen) {
          callback({ video: chosen, audio: 'loopback' })
        } else {
          callback({})
        }
      })
      .catch(() => callback({}))
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!isAllowedAppUrl(targetUrl)) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.href)
      }
    } catch {
      /* URL inválida bloqueada */
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── IPC Janela (Minimize / Maximize / Close) ─────────────────────────────────
ipcMain.on('window:minimize', (event) => {
  if (!isFromMainWindow(event)) return
  mainWindow?.minimize()
})

ipcMain.on('window:maximize', (event) => {
  if (!isFromMainWindow(event) || !mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.on('window:close', (event) => {
  if (!isFromMainWindow(event)) return
  mainWindow?.close()
})

// ─── IPC Remote Play ──────────────────────────────────────────────────────────
ipcMain.on('gamepad:state', (event, payload: unknown) => {
  if (!isFromMainWindow(event)) return
  const clean = sanitizeIpcGamepadState(payload)
  if (clean) {
    gamepadHost.handlePacket(clean)
  }
})

ipcMain.on('gamepad:connect', (event, slot: unknown) => {
  if (!isFromMainWindow(event)) return
  const validSlot = parseValidSlot(slot)
  if (validSlot !== null) {
    gamepadHost.handlePacket({ type: 'gamepad:connect', slot: validSlot })
  }
})

ipcMain.on('gamepad:disconnect', (event, slot: unknown) => {
  if (!isFromMainWindow(event)) return
  const validSlot = parseValidSlot(slot)
  if (validSlot !== null) {
    gamepadHost.handlePacket({ type: 'gamepad:disconnect', slot: validSlot })
  }
})

ipcMain.on('gamepad:release', (event, slot?: unknown) => {
  if (!isFromMainWindow(event)) return
  if (slot === undefined || slot === null) {
    gamepadHost.handlePacket({ type: 'gamepad:release' })
    return
  }
  const validSlot = parseValidSlot(slot)
  if (validSlot !== null) {
    gamepadHost.handlePacket({ type: 'gamepad:release', slot: validSlot })
  }
})

// ─── Captura de Janelas e Telas (Desktop Capturer) ───────────────────────────
ipcMain.handle('get-desktop-sources', async (event) => {
  if (!isFromMainWindow(event)) return []
  try {
    const sources = await desktopCapturer.getSources({
      types: ['window', 'screen'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    })
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon ? s.appIcon.toDataURL() : null,
      isScreen: s.id.startsWith('screen:'),
    }))
  } catch (err) {
    console.warn('[desktopCapturer] Erro ao buscar fontes de captura:', err)
    return []
  }
})

ipcMain.handle('select-desktop-source', (event, sourceId: unknown) => {
  if (!isFromMainWindow(event)) return false
  if (sourceId === null) {
    selectedDesktopSourceId = null
    return true
  }
  if (typeof sourceId !== 'string' || !DESKTOP_SOURCE_ID_RE.test(sourceId)) {
    return false
  }
  selectedDesktopSourceId = sourceId
  return true
})

// ─── Global Shortcuts (Mute / Deafen) ────────────────────────────────────────
ipcMain.on('register-global-shortcuts', (event, rawShortcuts: unknown) => {
  if (!isFromMainWindow(event)) return
  globalShortcut.unregisterAll()
  if (!rawShortcuts || typeof rawShortcuts !== 'object' || Array.isArray(rawShortcuts)) return

  const shortcuts = rawShortcuts as Record<string, unknown>
  const toggleMute = parseValidAccelerator(shortcuts.toggleMute)
  const toggleDeafen = parseValidAccelerator(shortcuts.toggleDeafen)

  if (toggleMute) {
    try {
      globalShortcut.register(toggleMute, () => {
        mainWindow?.webContents.send('shortcut-triggered', 'toggle-mute')
      })
    } catch (err) {
      console.warn('[globalShortcut] Erro ao registrar mute:', toggleMute, err)
    }
  }

  if (toggleDeafen && toggleDeafen !== toggleMute) {
    try {
      globalShortcut.register(toggleDeafen, () => {
        mainWindow?.webContents.send('shortcut-triggered', 'toggle-deafen')
      })
    } catch (err) {
      console.warn('[globalShortcut] Erro ao registrar deafen:', toggleDeafen, err)
    }
  }
})

// ─── Auto-Update via electron-updater ─────────────────────────────────────────
ipcMain.on('update:restart-and-install', (event) => {
  if (!isFromMainWindow(event)) return
  autoUpdater.quitAndInstall()
})

function initAutoUpdater(): void {
  // Executa verificação apenas em produção empacotada
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update-available', { version: info.version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update-downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    console.warn('[electron-updater] Erro na verificação:', err?.message || err)
  })

  void autoUpdater.checkForUpdatesAndNotify()
}

// Desativa congelamento e throttling em segundo plano no Chromium
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('webrtc-max-cpu-consumption-percentage', '100')
app.commandLine.appendSwitch('enable-features', 'WebRtcHideLocalIpsWithMdns,MediaSession')

app.whenReady().then(() => {
  // Tratamento completo de permissões de mídia (somente para a origem local do app)
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (!isAllowedAppUrl(webContents.getURL())) return callback(false)
    const perm = permission as string
    if (
      perm === 'media' ||
      perm === 'videoCapture' ||
      perm === 'audioCapture' ||
      perm === 'display-capture' ||
      perm === 'fullscreen' ||
      perm === 'notifications'
    ) {
      return callback(true)
    }
    callback(false)
  })

  session.defaultSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const checkUrl = requestingOrigin || webContents?.getURL() || ''
    if (checkUrl && !isAllowedAppUrl(checkUrl)) return false
    const perm = permission as string
    if (
      perm === 'media' ||
      perm === 'videoCapture' ||
      perm === 'audioCapture' ||
      perm === 'display-capture' ||
      perm === 'fullscreen' ||
      perm === 'notifications'
    ) {
      return true
    }
    return false
  })

  gamepadHost.start()
  createMainWindow()
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll()
  gamepadHost.stop()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  gamepadHost.stop()
})
