import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Crosshair, Dices, Flag, Minimize2, Power, RotateCcw, Trophy } from 'lucide-react'
import { playUiSfx } from '../hooks/useAudioSystem'
import { colorFromString } from '../lib/utils'
import type { GolfHoleEvent, GolfResetEvent, GolfStrokeEvent } from '../types'

export interface GolfParticipant {
  peerId: string
  name: string
  isLocal: boolean
}

export interface MiniGolfGameProps {
  open: boolean
  onClose: () => void
  onEndApp: () => void
  localPeerId: string
  localName: string
  participants: GolfParticipant[]
  lastStroke: GolfStrokeEvent | null
  lastReset: GolfResetEvent | null
  lastHole?: GolfHoleEvent | null
  onSendStroke: (vx: number, vz: number) => void
  onSendReset: () => void
  onSendHole?: (seed?: number, holeNumber?: number, par?: number) => void
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

interface WallBox {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface BumperObstacle {
  x: number
  z: number
  radius: number
}

interface SandTrap {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

interface CourseTile {
  gx: number
  gz: number
  cx: number
  cz: number
  type: 'tee' | 'straight' | 'bunker' | 'bumper' | 'obstacle' | 'ramp' | 'green'
  openEdges: { north: boolean; south: boolean; east: boolean; west: boolean }
}

interface GeneratedCourse {
  seed: number
  tiles: CourseTile[]
  walls: WallBox[]
  bumpers: BumperObstacle[]
  sandTraps: SandTrap[]
  obstacleBoxes: WallBox[]
  tee: { x: number; z: number }
  hole: { x: number; z: number }
  par: number
  boundingBox: { minX: number; maxX: number; minZ: number; maxZ: number }
}

const BALL_RADIUS = 0.26
const HOLE_RADIUS = 0.52
const MAX_PULL_DIST = 3.6
const MAX_POWER = 0.36
const FRICTION = 0.983
const SAND_FRICTION = 0.895
const TILE_SIZE = 4.2
const WALL_THICKNESS = 0.36
const WALL_HEIGHT = 0.55

/**
 * Gerador de Números Pseudo-Aleatórios Determinístico Mulberry32
 * Garante que todos os jogadores com a mesma seed gerem exatamente a mesma pista.
 */
function mulberry32(seed: number) {
  let s = seed | 0
  return function () {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Constrói proceduralmente um mapa de minigolf conectando tiles em grid 2D
 */
function generateProceduralCourse(seed: number): GeneratedCourse {
  const rand = mulberry32(seed)
  const pathCoords: Array<{ gx: number; gz: number }> = [{ gx: 0, gz: 0 }]
  const visited = new Set<string>(['0,0'])

  // Comprimento do percurso: 5 a 8 blocos conectados
  const targetLength = 5 + Math.floor(rand() * 4)

  const directions = [
    { dx: 0, dz: -1, weight: 5 }, // Norte (avanço para o horizonte)
    { dx: 1, dz: 0, weight: 2.2 }, // Leste (curva para a direita)
    { dx: -1, dz: 0, weight: 2.2 }, // Oeste (curva para a esquerda)
    { dx: 0, dz: 1, weight: 0.8 }, // Sul (raro, recuo suave)
  ]

  for (let i = 1; i < targetLength; i++) {
    const current = pathCoords[pathCoords.length - 1]
    const validDirs = directions.filter((d) => {
      const key = `${current.gx + d.dx},${current.gz + d.dz}`
      return !visited.has(key)
    })

    if (validDirs.length === 0) break

    const totalWeight = validDirs.reduce((acc, d) => acc + d.weight, 0)
    let roll = rand() * totalWeight
    let chosen = validDirs[0]
    for (const d of validDirs) {
      if (roll <= d.weight) {
        chosen = d
        break
      }
      roll -= d.weight
    }

    const nextCoord = { gx: current.gx + chosen.dx, gz: current.gz + chosen.dz }
    pathCoords.push(nextCoord)
    visited.add(`${nextCoord.gx},${nextCoord.gz}`)
  }

  const tiles: CourseTile[] = []
  const walls: WallBox[] = []
  const bumpers: BumperObstacle[] = []
  const sandTraps: SandTrap[] = []
  const obstacleBoxes: WallBox[] = []

  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  for (let i = 0; i < pathCoords.length; i++) {
    const { gx, gz } = pathCoords[i]
    const cx = gx * TILE_SIZE
    const cz = gz * TILE_SIZE

    minX = Math.min(minX, cx - TILE_SIZE / 2)
    maxX = Math.max(maxX, cx + TILE_SIZE / 2)
    minZ = Math.min(minZ, cz - TILE_SIZE / 2)
    maxZ = Math.max(maxZ, cz + TILE_SIZE / 2)

    const hasNorth = visited.has(`${gx},${gz - 1}`)
    const hasSouth = visited.has(`${gx},${gz + 1}`)
    const hasEast = visited.has(`${gx + 1},${gz}`)
    const hasWest = visited.has(`${gx - 1},${gz}`)

    let type: CourseTile['type'] = 'straight'
    if (i === 0) {
      type = 'tee'
    } else if (i === pathCoords.length - 1) {
      type = 'green'
    } else {
      const roll = rand()
      if (roll < 0.28) {
        type = 'bumper'
      } else if (roll < 0.52) {
        type = 'bunker'
      } else if (roll < 0.74) {
        type = 'obstacle'
      } else if (roll < 0.88) {
        type = 'ramp'
      } else {
        type = 'straight'
      }
    }

    tiles.push({
      gx,
      gz,
      cx,
      cz,
      type,
      openEdges: { north: hasNorth, south: hasSouth, east: hasEast, west: hasWest },
    })

    // Gera paredes externas apenas nas laterais abertas (sem vizinho)
    const wallHalfThick = WALL_THICKNESS / 2
    const tileHalfSize = TILE_SIZE / 2
    const wallExtension = wallHalfThick // Extensão para encaixe perfeito nos cantos

    if (!hasNorth) {
      walls.push({
        minX: cx - tileHalfSize - wallExtension,
        maxX: cx + tileHalfSize + wallExtension,
        minZ: cz - tileHalfSize - wallHalfThick,
        maxZ: cz - tileHalfSize + wallHalfThick,
      })
    }
    if (!hasSouth) {
      walls.push({
        minX: cx - tileHalfSize - wallExtension,
        maxX: cx + tileHalfSize + wallExtension,
        minZ: cz + tileHalfSize - wallHalfThick,
        maxZ: cz + tileHalfSize + wallHalfThick,
      })
    }
    if (!hasEast) {
      walls.push({
        minX: cx + tileHalfSize - wallHalfThick,
        maxX: cx + tileHalfSize + wallHalfThick,
        minZ: cz - tileHalfSize - wallExtension,
        maxZ: cz + tileHalfSize + wallExtension,
      })
    }
    if (!hasWest) {
      walls.push({
        minX: cx - tileHalfSize - wallHalfThick,
        maxX: cx - tileHalfSize + wallHalfThick,
        minZ: cz - tileHalfSize - wallExtension,
        maxZ: cz + tileHalfSize + wallExtension,
      })
    }

    // Obstáculos específicos por tile intermediário
    if (type === 'bumper') {
      const bumperCount = rand() > 0.45 ? 2 : 1
      if (bumperCount === 1) {
        bumpers.push({ x: cx, z: cz, radius: 0.42 })
      } else {
        bumpers.push({ x: cx - 0.95, z: cz, radius: 0.38 })
        bumpers.push({ x: cx + 0.95, z: cz, radius: 0.38 })
      }
    } else if (type === 'bunker') {
      sandTraps.push({
        minX: cx - 1.25,
        maxX: cx + 1.25,
        minZ: cz - 1.25,
        maxZ: cz + 1.25,
      })
    } else if (type === 'obstacle') {
      const obsW = 0.8
      const obsD = 0.8
      obstacleBoxes.push({
        minX: cx - obsW / 2,
        maxX: cx + obsW / 2,
        minZ: cz - obsD / 2,
        maxZ: cz + obsD / 2,
      })
    }
  }

  const teeTile = tiles[0]
  const greenTile = tiles[tiles.length - 1]

  const par = tiles.length <= 5 ? 3 : tiles.length === 6 ? 4 : 5

  return {
    seed,
    tiles,
    walls,
    bumpers,
    sandTraps,
    obstacleBoxes,
    tee: { x: teeTile.cx, z: teeTile.cz },
    hole: { x: greenTile.cx, z: greenTile.cz },
    par,
    boundingBox: { minX, maxX, minZ, maxZ },
  }
}

function spawnPositionForIndex(tee: { x: number; z: number }, idx: number, total: number): { x: number; z: number } {
  if (total <= 1) return { x: tee.x, z: tee.z }
  const spread = Math.min(2.4, Math.max(0, (total - 1) * 0.65))
  const x = tee.x - spread / 2 + (idx / (total - 1)) * spread
  return { x, z: tee.z }
}

function createNameSprite(name: string, colorHex: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)'
    ctx.beginPath()
    ctx.roundRect(14, 8, 228, 48, 24)
    ctx.fill()
    ctx.lineWidth = 3.5
    ctx.strokeStyle = colorHex
    ctx.stroke()

    ctx.font = 'bold 24px Inter, system-ui, sans-serif'
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(name.slice(0, 14), 128, 32)
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
  lastHole,
  onSendStroke,
  onSendReset,
  onSendHole,
}: MiniGolfGameProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const ballsRef = useRef<Map<string, BallSim>>(new Map())
  const lastStrokeSeqRef = useRef(0)
  const lastResetSeqRef = useRef(0)
  const lastHoleSeqRef = useRef(0)

  // Estado sincronizado do buraco e seed
  const [holeNumber, setHoleNumber] = useState(1)
  const [courseSeed, setCourseSeed] = useState(() => Math.floor(Math.random() * 900000) + 100000)
  const [currentPar, setCurrentPar] = useState(3)

  const [powerPct, setPowerPct] = useState(0)
  const [scoreboard, setScoreboard] = useState<
    Array<{ peerId: string; name: string; color: string; strokes: number; inHole: boolean }>
  >([])
  const [localMoving, setLocalMoving] = useState(false)
  const [localInHole, setLocalInHole] = useState(false)

  // Referência do curso ativo para a simulação física
  const courseRef = useRef<GeneratedCourse>(generateProceduralCourse(courseSeed))

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
    setLocalMoving(!!me && Math.hypot(me.vx, me.vz) > 0.002)
    setLocalInHole(!!me && me.inHole)
  }, [localPeerId])

  // Tratamento de Novo Buraco recebido via P2P
  useEffect(() => {
    if (!lastHole || lastHole.seq === lastHoleSeqRef.current) return
    lastHoleSeqRef.current = lastHole.seq
    setCourseSeed(lastHole.seed)
    setHoleNumber(lastHole.holeNumber)
    setCurrentPar(lastHole.par)
  }, [lastHole])

  // Tratamento de Tacada recebida via P2P
  useEffect(() => {
    if (!lastStroke || lastStroke.seq === lastStrokeSeqRef.current) return
    lastStrokeSeqRef.current = lastStroke.seq

    let ball = ballsRef.current.get(lastStroke.peerId)
    if (!ball) {
      const pos = spawnPositionForIndex(courseRef.current.tee, ballsRef.current.size, participants.length)
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

  // Tratamento de Reiniciar Posições
  useEffect(() => {
    if (!lastReset || lastReset.seq === lastResetSeqRef.current) return
    lastResetSeqRef.current = lastReset.seq
    const entries = [...ballsRef.current.values()]
    entries.forEach((b, idx) => {
      const pos = spawnPositionForIndex(courseRef.current.tee, idx, entries.length)
      b.x = pos.x
      b.z = pos.z
      b.vx = 0
      b.vz = 0
      b.strokes = 0
      b.inHole = false
    })
    syncScoreboardUi()
  }, [lastReset, syncScoreboardUi])

  // Disparo para gerar o próximo buraco determinístico
  const handleNextHole = useCallback(() => {
    const nextSeed = Math.floor(Math.random() * 900000) + 100000
    const nextHoleNum = holeNumber + 1
    const nextCourse = generateProceduralCourse(nextSeed)
    if (onSendHole) {
      onSendHole(nextSeed, nextHoleNum, nextCourse.par)
    } else {
      setCourseSeed(nextSeed)
      setHoleNumber(nextHoleNum)
      setCurrentPar(nextCourse.par)
    }
  }, [holeNumber, onSendHole])

  // Inicialização Three.js, cena modular e física 60fps
  useEffect(() => {
    if (!open) return
    const container = mountRef.current
    if (!container) return
    const ballsMap = ballsRef.current

    const course = generateProceduralCourse(courseSeed)
    courseRef.current = course
    setCurrentPar(course.par)

    const width = container.clientWidth || 640
    const height = container.clientHeight || 420

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#090d16')
    scene.fog = new THREE.Fog('#090d16', 26, 52)

    // Ajuste dinâmico de câmera para enquadrar perfeitamente a pista gerada
    const bb = course.boundingBox
    const midX = (bb.minX + bb.maxX) / 2
    const midZ = (bb.minZ + bb.maxZ) / 2
    const spanX = bb.maxX - bb.minX + 4.5
    const spanZ = bb.maxZ - bb.minZ + 4.5
    const maxSpan = Math.max(spanX, spanZ, 12)

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 120)
    camera.position.set(midX, maxSpan * 1.15 + 3, midZ + maxSpan * 0.9 + 2)
    camera.lookAt(midX, 0, midZ - 0.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    // Iluminação Low-Poly Stylized
    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x14532d, 0.85)
    scene.add(hemiLight)

    const sunLight = new THREE.DirectionalLight(0xffedd5, 1.25)
    sunLight.position.set(midX + 10, 20, midZ + 12)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.width = 1024
    sunLight.shadow.mapSize.height = 1024
    scene.add(sunLight)

    // Grupo de Cenário da Pista
    const courseGroup = new THREE.Group()
    scene.add(courseGroup)

    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.65 })
    const bumperMaterial = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.3,
      metalness: 0.2,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.35,
    })
    const bumperCapMaterial = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      roughness: 0.2,
      metalness: 0.8,
    })
    const sandMaterial = new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.95 })

    // Renderiza cada Tile da pista
    course.tiles.forEach((tile) => {
      const isGreen = tile.type === 'green'
      const isTee = tile.type === 'tee'
      const turfMat = new THREE.MeshStandardMaterial({
        color: isGreen ? 0x22c55e : (tile.gx + tile.gz) % 2 === 0 ? 0x16a34a : 0x15803d,
        roughness: 0.82,
      })
      const tileMesh = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, 0.2, TILE_SIZE), turfMat)
      tileMesh.position.set(tile.cx, -0.1, tile.cz)
      tileMesh.receiveShadow = true
      courseGroup.add(tileMesh)

      // Marcador no Tee
      if (isTee) {
        const teeMarker = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 0.04, 0.6),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 }),
        )
        teeMarker.position.set(tile.cx, 0.02, tile.cz + 0.3)
        teeMarker.receiveShadow = true
        courseGroup.add(teeMarker)
      }

      // Relevo suave em rampa
      if (tile.type === 'ramp') {
        const rampMesh = new THREE.Mesh(
          new THREE.BoxGeometry(TILE_SIZE * 0.75, 0.16, TILE_SIZE * 0.5),
          new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.75 }),
        )
        rampMesh.position.set(tile.cx, 0.06, tile.cz)
        rampMesh.receiveShadow = true
        courseGroup.add(rampMesh)
      }
    })

    // Renderiza Paredes de Madeira Externas (apenas em arestas sem conexão)
    course.walls.forEach((wall) => {
      const w = Math.max(0.01, wall.maxX - wall.minX)
      const d = Math.max(0.01, wall.maxZ - wall.minZ)
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), woodMaterial)
      wallMesh.position.set((wall.minX + wall.maxX) / 2, WALL_HEIGHT / 2, (wall.minZ + wall.maxZ) / 2)
      wallMesh.castShadow = true
      wallMesh.receiveShadow = true
      courseGroup.add(wallMesh)
    })

    // Renderiza Caixas de Areia (Bunkers)
    course.sandTraps.forEach((sand) => {
      const w = sand.maxX - sand.minX
      const d = sand.maxZ - sand.minZ
      const sandMesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), sandMaterial)
      sandMesh.position.set((sand.minX + sand.maxX) / 2, 0.02, (sand.minZ + sand.maxZ) / 2)
      sandMesh.receiveShadow = true
      courseGroup.add(sandMesh)
    })

    // Renderiza Bumpers Cilíndricos
    course.bumpers.forEach((bumper) => {
      const bumperMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(bumper.radius, bumper.radius, WALL_HEIGHT, 24),
        bumperMaterial,
      )
      bumperMesh.position.set(bumper.x, WALL_HEIGHT / 2, bumper.z)
      bumperMesh.castShadow = true
      courseGroup.add(bumperMesh)

      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(bumper.radius * 1.12, bumper.radius * 1.12, 0.08, 24),
        bumperCapMaterial,
      )
      cap.position.set(bumper.x, WALL_HEIGHT + 0.04, bumper.z)
      courseGroup.add(cap)
    })

    // Renderiza Caixas/Obstáculos internos
    course.obstacleBoxes.forEach((obs) => {
      const w = obs.maxX - obs.minX
      const d = obs.maxZ - obs.minZ
      const obsMesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), woodMaterial)
      obsMesh.position.set((obs.minX + obs.maxX) / 2, 0.225, (obs.minZ + obs.maxZ) / 2)
      obsMesh.castShadow = true
      obsMesh.receiveShadow = true
      courseGroup.add(obsMesh)
    })

    // Buraco + Mastro + Bandeira no Green
    const holeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, 0.05, 28),
      new THREE.MeshBasicMaterial({ color: 0x090d16 }),
    )
    holeMesh.position.set(course.hole.x, 0.01, course.hole.z)
    courseGroup.add(holeMesh)

    const holeRim = new THREE.Mesh(
      new THREE.RingGeometry(HOLE_RADIUS, HOLE_RADIUS + 0.08, 28),
      new THREE.MeshBasicMaterial({ color: 0xe2e8f0, side: THREE.DoubleSide }),
    )
    holeRim.rotation.x = -Math.PI / 2
    holeRim.position.set(course.hole.x, 0.02, course.hole.z)
    courseGroup.add(holeRim)

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 2.5, 12),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, metalness: 0.6, roughness: 0.3 }),
    )
    pole.position.set(course.hole.x, 1.25, course.hole.z)
    pole.castShadow = true
    courseGroup.add(pole)

    const flagGeo = new THREE.ConeGeometry(0.45, 0.95, 3)
    flagGeo.rotateZ(-Math.PI / 2)
    const flagMesh = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.5 }))
    flagMesh.position.set(course.hole.x + 0.42, 2.2, course.hole.z)
    courseGroup.add(flagMesh)

    // ─── Linha / Seta de Trajetória 3D no Chão (Pull & Release) ───────────────
    const aimGroup = new THREE.Group()
    aimGroup.visible = false
    scene.add(aimGroup)

    const reticleGeo = new THREE.RingGeometry(BALL_RADIUS + 0.05, BALL_RADIUS + 0.12, 32)
    reticleGeo.rotateX(-Math.PI / 2)
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthTest: false,
    })
    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat)
    reticleMesh.position.y = 0.03
    aimGroup.add(reticleMesh)

    const shaftGeo = new THREE.PlaneGeometry(1, 0.22)
    shaftGeo.rotateX(-Math.PI / 2)
    shaftGeo.translate(0.5, 0, 0)
    const shaftMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthTest: false,
    })
    const shaftMesh = new THREE.Mesh(shaftGeo, shaftMat)
    shaftMesh.position.y = 0.03
    aimGroup.add(shaftMesh)

    const headGeo = new THREE.BufferGeometry()
    const headVerts = new Float32Array([0, 0.03, -0.22, 0.45, 0.03, 0, 0, 0.03, 0.22])
    headGeo.setAttribute('position', new THREE.BufferAttribute(headVerts, 3))
    headGeo.setIndex([0, 1, 2])
    headGeo.computeVertexNormals()
    const headMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthTest: false,
    })
    const headMesh = new THREE.Mesh(headGeo, headMat)
    aimGroup.add(headMesh)

    const dashedPts = [new THREE.Vector3(0, 0.03, 0), new THREE.Vector3(4.5, 0.03, 0)]
    const dashedGeo = new THREE.BufferGeometry().setFromPoints(dashedPts)
    const dashedMat = new THREE.LineDashedMaterial({
      color: 0xfef08a,
      dashSize: 0.25,
      gapSize: 0.15,
      transparent: true,
      opacity: 0.7,
      depthTest: false,
    })
    const dashedLine = new THREE.Line(dashedGeo, dashedMat)
    dashedLine.computeLineDistances()
    aimGroup.add(dashedLine)

    // Sincroniza / Atualiza Bolas dos Participantes no Tee
    const entries = participants.length > 0 ? participants : [{ peerId: localPeerId, name: localName, isLocal: true }]
    entries.forEach((p, idx) => {
      const pos = spawnPositionForIndex(course.tee, idx, entries.length)
      let b = ballsRef.current.get(p.peerId)
      if (!b) {
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
        b.x = pos.x
        b.z = pos.z
        b.vx = 0
        b.vz = 0
        b.strokes = 0
        b.inHole = false
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

    // ─── MECÂNICA DE MIRA DEFINITIVA (PLANO MATEMÁTICO INFINITO) ─────────────
    // Zero colisão contra malhas 3D (paredes/obstáculos) durante a puxada.
    const raycaster = new THREE.Raycaster()
    const hitPoint = new THREE.Vector3()
    let isDragging = false
    let dragPlane: THREE.Plane | null = null

    const getPointOnPlane = (clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      return raycaster.ray.intersectPlane(plane, hitPoint)
    }

    const updateAimArrowVisual = (ballX: number, ballZ: number, angle: number, clampedDist: number, ratio: number) => {
      if (clampedDist < 0.12) {
        aimGroup.visible = false
        return
      }
      aimGroup.visible = true
      aimGroup.position.set(ballX, 0.04, ballZ)
      aimGroup.rotation.y = -angle

      // Gradiente suave de cor (Verde -> Amarelo -> Vermelho)
      const color = new THREE.Color()
      if (ratio < 0.5) {
        color.lerpColors(new THREE.Color(0x22c55e), new THREE.Color(0xfacc15), ratio * 2)
      } else {
        color.lerpColors(new THREE.Color(0xfacc15), new THREE.Color(0xef4444), (ratio - 0.5) * 2)
      }

      reticleMat.color.copy(color)
      shaftMat.color.copy(color)
      headMat.color.copy(color)

      const shaftLength = Math.max(0.25, clampedDist * 1.5)
      shaftMesh.scale.set(shaftLength, 1, 1)
      headMesh.position.set(shaftLength, 0, 0)
      dashedLine.position.set(shaftLength + 0.45, 0, 0)
    }

    const onGlobalPointerMove = (e: PointerEvent) => {
      if (!isDragging || !dragPlane) return
      const myBall = ballsRef.current.get(localPeerId)
      if (!myBall) return

      const pt = getPointOnPlane(e.clientX, e.clientY, dragPlane)
      if (!pt) return

      const pullX = myBall.x - pt.x
      const pullZ = myBall.z - pt.z
      const dist = Math.hypot(pullX, pullZ)
      const clampedDist = Math.min(MAX_PULL_DIST, dist)
      const ratio = clampedDist / MAX_PULL_DIST
      const angle = Math.atan2(pullZ, pullX)

      setPowerPct(Math.round(ratio * 100))
      updateAimArrowVisual(myBall.x, myBall.z, angle, clampedDist, ratio)
    }

    const onGlobalPointerUp = (e: PointerEvent) => {
      if (!isDragging) return
      isDragging = false
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('pointerup', onGlobalPointerUp)

      aimGroup.visible = false
      setPowerPct(0)

      const myBall = ballsRef.current.get(localPeerId)
      if (!myBall || myBall.inHole || !dragPlane) return

      const pt = getPointOnPlane(e.clientX, e.clientY, dragPlane)
      if (!pt) return

      const pullX = myBall.x - pt.x
      const pullZ = myBall.z - pt.z
      const dist = Math.hypot(pullX, pullZ)
      const clampedDist = Math.min(MAX_PULL_DIST, dist)

      if (clampedDist >= 0.18) {
        const ratio = clampedDist / MAX_PULL_DIST
        const angle = Math.atan2(pullZ, pullX)
        const speed = ratio * MAX_POWER
        const vx = Number((Math.cos(angle) * speed).toFixed(5))
        const vz = Number((Math.sin(angle) * speed).toFixed(5))
        onSendStroke(vx, vz)
      }
    }

    const onCanvasPointerDown = (e: PointerEvent) => {
      const myBall = ballsRef.current.get(localPeerId)
      if (!myBall || myBall.inHole || Math.hypot(myBall.vx, myBall.vz) > 0.002) return

      // Cria plano matemático horizontal infinito exatamente na altura da bola
      dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_RADIUS)
      const pt = getPointOnPlane(e.clientX, e.clientY, dragPlane)
      if (!pt) return

      // Inicia puxada se o clique for próximo à bola do jogador
      if (Math.hypot(pt.x - myBall.x, pt.z - myBall.z) <= 2.6) {
        isDragging = true
        window.addEventListener('pointermove', onGlobalPointerMove)
        window.addEventListener('pointerup', onGlobalPointerUp)
      }
    }

    const domEl = renderer.domElement
    domEl.addEventListener('pointerdown', onCanvasPointerDown)

    // ─── Loop de Física e Renderização 60 FPS ─────────────────────────────────
    let animId = 0
    const animate = () => {
      animId = requestAnimationFrame(animate)

      for (const b of ballsRef.current.values()) {
        if (!b.inHole && (Math.abs(b.vx) > 0.0001 || Math.abs(b.vz) > 0.0001)) {
          b.x += b.vx
          b.z += b.vz

          // Verifica se está dentro de caixa de areia (Bunker: alto atrito)
          let inSand = false
          for (const sand of course.sandTraps) {
            if (b.x >= sand.minX && b.x <= sand.maxX && b.z >= sand.minZ && b.z <= sand.maxZ) {
              inSand = true
              break
            }
          }
          const currentFriction = inSand ? SAND_FRICTION : FRICTION
          b.vx *= currentFriction
          b.vz *= currentFriction

          // Colisão com Paredes Externas
          for (const wall of course.walls) {
            const closestX = Math.max(wall.minX, Math.min(b.x, wall.maxX))
            const closestZ = Math.max(wall.minZ, Math.min(b.z, wall.maxZ))
            const dx = b.x - closestX
            const dz = b.z - closestZ
            const distSq = dx * dx + dz * dz
            if (distSq < BALL_RADIUS * BALL_RADIUS) {
              const dist = Math.sqrt(distSq)
              const nx = dist < 0.0001 ? 0 : dx / dist
              const nz = dist < 0.0001 ? 1 : dz / dist
              const overlap = BALL_RADIUS - dist
              b.x += nx * (overlap + 0.02)
              b.z += nz * (overlap + 0.02)
              const dot = b.vx * nx + b.vz * nz
              if (dot < 0) {
                b.vx -= 1.78 * dot * nx
                b.vz -= 1.78 * dot * nz
                playUiSfx('clack')
              }
            }
          }

          // Colisão com Bumpers Cilíndricos (Reflexão elástica aumentada)
          for (const bumper of course.bumpers) {
            const dx = b.x - bumper.x
            const dz = b.z - bumper.z
            const dist = Math.hypot(dx, dz)
            const minDist = BALL_RADIUS + bumper.radius
            if (dist < minDist) {
              const nx = dist < 0.0001 ? 1 : dx / dist
              const nz = dist < 0.0001 ? 0 : dz / dist
              b.x = bumper.x + nx * (minDist + 0.02)
              b.z = bumper.z + nz * (minDist + 0.02)
              const dot = b.vx * nx + b.vz * nz
              if (dot < 0) {
                b.vx = (b.vx - 2 * dot * nx) * 1.25
                b.vz = (b.vz - 2 * dot * nz) * 1.25
                playUiSfx('clack')
              }
            }
          }

          // Colisão com Obstáculos Internos de Madeira
          for (const obs of course.obstacleBoxes) {
            const closestX = Math.max(obs.minX, Math.min(b.x, obs.maxX))
            const closestZ = Math.max(obs.minZ, Math.min(b.z, obs.maxZ))
            const dx = b.x - closestX
            const dz = b.z - closestZ
            const distSq = dx * dx + dz * dz
            if (distSq < BALL_RADIUS * BALL_RADIUS) {
              const dist = Math.sqrt(distSq)
              const nx = dist < 0.0001 ? 0 : dx / dist
              const nz = dist < 0.0001 ? 1 : dz / dist
              const overlap = BALL_RADIUS - dist
              b.x += nx * (overlap + 0.02)
              b.z += nz * (overlap + 0.02)
              const dot = b.vx * nx + b.vz * nz
              if (dot < 0) {
                b.vx -= 1.75 * dot * nx
                b.vz -= 1.75 * dot * nz
                playUiSfx('clack')
              }
            }
          }

          // Queda suave no Buraco
          const distHole = Math.hypot(b.x - course.hole.x, b.z - course.hole.z)
          const speed = Math.hypot(b.vx, b.vz)
          if (distHole < HOLE_RADIUS && speed < 0.28) {
            b.inHole = true
            b.x = course.hole.x
            b.z = course.hole.z
            b.vx = 0
            b.vz = 0
            playUiSfx('hole')
            syncScoreboardUi()
          } else if (speed < 0.002) {
            b.vx = 0
            b.vz = 0
            syncScoreboardUi()
          }

          // Fallback de segurança contra saída acidental dos limites da pista
          if (
            b.x < bb.minX - 3 ||
            b.x > bb.maxX + 3 ||
            b.z < bb.minZ - 3 ||
            b.z > bb.maxZ + 3
          ) {
            b.x = course.tee.x
            b.z = course.tee.z
            b.vx = 0
            b.vz = 0
            syncScoreboardUi()
          }
        }

        if (b.mesh) {
          b.mesh.position.set(b.x, b.inHole ? -0.15 : BALL_RADIUS, b.z)
        }
        if (b.labelSprite) {
          b.labelSprite.position.set(b.x, b.inHole ? 0.35 : 0.95, b.z)
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
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('pointerup', onGlobalPointerUp)
      domEl.removeEventListener('pointerdown', onCanvasPointerDown)
      for (const b of ballsMap.values()) {
        b.mesh = undefined
        b.labelSprite = undefined
      }
      renderer.dispose()
    }
  }, [open, courseSeed, localPeerId, localName, participants, onSendStroke, syncScoreboardUi])

  if (!open) return null

  return (
    <div
      aria-labelledby="minigolf-3d-title"
      className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-dc-darker shadow-2xl"
    >
      {/* Cabeçalho do Jogo */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] bg-dc-darkest/90 px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Flag size={18} />
          </span>
          <div>
            <h2 id="minigolf-3d-title" className="text-sm font-extrabold text-white">
              Mini Golf 3D
            </h2>
            <p className="text-[11px] font-semibold text-emerald-400">
              Buraco {holeNumber} • Par {currentPar}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Botão Novo Mapa / Próximo Buraco */}
          <button
            type="button"
            onClick={handleNextHole}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/30 hover:text-white"
          >
            <Dices size={15} />
            <span>Próximo Buraco</span>
          </button>

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

      {/* Conteúdo Principal: Canvas 3D + Placar */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
          {/* Canvas 3D Three.js */}
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-slate-950 shadow-xl">
            <div ref={mountRef} className="h-[380px] w-full cursor-grab active:cursor-grabbing sm:h-[450px]" />

            {/* Banner Superior de Instrução e Status */}
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between gap-2">
              <span className="rounded-lg bg-black/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                {localInHole ? (
                  <span className="text-emerald-400 font-bold">🎉 Bola no buraco! Aguarde os outros jogadores.</span>
                ) : localMoving ? (
                  <span className="text-amber-300 font-bold">⚡ Bola em movimento...</span>
                ) : (
                  <span>⛳ Puxe sua bola para trás para mirar a tacada</span>
                )}
              </span>

              <span className="rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] font-bold text-zinc-300 backdrop-blur border border-white/10">
                Buraco {holeNumber} • Par {currentPar}
              </span>
            </div>

            {/* Medidor e Barra de Força Fixo no Canto Inferior Direito (Sem sobreposição no Spawn) */}
            {powerPct > 0 && (
              <div className="pointer-events-none absolute bottom-4 right-4 z-20 flex w-52 flex-col gap-1.5 rounded-2xl border border-white/15 bg-black/85 p-3 shadow-2xl backdrop-blur-md">
                <div className="flex items-center justify-between text-xs font-bold text-white">
                  <span className="flex items-center gap-1.5 text-zinc-300">
                    <Crosshair size={14} className="text-amber-400" /> Força
                  </span>
                  <span className="font-mono text-sm font-extrabold text-amber-300">{powerPct}%</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-white/15 p-0.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all duration-75"
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
                {scoreboard.map((item) => {
                  const scoreDiff = item.strokes - currentPar
                  return (
                    <li
                      key={item.peerId}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                        item.inHole ? 'border-emerald-400/50 bg-emerald-500/15' : 'border-white/5 bg-dc-darker'
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          style={{ backgroundColor: item.color }}
                          className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/30"
                        />
                        <span className="truncate font-semibold text-white">{item.name}</span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {item.inHole && (
                          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                            {item.strokes === 1
                              ? 'Ace! 🏆'
                              : scoreDiff === -2
                              ? 'Eagle 🦅'
                              : scoreDiff === -1
                              ? 'Birdie 🐦'
                              : scoreDiff === 0
                              ? 'Par ⛳'
                              : scoreDiff === 1
                              ? 'Bogey'
                              : `+${scoreDiff}`}
                          </span>
                        )}
                        <span className="rounded bg-black/40 px-2 py-0.5 font-mono text-xs font-bold text-amber-300">
                          {item.strokes} {item.strokes === 1 ? 'tacada' : 'tacadas'}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>

            <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[11px] text-zinc-400">
              <p className="font-semibold text-white">Como jogar:</p>
              <p className="mt-1">
                Pressione com o mouse sobre a sua bola, puxe para trás para carregar a força e solte para disparar.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
