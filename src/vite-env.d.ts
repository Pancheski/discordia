/// <reference types="vite/client" />

interface ImportMetaEnv {
  // ICE (STUN/TURN)
  readonly VITE_METERED_DOMAIN?: string
  readonly VITE_METERED_API_KEY?: string
  readonly VITE_TURN_URLS?: string
  readonly VITE_TURN_USERNAME?: string
  readonly VITE_TURN_CREDENTIAL?: string
  // Presença do Lobby
  readonly VITE_PRESENCE_PROVIDER?: 'firebase' | 'local' | 'off'
  readonly VITE_FIREBASE_DATABASE_URL?: string
  readonly VITE_PRESENCE_ROOT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

