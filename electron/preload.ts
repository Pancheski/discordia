import { contextBridge, ipcRenderer } from 'electron'

export interface KeybindShortcuts {
  toggleMute: string
  toggleDeafen: string
}

export interface DiscordiaElectronAPI {
  isElectron: boolean
  platform: string
  sendGamepadState: (payload: unknown) => void
  releaseGamepad: () => void
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
}

const api: DiscordiaElectronAPI = {
  isElectron: true,
  platform: process.platform,
  sendGamepadState: (payload: unknown) => {
    ipcRenderer.send('gamepad:state', payload)
  },
  releaseGamepad: () => {
    ipcRenderer.send('gamepad:release')
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
    const handler = (_event: unknown, info: { version?: string }) => callback(info)
    ipcRenderer.on('update-available', handler)
    return () => {
      ipcRenderer.removeListener('update-available', handler)
    }
  },
  onUpdateDownloaded: (callback) => {
    const handler = (_event: unknown, info: { version?: string }) => callback(info)
    ipcRenderer.on('update-downloaded', handler)
    return () => {
      ipcRenderer.removeListener('update-downloaded', handler)
    }
  },
  // Global Shortcuts
  registerGlobalShortcuts: (shortcuts: KeybindShortcuts) => {
    ipcRenderer.send('register-global-shortcuts', shortcuts)
  },
  onShortcutTriggered: (callback) => {
    const handler = (_event: unknown, action: 'toggle-mute' | 'toggle-deafen') => callback(action)
    ipcRenderer.on('shortcut-triggered', handler)
    return () => {
      ipcRenderer.removeListener('shortcut-triggered', handler)
    }
  },
}

contextBridge.exposeInMainWorld('electron', api)
