import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { Crosshair, Dices, Flag, Minimize2, Power, RotateCcw, Target, Trophy } from 'lucide-react'
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
  y: number
  z: number
  vx: number
  vz: number
  strokes: number
  inHole: boolean
  lastRestingX?: number
  lastRestingZ?: number
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

  const targetLength = 5 + Math.floor(rand() * 4)

  const directions = [
    { dx: 0, dz: -1, weight: 5 }, // Norte (avanço para o horizonte)
    { dx: 1, dz: 0, weight: 2.2 }, // Leste
    { dx: -1, dz: 0, weight: 2.2 }, // Oeste
    { dx: 0, dz: 1, weight: 0.8 }, // Sul
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

    const wallHalfThick = WALL_THICKNESS / 2
    const tileHalfSize = TILE_SIZE / 2
    const wallExtension = wallHalfThick

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
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)'
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
  const lastStrokeSeqRef = useRef(lastStroke?.seq ?? 0)
  const lastResetSeqRef = useRef(lastReset?.seq ?? 0)
  const lastHoleSeqRef = useRef(lastHole?.seq ?? 0)

  // Referência para centralizar câmera na bola a partir de botões da interface ou tecla Espaço
  const centerOnBallRef = useRef<() => void>(() => {})

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

  const courseRef = useRef<GeneratedCourse>(generateProceduralCourse(courseSeed))
  const participantsRef = useRef(participants)
  useEffect(() => {
    participantsRef.current = participants
  }, [participants])

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

    const nextCourse = generateProceduralCourse(lastHole.seed)
    courseRef.current = nextCourse
    const entries = [...ballsRef.current.values()]
    entries.forEach((b, idx) => {
      const pos = spawnPositionForIndex(nextCourse.tee, idx, entries.length)
      b.x = pos.x
      b.y = BALL_RADIUS
      b.z = pos.z
      b.lastRestingX = pos.x
      b.lastRestingZ = pos.z
      b.vx = 0
      b.vz = 0
      b.strokes = 0
      b.inHole = false
    })
    syncScoreboardUi()
  }, [lastHole, syncScoreboardUi])

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
        y: BALL_RADIUS,
        z: pos.z,
        vx: 0,
        vz: 0,
        strokes: 0,
        inHole: false,
        lastRestingX: pos.x,
        lastRestingZ: pos.z,
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

  // Tratamento de Reiniciar Posições (apenas no mesmo buraco)
  useEffect(() => {
    if (!lastReset || lastReset.seq === lastResetSeqRef.current) return
    lastResetSeqRef.current = lastReset.seq
    const entries = [...ballsRef.current.values()]
    entries.forEach((b, idx) => {
      const pos = spawnPositionForIndex(courseRef.current.tee, idx, entries.length)
      b.x = pos.x
      b.y = BALL_RADIUS
      b.z = pos.z
      b.lastRestingX = pos.x
      b.lastRestingZ = pos.z
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
      courseRef.current = nextCourse
      const entries = [...ballsRef.current.values()]
      entries.forEach((b, idx) => {
        const pos = spawnPositionForIndex(nextCourse.tee, idx, entries.length)
        b.x = pos.x
        b.y = BALL_RADIUS
        b.z = pos.z
        b.lastRestingX = pos.x
        b.lastRestingZ = pos.z
        b.vx = 0
        b.vz = 0
        b.strokes = 0
        b.inHole = false
      })
      syncScoreboardUi()
    }
  }, [holeNumber, onSendHole, syncScoreboardUi])

  // ─── Inicialização Three.js, cena modular e física 60fps ─────────────────
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
    // Fundo limpo e escuro sem neblina
    scene.background = new THREE.Color('#0b1329')

    // ─── Câmera Próxima e Sistema de Orbit/Pan/Zoom ─────────────────────────
    const initialMyBall = ballsMap.get(localPeerId)
    const cameraTarget = new THREE.Vector3(
      initialMyBall ? initialMyBall.x : course.tee.x,
      0,
      initialMyBall ? initialMyBall.z : course.tee.z,
    )

    let cameraRadius = 14
    let cameraTheta = Math.PI / 3.4 // ~53 graus de elevação
    let cameraPhi = 0 // Alinhado para olhar para frente (em direção ao -Z)
    let isTrackingBall = true

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 150)

    const updateCameraTransform = () => {
      const sinTheta = Math.sin(cameraTheta)
      const cosTheta = Math.cos(cameraTheta)
      const sinPhi = Math.sin(cameraPhi)
      const cosPhi = Math.cos(cameraPhi)

      camera.position.set(
        cameraTarget.x + cameraRadius * sinTheta * sinPhi,
        cameraTarget.y + cameraRadius * cosTheta,
        cameraTarget.z + cameraRadius * sinTheta * cosPhi,
      )
      camera.lookAt(cameraTarget.x, cameraTarget.y + 0.35, cameraTarget.z)
    }

    updateCameraTransform()

    const centerOnBall = () => {
      const me = ballsMap.get(localPeerId)
      if (me) {
        cameraTarget.set(me.x, 0, me.z)
      } else {
        cameraTarget.set(course.tee.x, 0, course.tee.z)
      }
      cameraRadius = 14
      cameraTheta = Math.PI / 3.4
      cameraPhi = 0
      isTrackingBall = true
    }
    centerOnBallRef.current = centerOnBall

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    // ─── Iluminação Vívida e Clara ───────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95)
    scene.add(ambientLight)

    const hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0x166534, 0.75)
    scene.add(hemiLight)

    const sunLight = new THREE.DirectionalLight(0xffedd5, 1.35)
    sunLight.position.set(12, 24, 16)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.width = 2048
    sunLight.shadow.mapSize.height = 2048
    sunLight.shadow.camera.near = 0.5
    sunLight.shadow.camera.far = 80
    sunLight.shadow.camera.left = -25
    sunLight.shadow.camera.right = 25
    sunLight.shadow.camera.top = 25
    sunLight.shadow.camera.bottom = -25
    sunLight.shadow.bias = -0.0004
    scene.add(sunLight)

    // Grupo de Cenário da Pista
    const courseGroup = new THREE.Group()
    scene.add(courseGroup)

    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.6 })
    const bumperMaterial = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.25,
      metalness: 0.2,
      emissive: 0x7c2d12,
      emissiveIntensity: 0.4,
    })
    const bumperCapMaterial = new THREE.MeshStandardMaterial({
      color: 0xfde047,
      roughness: 0.2,
      metalness: 0.85,
    })
    const sandMaterial = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.9 })

    // Renderiza cada Tile da pista com cores vivas
    course.tiles.forEach((tile) => {
      const isGreen = tile.type === 'green'
      const isTee = tile.type === 'tee'
      const turfMat = new THREE.MeshStandardMaterial({
        color: isGreen ? 0x4ade80 : (tile.gx + tile.gz) % 2 === 0 ? 0x22c55e : 0x16a34a,
        roughness: 0.7,
      })
      const tileMesh = new THREE.Mesh(new THREE.BoxGeometry(TILE_SIZE, 0.2, TILE_SIZE), turfMat)
      tileMesh.position.set(tile.cx, -0.1, tile.cz)
      tileMesh.receiveShadow = true
      courseGroup.add(tileMesh)

      if (isTee) {
        const teeMarker = new THREE.Mesh(
          new THREE.BoxGeometry(1.5, 0.04, 0.65),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }),
        )
        teeMarker.position.set(tile.cx, 0.02, tile.cz + 0.3)
        teeMarker.receiveShadow = true
        courseGroup.add(teeMarker)
      }

      if (tile.type === 'ramp') {
        const rampMesh = new THREE.Mesh(
          new THREE.BoxGeometry(TILE_SIZE * 0.75, 0.16, TILE_SIZE * 0.5),
          new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.7 }),
        )
        rampMesh.position.set(tile.cx, 0.06, tile.cz)
        rampMesh.receiveShadow = true
        courseGroup.add(rampMesh)
      }
    })

    // Paredes de Madeira Externas (laterais abertas)
    course.walls.forEach((wall) => {
      const w = Math.max(0.01, wall.maxX - wall.minX)
      const d = Math.max(0.01, wall.maxZ - wall.minZ)
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), woodMaterial)
      wallMesh.position.set((wall.minX + wall.maxX) / 2, WALL_HEIGHT / 2, (wall.minZ + wall.maxZ) / 2)
      wallMesh.castShadow = true
      wallMesh.receiveShadow = true
      courseGroup.add(wallMesh)
    })

    // Caixas de Areia (Bunkers)
    course.sandTraps.forEach((sand) => {
      const w = sand.maxX - sand.minX
      const d = sand.maxZ - sand.minZ
      const sandMesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), sandMaterial)
      sandMesh.position.set((sand.minX + sand.maxX) / 2, 0.02, (sand.minZ + sand.maxZ) / 2)
      sandMesh.receiveShadow = true
      courseGroup.add(sandMesh)
    })

    // Bumpers Cilíndricos
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

    // Obstáculos Internos de Madeira
    course.obstacleBoxes.forEach((obs) => {
      const w = obs.maxX - obs.minX
      const d = obs.maxZ - obs.minZ
      const obsMesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), woodMaterial)
      obsMesh.position.set((obs.minX + obs.maxX) / 2, 0.225, (obs.minZ + obs.maxZ) / 2)
      obsMesh.castShadow = true
      obsMesh.receiveShadow = true
      courseGroup.add(obsMesh)
    })

    // Buraco + Mastro + Bandeira
    const holeMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(HOLE_RADIUS, HOLE_RADIUS, 0.05, 28),
      new THREE.MeshBasicMaterial({ color: 0x090d16 }),
    )
    holeMesh.position.set(course.hole.x, 0.01, course.hole.z)
    courseGroup.add(holeMesh)

    const holeRim = new THREE.Mesh(
      new THREE.RingGeometry(HOLE_RADIUS, HOLE_RADIUS + 0.08, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
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
    const flagMesh = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.4 }))
    flagMesh.position.set(course.hole.x + 0.42, 2.2, course.hole.z)
    courseGroup.add(flagMesh)

    // ─── Linha / Seta de Trajetória 3D no Chão ────────────────────────────────
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

    // Inicializa ou sincroniza bolas dos participantes SEM resetar posições existentes
    const currentParticipants = participantsRef.current
    const entries =
      currentParticipants.length > 0 ? currentParticipants : [{ peerId: localPeerId, name: localName, isLocal: true }]
    entries.forEach((p, idx) => {
      let b = ballsMap.get(p.peerId)
      if (!b) {
        const pos = spawnPositionForIndex(course.tee, idx, entries.length)
        b = {
          peerId: p.peerId,
          name: p.name,
          color: colorFromString(p.peerId),
          x: pos.x,
          y: BALL_RADIUS,
          z: pos.z,
          vx: 0,
          vz: 0,
          strokes: 0,
          inHole: false,
          lastRestingX: pos.x,
          lastRestingZ: pos.z,
        }
        ballsMap.set(p.peerId, b)
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

    // ─── ENTRADA DO USUÁRIO: MIRA vs NAVEGAÇÃO LIVRE DA CÂMERA ───────────────
    const raycaster = new THREE.Raycaster()
    const hitPoint = new THREE.Vector3()

    let isAiming = false
    let isOrbiting = false
    let isPanning = false
    let dragPlane: THREE.Plane | null = null
    let lastPointerX = 0
    let lastPointerY = 0

    const getPointOnPlane = (clientX: number, clientY: number, plane: THREE.Plane): THREE.Vector3 | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return null
      const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1
      const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera)
      return raycaster.ray.intersectPlane(plane, hitPoint)
    }

    const orbitCamera = (dx: number, dy: number) => {
      cameraPhi -= dx * 0.007
      cameraTheta = Math.max(0.22, Math.min(1.36, cameraTheta + dy * 0.005))
    }

    const panCamera = (dx: number, dy: number) => {
      const rightX = Math.cos(cameraPhi)
      const rightZ = -Math.sin(cameraPhi)
      const forwardX = -Math.sin(cameraPhi)
      const forwardZ = -Math.cos(cameraPhi)

      const panSpeed = cameraRadius * 0.0018
      cameraTarget.x += (-dx * rightX + dy * forwardX) * panSpeed
      cameraTarget.z += (-dx * rightZ + dy * forwardZ) * panSpeed
    }

    const updateAimArrowVisual = (ballX: number, ballZ: number, angle: number, clampedDist: number, ratio: number) => {
      if (clampedDist < 0.12) {
        aimGroup.visible = false
        return
      }
      aimGroup.visible = true
      aimGroup.position.set(ballX, 0.04, ballZ)
      aimGroup.rotation.y = -angle

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
      if (isAiming) {
        if (!dragPlane) return
        const myBall = ballsMap.get(localPeerId)
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
        return
      }

      const dx = e.clientX - lastPointerX
      const dy = e.clientY - lastPointerY
      lastPointerX = e.clientX
      lastPointerY = e.clientY

      if (isOrbiting) {
        if (e.shiftKey) {
          panCamera(dx, dy)
        } else {
          orbitCamera(dx, dy)
        }
      } else if (isPanning) {
        panCamera(dx, dy)
      }
    }

    const onGlobalPointerUp = (e: PointerEvent) => {
      if (isAiming) {
        isAiming = false
        aimGroup.visible = false
        setPowerPct(0)

        const myBall = ballsMap.get(localPeerId)
        if (myBall && !myBall.inHole && dragPlane) {
          const pt = getPointOnPlane(e.clientX, e.clientY, dragPlane)
          if (pt) {
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
              isTrackingBall = true
              onSendStroke(vx, vz)
            }
          }
        }
      }

      isOrbiting = false
      isPanning = false
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('pointerup', onGlobalPointerUp)
    }

    const onCanvasPointerDown = (e: PointerEvent) => {
      lastPointerX = e.clientX
      lastPointerY = e.clientY

      const myBall = ballsMap.get(localPeerId)

      // Regra de Ouro: clique na bola ativa a Mira
      if (e.button === 0 && myBall && !myBall.inHole && Math.hypot(myBall.vx, myBall.vz) <= 0.002) {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_RADIUS)
        const pt = getPointOnPlane(e.clientX, e.clientY, plane)
        if (pt && Math.hypot(pt.x - myBall.x, pt.z - myBall.z) <= 2.2) {
          isAiming = true
          dragPlane = plane
          window.addEventListener('pointermove', onGlobalPointerMove)
          window.addEventListener('pointerup', onGlobalPointerUp)
          return
        }
      }

      // Caso contrário, ativa navegação livre da câmera (Orbit ou Pan)
      if (e.button === 0) {
        isOrbiting = true
      } else if (e.button === 2) {
        isPanning = true
      }
      isTrackingBall = false
      window.addEventListener('pointermove', onGlobalPointerMove)
      window.addEventListener('pointerup', onGlobalPointerUp)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      cameraRadius = Math.max(5.5, Math.min(32, cameraRadius + e.deltaY * 0.015))
    }

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        const activeTag = (document.activeElement?.tagName || '').toLowerCase()
        if (activeTag === 'input' || activeTag === 'textarea') return
        e.preventDefault()
        centerOnBall()
      }
    }

    const domEl = renderer.domElement
    domEl.addEventListener('pointerdown', onCanvasPointerDown)
    domEl.addEventListener('wheel', onWheel, { passive: false })
    domEl.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKeyDown)

    // ─── Loop de Física e Renderização 60 FPS ─────────────────────────────────
    let animId = 0
    const animate = () => {
      animId = requestAnimationFrame(animate)

      const myBall = ballsMap.get(localPeerId)

      // Segue a bola suavemente com a câmera quando em modo de acompanhamento
      if (isTrackingBall && myBall) {
        cameraTarget.x += (myBall.x - cameraTarget.x) * 0.08
        cameraTarget.z += (myBall.z - cameraTarget.z) * 0.08
      }

      updateCameraTransform()

      for (const b of ballsMap.values()) {
        if (!b.inHole && (Math.abs(b.vx) > 0.0001 || Math.abs(b.vz) > 0.0001)) {
          b.x += b.vx
          b.z += b.vz

          // Verifica se está dentro de caixa de areia (Bunker)
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

          // Colisão com Bumpers Cilíndricos
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
            b.lastRestingX = b.x
            b.lastRestingZ = b.z
            syncScoreboardUi()
          }
        }

        // Recuperação de segurança se a bola cair para fora da pista no abismo (y < -2.0)
        if (b.y < -2.0) {
          b.x = b.lastRestingX ?? course.tee.x
          b.z = b.lastRestingZ ?? course.tee.z
          b.y = BALL_RADIUS
          b.vx = 0
          b.vz = 0
          syncScoreboardUi()
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
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointermove', onGlobalPointerMove)
      window.removeEventListener('pointerup', onGlobalPointerUp)
      domEl.removeEventListener('pointerdown', onCanvasPointerDown)
      domEl.removeEventListener('wheel', onWheel)
      domEl.removeEventListener('contextmenu', onContextMenu)
      for (const b of ballsMap.values()) {
        b.mesh = undefined
        b.labelSprite = undefined
      }
      renderer.dispose()
    }
  }, [open, courseSeed, localPeerId, localName, onSendStroke, syncScoreboardUi])

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

            {/* Banner Superior com Botão Focar Bola e Status */}
            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-center justify-between gap-2 z-10">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => centerOnBallRef.current()}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/80 px-3 py-1.5 text-xs font-bold text-emerald-400 shadow-lg backdrop-blur transition hover:bg-black hover:text-white"
                  title="Centralizar câmera na sua bola (Espaço)"
                >
                  <Target size={14} className="text-emerald-400" />
                  <span>Centralizar na Bola (Espaço)</span>
                </button>

                <span className="rounded-lg bg-black/75 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur border border-white/5">
                  {localInHole ? (
                    <span className="text-emerald-400 font-bold">🎉 Bola no buraco! Aguarde os outros jogadores.</span>
                  ) : localMoving ? (
                    <span className="text-amber-300 font-bold">⚡ Bola em movimento...</span>
                  ) : (
                    <span>⛳ Puxe sua bola para trás para mirar</span>
                  )}
                </span>
              </div>

              <span className="rounded-full bg-slate-900/85 px-2.5 py-1 text-[11px] font-bold text-zinc-300 backdrop-blur border border-white/10">
                Buraco {holeNumber} • Par {currentPar}
              </span>
            </div>

            {/* Medidor e Barra de Força Fixo no Canto Inferior Direito */}
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

            <div className="mt-4 rounded-xl border border-white/5 bg-white/[0.03] p-3 text-[11px] text-zinc-400 leading-relaxed">
              <p className="font-semibold text-white">Controles:</p>
              <ul className="mt-1 space-y-1">
                <li>• <b>Puxar o taco:</b> Clique e arraste sua bola para trás.</li>
                <li>• <b>Girar câmera:</b> Arraste com o botão esquerdo no cenário.</li>
                <li>• <b>Mover visão (Pan):</b> Arraste com o botão direito.</li>
                <li>• <b>Zoom:</b> Roda do mouse (scroll).</li>
                <li>• <b>Focar bola:</b> Pressione <b>Espaço</b> ou use o botão no topo.</li>
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
