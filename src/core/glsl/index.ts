/**
 * Public entry for the GLSL/WebGL pipeline — `import { ... } from 'three-fluid-fx'`.
 *
 * Stays in lockstep with `src/core/tsl/index.ts` for the WebGPU/TSL pipeline:
 * the same conceptual API (`FluidSimulation`, `attachPointerSplats`, ...) is
 * exported from both, with pipeline-specific implementations.
 */

// Solver
export { FluidSimulation, FLUID_PROFILES } from './simulation/FluidSimulation'
export type {
  FluidSimulationOptions,
  FluidSplatOptions,
  FluidProfile,
} from './simulation/FluidSimulation'

// Pointer splat helper — agnostic, lives in core/shared.
export { attachPointerSplats } from '../shared/pointerSplats'
export type { AttachPointerSplatsOptions } from '../shared/pointerSplats'

// Post-processing helpers
export { FullscreenPass, FULLSCREEN_VERTEX } from './effects/FullscreenPass'
export { createSceneTarget } from './effects/createSceneTarget'
export { FluidEffectPass } from './effects/FluidEffectPass'

// Distortion passes
export { SimpleDistortionPass } from './effects/distortion/SimpleDistortionPass'
export { RGBShiftDistortionPass } from './effects/distortion/RGBShiftDistortionPass'
export { ChromaticDistortionPass } from './effects/distortion/ChromaticDistortionPass'
export { WaterDistortionPass } from './effects/distortion/WaterDistortionPass'
export { WaterCausticsDistortionPass } from './effects/distortion/WaterCausticsDistortionPass'

// Overlay passes
export { DefaultOverlayPass } from './effects/overlay/DefaultOverlayPass'
export { VolumeCursorOverlayPass } from './effects/overlay/VolumeCursorOverlayPass'
export { TrailOverlayPass } from './effects/overlay/TrailOverlayPass'
export { OilOverlayPass } from './effects/overlay/OilOverlayPass'
export { VelocityOverlayPass } from './effects/overlay/VelocityOverlayPass'
export { ColorfulOverlayPass } from './effects/overlay/ColorfulOverlayPass'
export { RainbowFishOverlayPass } from './effects/overlay/RainbowFishOverlayPass'
export { GlazeOverlayPass } from './effects/overlay/GlazeOverlayPass'
export { BurnOverlayPass } from './effects/overlay/BurnOverlayPass'
export { SmokeOverlayPass } from './effects/overlay/SmokeOverlayPass'
export { ArtInkOverlayPass } from './effects/overlay/ArtInkOverlayPass'
export { RainbowInkOverlayPass } from './effects/overlay/RainbowInkOverlayPass'
export { ColorWaterOverlayPass } from './effects/overlay/ColorWaterOverlayPass'
export { LiquidLensOverlayPass } from './effects/overlay/LiquidLensOverlayPass'
export { DensityTintOverlayPass } from './effects/overlay/DensityTintOverlayPass'
