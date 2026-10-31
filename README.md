# 🎧 Discordia

Uma alternativa leve ao Discord para grupos de 2 a 6 amigos. Faz **chamadas de voz** e **compartilhamento de tela com áudio a 60 fps** usando WebRTC P2P (PeerJS).
Pronto para deploy 100% gratuito na nuvem (Vercel, Cloudflare Pages ou Netlify) e adaptado para funcionar entre redes diferentes na internet pública (NAT/CGNAT).

---

## 🚀 Como Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor de desenvolvimento
npm run dev          # http://localhost:5173

# 3. Build de produção
npm run build && npm run preview
```

---

## 🌐 Conexão Externa (NAT / CGNAT / 4G e 5G)

Em redes locais (mesmo Wi-Fi), a conexão WebRTC acontece diretamente.
Na internet pública, provedores de internet residencial e operadoras móveis utilizam **CGNAT** (NAT simétrico) e firewalls estritos. Para garantir conectividade em 100% dos cenários:

1. **STUN (Gratuito e Ativo por Padrão):** O app vem com 5 servidores Google STUN configurados para descoberta de IP/porta pública.
2. **TURN Relay (Recomendado para Redes Restritas):** Quando o firewall impede conexão direta, o tráfego de mídia é redirecionado via TURN sobre UDP/TCP 443.

### Como Ativar TURN Gratuito (Metered.ca — 50 GB/mês Free sem cartão)
1. Crie uma conta gratuita em [https://www.metered.ca/tools/openrelay/](https://www.metered.ca/tools/openrelay/).
2. No painel, copie o **App Domain** (ex: `meuapp.metered.ca`) e a **API Key**.
3. Crie um arquivo `.env` na raiz do projeto baseado no `.env.example`:
   ```env
   VITE_METERED_DOMAIN=meuapp.metered.ca
   VITE_METERED_API_KEY=sua_api_key_aqui
   ```
4. O app detectará automaticamente e carregará servidores TURN distribuídos globalmente.

---

## ☁️ Guia de Deploy 100% Gratuito na Nuvem

Navegadores exigem **HTTPS** (contexto seguro) para liberar `getDisplayMedia` e `getUserMedia` fora do localhost. Vercel e Cloudflare Pages fornecem certificados SSL automáticos gratuitos.

### Opção 1: Vercel (Recomendado)

O projeto já inclui o arquivo [vercel.json](file:///c:/DEV/Discordia/vercel.json) com as regras de SPA rewrite e headers de `Permissions-Policy`.

#### Pelo Terminal (Vercel CLI):
```bash
# 1. Instalar o CLI da Vercel (se ainda não tiver)
npm i -g vercel

# 2. Executar o deploy
vercel

# Responda às perguntas:
# - Set up and deploy? [Y]
# - Which scope? [Sua conta]
# - Link to existing project? [N]
# - Project name? [discordia]
# - In which directory is your code located? [./]
# O Vercel detecta o Vite automaticamente.

# 3. Deploy de Produção:
vercel --prod
```

#### Pelo GitHub:
1. Suba o código para um repositório no GitHub.
2. Acesse [vercel.com](https://vercel.com) e clique em **Add New... -> Project**.
3. Importe seu repositório.
4. Em **Environment Variables**, adicione as variáveis do TURN (`VITE_METERED_DOMAIN` e `VITE_METERED_API_KEY`) caso deseje.
5. Clique em **Deploy**.

---

### Opção 2: Cloudflare Pages

O projeto já inclui o arquivo [public/_redirects](file:///c:/DEV/Discordia/public/_redirects) (`/* /index.html 200`).

1. Acesse o painel da Cloudflare -> **Workers & Pages** -> **Create application** -> **Pages**.
2. Conecte com seu GitHub e selecione o repositório.
3. Configure as opções de Build:
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. Em **Environment variables**, adicione suas variáveis do `.env`.
5. Clique em **Save and Deploy**.

---

## 🧪 Como Testar entre Redes Diferentes

1. Copie o link gerado pelo deploy (ex: `https://meu-discordia.vercel.app`).
2. Abra o link no seu **Computador conectado no Wi-Fi de casa**.
3. Escolha uma sala e entre.
4. Clique em **"Convidar"** ou copie a URL gerada (ex: `https://meu-discordia.vercel.app/?room=amigos`).
5. Abra o link no seu **Celular desconectado do Wi-Fi (usando apenas dados móveis 4G ou 5G)**.
6. Digite seu apelido no celular e clique em **Entrar na sala**.
7. Verifique o status **"2 na call"** e fale no microfone para validar o áudio bidirecional e o anel verde de fala.

---

## 📁 Estrutura do Projeto

```
discordia/
├── index.html
├── package.json
├── vite.config.ts                # React + Tailwind v4
├── vercel.json                   # Configuração de SPA e Permissions-Policy para Vercel
├── .env.example                  # Modelo de variáveis de ambiente para STUN/TURN
├── public/
│   ├── favicon.svg
│   └── _redirects                # Regra de roteamento SPA para Cloudflare Pages
└── src/
    ├── main.tsx
    ├── App.tsx                   # Roteamento entre Lobby e Sala; sync com ?room=
    ├── index.css                 # Design tokens do Discord, animações e range slider
    ├── types.ts                  # Protocolo de sinalização e estados
    ├── hooks/
    │   ├── useRoom.ts            # Hook React de controle de sala
    │   └── useMediaStream.ts     # Binding seguro de MediaStream com elementos HTML
    ├── lib/
    │   ├── RoomManager.ts        # Core WebRTC: malha P2P, reconexão e auto-cura
    │   ├── iceConfig.ts          # Servidores STUN Google + integração TURN Metered.ca
    │   ├── audio.ts              # Deteção nativa RTP (RFC 6464) e mic local
    │   ├── rtc.ts                # SDP munging (64kbps voz, 12Mbps tela) e sender tuning
    │   └── utils.ts              # Extração de URLs (?room= e #hash), links e helpers
    └── components/
        ├── Lobby.tsx             # Entrada, detecção de convite e cópia de link
        ├── RoomView.tsx          # Palco principal e grid de participantes
        ├── ScreenStage.tsx       # Transmissão de tela 60fps com Fullscreen e áudio estéreo
        ├── ParticipantTile.tsx   # Card com feedback visual de fala (anel verde)
        ├── Sidebar.tsx           # Roster com sliders de volume individuais por pessoa
        ├── ControlBar.tsx        # Controles inferiores (Mute, Tela, Sair, Convidar)
        ├── VolumeSlider.tsx
        ├── AudioSink.tsx         # Elemento de áudio offscreen com alta prioridade de thread
        ├── Avatar.tsx
        └── Toasts.tsx
```
