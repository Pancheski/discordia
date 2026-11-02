export interface KeybindShortcuts {
  toggleMute: string
  toggleDeafen: string
}

export const DEFAULT_KEYBINDS: KeybindShortcuts = {
  toggleMute: 'CommandOrControl+Shift+M',
  toggleDeafen: 'CommandOrControl+Shift+D',
}

const STORAGE_KEY = 'discordia:keybinds'

export function loadSavedKeybinds(): KeybindShortcuts {
  if (typeof window === 'undefined') return DEFAULT_KEYBINDS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<KeybindShortcuts>
      return {
        toggleMute: parsed.toggleMute || DEFAULT_KEYBINDS.toggleMute,
        toggleDeafen: parsed.toggleDeafen || DEFAULT_KEYBINDS.toggleDeafen,
      }
    }
  } catch {
    /* ignore fallback */
  }
  return DEFAULT_KEYBINDS
}

export function saveKeybinds(shortcuts: KeybindShortcuts): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts))
  } catch {
    /* ignore */
  }
}

/**
 * Formata um Accelerator do Electron para exibição amigável no UI (ex: Ctrl + Shift + M)
 */
export function formatAcceleratorDisplay(accel: string): string {
  if (!accel) return 'Nenhum'
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)
  return accel
    .split('+')
    .map((part) => {
      const p = part.trim()
      if (p === 'CommandOrControl') return isMac ? 'Cmd' : 'Ctrl'
      if (p === 'Control') return 'Ctrl'
      if (p === 'Command') return 'Cmd'
      return p
    })
    .join(' + ')
}

/**
 * Converte um KeyboardEvent do navegador em um Accelerator válido para o Electron globalShortcut
 */
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const code = e.code

  // Teclas modificadoras puras não encerram a combinação
  if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(code)) {
    return null
  }

  // Teclas proibidas
  if (['Escape', 'Tab', 'CapsLock', 'NumLock', 'ScrollLock'].includes(code)) {
    return null
  }

  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('CommandOrControl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')

  // Mapeamento de teclas
  let keyName = ''
  if (code.startsWith('Key')) {
    keyName = code.slice(3) // KeyM -> M
  } else if (code.startsWith('Digit')) {
    keyName = code.slice(5) // Digit1 -> 1
  } else if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) {
    keyName = code // F1-F12
  } else {
    switch (code) {
      case 'Space': keyName = 'Space'; break
      case 'Enter': keyName = 'Return'; break
      case 'Backspace': keyName = 'Backspace'; break
      case 'Delete': keyName = 'Delete'; break
      case 'ArrowUp': keyName = 'Up'; break
      case 'ArrowDown': keyName = 'Down'; break
      case 'ArrowLeft': keyName = 'Left'; break
      case 'ArrowRight': keyName = 'Right'; break
      case 'Home': keyName = 'Home'; break
      case 'End': keyName = 'End'; break
      case 'PageUp': keyName = 'PageUp'; break
      case 'PageDown': keyName = 'PageDown'; break
      default:
        if (e.key && e.key.length === 1) {
          keyName = e.key.toUpperCase()
        } else {
          keyName = code
        }
    }
  }

  if (!keyName) return null

  // Se não for tecla de função (F1-F12), exige pelo menos um modificador (Ctrl, Alt)
  if (!code.startsWith('F') && parts.length === 0) {
    return null
  }

  parts.push(keyName)
  return parts.join('+')
}

