import { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, shell, session } from 'electron'
import { autoUpdater } from 'electron-updater'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

interface GamepadPacket {
  type: 'gamepad:state' | 'gamepad:release'
  player?: number
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
          this.workerProcess = spawn(exePath, [], {
            windowsHide: true,
            stdio: 'ignore',
            detached: false,
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
          this.workerProcess = spawn('python', [scriptPath], {
            windowsHide: true,
            stdio: 'ignore',
            detached: false,
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

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'display-capture', 'fullscreen', 'notifications', 'audioCapture']
    callback(allowed.includes(permission))
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ─── IPC Janela (Minimize / Maximize / Close) ─────────────────────────────────
ipcMain.on('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.on('window:maximize', () => {
  if (!mainWindow) return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }
})

ipcMain.on('window:close', () => {
  mainWindow?.close()
})

// ─── IPC Remote Play ──────────────────────────────────────────────────────────
ipcMain.on('gamepad:state', (_event, payload: unknown) => {
  if (payload && typeof payload === 'object') {
    gamepadHost.handlePacket(payload as GamepadPacket)
  }
})

ipcMain.on('gamepad:release', () => {
  gamepadHost.handlePacket({ type: 'gamepad:release' })
})

// ─── Captura de Janelas e Telas (Desktop Capturer) ───────────────────────────
ipcMain.handle('get-desktop-sources', async () => {
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

ipcMain.handle('select-desktop-source', (_event, sourceId: string | null) => {
  selectedDesktopSourceId = sourceId
  return true
})

// ─── Global Shortcuts (Mute / Deafen) ────────────────────────────────────────
interface RegisteredShortcuts {
  toggleMute: string
  toggleDeafen: string
}

ipcMain.on('register-global-shortcuts', (_event, shortcuts: RegisteredShortcuts) => {
  globalShortcut.unregisterAll()

  if (shortcuts?.toggleMute && shortcuts.toggleMute.trim()) {
    try {
      globalShortcut.register(shortcuts.toggleMute.trim(), () => {
        mainWindow?.webContents.send('shortcut-triggered', 'toggle-mute')
      })
    } catch (err) {
      console.warn('[globalShortcut] Erro ao registrar mute:', shortcuts.toggleMute, err)
    }
  }

  if (shortcuts?.toggleDeafen && shortcuts.toggleDeafen.trim()) {
    try {
      globalShortcut.register(shortcuts.toggleDeafen.trim(), () => {
        mainWindow?.webContents.send('shortcut-triggered', 'toggle-deafen')
      })
    } catch (err) {
      console.warn('[globalShortcut] Erro ao registrar deafen:', shortcuts.toggleDeafen, err)
    }
  }
})

// ─── Auto-Update via electron-updater ─────────────────────────────────────────
ipcMain.on('update:restart-and-install', () => {
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

app.whenReady().then(() => {
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
