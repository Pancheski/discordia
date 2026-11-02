import { contextBridge, ipcRenderer } from 'electron'

export interface DiscordiaElectronAPI {
  isElectron: boolean
  platform: string
  sendGamepadState: (payload: unknown) => void
  releaseGamepad: () => void
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
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
}

contextBridge.exposeInMainWorld('electron', api)

