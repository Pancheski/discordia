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
    ipcRenderer.send('gamepad:state', payload)
  },
  releaseGamepad: (slot?: number) => {
    ipcRenderer.send('gamepad:release', slot)
  },
  connectGamepadSlot: (slot: number) => {
    ipcRenderer.send('gamepad:connect', slot)
  },
  disconnectGamepadSlot: (slot: number) => {
    ipcRenderer.send('gamepad:disconnect', slot)
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
  // Captura de Janelas e Telas (Desktop Capturer)
  getDesktopSources: () => ipcRenderer.invoke('get-desktop-sources'),
  selectDesktopSource: (sourceId: string | null) => ipcRenderer.invoke('select-desktop-source', sourceId),
}

contextBridge.exposeInMainWorld('electron', api)
