/**
 * Public entry for the TSL/WebGPU pipeline — `import { ... } from 'three-fluid-fx/tsl'`.
 *
 * The simulation is WGSL/WebGPU compute-backed, while effects remain TSL
 * nodes that consume the simulation output as TextureNodes.
 */
export { WGSLFluidSimulation, WGSLFluidSimulation as FluidSimulation, } from './simulation/WGSLFluidSimulation.js';
export { FLUID_PROFILES } from './simulation/types.js';
export type { FluidSimulationOptions, FluidSplatOptions, FluidProfile, IFluidSimulation, } from './simulation/types.js';
export { attachPointerSplats } from '../shared/pointerSplats.js';
export type { AttachPointerSplatsOptions } from '../shared/pointerSplats.js';
export { chromaticDistortion, ChromaticDistortionNode, } from './effects/distortion/ChromaticDistortionNode.js';
export { simpleDistortion, SimpleDistortionNode } from './effects/distortion/SimpleDistortionNode.js';
export { rgbShiftDistortion, RGBShiftDistortionNode, } from './effects/distortion/RGBShiftDistortionNode.js';
export { waterDistortion, WaterDistortionNode } from './effects/distortion/WaterDistortionNode.js';
export { waterCausticsDistortion, WaterCausticsDistortionNode, } from './effects/distortion/WaterCausticsDistortionNode.js';
export { densityTintOverlay, DensityTintOverlayNode, type DensityTintOverlayOptions, } from './effects/overlay/DensityTintOverlayNode.js';
export { artInkOverlay, burnOverlay, colorWaterOverlay, colorfulOverlay, defaultOverlay, FluidOverlayNode, fluidOverlay, glazeOverlay, liquidLensOverlay, oilOverlay, rainbowFishOverlay, rainbowInkOverlay, smokeOverlay, trailOverlay, velocityOverlay, volumeCursorOverlay, type FluidOverlayOptions, type FluidOverlayStyle, } from './effects/overlay/FluidOverlayNode.js';
