import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Velocity-refracted scene + multiplicative dye tint (dreamers.js port). */
export declare class LiquidLensOverlayPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    vibrance: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
