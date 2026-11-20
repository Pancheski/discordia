import { contextBridge, ipcRenderer } from 'electron'

export interface KeybindShortcuts {
  toggleMute: string
  toggleDeafen: string
}

export interface DesktopSourceInfo {
  id: string
  name: string
  thumbnail: string
  appIcon: string | null
  isScreen: boolean
}

export interface DiscordiaElectronAPI {
  isElectron: boolean
  platform: string
  sendGamepadState: (payload: unknown) => void
  releaseGamepad: (slot?: number) => void
  connectGamepadSlot: (slot: number) => void
  disconnectGamepadSlot: (slot: number) => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  // Auto-Update
  restartAndInstallUpdate: () => void
  onUpdateAvailable: (callback: (info: { version?: string }) => void) => () => void
  onUpdateDownloaded: (callback: (info: { version?: string }) => void) => () => void
  // Global Shortcuts
  registerGlobalShortcuts: (shortcuts: KeybindShortcuts) => void
  onShortcutTriggered: (callback: (action: 'toggle-mute' | 'toggle-deafen') => void) => () => void
  // Captura de Janelas e Telas (Desktop Capturer)
  getDesktopSources: () => Promise<DesktopSourceInfo[]>
  selectDesktopSource: (sourceId: string | null) => Promise<boolean>
}

const api: DiscordiaElectronAPI = {
  isElectron: true,
  platform: process.platform,
  sendGamepadState: (payload: unknown) => {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      ipcRenderer.send('gamepad:state', payload)
    }
  },
  releaseGamepad: (slot?: number) => {
    if (slot === undefined || (typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= 4)) {
      ipcRenderer.send('gamepad:release', slot)
    }
  },
  connectGamepadSlot: (slot: number) => {
    if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= 4) {
      ipcRenderer.send('gamepad:connect', slot)
    }
  },
  disconnectGamepadSlot: (slot: number) => {
    if (typeof slot === 'number' && Number.isInteger(slot) && slot >= 1 && slot <= 4) {
      ipcRenderer.send('gamepad:disconnect', slot)
    }
  },
  minimizeWindow: () => {
    ipcRenderer.send('window:minimize')
  },
  maximizeWindow: () => {
    ipcRenderer.send('window:maximize')
  },
  closeWindow: () => {
    ipcRenderer.send('window:close')
  },
  // Auto-Update
  restartAndInstallUpdate: () => {
    ipcRenderer.send('update:restart-and-install')
  },
  onUpdateAvailable: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const handler = (_event: unknown, info: { version?: string }) => callback(info)
    ipcRenderer.on('update-available', handler)
    return () => {
      ipcRenderer.removeListener('update-available', handler)
    }
  },
  onUpdateDownloaded: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const handler = (_event: unknown, info: { version?: string }) => callback(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => {
      ipcRenderer.removeListener('update-downloaded', handler)
    }
  },
  // Global Shortcuts
  registerGlobalShortcuts: (shortcuts: KeybindShortcuts) => {
    if (
      shortcuts &&
      typeof shortcuts === 'object' &&
      typeof shortcuts.toggleMute === 'string' &&
      typeof shortcuts.toggleDeafen === 'string'
    ) {
      ipcRenderer.send('register-global-shortcuts', {
        toggleMute: shortcuts.toggleMute.slice(0, 64),
        toggleDeafen: shortcuts.toggleDeafen.slice(0, 64),
      })
    }
  },
  onShortcutTriggered: (callback) => {
    if (typeof callback !== 'function') return () => {}
    const handler = (_event: unknown, action: 'toggle-mute' | 'toggle-deafen') => callback(action)
    ipcRenderer.on('shortcut-triggered', handler)
    return () => {
      ipcRenderer.removeListener('shortcut-triggered', handler)
    }
  },
  // Captura de Janelas e Telas (Desktop Capturer)
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  selectDesktopSource: (sourceId: string | null) => {
    if (sourceId !== null && typeof sourceId !== 'string') return Promise.resolve(false)
    return ipcRenderer.invoke('select-desktop-source', sourceId)
  },
}

contextBridge.exposeInMainWorld('electron', api)
