import { type WebGLRenderTarget } from 'three';
import { FluidEffectPass } from '../FluidEffectPass.js';
import type { FluidSimulation } from '../../simulation/FluidSimulation.js';
/** Refraction through density-as-height: density gradient bends UVs with a per-channel Snell split. */
export declare class WaterDistortionPass extends FluidEffectPass {
    private readonly fluid;
    intensity: number;
    constructor(fluid: FluidSimulation);
    protected updateUniforms(readBuffer: WebGLRenderTarget): void;
}
