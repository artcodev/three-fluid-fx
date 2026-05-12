import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Density-driven chromatic R/B split along the flow direction; G stays put. */
export declare class RGBShiftDistortionPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
