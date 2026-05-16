import { type InstancedBufferGeometry, type InstancedMesh } from 'three'
import type { MeshBasicNodeMaterial, Renderer } from 'three/webgpu'
import {
  createWGSLFlowParticles,
  type FlowParticles,
  type FlowParticlesStepParams,
} from './WGSLFlowParticles'

const DEFAULT_HOLD_SECONDS = 6.5
const DEFAULT_MORPH_SECONDS = 4.8
const TEXT_SINGLE_FONT_SIZE = 184
const TEXT_STACKED_FONT_SIZE = 150
const TEXT_DEPTH = 0.34
const TREFOIL_Z_ROTATION = Math.PI / 2
const GOLDEN_ANGLE = 2.399963229728653
const TAU = Math.PI * 2

type MorphTarget = Float32Array
type Vec3Tuple = readonly [number, number, number]

export interface MorphFlowParticlesOptions {
  size?: number
  holdSeconds?: number
  morphSeconds?: number
}

export class MorphFlowParticles {
  readonly mesh: InstancedMesh<InstancedBufferGeometry, MeshBasicNodeMaterial>
  holdSeconds: number
  morphSeconds: number

  private readonly particles: FlowParticles
  private readonly size: number
  private readonly count: number
  private readonly targets: MorphTarget[]
  private readonly destinationData: Float32Array

  constructor(renderer: Renderer, options: MorphFlowParticlesOptions = {}) {
    this.size = options.size ?? 64
    this.count = this.size * this.size
    this.holdSeconds = options.holdSeconds ?? DEFAULT_HOLD_SECONDS
    this.morphSeconds = options.morphSeconds ?? DEFAULT_MORPH_SECONDS
    this.targets = [
      this.createSphereTarget(),
      this.createTetraTarget(),
      this.createTrefoilTarget(),
      this.createTextTarget('TSL'),
      this.createTextTarget(['GL', 'SL']),
    ]
    this.destinationData = new Float32Array(this.count * 4)
    this.particles = createWGSLFlowParticles(renderer, {
      mode: 'cloud3d',
      size: this.size,
    })
    this.mesh = this.particles.mesh
    this.updateDestination(0)
  }

  step(params: FlowParticlesStepParams, timeSeconds: number): void {
    this.updateDestination(timeSeconds)
    this.particles.step(params)
  }

  reset(): void {
    this.particles.reset()
    this.updateDestination(0)
  }

  dispose(): void {
    this.particles.dispose()
  }

  private updateDestination(timeSeconds: number): void {
    const holdSeconds = Math.max(0.1, this.holdSeconds)
    const morphSeconds = Math.max(0.1, this.morphSeconds)
    const segmentSeconds = holdSeconds + morphSeconds
    const cycle = this.targets.length
    const cycleSeconds = segmentSeconds * cycle
    const phaseSeconds = positiveModulo(timeSeconds, cycleSeconds)
    const fromIndex = Math.floor(phaseSeconds / segmentSeconds)
    const toIndex = (fromIndex + 1) % cycle
    const localSeconds = phaseSeconds - fromIndex * segmentSeconds
    const progress =
      localSeconds <= holdSeconds
        ? 0
        : Math.min(1, Math.max(0, (localSeconds - holdSeconds) / morphSeconds))
    const eased = easeInOutCubic(progress)
    const from = this.targets[fromIndex]
    const to = this.targets[toIndex]
    const data = this.destinationData

    for (let i = 0; i < data.length; i += 4) {
      data[i] = lerp(from[i], to[i], eased)
      data[i + 1] = lerp(from[i + 1], to[i + 1], eased)
      data[i + 2] = lerp(from[i + 2], to[i + 2], eased)
      data[i + 3] = lerp(from[i + 3], to[i + 3], eased)
    }

    this.particles.setDestinationData(data)
  }

  private createSphereTarget(): MorphTarget {
    const data = new Float32Array(this.count * 4)
    const radius = 1.7

    for (let i = 0; i < this.count; i += 1) {
      const yNorm = 1 - 2 * ((i + 0.5) / this.count)
      const ring = Math.sqrt(Math.max(0, 1 - yNorm * yNorm))
      const theta = i * GOLDEN_ANGLE
      const offset = i * 4
      data[offset] = Math.cos(theta) * ring * radius
      data[offset + 1] = yNorm * radius
      data[offset + 2] = Math.sin(theta) * ring * radius
      data[offset + 3] = 0.82
    }

    return data
  }

  private createTetraTarget(): MorphTarget {
    const data = new Float32Array(this.count * 4)
    const random = mulberry32(0xced1ce)
    const top: Vec3Tuple = [0, 1.78, 0]
    const bottom: Vec3Tuple = [0, -1.78, 0]
    const ringRadius = 1.78
    const ring: Vec3Tuple[] = [0, 1, 2].map((index) => {
      const angle = -Math.PI / 2 + (index / 3) * TAU
      return [Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius] as const
    })
    const faces: readonly (readonly [Vec3Tuple, Vec3Tuple, Vec3Tuple])[] = [
      [top, ring[0], ring[1]],
      [top, ring[1], ring[2]],
      [top, ring[2], ring[0]],
      [bottom, ring[1], ring[0]],
      [bottom, ring[2], ring[1]],
      [bottom, ring[0], ring[2]],
    ]

    for (let i = 0; i < this.count; i += 1) {
      const face = faces[i % faces.length]
      const point = sampleTriangle(face[0], face[1], face[2], random(), random())
      const offset = i * 4
      data[offset] = point[0]
      data[offset + 1] = point[1]
      data[offset + 2] = point[2]
      data[offset + 3] = 0.95
    }

    return data
  }

  private createTrefoilTarget(): MorphTarget {
    const data = new Float32Array(this.count * 4)
    const random = mulberry32(0x7eefe011)
    const scale = 0.85

    for (let i = 0; i < this.count; i += 1) {
      const t = (i / this.count) * TAU
      const tubeAngle = random() * TAU
      const tubeRadius = Math.sqrt(random()) * 0.26 * scale
      const offset = i * 4
      const x = Math.sin(t) + 2 * Math.sin(2 * t)
      const y = Math.cos(t) - 2 * Math.cos(2 * t)
      const z = -Math.sin(3 * t)
      const baseX = x * 0.62 * scale + Math.cos(tubeAngle) * tubeRadius
      const baseY = y * 0.62 * scale + Math.sin(tubeAngle) * tubeRadius
      const rotated = rotateZ(baseX, baseY, TREFOIL_Z_ROTATION)

      data[offset] = rotated[0]
      data[offset + 1] = rotated[1]
      data[offset + 2] = z * 0.62 * scale + (random() - 0.5) * 0.3 * scale
      data[offset + 3] = 0.9
    }

    return data
  }

  private createTextTarget(text: string | string[]): MorphTarget {
    const canvas = document.createElement('canvas')
    const width = 768
    const height = 256
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return this.createSphereTarget()

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'

    const lines = Array.isArray(text) ? text : [text]
    const fontSize = lines.length > 1 ? TEXT_STACKED_FONT_SIZE : TEXT_SINGLE_FONT_SIZE
    const lineHeight = fontSize * 0.74
    const letterSpacing = lines.length > 1 ? -10 : -14
    ctx.font = `850 ${fontSize}px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif`

    for (let i = 0; i < lines.length; i += 1) {
      const y = height / 2 + (i - (lines.length - 1) / 2) * lineHeight + 2
      drawTrackedText(ctx, lines[i], width / 2, y, letterSpacing)
    }

    const pixels = ctx.getImageData(0, 0, width, height).data
    const points: { x: number; y: number }[] = []
    let minX = width
    let maxX = 0
    let minY = height
    let maxY = 0
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        if (pixels[(y * width + x) * 4 + 3] > 32) {
          points.push({ x, y })
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
      }
    }

    const textCenterX = points.length > 0 ? (minX + maxX) / 2 : width / 2
    const textCenterY = points.length > 0 ? (minY + maxY) / 2 : height / 2
    const data = new Float32Array(this.count * 4)
    const random = mulberry32(hashString(lines.join('/')))
    for (let i = 0; i < this.count; i += 1) {
      const point = points[Math.floor(random() * points.length)] ?? {
        x: textCenterX,
        y: textCenterY,
      }
      const offset = i * 4
      data[offset] = (point.x - textCenterX) / 76 + (random() - 0.5) * 0.035
      data[offset + 1] = -(point.y - textCenterY) / 76 + (random() - 0.5) * 0.035
      data[offset + 2] = (random() - 0.5) * TEXT_DEPTH
      data[offset + 3] = 1.08
    }

    return data
  }
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  letterSpacing: number,
): void {
  const chars = [...text]
  const textWidth =
    chars.reduce((width, char) => width + ctx.measureText(char).width, 0) +
    Math.max(0, chars.length - 1) * letterSpacing
  let x = centerX - textWidth / 2

  for (const char of chars) {
    ctx.fillText(char, x, y)
    x += ctx.measureText(char).width + letterSpacing
  }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

function rotateZ(x: number, y: number, angle: number): readonly [number, number] {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return [x * c - y * s, x * s + y * c]
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function sampleTriangle(
  a: Vec3Tuple,
  b: Vec3Tuple,
  c: Vec3Tuple,
  r1: number,
  r2: number,
): Vec3Tuple {
  const sr1 = Math.sqrt(r1)
  const wa = 1 - sr1
  const wb = sr1 * (1 - r2)
  const wc = sr1 * r2
  return [
    a[0] * wa + b[0] * wb + c[0] * wc,
    a[1] * wa + b[1] * wb + c[1] * wc,
    a[2] * wa + b[2] * wb + c[2] * wc,
  ]
}

function hashString(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
