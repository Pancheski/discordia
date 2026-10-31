import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Sem <StrictMode>: o duplo-mount de desenvolvimento abriria/fecharia conexões WebRTC
// desnecessariamente. Toda a lógica de mídia vive no RoomManager (fora do ciclo do React).
createRoot(document.getElementById('root')!).render(<App />)
