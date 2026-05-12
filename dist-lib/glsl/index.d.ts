/**
 * Public entry for the GLSL/WebGL pipeline — `import { ... } from 'three-fluid-fx'`.
 *
 * Stays in lockstep with `src/core/tsl/index.ts` for the WebGPU/TSL pipeline:
 * the same conceptual API (`FluidSimulation`, `attachPointerSplats`, ...) is
 * exported from both, with pipeline-specific implementations.
 */
export { FluidSimulation, FLUID_PROFILES } from './simulation/FluidSimulation.js';
export type { FluidSimulationOptions, FluidSplatOptions, FluidProfile, } from './simulation/FluidSimulation.js';
export { attachPointerSplats } from '../shared/pointerSplats.js';
export type { AttachPointerSplatsOptions } from '../shared/pointerSplats.js';
export { FullscreenPass, FULLSCREEN_VERTEX } from './effects/FullscreenPass.js';
export { createSceneTarget } from './effects/createSceneTarget.js';
export { FluidEffectPass } from './effects/FluidEffectPass.js';
export { SimpleDistortionPass } from './effects/distortion/SimpleDistortionPass.js';
export { RGBShiftDistortionPass } from './effects/distortion/RGBShiftDistortionPass.js';
export { ChromaticDistortionPass } from './effects/distortion/ChromaticDistortionPass.js';
export { WaterDistortionPass } from './effects/distortion/WaterDistortionPass.js';
export { WaterCausticsDistortionPass } from './effects/distortion/WaterCausticsDistortionPass.js';
export { DefaultOverlayPass } from './effects/overlay/DefaultOverlayPass.js';
export { VolumeCursorOverlayPass } from './effects/overlay/VolumeCursorOverlayPass.js';
export { TrailOverlayPass } from './effects/overlay/TrailOverlayPass.js';
export { OilOverlayPass } from './effects/overlay/OilOverlayPass.js';
export { VelocityOverlayPass } from './effects/overlay/VelocityOverlayPass.js';
export { ColorfulOverlayPass } from './effects/overlay/ColorfulOverlayPass.js';
export { RainbowFishOverlayPass } from './effects/overlay/RainbowFishOverlayPass.js';
export { GlazeOverlayPass } from './effects/overlay/GlazeOverlayPass.js';
export { BurnOverlayPass } from './effects/overlay/BurnOverlayPass.js';
export { SmokeOverlayPass } from './effects/overlay/SmokeOverlayPass.js';
export { ArtInkOverlayPass } from './effects/overlay/ArtInkOverlayPass.js';
export { RainbowInkOverlayPass } from './effects/overlay/RainbowInkOverlayPass.js';
export { ColorWaterOverlayPass } from './effects/overlay/ColorWaterOverlayPass.js';
export { LiquidLensOverlayPass } from './effects/overlay/LiquidLensOverlayPass.js';
export { DensityTintOverlayPass } from './effects/overlay/DensityTintOverlayPass.js';
