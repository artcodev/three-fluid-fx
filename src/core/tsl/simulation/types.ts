import type { TextureNode } from 'three/webgpu'

export const FLUID_PROFILES = {
  performance: { simResolution: 128, dyeResolution: 256, pressureIterations: 6 },
  balanced: { simResolution: 256, dyeResolution: 512, pressureIterations: 12 },
  quality: { simResolution: 384, dyeResolution: 1024, pressureIterations: 20 },
} as const

export type FluidProfile = keyof typeof FLUID_PROFILES

export interface FluidSimulationOptions {
  profile?: FluidProfile
  simResolution?: number
  dyeResolution?: number
  pressureIterations?: number
  densityDissipation?: number
  velocityDissipation?: number
  pressureDissipation?: number
  curlStrength?: number
  splatRadius?: number
  splatForce?: number
  baseDelta?: number
  dyeDissipation?: number
  enableVorticity?: boolean
  bfecc?: boolean
  reflectWalls?: boolean
}

export interface FluidSplatOptions {
  radius?: number
  color?: [number, number, number]
  dyeColor?: [number, number, number]
}

export interface IFluidSimulation {
  splatRadius: number
  splatForce: number
  readonly densityNode: TextureNode
  readonly dyeNode: TextureNode
  readonly velocityNode: TextureNode
  readonly pressureNode: TextureNode
  readonly divergenceNode: TextureNode
  readonly curlNode: TextureNode
  resize(width: number, height: number): void
  addSplat(x01: number, y01: number, dx: number, dy: number, options?: FluidSplatOptions): void
  step(deltaSeconds: number): void
  dispose(): void
}
