/**
 * Public entry for the TSL/WebGPU pipeline — `import { ... } from 'three-fluid-fx/tsl'`.
 *
 * The simulation is WGSL/WebGPU compute-backed, while effects remain TSL
 * nodes that consume the simulation output as TextureNodes.
 */

// Simulation
export {
  WGSLFluidSimulation,
  WGSLFluidSimulation as FluidSimulation,
} from './simulation/WGSLFluidSimulation'
export { FLUID_PROFILES } from './simulation/types'
export type {
  FluidSimulationOptions,
  FluidSplatOptions,
  FluidProfile,
  IFluidSimulation,
} from './simulation/types'

// Pointer splat helper — pipeline-agnostic, lives in core/shared.
export { attachPointerSplats } from '../shared/pointerSplats'
export type { AttachPointerSplatsOptions } from '../shared/pointerSplats'

// Effects — function-based public API per three.js TSL convention. Internal
// `*Node` classes are also exported for consumers that want to subclass.
export {
  chromaticDistortion,
  ChromaticDistortionNode,
} from './effects/distortion/ChromaticDistortionNode'
export { simpleDistortion, SimpleDistortionNode } from './effects/distortion/SimpleDistortionNode'
export {
  rgbShiftDistortion,
  RGBShiftDistortionNode,
} from './effects/distortion/RGBShiftDistortionNode'
export { waterDistortion, WaterDistortionNode } from './effects/distortion/WaterDistortionNode'
export {
  waterCausticsDistortion,
  WaterCausticsDistortionNode,
} from './effects/distortion/WaterCausticsDistortionNode'
export {
  densityTintOverlay,
  DensityTintOverlayNode,
  type DensityTintOverlayOptions,
} from './effects/overlay/DensityTintOverlayNode'
export {
  artInkOverlay,
  burnOverlay,
  colorWaterOverlay,
  colorfulOverlay,
  defaultOverlay,
  FluidOverlayNode,
  fluidOverlay,
  glazeOverlay,
  liquidLensOverlay,
  oilOverlay,
  rainbowFishOverlay,
  rainbowInkOverlay,
  smokeOverlay,
  trailOverlay,
  velocityOverlay,
  volumeCursorOverlay,
  type FluidOverlayOptions,
  type FluidOverlayStyle,
} from './effects/overlay/FluidOverlayNode'
