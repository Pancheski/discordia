import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Flag, Minimize2, Power, RotateCcw, Trophy } from 'lucide-react'
import { playUiSfx } from '../hooks/useAudioSystem'
import { colorFromString } from '../lib/utils'
import type { GolfResetEvent, GolfStrokeEvent } from '../types'

interface GolfParticipant {
  peerId: string
  name: string
  isLocal: boolean
}

interface MiniGolfGameProps {
  open: boolean
  onClose: () => void
  onEndApp: () => void
  localPeerId: string
  localName: string
  participants: GolfParticipant[]
  lastStroke: GolfStrokeEvent | null
  lastReset: GolfResetEvent | null
  onSendStroke: (vx: number, vz: number) => void
  onSendReset: () => void
}

interface BallSim {
  peerId: string
  name: string
  color: string
  x: number
  z: number
  vx: number
  vz: number
  strokes: number
  inHole: boolean
  mesh?: THREE.Mesh
  labelSprite?: THREE.Sprite
}

interface ObstacleBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const COURSE_HALF_W = 4.6
const COURSE_HALF_L = 10.2
const BALL_RADIUS = 0.28
const HOLE_X = 0
const HOLE_Z = -8.0
const HOLE_RADIUS = 0.52
const MAX_PULL_DIST = 3.6
const MAX_POWER = 0.36
const FRICTION = 0.982

// Obstáculos de madeira no meio da pista para tabelas
const OBSTACLES: ObstacleBox[] = [
  { minX: -2.4, maxX: 0.4, minZ: 2.2, maxZ: 2.8 },
  { minX: -0.4, maxX: 2.4, minZ: -2.6, maxZ: -2.0 },
]

function spawnPositionForIndex(idx: number, total: number): { x: number; z: number } {
  const spread = Math.min(3.2, Math.max(0, (total - 1) * 0.75))
  const x = total <= 1 ? 0 : -spread / 2 + (idx / (total - 1)) * spread
  return { x, z: 8.2 }
}

function createNameSprite(name: string, colorHex: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'rgba(18, 20, 26, 0.82)'
    ctx.beginPath()
    ctx.roundRect(16, 10, 224, 44, 22)
    ctx.fill()
    ctx.lineWidth = 3
    ctx.strokeStyle = colorHex
    ctx.stroke()

    ctx.font = 'bold 24px Inter, system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name.slice(0, 14), 128, 33)
  }
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(2.1, 0.52, 1)
  return sprite
}

export function MiniGolfGame({
  open,
  onClose,
  onEndApp,
  localPeerId,
  localName,
  participants,
  lastStroke,
  lastReset,
  onSendStroke,
  onSendReset,
}: MiniGolfGameProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const ballsRef = useRef<Map<string, BallSim>>(new Map())
  const lastStrokeSeqRef = useRef(0)
  const lastResetSeqRef = useRef(0)

  const [powerPct, setPowerPct] = useState(0)
  const [scoreboard, setScoreboard] = useState<Array<{ peerId: string; name: string; color: string; strokes: number; inHole: boolean }>>([])
  const [localMoving, setLocalMoving] = useState(false)

  const syncScoreboardUi = useCallback(() => {
    const list = [...ballsRef.current.values()].map((b) => ({
      peerId: b.peerId,
      name: b.name,
      color: b.color,
      strokes: b.strokes,
      inHole: b.inHole,
    }))
    setScoreboard(list)
    const me = ballsRef.current.get(localPeerId)
    setLocalMoving(!!me && (Math.hypot(me.vx, me.vz) > 0.002 || me.inHole))
  }, [localPeerId])

  // Aplica tacada recebida via P2P ou local
  useEffect(() => {
    if (!lastStroke || lastStroke.seq === lastStrokeSeqRef.current) return
    lastStrokeSeqRef.current = lastStroke.seq

    let ball = ballsRef.current.get(lastStroke.peerId)
    if (!ball) {
      const pos = spawnPositionForIndex(ballsRef.current.size, participants.length)
      ball = {
        peerId: lastStroke.peerId,
        name: lastStroke.name,
        color: colorFromString(lastStroke.peerId),
        x: pos.x,
        z: pos.z,
        vx: 0,
        vz: 0,
        strokes: 0,
        inHole: false,
      }
      ballsRef.current.set(lastStroke.peerId, ball)
    }

    if (ball.inHole) return
    ball.vx = lastStroke.vx
    ball.vz = lastStroke.vz
    ball.strokes += 1
    playUiSfx('putt')
    syncScoreboardUi()
  }, [lastStroke, participants.length, syncScoreboardUi])

  // Reinicia posições quando solicitado
  useEffect(() => {
    if (!lastReset || lastReset.seq === lastResetSeqRef.current) return
    lastResetSeqRef.current = lastReset.seq
    const entries = [...ballsRef.current.values()]
    entries.forEach((b, idx) => {
      const pos = spawnPositionForIndex(idx, entries.length)
      b.x = pos.x
      b.z = pos.z
      b.vx = 0
      b.vz = 0
      b.strokes = 0
      b.inHole = false
    })
    syncScoreboardUi()
  }, [lastReset, syncScoreboardUi])

  // Inicializa cena Three.js, física 60fps e controles Pull & Release
  useEffect(() => {
    if (!open) return
    const container = mountRef.current
    if (!container) return
    const ballsMap = ballsRef.current

    const width = container.clientWidth || 640
    const height = container.clientHeight || 420

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#0f172a')
    scene.fog = new THREE.Fog('#0f172a', 22, 38)

    const camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100)
    camera.position.set(0, 14.5, 15.8)
    camera.lookAt(0, 0, 0.5)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    // Iluminação Low-Poly Stylized
    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x14532d, 0.85)
    scene.add(hemi)

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 1.15)
    dirLight.position.set(8, 16, 10)
    dirLight.castShadow = true
    dirLight.shadow.mapSize.width = 1024
    dirLight.shadow.mapSize.height = 1024
    scene.add(dirLight)

    // Gramado em faixas estilizadas
    const turfGroup = new THREE.Group()
    const stripeCount = 10
    const stripeLen = (COURSE_HALF_L * 2) / stripeCount
    for (let i = 0; i < stripeCount; i++) {
      const geo = new THREE.BoxGeometry(COURSE_HALF_W * 2, 0.3, stripeLen)
      const mat = new THREE.MeshStandardMaterial({
        color: i % 2 === 0 ? 0x16a34a : 0x15803d,
        roughness: 0.88,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(0, -0.15, -COURSE_HALF_L + stripeLen * (i + 0.5))
      mesh.receiveShadow = true
      turfGroup.add(mesh)
    }
    scene.add(turfGroup)

    // Rampa / relevo suave central (visual)
    const rampGeo = new THREE.BoxGeometry(3.2, 0.14, 2.2)
    const rampMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.75 })
    const rampMesh = new THREE.Mesh(rampGeo, rampMat)
    rampMesh.position.set(0, 0.04, 0)
    rampMesh.receiveShadow = true
    scene.add(rampMesh)

    // Bordas de madeira externas
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 })
    const wallThickness = 0.45
    const wallHeight = 0.55

    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(wallThickness, wallHeight, COURSE_HALF_L * 2 + wallThickness * 2),
      woodMat,
    )
    leftWall.position.set(-COURSE_HALF_W - wallThickness / 2, wallHeight / 2, 0)
    leftWall.castShadow = true
    leftWall.receiveShadow = true
    scene.add(leftWall)

    const rightWall = leftWall.clone()
    rightWall.position.set(COURSE_HALF_W + wallThickness / 2, wallHeight / 2, 0)
    scene.add(rightWall)

    const topWall = new THREE.Mesh(new THREE.BoxGeometry(COURSE_HALF_W * 2, wallHeight, wallThickness), woodMat)
    topWall.position.set(0, wallHeight / 2, -COURSE_HALF_L - wallThickness / 2)
    topWall.castShadow = true
    scene.add(topWall)

    const bottomWall = topWall.clone()
    bottomWall.position.set(0, wallHeight / 2, COURSE_HALF_L + wallThickness / 2)
    scene.add(bottomWall)

    // Obstáculos internos de madeira
    for (const obs of OBSTACLES) {
      const w = obs.maxX - obs.minX
      const d = obs.maxZ - obs.minZ
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, d), woodMat)
      mesh.position.set((obs.minX + obs.maxX) / 2, 0.25, (obs.minZ + obs.maxZ) / 2)
      mesh.castShadow = true
      mesh.receiveShadow = true
      scene.add(mesh)
    }

    // Buraco final + Mastro + Bandeira vermelha
    const holeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, 0.05, 28),
      new THREE.MeshBasicMaterial({ color: 0x090d16 }),
    )
    holeMesh.position.set(HOLE_X, 0.01, HOLE_Z)
    scene.add(holeMesh)

    const holeRim = new THREE.Mesh(
      new THREE.RingGeometry(HOLE_RADIUS, HOLE_RADIUS + 0.08, 28),
      new THREE.MeshBasicMaterial({ color: 0xe2e8f0, side: THREE.DoubleSide }),
    )
    holeRim.rotation.x = -Math.PI / 2
    holeRim.position.set(HOLE_X, 0.02, HOLE_Z)
    scene.add(holeRim)

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 2.5, 12),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.6, roughness: 0.3 }),
    )
    pole.position.set(HOLE_X, 1.25, HOLE_Z)
    pole.castShadow = true
    scene.add(pole)

    const flagGeo = new THREE.ConeGeometry(0.45, 0.95, 3)
    flagGeo.rotateZ(-Math.PI / 2)
    const flagMesh = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 }))
    flagMesh.position.set(HOLE_X + 0.42, 2.2, HOLE_Z)
    scene.add(flagMesh)

    // Linha pontilhada de mira (Pull & Release)
    const aimPoints = [new THREE.Vector3(), new THREE.Vector3()]
    const aimGeo = new THREE.BufferGeometry().setFromPoints(aimPoints)
    const aimMat = new THREE.LineDashedMaterial({ color: 0xfef08a, dashSize: 0.3, gapSize: 0.18 })
    const aimLine = new THREE.Line(aimGeo, aimMat)
    aimLine.visible = false
    scene.add(aimLine)

    // Sincroniza bolas dos participantes
    const ensureParticipantBalls = () => {
      participants.forEach((p, idx) => {
        let b = ballsRef.current.get(p.peerId)
        if (!b) {
          const pos = spawnPositionForIndex(idx, participants.length)
          b = {
            peerId: p.peerId,
            name: p.name,
            color: colorFromString(p.peerId),
            x: pos.x,
            z: pos.z,
            vx: 0,
            vz: 0,
            strokes: 0,
            inHole: false,
          }
          ballsRef.current.set(p.peerId, b)
        } else {
          b.name = p.name
        }

        if (!b.mesh) {
          const ballGeo = new THREE.SphereGeometry(BALL_RADIUS, 24, 24)
          const ballMat = new THREE.MeshStandardMaterial({
            color: b.color,
            roughness: 0.25,
            metalness: 0.1,
          })
          const mesh = new THREE.Mesh(ballGeo, ballMat)
          mesh.castShadow = true
          scene.add(mesh)
          b.mesh = mesh

          const sprite = createNameSprite(b.name, b.color)
          scene.add(sprite)
          b.labelSprite = sprite
        }
      })
      syncScoreboardUi()
    }

    ensureParticipantBalls()

    // Interação Pull & Release via Raycaster no plano horizontal
    const raycaster = new THREE.Raycaster()
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
    const hitPoint = new THREE.Vector3()
    let dragging = false

    const screenToGround = (clientX: number, clientY: number): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      return raycaster.ray.intersectPlane(groundPlane, hitPoint)
    }

    const onPointerDown = (e: PointerEvent) => {
      const myBall = ballsRef.current.get(localPeerId)
      if (!myBall || myBall.inHole || Math.hypot(myBall.vx, myBall.vz) > 0.002) return
      const pt = screenToGround(e.clientX, e.clientY)
      if (!pt) return
      // Permite puxar clicando perto da própria bola ou em qualquer lugar da pista
      if (Math.hypot(pt.x - myBall.x, pt.z - myBall.z) <= 2.4) {
        dragging = true
        renderer.domElement.setPointerCapture(e.pointerId)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      const myBall = ballsRef.current.get(localPeerId)
      if (!myBall) return
      const pt = screenToGround(e.clientX, e.clientY)
      if (!pt) return

      const pullX = myBall.x - pt.x
      const pullZ = myBall.z - pt.z
      const dist = Math.min(MAX_PULL_DIST, Math.hypot(pullX, pullZ))
      const angle = Math.atan2(pullZ, pullX)
      const pct = Math.round((dist / MAX_PULL_DIST) * 100)
      setPowerPct(pct)

      const aimLen = dist * 1.45
      const startVec = new THREE.Vector3(myBall.x, BALL_RADIUS + 0.05, myBall.z)
      const endVec = new THREE.Vector3(
        myBall.x + Math.cos(angle) * aimLen,
        BALL_RADIUS + 0.05,
        myBall.z + Math.sin(angle) * aimLen,
      )
      aimLine.geometry.setFromPoints([startVec, endVec])
      aimLine.computeLineDistances()
      aimLine.visible = dist > 0.15
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      aimLine.visible = false
      setPowerPct(0)

      const myBall = ballsRef.current.get(localPeerId)
      if (!myBall || myBall.inHole) return
      const pt = screenToGround(e.clientX, e.clientY)
      if (!pt) return

      const pullX = myBall.x - pt.x
      const pullZ = myBall.z - pt.z
      const dist = Math.min(MAX_PULL_DIST, Math.hypot(pullX, pullZ))
      if (dist < 0.18) return

      const ratio = dist / MAX_PULL_DIST
      const angle = Math.atan2(pullZ, pullX)
      const speed = ratio * MAX_POWER
      const vx = Number((Math.cos(angle) * speed).toFixed(5))
      const vz = Number((Math.sin(angle) * speed).toFixed(5))
      onSendStroke(vx, vz)
    }

    const domEl = renderer.domElement
    domEl.addEventListener('pointerdown', onPointerDown)
    domEl.addEventListener('pointermove', onPointerMove)
    domEl.addEventListener('pointerup', onPointerUp)

    // Loop de física e renderização
    let animId = 0
    const animate = () => {
      animId = requestAnimationFrame(animate)

      for (const b of ballsRef.current.values()) {
        if (!b.inHole && (Math.abs(b.vx) > 0.0001 || Math.abs(b.vz) > 0.0001)) {
          b.x += b.vx
          b.z += b.vz
          b.vx *= FRICTION
          b.vz *= FRICTION

          // Colisão elástica com as 4 paredes externas
          const minX = -COURSE_HALF_W + BALL_RADIUS
          const maxX = COURSE_HALF_W - BALL_RADIUS
          const minZ = -COURSE_HALF_L + BALL_RADIUS
          const maxZ = COURSE_HALF_L - BALL_RADIUS

          if (b.x < minX) {
            b.x = minX
            b.vx = -b.vx * 0.78
          } else if (b.x > maxX) {
            b.x = maxX
            b.vx = -b.vx * 0.78
          }

          if (b.z < minZ) {
            b.z = minZ
            b.vz = -b.vz * 0.78
          } else if (b.z > maxZ) {
            b.z = maxZ
            b.vz = -b.vz * 0.78
          }

          // Colisão com obstáculos internos
          for (const obs of OBSTACLES) {
            const closestX = Math.max(obs.minX, Math.min(b.x, obs.maxX))
            const closestZ = Math.max(obs.minZ, Math.min(b.z, obs.maxZ))
            const dx = b.x - closestX
            const dz = b.z - closestZ
            const distSq = dx * dx + dz * dz
            if (distSq < BALL_RADIUS * BALL_RADIUS) {
              if (Math.abs(dx) > Math.abs(dz)) {
                b.vx = -b.vx * 0.8
                b.x += dx > 0 ? 0.06 : -0.06
              } else {
                b.vz = -b.vz * 0.8
                b.z += dz > 0 ? 0.06 : -0.06
              }
            }
          }

          // Atração suave e queda no buraco
          const distHole = Math.hypot(b.x - HOLE_X, b.z - HOLE_Z)
          const speed = Math.hypot(b.vx, b.vz)
          if (distHole < HOLE_RADIUS && speed < 0.24) {
            b.inHole = true
            b.x = HOLE_X
            b.z = HOLE_Z
            b.vx = 0
            b.vz = 0
            playUiSfx('hole')
            syncScoreboardUi()
          } else if (speed < 0.0025) {
            b.vx = 0
            b.vz = 0
            syncScoreboardUi()
          }
        }

        if (b.mesh) {
          const onRamp = Math.abs(b.x) < 1.6 && Math.abs(b.z) < 1.1
          const yBase = b.inHole ? -0.18 : onRamp ? BALL_RADIUS + 0.12 : BALL_RADIUS
          b.mesh.position.set(b.x, yBase, b.z)
        }
        if (b.labelSprite) {
          b.labelSprite.position.set(b.x, b.inHole ? 0.45 : 1.05, b.z)
        }
      }

      renderer.render(scene, camera)
    }

    animId = requestAnimationFrame(animate)

    const onResize = () => {
      if (!container) return
      const w = container.clientWidth || 640
      const h = container.clientHeight || 420
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(animId)
      window.removeEventListener('resize', onResize)
      domEl.removeEventListener('pointerdown', onPointerDown)
      domEl.removeEventListener('pointermove', onPointerMove)
      domEl.removeEventListener('pointerup', onPointerUp)
      for (const b of ballsMap.values()) {
        b.mesh = undefined
        b.labelSprite = undefined
      }
      renderer.dispose()
    }
  }, [open, localPeerId, localName, participants, onSendStroke, syncScoreboardUi])

  if (!open) return null

  return (
    <div
      aria-labelledby="minigolf-3d-title"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-dc-darker shadow-2xl"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-dc-darkest/90 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/20 text-sky-300">
            <Flag size={18} />
          </span>
          <h2 id="minigolf-3d-title" className="text-sm font-extrabold text-white">
            Mini Golf
          </h2>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSendReset}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-dc-text transition hover:bg-white/10 hover:text-white"
          >
            <RotateCcw size={14} />
            <span className="hidden sm:inline">Reiniciar</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded-lg bg-dc-light px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-dc-hover"
          >
            <Minimize2 size={14} />
            <span>Minimizar</span>
          </button>
          <button
            type="button"
            onClick={onEndApp}
            className="inline-flex items-center gap-1.5 rounded-lg bg-dc-red/20 px-3 py-1.5 text-xs font-semibold text-dc-red transition hover:bg-dc-red hover:text-white"
          >
            <Power size={14} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        {/* Canvas 3D Three.js */}
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-xl">
          <div ref={mountRef} className="h-[380px] w-full cursor-grab active:cursor-grabbing sm:h-[430px]" />

          {/* HUD de instrução + Barra de Força */}
          <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between gap-2">
            <span className="rounded-lg bg-black/65 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
              ⛳ Clique na sua bola ({localName}), puxe para trás para mirar e solte!
            </span>
            {localMoving && (
              <span className="rounded-full bg-amber-500/25 px-2.5 py-1 text-[11px] font-bold text-amber-300 backdrop-blur">
                Bola em movimento / no buraco
              </span>
            )}
          </div>

          {powerPct > 0 && (
            <div className="pointer-events-none absolute inset-x-6 bottom-4 rounded-xl bg-black/75 p-2.5 backdrop-blur">
              <div className="mb-1 flex items-center justify-between text-xs font-bold text-white">
                <span>Força da Tacada</span>
                <span className="font-mono text-amber-300">{powerPct}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500"
                  style={{ width: `${powerPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Placar Lateral */}
        <aside className="flex flex-col justify-between rounded-2xl border border-white/10 bg-dc-darkest/90 p-4">
          <div>
            <h3 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-dc-header">
              <Trophy size={15} className="text-amber-400" /> Placar
            </h3>

            <ul className="mt-3 space-y-2">
              {scoreboard.map((item) => (
                <li
                  key={item.peerId}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                    item.inHole ? 'border-emerald-400/50 bg-emerald-500/15' : 'border-white/5 bg-dc-darker'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <span style={{ backgroundColor: item.color }} className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/30" />
                    <span className="truncate font-semibold text-white">{item.name}</span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {item.inHole && (
                      <span className="rounded bg-emerald-500 px-1.5 py-0.5 text-[9px] font-black uppercase text-black">
                        ⛳
                      </span>
                    )}
                    <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
                      {item.strokes}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      </div>
    </div>
  )
}
